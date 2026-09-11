const express = require('express');
const session = require('express-session');
const path = require('path');
const { getConnection, sql } = require('./db');
const runMigrations = require('./migrate');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '512kb' }));
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 1000 * 60 * 60 * 24 }
}));

function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.status(401).json({ message: 'No autorizado' });
}

app.get('/', (req, res) => res.redirect('/login.html'));

// ==========================================
//  LOGIN Y SESIÓN
// ==========================================
app.post('/api/login', async (req, res) => {
    const { usuario, password } = req.body;
    try {
        const pool = await getConnection();
        const result = await pool.request().input('usuario', sql.NVarChar, usuario)
            .query('SELECT Usuario, Password FROM Usuarios WHERE Usuario = @usuario');

        if (result.recordset.length === 0) return res.status(400).json({ message: 'Usuario no encontrado' });
        const user = result.recordset[0];
        const realPassword = desencriptarPassword(user.Password);
        if (password !== realPassword) return res.status(400).json({ message: 'Contraseña incorrecta' });

        req.session.user = { usuario: user.Usuario };
        req.session.save(() => res.json({ message: 'Login exitoso', user: req.session.user }));
    } catch (error) { res.status(500).send(error.message); }
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ message: 'Sesión cerrada' }); });
app.get('/api/session', (req, res) => { req.session.user ? res.json({ user: req.session.user }) : res.status(401).send(); });

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
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (error) {
        res.status(500).send(error.message);
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
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (e) { res.status(500).send(e.message); }
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
        const result = await request.query(query);

        if (result.rowsAffected[0] > 0) {
            broadcastSSE({ type: 'mesa_updated', numero: parseInt(numero), empresa: parseInt(empresa) });
            res.json({ success: true, message: 'Estado actualizado' });
        } else {
            res.status(404).json({ success: false, message: 'Mesa no encontrada' });
        }
    } catch (e) { res.status(500).send(e.message); }
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
    } catch (e) { res.status(500).send(e.message); }
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
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/pos/categories', isAuthenticated, async (req, res) => {
    const { empresa } = req.query;
    try {
        const pool = await getConnection();
        const request = pool.request();
        let query = `
            SELECT DISTINCT L.Descripcion 
            FROM Lineas L
            INNER JOIN Productos P ON P.Clinea = L.CodLinea
            WHERE P.Eliminado = 0
        `;
        if (empresa) {
            query += " AND P.CodPro LIKE @empresa + '%'";
            request.input('empresa', sql.VarChar, empresa);
        }
        const result = await request.query(query);
        res.json(result.recordset.map(r => r.Descripcion));
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/pos/config', isAuthenticated, async (req, res) => {
    try {
        const pool = await getConnection();
        const result = await pool.request().query(`SELECT c_valor, n_valor FROM Valores WHERE c_valor IN ('Igv', 'Igvv')`);
        const config = {};
        result.recordset.forEach(r => {
            config[r.c_valor.trim().toLowerCase()] = r.n_valor;
        });
        res.json({ igv: config.igv || 18, igvv: config.igvv || 10.5 });
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/pos/products', isAuthenticated, async (req, res) => {
    const { empresa, linea } = req.query;
    try {
        const pool = await getConnection();
        const request = pool.request();
        let query = `
            SELECT P.CodPro, P.Nombre, P.PventaMa, P.Afecto, L.Descripcion as Linea
            FROM Productos P
            LEFT JOIN Lineas L ON P.Clinea = L.CodLinea
            WHERE P.Eliminado = 0
        `;
        if (empresa) {
            query += " AND P.CodPro LIKE @empresa + '%'";
            request.input('empresa', sql.VarChar, empresa);
        }
        if (linea) {
            query += " AND L.Descripcion = @linea";
            request.input('linea', sql.VarChar, linea);
        }
        query += " ORDER BY P.Nombre ASC";
        const result = await request.query(query);
        res.json(result.recordset);
    } catch (e) { res.status(500).send(e.message); }
});

require('./lib/orders').install(app, isAuthenticated, broadcastSSE);
require('./lib/shift-closures').install(app, isAuthenticated, broadcastSSE);

async function start() {
    const MAX_REINTENTOS = 12;
    for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
        try {
            await runMigrations();
            const protocol = String(process.env.PRINTER_PROTOCOL || '').toLowerCase();
            const transport = protocol === 'escpos_tcp' ? require('./lib/escpos-tcp').createEscPosTcpTransport() : null;
            require('./lib/print-worker').startPrintWorker({ transport, notify: broadcastSSE });
            require('./lib/shift-closures').startRetentionWorker();
            app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
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
if (require.main === module) start();
module.exports = app;

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
