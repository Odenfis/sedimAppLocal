const sql = require('mssql');
require('dotenv').config();

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    server: process.env.DB_SERVER,
    port: 1433,
    database: process.env.DB_NAME,
    options: {
        encrypt: false, // Cambiado a false para conexión local
        trustServerCertificate: true
    }
};


async function getConnection() {
    try {
        const pool = await sql.connect(config);
        return pool;
    } catch (err) {
        console.error('Error conectando a Azure SQL', err);
    }
}

module.exports = { getConnection, sql };