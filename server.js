const express = require('express');
const session = require('express-session');
const path = require('path');
const { getConnection, closeConnections, sql } = require('./db');
const runMigrations = require('./migrate');
const SqlSessionStore = require('./lib/sql-session-store');
const requestContext = require('./lib/request-context');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24;
const sessionStore = new SqlSessionStore({ ttlMs: SESSION_TTL_MS });
const loginAttempts = new Map();
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 5 * 60 * 1000;

function enabled(value) { return String(value).toLowerCase() === 'true'; }
function features() {
    return {
        printerEnabled: enabled(process.env.PRINTER_ENABLED) && Boolean(process.env.PRINTER_HOST),
        closuresEnabled: Boolean(process.env.MAINTENANCE_PIN_HASH)
    };
}
function validateProductionConfig() {
    const missing = ['DB_USER', 'DB_PASS', 'DB_SERVER', 'DB_NAME', 'SESSION_SECRET'].filter(name => !process.env[name]);
    if (missing.length) throw new Error(`Faltan variables obligatorias: ${missing.join(', ')}`);
    const forbiddenSecrets = ['secret', 'cambiame_por_algo_seguro', 'reemplace_con_un_valor_aleatorio_de_32_caracteres_o_mas'];
    if (forbiddenSecrets.includes(process.env.SESSION_SECRET) || process.env.SESSION_SECRET.length < 32) {
        throw new Error('SESSION_SECRET debe ser único y tener al menos 32 caracteres');
    }
    const numeric = {
        DB_POOL_MAX: process.env.DB_POOL_MAX || 20,
        DB_POOL_MIN: process.env.DB_POOL_MIN || 2,
        DB_POOL_IDLE_TIMEOUT_MS: process.env.DB_POOL_IDLE_TIMEOUT_MS || 30000,
        DB_CONNECTION_TIMEOUT_MS: process.env.DB_CONNECTION_TIMEOUT_MS || 5000,
        DB_REQUEST_TIMEOUT_MS: process.env.DB_REQUEST_TIMEOUT_MS || 10000,
        SLOW_REQUEST_MS: process.env.SLOW_REQUEST_MS || 750
    };
    for (const [name, value] of Object.entries(numeric)) {
        if (!Number.isInteger(Number(value)) || Number(value) < 0) throw new Error(`${name} debe ser un entero no negativo`);
    }
    if (Number(numeric.DB_POOL_MIN) > Number(numeric.DB_POOL_MAX) || Number(numeric.DB_POOL_MAX) < 1) {
        throw new Error('DB_POOL_MAX debe ser positivo y mayor o igual a DB_POOL_MIN');
    }
    if (enabled(process.env.PRINTER_ENABLED) && !process.env.PRINTER_HOST) throw new Error('PRINTER_HOST es obligatorio cuando PRINTER_ENABLED=true');
}
function internalError(res, error, context) {
    const diagnosticId = requestContext.diagnosticId(res);
    console.error(JSON.stringify({ type: 'api_error', diagnosticId, context, error: requestContext.safeError(error) }));
    res.status(500).json({ success: false, message: 'No se pudo completar la operación.', diagnosticId });
}

app.disable('x-powered-by');
if (enabled(process.env.TRUST_PROXY)) app.set('trust proxy', 1);
app.use(requestContext.start);
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    next();
});

app.use(express.json({ limit: '512kb' }));
app.use('/vendor/fontawesome', express.static(path.join(__dirname, 'node_modules/@fortawesome/fontawesome-free')));
app.use(express.static('public'));
app.use(session({
    name: 'sedim.sid',
    secret: process.env.SESSION_SECRET || 'development-only-session-secret-32',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: enabled(process.env.COOKIE_SECURE), httpOnly: true, sameSite: 'lax', maxAge: SESSION_TTL_MS }
}));

function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ message: 'No autorizado' });
}

app.get('/', (req, res) => res.redirect('/login.html'));
app.get('/healthz', async (req, res) => {
    try {
        const pool = await getConnection();
        await pool.request().query('SELECT 1 AS ok');
        res.json({ status: 'ok' });
    } catch (error) {
        console.error('Healthcheck DB:', error.message);
        res.status(503).json({ status: 'unavailable' });
    }
});

// ==========================================
//  LOGIN Y SESIÓN
// ==========================================
app.post('/api/login', async (req, res) => {
    const { usuario, password } = req.body || {};
    const key = req.ip;
    const attempt = loginAttempts.get(key);
    if (attempt?.lockedUntil > Date.now()) return res.status(429).json({ message: 'Demasiados intentos. Espere cinco minutos.' });
    try {
        const pool = await getConnection();
        const result = await pool.request().input('usuario', sql.NVarChar, usuario)
            .query('SELECT Usuario, Password FROM Usuarios WHERE Usuario = @usuario');

        if (result.recordset.length === 0) return loginFailed(key, res);
        const user = result.recordset[0];
        const realPassword = desencriptarPassword(String(user.Password || ''));
        if (password !== realPassword) return loginFailed(key, res);

        loginAttempts.delete(key);
        req.session.user = { usuario: user.Usuario };
        req.session.save(error => error ? internalError(res, error, 'Guardar sesión') : res.json({ message: 'Login exitoso', user: req.session.user, features: features() }));
    } catch (error) { internalError(res, error, 'Login'); }
});

function loginFailed(key, res) {
    const state = loginAttempts.get(key) || { failures: 0, lockedUntil: 0 };
    state.failures++;
    if (state.failures >= LOGIN_MAX_ATTEMPTS) { state.failures = 0; state.lockedUntil = Date.now() + LOGIN_LOCK_MS; }
    loginAttempts.set(key, state);
    return res.status(400).json({ message: 'Usuario o contraseña incorrectos' });
}

app.post('/api/logout', (req, res) => req.session.destroy(error => error ? internalError(res, error, 'Cerrar sesión') : res.json({ message: 'Sesión cerrada' })));
app.get('/api/session', (req, res) => { req.session.user ? res.json({ user: req.session.user, features: features() }) : res.status(401).send(); });

app.get('/api/users', async (req, res) => {
    const { q } = req.query;
    try {
        const pool = await getConnection();
        const request = pool.request();
        let query = "SELECT Usuario FROM Usuarios";
        if (q) {
            query += " WHERE Usuario LIKE @q + '%'";
            request.input('q', sql.NVarChar, q);
        }
        query += " ORDER BY Usuario";
        const result = await requestContext.measureSql(() => request.query(query));
        res.json(result.recordset);
    } catch (error) {
        internalError(res, error, 'Listar usuarios');
    }
});

// ==========================================
//  SERVER-SENT EVENTS (REAL-TIME)
// ==========================================
const sseClients = new Set();

app.get('/api/events', isAuthenticated, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    res.write(':ok\n\n');

    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    sseClients.add(res);
    console.log(`SSE: Cliente conectado. Total: ${sseClients.size}`);

    const heartbeat = setInterval(() => {
        res.write(':heartbeat\n\n');
    }, 30000);

    req.on('close', () => {
        sseClients.delete(res);
        clearInterval(heartbeat);
        console.log(`SSE: Cliente desconectado. Total: ${sseClients.size}`);
    });
});

function broadcastSSE(event) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
        client.write(data);
    }
}

// ==========================================
//  POS DE VENTAS
// ==========================================
app.get('/api/pos/tables', isAuthenticated, async (req, res) => {
    const { empresa } = req.query;
    try {
        const pool = await getConnection();
        let query = "SELECT Numero, Ambiente, Estado, Empresa FROM Mesas";
        const request = pool.request();
        if (empresa) {
            query += " WHERE Empresa = @empresa";
            request.input('empresa', sql.Int, parseInt(empresa));
        }
        query += " ORDER BY Numero";
        const result = await requestContext.measureSql(() => request.query(query));
        res.json(result.recordset);
    } catch (e) { internalError(res, e, 'Listar mesas'); }
});

app.put('/api/pos/tables/:numero/estado', isAuthenticated, async (req, res) => {
    const { numero } = req.params;
    const { estado, empresa } = req.body;
    try {
        const pool = await getConnection();
        const request = pool.request();
        request.input('numero', sql.Int, parseInt(numero));
        request.input('estado', sql.Int, parseInt(estado));
        request.input('empresa', sql.Int, parseInt(empresa));

        const query = "UPDATE Mesas SET Estado = @estado WHERE Numero = @numero AND Empresa = @empresa";
        const result = await requestContext.measureSql(() => request.query(query));

        if (result.rowsAffected[0] > 0) {
            broadcastSSE({ type: 'mesa_updated', numero: parseInt(numero), empresa: parseInt(empresa) });
            res.json({ success: true, message: 'Estado actualizado' });
        } else {
            res.status(404).json({ success: false, message: 'Mesa no encontrada' });
        }
    } catch (e) { internalError(res, e, 'Actualizar mesa'); }
});

app.put('/api/pos/tables/:numero/liberar-reservada', isAuthenticated, async (req, res) => {
    const { numero } = req.params;
    const { empresa } = req.body;
    try {
        const pool = await getConnection();
        const request = pool.request();
        request.input('numero', sql.Int, parseInt(numero));
        request.input('empresa', sql.Int, parseInt(empresa));

        const checkQuery = "SELECT Estado FROM Mesas WHERE Numero = @numero AND Empresa = @empresa";
        const mesaCheck = await request.query(checkQuery);

        if (mesaCheck.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Mesa no encontrada' });
        }

        if (mesaCheck.recordset[0].Estado !== 3) {
            return res.status(400).json({ success: false, message: 'Solo se pueden liberar mesas reservadas' });
        }

        const updateQuery = "UPDATE Mesas SET Estado = 1 WHERE Numero = @numero AND Empresa = @empresa";
        await pool.request().input('numero', sql.Int, parseInt(numero)).input('empresa', sql.Int, parseInt(empresa)).query(updateQuery);

        broadcastSSE({ type: 'mesa_updated', numero: parseInt(numero), empresa: parseInt(empresa) });
        res.json({ success: true, message: 'Mesa liberada' });
    } catch (e) { internalError(res, e, 'Liberar mesa'); }
});

app.get('/api/pos/mozos', isAuthenticated, async (req, res) => {
    const { empresa } = req.query;
    try {
        const pool = await getConnection();
        const request = pool.request();
        request.input('empresa', sql.Int, parseInt(empresa));

        const result = await request.query(`
            SELECT Codemp, Nombre 
            FROM Empleados 
            WHERE Tipo = 3 AND Empresa = @empresa AND FecCese IS NULL
            ORDER BY Nombre
        `);

        res.json(result.recordset);
    } catch (e) { internalError(res, e, 'Listar mozos'); }
});

function buildPOSCategoriesQuery({ empresa } = {}) {
    let query = `
        SELECT DISTINCT L.Descripcion
        FROM Lineas L
        INNER JOIN Productos P ON P.Clinea = L.CodLinea
        WHERE P.Eliminado = 0 AND P.Tipo = 3
    `;
    if (empresa) query += " AND P.CodPro LIKE @empresa + '%'";
    return query;
}

function buildPOSProductsQuery({ empresa, linea } = {}) {
    let query = `
        SELECT P.CodPro, P.Nombre, P.PventaMa, P.Afecto, L.Descripcion as Linea
        FROM Productos P
        LEFT JOIN Lineas L ON P.Clinea = L.CodLinea
        WHERE P.Eliminado = 0 AND P.Tipo = 3
    `;
    if (empresa) query += " AND P.CodPro LIKE @empresa + '%'";
    if (linea) query += ' AND L.Descripcion = @linea';
    return query + ' ORDER BY P.Nombre ASC';
}

app.get('/api/pos/categories', isAuthenticated, async (req, res) => {
    const { empresa } = req.query;
    try {
        const pool = await getConnection();
        const request = pool.request();
        const query = buildPOSCategoriesQuery({ empresa });
        if (empresa) {
            request.input('empresa', sql.VarChar, empresa);
        }
        const result = await requestContext.measureSql(() => request.query(query));
        res.json(result.recordset.map(r => r.Descripcion));
    } catch (e) { internalError(res, e, 'Listar categorías'); }
});

app.get('/api/pos/config', isAuthenticated, async (req, res) => {
    try {
        const pool = await getConnection();
        const result = await requestContext.measureSql(() => pool.request().query(`SELECT c_valor, n_valor FROM Valores WHERE c_valor IN ('Igv', 'Igvv')`));
        const config = {};
        result.recordset.forEach(r => {
            config[r.c_valor.trim().toLowerCase()] = r.n_valor;
        });
        res.json({ igv: config.igv || 18, igvv: config.igvv || 10.5 });
    } catch (e) { internalError(res, e, 'Configuración POS'); }
});

app.get('/api/pos/products', isAuthenticated, async (req, res) => {
    const { empresa, linea } = req.query;
    try {
        const pool = await getConnection();
        const request = pool.request();
        const query = buildPOSProductsQuery({ empresa, linea });
        if (empresa) {
            request.input('empresa', sql.VarChar, empresa);
        }
        if (linea) {
            request.input('linea', sql.VarChar, linea);
        }
        const result = await requestContext.measureSql(() => request.query(query));
        res.json(result.recordset);
    } catch (e) { internalError(res, e, 'Listar productos'); }
});

require('./lib/orders').install(app, isAuthenticated, broadcastSSE);
require('./lib/shift-closures').install(app, isAuthenticated, broadcastSSE);

async function start() {
    validateProductionConfig();
    const MAX_REINTENTOS = 12;
    for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
        try {
            await runMigrations();
            const protocol = String(process.env.PRINTER_PROTOCOL || '').toLowerCase();
            const transport = protocol === 'escpos_tcp' ? require('./lib/escpos-tcp').createEscPosTcpTransport() : null;
            const stopPrint = require('./lib/print-worker').startPrintWorker({ transport, notify: broadcastSSE });
            const stopRetention = features().closuresEnabled ? require('./lib/shift-closures').startRetentionWorker() : () => {};
            const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
            let stopping = false;
            const shutdown = signal => {
                if (stopping) return; stopping = true;
                console.log(`${signal}: cerrando SedimApp...`);
                stopPrint(); stopRetention(); sessionStore.stop();
                server.close(() => closeConnections().finally(() => process.exit(0)));
                setTimeout(() => process.exit(1), 10000).unref();
            };
            process.once('SIGTERM', () => shutdown('SIGTERM'));
            process.once('SIGINT', () => shutdown('SIGINT'));
            return;
        } catch (err) {
            console.error(`[${intento}/${MAX_REINTENTOS}] DB no disponible: ${err.message}. Reintentando en 5s...`);
            if (intento < MAX_REINTENTOS) await new Promise(r => setTimeout(r, 5000));
        }
    }
    console.error('No se pudo conectar a la base de datos.');
    console.error('Verifique: DB_SERVER=host.docker.internal en el .env y que SQL Server acepte TCP en el puerto 1433.');
    process.exitCode = 1;
}
if (require.main === module) start().catch(error => {
    console.error(`Configuración inválida: ${error.message}`);
    sessionStore.stop();
    process.exitCode = 1;
});
module.exports = app;
module.exports.features = features;
module.exports.validateProductionConfig = validateProductionConfig;
module.exports.buildPOSCategoriesQuery = buildPOSCategoriesQuery;
module.exports.buildPOSProductsQuery = buildPOSProductsQuery;

function desencriptarPassword(hash) {
    let password = '';
    for (let i = 0; i < hash.length; i++) {
        password += String.fromCharCode(hash.charCodeAt(i) - (i + 1));
    }
    return password;
}

function redondear2(x) {
    return Math.round((x + Number.EPSILON) * 100) / 100;
}

function encriptarPassword(password) {
    let hash = '';
    for (let i = 0; i < password.length; i++) {
        hash += String.fromCharCode(password.charCodeAt(i) + (i + 1));
    }
    return hash;
}
