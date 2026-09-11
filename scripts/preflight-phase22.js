'use strict';
// Read-only catalog inspection. Does not execute migrations or change business data.
require('dotenv').config();
const sql = require('mssql');
const fs = require('fs'), path = require('path');
const { validateMigration } = require('../migrate');
async function main() {
    for (const file of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter(f => f.endsWith('.sql')).sort()) {
        validateMigration(fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'), file);
        console.log(`Política de migración aprobada: ${file}`);
    }
    const pool = await new sql.ConnectionPool({ user: process.env.DB_USER, password: process.env.DB_PASS,
        server: process.env.DB_SERVER, database: process.env.DB_NAME, connectionTimeout: 5000, requestTimeout: 10000,
        options: { encrypt: false, trustServerCertificate: true } }).connect();
    try {
        const result = await pool.request().query(`
            SELECT OBJECT_NAME(c.object_id) Tabla,c.name Columna,TYPE_NAME(c.user_type_id) Tipo,c.max_length,c.is_nullable
            FROM sys.columns c WHERE c.object_id IN(OBJECT_ID('Ticket_c'),OBJECT_ID('Ticket_d'),OBJECT_ID('Cocina_pedidos')) ORDER BY Tabla,c.column_id;
            SELECT OBJECT_NAME(i.object_id) Tabla,i.name,i.is_unique FROM sys.indexes i
            WHERE i.object_id IN(OBJECT_ID('Ticket_c'),OBJECT_ID('Ticket_d'),OBJECT_ID('Cocina_pedidos'));
            SELECT name,OBJECT_NAME(parent_id) Tabla FROM sys.triggers WHERE parent_id IN(OBJECT_ID('Ticket_c'),OBJECT_ID('Ticket_d'));
            SELECT OBJECT_NAME(referencing_id) Objeto,referenced_entity_name Tabla FROM sys.sql_expression_dependencies
            WHERE referenced_entity_name IN('Ticket_c','Ticket_d','Cocina_pedidos');
            SELECT compatibility_level FROM sys.databases WHERE database_id=DB_ID();
        `);
        console.log(JSON.stringify({ columns: result.recordsets[0], indexes: result.recordsets[1], triggers: result.recordsets[2],
            dependentObjects: result.recordsets[3].length, compatibility: result.recordsets[4] }, null, 2));
        for (const file of ['002_pedido_lineas_envios.sql','003_cocina_historico.sql']) {
            const source = fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8');
            // PARSEONLY changes only the connection session; statements are not executed.
            await pool.request().query('SET PARSEONLY ON;\n' + source + '\nSET PARSEONLY OFF;');
            console.log('Sintaxis SQL validada sin ejecutar: ' + file);
        }
        console.log('Confirmar también aplicaciones externas: el catálogo no identifica todos los escritores.');
    } finally { await pool.close(); }
}
main().catch(e => { console.error(`Preflight no disponible (${e.code || e.name}). No se ejecutaron migraciones.`); process.exitCode = 1; });
