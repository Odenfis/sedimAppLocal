'use strict';

require('dotenv').config();
const { getConnection, closeConnections, sql } = require('../db');
const { normalizeCompany } = require('../lib/company-context');

function selectedCompany(args = process.argv.slice(2)) {
    const raw = args.find(value => value.startsWith('--empresa='))?.split('=')[1] || '2';
    return normalizeCompany(raw);
}

async function inspect(pool, selected) {
    const configuration = (await pool.request()
        .input('numero', sql.Int, selected.numeroTabla)
        .query(`SELECT c_describe FROM Tablas WHERE n_codtabla=23 AND n_numero=@numero`)).recordset[0];
    if (!configuration || !String(configuration.c_describe || '').trim().includes('-')) {
        const error = new Error(`No existe correlativo valido para empresa ${selected.empresa}.`);
        error.code = 'INVALID_COMPANY_CONFIGURATION';
        throw error;
    }
    const table = (await pool.request()
        .input('empresa', sql.Int, selected.empresa)
        .query(`SELECT TOP 1 Numero,CONVERT(INT,Empresa) Empresa FROM Mesas WHERE Empresa=@empresa ORDER BY Numero`)).recordset[0];
    if (!table) {
        const error = new Error(`No existen mesas para empresa ${selected.empresa}.`);
        error.code = 'COMPANY_WITHOUT_TABLES';
        throw error;
    }
    return { prefix: String(configuration.c_describe).trim().split('-')[0], table };
}

async function main(args = process.argv.slice(2)) {
    const selected = selectedCompany(args);
    const pool = await getConnection();
    try {
        const report = await inspect(pool, selected);
        console.log(`[POS] Empresa=${selected.empresa}; codigo=${selected.codigo}; tabla=${selected.numeroTabla}; prefijo=${report.prefix}; mesa=${report.table.Numero}; empresaMesa=${report.table.Empresa}.`);
        console.log('[POS] Contexto de empresa y lectura de Mesas correctos; no se modificaron datos.');
        return 0;
    } finally { await closeConnections(); }
}

if (require.main === module) main().then(code => { process.exitCode = code; }).catch(async error => {
    console.error(`[POS] Diagnostico fallido: codigo=${error?.code || error?.number || 'sin_codigo'}; detalle=${String(error?.message || error).replace(/\s+/g, ' ').slice(0, 240)}`);
    await closeConnections();
    process.exitCode = 1;
});

module.exports = { selectedCompany, inspect };
