'use strict';
const { query, transaction } = require('./orders');
const { getPrinterConnection } = require('../db');
// A transport must be installed only after validating the actual printer/manual.
// Contract: async send(document, config) -> { transmitted: true }.
// Errors must explicitly declare beforeTransmission=true to permit automatic retry.
function classifyFailure(error, attempt) {
    return error.beforeTransmission === true ? (attempt < 3 ? 'en_cola' : 'error') : 'incierto';
}
function printerSettings(destination) {
    const prefix = destination === 'barra' ? 'BAR_PRINTER_' : 'PRINTER_';
    return {
        enabled: String(process.env[`${prefix}ENABLED`]).toLowerCase() === 'true',
        host: process.env[`${prefix}HOST`], protocol: process.env[`${prefix}PROTOCOL`],
        port: Number(process.env[`${prefix}PORT`] || 9100),
        timeoutMs: Number(process.env[`${prefix}TIMEOUT_MS`] || 5000), widthMm: 72,
        codepage: process.env[`${prefix}CODEPAGE`] || 'cp850', cut: process.env[`${prefix}CUT`] !== 'false'
    };
}
function startPrintWorker({ transport = null, intervalMs = 2000, notify = () => {}, destination = 'cocina' } = {}) {
    if (!['cocina', 'barra'].includes(destination)) throw new Error('Destino de impresión inválido');
    let stopped = false, timer;
    const config = printerSettings(destination);
    const table = destination === 'barra' ? 'Impresion_barra_trabajos' : 'Impresion_trabajos';
    if (!config.enabled || !transport) {
        console.log(`Impresión ${destination} deshabilitada: configure y habilite su impresora.`);
        return () => {};
    }
    const staleSeconds = Math.max(30, Math.ceil(config.timeoutMs / 1000) * 2 + 10);
    async function claimJob() {
        return transaction(async db => {
            const lock = (await query(db, `DECLARE @r INT; EXEC @r=sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=0; SELECT @r result;`,
                { resource: `sedim-printer-claim:${destination}` })).recordset[0];
            if (lock.result < 0) return null;
            await query(db, `UPDATE ${table} SET Estado='incierto',Error=N'Servicio interrumpido durante transmisión',Actualizado=SYSUTCDATETIME()
                WHERE Estado='procesando' AND Actualizado<DATEADD(SECOND,-@staleSeconds,SYSUTCDATETIME())`, { staleSeconds });
            const job = (await query(db, `SELECT TOP 1 * FROM ${table} WITH(UPDLOCK,READPAST)
                WHERE Estado='en_cola' AND ProximoIntento<=SYSUTCDATETIME()
                AND NOT EXISTS(SELECT 1 FROM ${table} WHERE Estado='procesando')
                ORDER BY Fecha,Id`)).recordset[0];
            if (!job) return null;
            await query(db, `UPDATE ${table} SET Estado='procesando',Intentos=Intentos+1,Actualizado=SYSUTCDATETIME() WHERE Id=@id`, { id: job.Id });
            job.Intentos++;
            return job;
        }, getPrinterConnection);
    }
    async function tick() {
        try {
            const job = await claimJob();
            if (job) {
                let state = 'enviado', error = null;
                try { const result = await transport.send(job.Documento, config); if (!result?.transmitted) throw new Error('Resultado de transmisión no confirmado'); }
                catch (e) { state = classifyFailure(e, job.Intentos); error = String(e.message).slice(0, 1000); }
                await query(await getPrinterConnection(), `UPDATE ${table} SET Estado=@state,Error=@error,Actualizado=SYSUTCDATETIME(),ProximoIntento=DATEADD(SECOND,10,SYSUTCDATETIME()) WHERE Id=@id`,
                    { id: job.Id, state, error });
                notify({ type: 'impresion_updated', envioId: job.EnvioId, estado: state, destino: destination });
            }
        } catch (e) { console.error(`Cola de impresión ${destination}:`, e.message); }
        if (!stopped) timer = setTimeout(tick, intervalMs);
    }
    tick();
    return () => { stopped = true; clearTimeout(timer); };
}
module.exports = { startPrintWorker, classifyFailure, printerSettings };
