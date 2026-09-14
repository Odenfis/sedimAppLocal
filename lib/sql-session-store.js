'use strict';
const session = require('express-session');
const { getConnection, sql } = require('../db');

class SqlSessionStore extends session.Store {
    constructor({ ttlMs = 86400000, cleanupIntervalMs = 900000 } = {}) {
        super();
        this.ttlMs = ttlMs;
        this.cleanupTimer = setInterval(() => this.cleanup(), cleanupIntervalMs);
        this.cleanupTimer.unref?.();
    }

    async get(sid, callback) {
        try {
            const pool = await getConnection();
            const row = (await pool.request().input('sid', sql.VarChar(128), sid).query(
                'SELECT Data FROM Web_sessions WHERE Sid=@sid AND ExpiresAt>SYSUTCDATETIME()'
            )).recordset[0];
            callback(null, row ? JSON.parse(row.Data) : null);
        } catch (error) { callback(error); }
    }

    async set(sid, value, callback = () => {}) {
        try {
            const expires = value.cookie?.expires ? new Date(value.cookie.expires) : new Date(Date.now() + this.ttlMs);
            const pool = await getConnection();
            await pool.request()
                .input('sid', sql.VarChar(128), sid)
                .input('data', sql.NVarChar(sql.MAX), JSON.stringify(value))
                .input('expires', sql.DateTime2, expires)
                .query(`MERGE Web_sessions WITH (HOLDLOCK) AS target
                    USING (SELECT @sid Sid,@data Data,@expires ExpiresAt) AS source ON target.Sid=source.Sid
                    WHEN MATCHED THEN UPDATE SET Data=source.Data,ExpiresAt=source.ExpiresAt,UpdatedAt=SYSUTCDATETIME()
                    WHEN NOT MATCHED THEN INSERT(Sid,Data,ExpiresAt) VALUES(source.Sid,source.Data,source.ExpiresAt);`);
            callback();
        } catch (error) { callback(error); }
    }

    async destroy(sid, callback = () => {}) {
        try {
            const pool = await getConnection();
            await pool.request().input('sid', sql.VarChar(128), sid).query('DELETE Web_sessions WHERE Sid=@sid');
            callback();
        } catch (error) { callback(error); }
    }

    touch(sid, value, callback = () => {}) { this.set(sid, value, callback); }

    async cleanup() {
        try { const pool = await getConnection(); await pool.request().query('DELETE Web_sessions WHERE ExpiresAt<=SYSUTCDATETIME()'); }
        catch (error) { console.error(`Limpieza de sesiones: ${error.message}`); }
    }

    stop() { clearInterval(this.cleanupTimer); }
}

module.exports = SqlSessionStore;
