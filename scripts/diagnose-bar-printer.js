'use strict';

const net = require('node:net');
const { getConnection, closeConnections } = require('../db');
const { createEscPosTcpTransport } = require('../lib/escpos-tcp');

function barConfig(env = process.env) {
    return {
        enabled: String(env.BAR_PRINTER_ENABLED || '').toLowerCase() === 'true',
        host: String(env.BAR_PRINTER_HOST || '').trim(),
        protocol: String(env.BAR_PRINTER_PROTOCOL || '').trim().toLowerCase(),
        port: Number(env.BAR_PRINTER_PORT || 9100),
        timeoutMs: Number(env.BAR_PRINTER_TIMEOUT_MS || 5000),
        codepage: String(env.BAR_PRINTER_CODEPAGE || 'cp850').trim().toLowerCase(),
        cut: String(env.BAR_PRINTER_CUT || 'true').toLowerCase() !== 'false'
    };
}

function validateConfig(config) {
    const errors = [];
    if (!config.enabled) errors.push('BAR_PRINTER_ENABLED debe ser true');
    if (!config.host) errors.push('BAR_PRINTER_HOST no está configurado');
    if (config.protocol !== 'escpos_tcp') errors.push('BAR_PRINTER_PROTOCOL debe ser escpos_tcp');
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) errors.push('BAR_PRINTER_PORT es inválido');
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 250) errors.push('BAR_PRINTER_TIMEOUT_MS debe ser un entero de al menos 250 ms');
    if (config.codepage !== 'cp850') errors.push('BAR_PRINTER_CODEPAGE debe ser cp850 para la RPT004 validada');
    return errors;
}

function probeTcp(config) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: config.host, port: config.port });
        let settled = false;
        const finish = error => {
            if (settled) return;
            settled = true;
            socket.destroy();
            error ? reject(error) : resolve();
        };
        socket.setTimeout(config.timeoutMs);
        socket.once('connect', () => finish());
        socket.once('timeout', () => finish(new Error(`timeout después de ${config.timeoutMs} ms`)));
        socket.once('error', finish);
    });
}

async function inspectDatabase() {
    const pool = await getConnection();
    const status = (await pool.request().query(`SELECT
        CASE WHEN EXISTS(SELECT 1 FROM Migrations WHERE MigrationName='008_bar_printing.sql') THEN 1 ELSE 0 END Migracion,
        CASE WHEN OBJECT_ID('dbo.Impresion_linea_rutas','U') IS NOT NULL THEN 1 ELSE 0 END Rutas,
        CASE WHEN OBJECT_ID('dbo.Impresion_barra_trabajos','U') IS NOT NULL THEN 1 ELSE 0 END Cola`)).recordset[0];
    let jobs = [];
    if (status.Cola) jobs = (await pool.request().query(`SELECT TOP 10 Id,EnvioId,Estado,Intentos,Error,Fecha,Actualizado
        FROM Impresion_barra_trabajos ORDER BY Fecha DESC`)).recordset;
    return { status, jobs };
}

function printConfig(config) {
    console.log('Configuración efectiva de Barra dentro del contenedor:');
    console.log(`  habilitada: ${config.enabled}`);
    console.log(`  destino: ${config.host || '(vacío)'}:${config.port}`);
    console.log(`  protocolo: ${config.protocol || '(vacío)'}`);
    console.log(`  timeout: ${config.timeoutMs} ms`);
    console.log(`  página: ${config.codepage}; corte: ${config.cut}`);
}

async function main(args = process.argv.slice(2)) {
    const config = barConfig();
    printConfig(config);
    const errors = validateConfig(config);
    if (errors.length) {
        for (const error of errors) console.error(`[CONFIG] ${error}`);
        return 1;
    }

    try {
        await probeTcp(config);
        console.log(`[RED] TCP ${config.host}:${config.port} accesible desde el contenedor.`);
    } catch (error) {
        console.error(`[RED] No se pudo abrir TCP ${config.host}:${config.port}: ${error.code || error.message}`);
        return 1;
    }

    try {
        const { status, jobs } = await inspectDatabase();
        console.log(`[SQL] migración 008: ${status.Migracion ? 'OK' : 'FALTA'}; rutas: ${status.Rutas ? 'OK' : 'FALTA'}; cola: ${status.Cola ? 'OK' : 'FALTA'}.`);
        if (!status.Migracion || !status.Rutas || !status.Cola) return 1;
        if (!jobs.length) console.log('[COLA] No existen trabajos de Barra. Genere una comanda nueva después de habilitarla.');
        else {
            console.log('[COLA] Últimos trabajos (sin contenido de comandas):');
            for (const job of jobs) console.log(`  ${String(job.Id).toLowerCase()} | ${job.Estado} | intentos=${job.Intentos} | ${job.Error || 'sin error'} | ${new Date(job.Fecha).toISOString()}`);
        }
    } catch (error) {
        console.error(`[SQL] No se pudo validar migración/cola: ${error.number || error.code || error.message}`);
        return 1;
    } finally {
        await closeConnections();
    }

    if (args.includes('--print')) {
        try {
            const document = ['SEDIMAPP / RPT004', 'COMANDA DE BARRA', 'Ticket PRUEBA-0001 / Envío 1', 'Mesa 00 / Mozo PRUEBA',
                new Date().toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false }), '-'.repeat(42), 'ADICIÓN',
                '1 x PRODUCTO DE PRUEBA', 'NOTA: Español á é í ó ú ñ Ñ ¿ ¡', '-'.repeat(42),
                'TCP ESC/POS: CORRECTO'].join('\n') + '\n';
            await createEscPosTcpTransport().send(document, config);
            console.log('[IMPRESIÓN] Trama transmitida. Confirme negritas, nota alta, caracteres, papel y corte.');
        } catch (error) {
            console.error(`[IMPRESIÓN] Falló la transmisión: ${error.code || error.message}`);
            return 1;
        }
    } else console.log('Diagnóstico aprobado. Para emitir papel: npm run diagnose:bar -- --print');
    return 0;
}

if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.message); process.exitCode = 1;
});

module.exports = { barConfig, validateConfig, probeTcp };
