const fs = require('fs');
const path = require('path');
const { getConnection, closeConnections, sql } = require('./db');
function validateMigration(source, file) {
    const stripped = source.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    if (/\b(?:ALTER|DROP|TRUNCATE|DELETE|UPDATE|MERGE|EXEC|TRIGGER)\b/i.test(stripped)) {
        throw new Error(`Migración ${file} contiene una operación prohibida sobre el esquema protegido`);
    }
    const writes = [...stripped.matchAll(/\bINSERT\s+(?:INTO\s+)?(?:dbo\.)?\[?([A-Za-z0-9_]+)\]?/gi), ...stripped.matchAll(/\bCREATE\s+INDEX\s+\[?[A-Za-z0-9_]+\]?\s+ON\s+(?:dbo\.)?\[?([A-Za-z0-9_]+)\]?/gi)];
    for (const match of writes) {
        const table = match[1].toLowerCase();
        if (!['pedido_control','pedido_lineas','cocina_envios','cocina_envio_detalles','cocina_estados','impresion_trabajos','cocina_pedidos_legacy','cocina_pedidos','cierres_turno','cierre_turno_archivos','cierre_turno_operaciones','web_sessions','migrations'].includes(table)) {
            throw new Error(`Migración ${file} intenta escribir o indexar una tabla no autorizada: ${table}`);
        }
    }
}
async function runMigrations() {
    const pool = await getConnection();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
        await new sql.Request(tx).query(`
            DECLARE @result INT;
            EXEC @result=sp_getapplock @Resource='sedim-migrations',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=30000;
            IF @result<0 THROW 51000, 'No se obtuvo bloqueo de migraciones', 1;
            IF OBJECT_ID('Migrations') IS NULL CREATE TABLE Migrations (
                Id INT PRIMARY KEY IDENTITY(1,1), MigrationName NVARCHAR(255) NOT NULL, AppliedAt DATETIME DEFAULT GETDATE()
            );`);
        const applied = (await new sql.Request(tx).query('SELECT MigrationName FROM Migrations')).recordset.map(r => r.MigrationName);
        const files = fs.readdirSync(path.join(__dirname, 'migrations')).filter(f => f.endsWith('.sql')).sort();
        for (const file of files.filter(f => !applied.includes(f))) {
            const source = fs.readFileSync(path.join(__dirname, 'migrations', file), 'utf8');
            validateMigration(source, file);
            await new sql.Request(tx).query(source);
            await new sql.Request(tx).input('name', sql.NVarChar(255), file).query('INSERT Migrations(MigrationName) VALUES(@name)');
            console.log(`Migración preparada: ${file}`);
        }
        await tx.commit();
    } catch (e) { try { await tx.rollback(); } catch {} throw e; }
}
if (require.main === module) runMigrations().then(() => closeConnections()).catch(e => { console.error(e.message); process.exitCode = 1; closeConnections(); });
module.exports = runMigrations;
module.exports.validateMigration = validateMigration;
