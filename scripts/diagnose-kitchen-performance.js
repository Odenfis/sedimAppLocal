'use strict';

require('dotenv').config();
const { getConnection, closeConnections } = require('../db');
const { loadKitchenBoard } = require('../lib/orders');

const EXPECTED_MIGRATIONS = ['007_performance_indexes.sql', '009_beverage_printing.sql'];
const EXPECTED_INDEXES = [
    'IX_Pedido_control_empresa_ticket',
    'IX_Cocina_estados_activos',
    'IX_Cocina_estados_pendientes',
    'IX_Impresion_trabajos_envio_fecha',
    'IX_Impresion_trabajo_destinos_destino'
];

function selectedCompany(args = process.argv.slice(2)) {
    const raw = args.find(value => value.startsWith('--empresa='))?.split('=')[1] || '2';
    const company = Number(raw);
    if (![2, 4, 6].includes(company)) throw new Error('Use --empresa=2, --empresa=4 o --empresa=6.');
    return company;
}

async function inspect(pool) {
    const database = (await pool.request().query(`SELECT is_read_committed_snapshot_on,snapshot_isolation_state_desc
        FROM sys.databases WHERE name=DB_NAME()`)).recordset[0];
    const migrations = (await pool.request().query(`SELECT MigrationName FROM Migrations
        WHERE MigrationName IN('007_performance_indexes.sql','009_beverage_printing.sql')`)).recordset.map(row => row.MigrationName);
    const indexes = (await pool.request().query(`SELECT i.name,OBJECT_NAME(i.object_id) Tabla
        FROM sys.indexes i WHERE i.name IN(
            'IX_Pedido_control_empresa_ticket','IX_Cocina_estados_activos','IX_Cocina_estados_pendientes',
            'IX_Impresion_trabajos_envio_fecha','IX_Impresion_trabajo_destinos_destino')
        ORDER BY i.name`)).recordset;
    const volumes = (await pool.request().query(`SELECT
        (SELECT COUNT_BIG(*) FROM Pedido_control) PedidosControl,
        (SELECT COUNT_BIG(*) FROM Cocina_estados) EstadosCocina,
        (SELECT COUNT_BIG(*) FROM Cocina_estados WHERE Anulada=0 AND Estado<4) LineasActivas,
        (SELECT COUNT_BIG(*) FROM Cocina_estados WHERE PendienteId IS NOT NULL) CorreccionesPendientes,
        (SELECT COUNT_BIG(*) FROM Cocina_envios) Envios,
        (SELECT COUNT_BIG(*) FROM Impresion_trabajos) TrabajosCompartidos`)).recordset[0];
    let blockers = null;
    try {
        blockers = (await pool.request().query(`SELECT COUNT(*) Total FROM sys.dm_exec_requests
            WHERE session_id<>@@SPID AND blocking_session_id<>0`)).recordset[0].Total;
    } catch (error) {
        blockers = `no disponible (${error.number || error.code || 'sin permiso'})`;
    }
    return { database, migrations, indexes, volumes, blockers };
}

async function main(args = process.argv.slice(2)) {
    const company = selectedCompany(args);
    const pool = await getConnection();
    try {
        const report = await inspect(pool);
        const missingMigrations = EXPECTED_MIGRATIONS.filter(name => !report.migrations.includes(name));
        const indexNames = report.indexes.map(index => index.name);
        const missingIndexes = EXPECTED_INDEXES.filter(name => !indexNames.includes(name));
        console.log(`[SQL] Aislamiento: snapshot=${report.database.snapshot_isolation_state_desc}; RCSI=${Boolean(report.database.is_read_committed_snapshot_on)}.`);
        console.log(`[SQL] Migraciones: ${missingMigrations.length ? `faltan ${missingMigrations.join(', ')}` : '007 y 009 aplicadas'}.`);
        console.log(`[SQL] Índices auxiliares: ${missingIndexes.length ? `faltan ${missingIndexes.join(', ')}` : 'completos'}.`);
        console.log(`[SQL] Volúmenes: control=${report.volumes.PedidosControl}, estados=${report.volumes.EstadosCocina}, activos=${report.volumes.LineasActivas}, correcciones=${report.volumes.CorreccionesPendientes}, envíos=${report.volumes.Envios}, trabajos=${report.volumes.TrabajosCompartidos}.`);
        console.log(`[SQL] Solicitudes bloqueadas en este instante: ${report.blockers}.`);
        if (missingMigrations.length || missingIndexes.length) {
            console.warn('[KDS] Medición omitida: aplique las migraciones pendientes mediante el despliegue normal antes de consultar el Kanban.');
            return 1;
        }

        const started = performance.now();
        const board = await loadKitchenBoard(pool, company);
        const elapsedMs = performance.now() - started;
        const lines = board.pedidos.reduce((total, ticket) => total + ticket.lineas.length, 0);
        console.log(`[KDS] Empresa ${company}: ${board.pedidos.length} ticket(s), ${lines} línea(s), ${elapsedMs.toFixed(1)} ms; no se mostró contenido comercial.`);
        if (elapsedMs >= 500) console.warn('[KDS] La lectura supera la meta p95 de 500 ms; correlacione el plan de ejecución y los logs slow_sql antes de publicar.');
        else console.log('[KDS] Lectura puntual dentro de la meta de 500 ms.');
        return 0;
    } finally {
        await closeConnections();
    }
}

if (require.main === module) main().then(code => { process.exitCode = code; }).catch(async error => {
    console.error(`[KDS] Diagnóstico fallido: ${error.number || error.code || error.message}`);
    await closeConnections();
    process.exitCode = 1;
});

module.exports = { selectedCompany, EXPECTED_MIGRATIONS, EXPECTED_INDEXES };
