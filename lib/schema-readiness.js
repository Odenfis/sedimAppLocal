'use strict';

const REQUIRED_TABLES = [
    'Pedido_control', 'Pedido_lineas', 'Cocina_envios', 'Cocina_envio_detalles', 'Cocina_estados',
    'Impresion_trabajos', 'Impresion_linea_rutas', 'Impresion_linea_destinos',
    'Impresion_trabajo_destinos', 'Impresion_barra_trabajos', 'Pedido_residuos_archivo'
];
const REQUIRED_INDEXES = [
    'IX_Pedido_control_empresa_ticket', 'IX_Cocina_estados_activos', 'IX_Cocina_estados_pendientes',
    'IX_Impresion_trabajos_envio_fecha', 'IX_Impresion_barra_envio_fecha',
    'IX_Impresion_linea_destinos_destino', 'IX_Impresion_trabajo_destinos_destino', 'IX_Pedido_residuos_ticket_fecha'
];
const REQUIRED_MIGRATIONS = ['007_performance_indexes.sql', '008_bar_printing.sql', '009_beverage_printing.sql', '010_repair_beverage_destinations.sql', '011_ticket_residue_archive.sql', '012_order_reference_code.sql'];
const INDEX_TABLES = {
    IX_Pedido_control_empresa_ticket: 'Pedido_control',
    IX_Cocina_estados_activos: 'Cocina_estados',
    IX_Cocina_estados_pendientes: 'Cocina_estados',
    IX_Impresion_trabajos_envio_fecha: 'Impresion_trabajos',
    IX_Impresion_barra_envio_fecha: 'Impresion_barra_trabajos',
    IX_Impresion_linea_destinos_destino: 'Impresion_linea_destinos',
    IX_Impresion_trabajo_destinos_destino: 'Impresion_trabajo_destinos',
    IX_Pedido_residuos_ticket_fecha: 'Pedido_residuos_archivo'
};

async function inspectOperationalSchema(pool) {
    const request = pool.request();
    const result = await request.query(`SELECT 'table' Kind,Required.Name,
            CASE WHEN Required.ObjectId IS NULL THEN 0 ELSE 1 END Present
        FROM (VALUES ${REQUIRED_TABLES.map(name => `('${name}',OBJECT_ID('dbo.${name}','U'))`).join(',')}) Required(Name,ObjectId)
        UNION ALL
        SELECT 'column','Pedido_control.CodigoPedido',CASE WHEN COL_LENGTH('dbo.Pedido_control','CodigoPedido') IS NULL THEN 0 ELSE 1 END
        UNION ALL
        SELECT 'index',Required.Name,CASE WHEN EXISTS(SELECT 1 FROM sys.indexes
            WHERE name=Required.Name AND object_id=Required.ObjectId) THEN 1 ELSE 0 END
        FROM (VALUES ${REQUIRED_INDEXES.map(name => `('${name}',OBJECT_ID('dbo.${INDEX_TABLES[name]}'))`).join(',')}) Required(Name,ObjectId)
        UNION ALL
        SELECT 'migration',Required.Name,CASE WHEN EXISTS(SELECT 1 FROM Migrations WHERE MigrationName=Required.Name) THEN 1 ELSE 0 END
        FROM (VALUES ${REQUIRED_MIGRATIONS.map(name => `('${name}')`).join(',')}) Required(Name);`);
    const missing = result.recordset.filter(item => !item.Present).map(item => `${item.Kind}:${item.Name}`);
    return { ready: missing.length === 0, missing };
}

async function assertOperationalSchema(pool) {
    const status = await inspectOperationalSchema(pool);
    if (!status.ready) {
        const error = new Error(`Esquema auxiliar incompleto: ${status.missing.join(', ')}`);
        error.code = 'ESCHEMA';
        error.missing = status.missing;
        throw error;
    }
    return status;
}

module.exports = { REQUIRED_TABLES, REQUIRED_INDEXES, REQUIRED_MIGRATIONS, inspectOperationalSchema, assertOperationalSchema };
