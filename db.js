const sql = require('mssql');
require('dotenv').config();

const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    server: process.env.DB_SERVER,
    port: 1433,
    database: process.env.DB_NAME,
    connectionTimeout: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
    requestTimeout: Number(process.env.DB_REQUEST_TIMEOUT_MS || 10000),
    pool: {
        max: Number(process.env.DB_POOL_MAX || 20),
        min: Number(process.env.DB_POOL_MIN || 2),
        idleTimeoutMillis: Number(process.env.DB_POOL_IDLE_TIMEOUT_MS || 30000)
    },
    options: {
        encrypt: false, // Cambiado a false para conexión local
        trustServerCertificate: true
    }
};

let appPoolPromise;
let printerPoolPromise;
let appPoolInstance;

async function getConnection() {
    if (!appPoolPromise) {
        const pool = new sql.ConnectionPool(config);
        appPoolPromise = pool.connect().then(connected => { appPoolInstance = connected; return connected; })
            .catch(error => { appPoolPromise = null; appPoolInstance = null; throw error; });
    }
    return appPoolPromise;
}

async function getPrinterConnection() {
    if (!printerPoolPromise) {
        const pool = new sql.ConnectionPool({ ...config, pool: { max: 1, min: 0, idleTimeoutMillis: 30000 } });
        printerPoolPromise = pool.connect().catch(error => { printerPoolPromise = null; throw error; });
    }
    return printerPoolPromise;
}

async function closeConnections() {
    const pools = await Promise.allSettled([appPoolPromise, printerPoolPromise].filter(Boolean));
    await Promise.allSettled(pools.filter(result => result.status === 'fulfilled').map(result => result.value.close()));
    appPoolPromise = null;
    printerPoolPromise = null;
    appPoolInstance = null;
}

function poolStats() {
    if (!appPoolInstance) return null;
    return { size: appPoolInstance.size, available: appPoolInstance.available,
        pending: appPoolInstance.pending, borrowed: appPoolInstance.borrowed };
}

module.exports = { getConnection, getPrinterConnection, closeConnections, poolStats, config, sql };
