const fs = require('fs');
const path = require('path');
const { getConnection, sql } = require('./db');

async function runMigrations() {
    let pool;
    try {
        pool = await getConnection();
        console.log('🚀 Checking for pending migrations...');

        // 1. Create Migrations table if it doesn't exist
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Migrations' AND xtype='U')
            CREATE TABLE Migrations (
                Id INT PRIMARY KEY IDENTITY(1,1),
                MigrationName NVARCHAR(255) NOT NULL,
                AppliedAt DATETIME DEFAULT GETDATE()
            )
        `);

        // 2. Get list of applied migrations
        const result = await pool.request().query('SELECT MigrationName FROM Migrations');
        const appliedMigrations = result.recordset.map(r => r.MigrationName);

        // 3. Read migrations folder
        const migrationsDir = path.join(__dirname, 'migrations');
        const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

        let appliedCount = 0;

        for (const file of files) {
            if (!appliedMigrations.includes(file)) {
                console.log(`Applying migration: ${file}...`);
                const query = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
                
                await pool.request().query(query);
                await pool.request()
                    .input('name', sql.NVarChar, file)
                    .query('INSERT INTO Migrations (MigrationName) VALUES (@name)');
                
                console.log(`✅ Successfully applied ${file}`);
                appliedCount++;
            }
        }

        if (appliedCount === 0) {
            console.log('✨ Database is up to date.');
        } else {
            console.log(`📦 Applied ${appliedCount} new migrations.`);
        }

    } catch (err) {
        console.error('❌ No se pudo aplicar migraciones:', err.message);
        throw err;
    }
}

if (require.main === module) {
    runMigrations();
}

module.exports = runMigrations;
