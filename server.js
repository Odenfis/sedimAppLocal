const express = require('express');
const session = require('express-session');
const path = require('path');
const { getConnection, sql } = require('./db');
const runMigrations = require('./migrate');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
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

app.get('/api/pos/pedido', isAuthenticated, async (req, res) => {
    const { mesa, empresa } = req.query;
    try {
        const pool = await getConnection();
        const mesaNum = parseInt(mesa);
        const empresaNum = parseInt(empresa);

        const empresaNumeroMap = { 2: 1, 4: 2, 6: 5 };
        const nNumero = empresaNumeroMap[empresaNum];

        if (!nNumero) {
            res.json({ success: true, pedido: null });
            return;
        }

        const tabResult = await pool.request()
            .input('codtabla', sql.Int, 23)
            .input('numero', sql.Int, nNumero)
            .query(`SELECT c_describe FROM Tablas WHERE n_codtabla = @codtabla AND n_numero = @numero`);

        if (tabResult.recordset.length === 0) {
            res.json({ success: true, pedido: null });
            return;
        }

        const prefijoActual = tabResult.recordset[0].c_describe.split('-')[0];

        const mesaCheck = await pool.request()
            .input('mesa', sql.Int, mesaNum)
            .input('empresa', sql.Int, empresaNum)
            .query(`SELECT Numero FROM Mesas WHERE Numero = @mesa AND Empresa = @empresa`);

        if (mesaCheck.recordset.length === 0) {
            res.json({ success: true, pedido: null });
            return;
        }

        const ticketResult = await pool.request()
            .input('mesa', sql.Int, mesaNum)
            .input('prefijo', sql.VarChar, prefijoActual)
            .query(`SELECT NroTicket, NroMesa, Mozo, Total, Estado, Fecha FROM Ticket_c WHERE NroMesa = @mesa AND NroTicket LIKE @prefijo + '%' AND Estado IN (1, 2)`);

        if (ticketResult.recordset.length === 0) {
            res.json({ success: true, pedido: null });
            return;
        }

        const ticket = ticketResult.recordset[0];

        const detResult = await pool.request()
            .input('nroTicket', sql.VarChar, ticket.NroTicket)
            .query(`SELECT t.Codpro, RTRIM(t.Descripcion) AS Descripcion, t.Cantidad, t.Precio, t.Descuento, t.Importe, p.Afecto, p.PventaMa
                    FROM Ticket_d t
                    LEFT JOIN Productos p ON t.Codpro = p.CodPro
                    WHERE t.NroTicket = @nroTicket`);

        res.json({ success: true, pedido: ticket, items: detResult.recordset });
    } catch (e) { res.status(500).send(e.message); }
});

async function getNextTicketNumber(request, empresa) {
    const empresaNumeroMap = {
        '02': 1,   // Cocinería -> T001
        '04': 2,   // Mar Picante 1 -> T002
        '06': 5,   // Inversiones Abruzzo -> T005
        2: 1,      // Cocinería como número
        4: 2,      // Mar Picante 1 como número
        6: 5       // Inversiones Abruzzo como número
    };

    const empresaNum = parseInt(empresa);
    const nNumero = empresaNumeroMap[empresaNum];
    if (!nNumero) {
        throw new Error(`Empresa no definida para correlativo de ticket: ${empresa}`);
    }

    const tabRequest = request;
    tabRequest.input('codtabla', sql.Int, 23);
    tabRequest.input('numero', sql.Int, nNumero);

    const tabResult = await tabRequest.query(`
        SELECT c_describe FROM Tablas 
        WHERE n_codtabla = @codtabla AND n_numero = @numero
    `);

    if (tabResult.recordset.length === 0) {
        throw new Error(`No se encontró correlativo para empresa ${empresa}`);
    }

    const currentValue = tabResult.recordset[0].c_describe;
    const parts = currentValue.split('-');
    if (parts.length !== 2) {
        throw new Error(`Formato de correlativo inválido: ${currentValue}`);
    }

    const prefix = parts[0];
    const correlativo = parseInt(parts[1], 10);
    const nextCorrelativo = correlativo + 1;
    const nextValue = `${prefix}-${nextCorrelativo.toString().padStart(6, '0')}`;

    await tabRequest
        .input('newvalue', sql.VarChar, nextValue)
        .query(`
            UPDATE Tablas SET c_describe = @newvalue 
            WHERE n_codtabla = @codtabla AND n_numero = @numero
        `);

    return nextValue;
}

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

app.post('/api/pos/pedido', isAuthenticated, async (req, res) => {
    const { mesa, empresa, items, mozo, nroTicket, turno } = req.body;
    try {
        const pool = await getConnection();
        const transaction = await pool.transaction();
        await transaction.begin();
        let nroTicketAsignado = nroTicket;
        try {
            const request = new sql.Request(transaction);

            if (!nroTicket) {
                nroTicketAsignado = await getNextTicketNumber(request, parseInt(empresa));
            }

            const mesaNum = parseInt(mesa);

            request.input('nro', sql.VarChar, nroTicketAsignado);
            request.input('mesa', sql.Int, mesaNum);

            const existing = await request.query(`
                SELECT NroTicket FROM Ticket_c 
                WHERE NroTicket = @nro AND NroMesa = @mesa
            `);

            if (existing.recordset.length > 0) {
                const mozoCod = parseInt(mozo) || 1;
                const usuarioSesion = req.session.user ? req.session.user.usuario : 'Sistema';
                await request
                    .input('mozo', sql.Int, mozoCod)
                    .input('usuario', sql.NVarChar, usuarioSesion)
                    .query(`UPDATE Ticket_c SET Fecha = GETDATE(), Mozo = @mozo, Usuario = @usuario WHERE NroTicket = @nro`);
                await request.query(`DELETE FROM Ticket_d WHERE NroTicket = @nro`);
            } else {
                const mozoCod = parseInt(mozo) || 1;
                const usuarioSesion = req.session.user ? req.session.user.usuario : 'Sistema';
                await request
                    .input('mozo', sql.Int, mozoCod)
                    .input('total', sql.Money, 0)
                    .input('turno', sql.Int, turno || 1)
                    .input('usuario', sql.NVarChar, usuarioSesion)
                    .query(`INSERT INTO Ticket_c (NroTicket, NroMesa, Mozo, Total, Estado, Fecha, Turno, Usuario)
                            VALUES (@nro, @mesa, @mozo, @total, 1, GETDATE(), @turno, @usuario)`);
            }

            let totalPedido = 0;

            const igvResult = await request.query(`SELECT n_valor FROM Valores WHERE c_valor = 'Igvv'`);
            const igvvPct = igvResult.recordset.length > 0 ? igvResult.recordset[0].n_valor : 10.5;

            for (const item of items) {
                const esAfecto = item.afecto === 1 || item.afecto === true;
                const factor = esAfecto ? (1 + igvvPct / 100) : 1;
                const precioUnitario = redondear2(item.precio * factor);
                const importe = redondear2(precioUnitario * item.cantidad);

                totalPedido += importe;

                const itemRequest = new sql.Request(transaction);
                itemRequest.input('nro', sql.VarChar, nroTicketAsignado);
                itemRequest.input('codpro', sql.Char(10), item.codPro);
                itemRequest.input('desc', sql.VarChar, item.nombre);
                itemRequest.input('cant', sql.Decimal(9, 2), item.cantidad);
                itemRequest.input('precio', sql.Money, item.precio);
                itemRequest.input('importe', sql.Money, importe);

                await itemRequest.query(`
                    INSERT INTO Ticket_d (NroTicket, Codpro, Descripcion, Cantidad, Precio, Descuento, Importe) 
                    VALUES (@nro, @codpro, @desc, @cant, @precio, 0, @importe)
                `);
            }

            await new sql.Request(transaction)
                .input('nro', sql.VarChar, nroTicketAsignado)
                .input('total', sql.Money, totalPedido)
                .query(`UPDATE Ticket_c SET Total = @total WHERE NroTicket = @nro`);

            await transaction.commit();
            broadcastSSE({ type: 'mesa_updated', numero: mesaNum, empresa: parseInt(empresa) });
            res.json({ success: true, nroTicket: nroTicketAsignado, message: 'Pedido guardado' });
        } catch (err) {
            try { await transaction.rollback(); } catch (rb) { /* ya abortada */ }
            throw err;
        }
    } catch (e) {
        console.error('Error en /api/pos/pedido:', e);
        res.status(500).send(e.message);
    }
});

app.put('/api/pos/pedido/:nro/pagar', isAuthenticated, async (req, res) => {
    const { nro } = req.params;
    const { mesa, empresa, total, igv } = req.body;
    try {
        const pool = await getConnection();
        const request = pool.request();
        request.input('nro', sql.VarChar, nro);
        request.input('estado', sql.Int, 2); // Preventa

        await request.query(`UPDATE Ticket_c SET Estado = @estado WHERE NroTicket = @nro`);

        if (mesa) {
            broadcastSSE({ type: 'mesa_updated', numero: parseInt(mesa), empresa: parseInt(empresa) });
        }
        res.json({ success: true, message: 'Pedido facturado' });
    } catch (e) { res.status(500).send(e.message); }
});

app.put('/api/pos/pedido/:nro/reabrir', isAuthenticated, async (req, res) => {
    const { nro } = req.params;
    const { empresa } = req.body;
    try {
        const pool = await getConnection();
        const request = pool.request();
        request.input('nro', sql.VarChar, nro);

        const ticketResult = await request.query(`
            SELECT NroMesa, Estado FROM Ticket_c WHERE NroTicket = @nro
        `);

        if (ticketResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Ticket no encontrado' });
        }

        const ticket = ticketResult.recordset[0];
        if (ticket.Estado !== 2) {
            return res.status(400).json({ success: false, message: 'Solo se puede reabrir tickets en estado Preventa' });
        }

        const { NroMesa } = ticket;

        await request.query(`UPDATE Ticket_c SET Estado = 1 WHERE NroTicket = @nro`);

        const mesaRequest = pool.request();
        mesaRequest.input('mesa', sql.Int, NroMesa);
        mesaRequest.input('empresa', sql.Int, parseInt(empresa));
        await mesaRequest.query('UPDATE Mesas SET Estado = 2 WHERE Numero = @mesa AND Empresa = @empresa');

        broadcastSSE({ type: 'mesa_updated', numero: NroMesa, empresa: parseInt(empresa) });
        res.json({ success: true, message: 'Pedido reabierto - Mesa Ocupada' });
    } catch (e) { res.status(500).send(e.message); }
});

app.delete('/api/pos/comanda/:nro', isAuthenticated, async (req, res) => {
    const { nro } = req.params;
    const { empresa } = req.query;
    try {
        const pool = await getConnection();
        const request = pool.request();
        request.input('nro', sql.VarChar, nro);

        const ticketResult = await request.query(`
            SELECT NroMesa FROM Ticket_c WHERE NroTicket = @nro
        `);

        if (ticketResult.recordset.length === 0) {
            return res.status(404).json({ success: false, message: 'Ticket no encontrado' });
        }

        const { NroMesa } = ticketResult.recordset[0];

        await request.query('DELETE FROM Ticket_d WHERE NroTicket = @nro');
        await request.query('DELETE FROM Ticket_c WHERE NroTicket = @nro');

        const mesaRequest = pool.request();
        mesaRequest.input('mesa', sql.Int, NroMesa);
        mesaRequest.input('empresa', sql.Int, parseInt(empresa));
        await mesaRequest.query('UPDATE Mesas SET Estado = 1 WHERE Numero = @mesa AND Empresa = @empresa');

        broadcastSSE({ type: 'mesa_updated', numero: NroMesa, empresa: parseInt(empresa) });
        res.json({ success: true, message: 'Comanda eliminada' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
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

app.post('/api/pos/ticket', isAuthenticated, async (req, res) => {
    const { table, guests, items, total, igv, empresa, turno, mozo } = req.body;
    const usuarioSesion = req.session.user ? req.session.user.usuario : 'Sistema';
    const mozoCod = parseInt(mozo) || 1;
    try {
        const pool = await getConnection();
        const transaction = await pool.transaction();
        await transaction.begin();
        try {
            const request = new sql.Request(transaction);
            const nroTicket = await getNextTicketNumber(request, parseInt(empresa));

            const igvResult = await pool.request().query(`SELECT n_valor FROM Valores WHERE c_valor = 'Igvv'`);
            const igvvPct = igvResult.recordset.length > 0 ? igvResult.recordset[0].n_valor : 10.5;

            const lineas = items.map(item => {
                const esAfecto = item.afecto === 1 || item.afecto === true;
                const factor = esAfecto ? (1 + igvvPct / 100) : 1;
                const precioUnitario = redondear2(item.precio * factor);
                const importe = redondear2(precioUnitario * item.cantidad);
                return {
                    cp: item.codPro.trim(),
                    codPro: item.codPro,
                    nombre: item.nombre,
                    cantidad: item.cantidad,
                    precioBase: item.precio,
                    importe
                };
            });
            const totalConIgv = lineas.reduce((acc, l) => acc + l.importe, 0);

            await request.input('nro', sql.VarChar, nroTicket)
                .input('mesa', sql.Int, table)
                .input('mozo', sql.Int, mozoCod)
                .input('total', sql.Money, totalConIgv)
                .input('turno', sql.Int, turno || 1)
                .input('user', sql.NVarChar, usuarioSesion)
                .query(`INSERT INTO Ticket_c (NroTicket, NroMesa, Mozo, Total, Estado, Fecha, Turno, Usuario) 
                        VALUES (@nro, @mesa, @mozo, @total, 2, GETDATE(), @turno, @user)`);

            for (const l of lineas) {
                await request.input(`cod_${l.cp}`, sql.Char(10), l.codPro)
                    .input(`nom_${l.cp}`, sql.VarChar, l.nombre)
                    .input(`cant_${l.cp}`, sql.Decimal(9, 2), l.cantidad)
                    .input(`pre_${l.cp}`, sql.Money, l.precioBase)
                    .input(`imp_${l.cp}`, sql.Money, l.importe)
                    .query(`INSERT INTO Ticket_d (NroTicket, Codpro, Descripcion, Cantidad, Precio, Descuento, Importe) 
                            VALUES (@nro, @cod_${l.cp}, @nom_${l.cp}, @cant_${l.cp}, @pre_${l.cp}, 0, @imp_${l.cp})`);
            }

            await transaction.commit();
            broadcastSSE({ type: 'mesa_updated', numero: table, empresa: parseInt(empresa) });
            res.json({ message: 'Venta procesada con éxito', nroTicket });
        } catch (err) {
            try { await transaction.rollback(); } catch (rb) { /* ya abortada */ }
            throw err;
        }
    } catch (e) {
        console.error(e);
        res.status(500).send(e.message);
    }
});

app.listen(PORT, async () => {
    const MAX_REINTENTOS = 12;
    for (let intento = 1; intento <= MAX_REINTENTOS; intento++) {
        try {
            await runMigrations();
            console.log(`Server running on port ${PORT}`);
            return;
        } catch (err) {
            console.error(`[${intento}/${MAX_REINTENTOS}] DB no disponible: ${err.message}. Reintentando en 5s...`);
            if (intento < MAX_REINTENTOS) await new Promise(r => setTimeout(r, 5000));
        }
    }
    console.error('No se pudo conectar a la base de datos.');
    console.error('Verifique: DB_SERVER=host.docker.internal en el .env y que SQL Server acepte TCP en el puerto 1433.');
});

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
