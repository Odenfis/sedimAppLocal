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
            .query(`SELECT Codpro, Descripcion, Cantidad, Precio, Descuento, Importe FROM Ticket_d WHERE NroTicket = @nroTicket`);
        
        res.json({ success: true, pedido: ticket, items: detResult.recordset });
    } catch (e) { res.status(500).send(e.message); }
});

async function getNextTicketNumber(pool, empresa) {
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
    
    const tabRequest = pool.request();
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
        
        let nroTicketAsignado = nroTicket;
        
        if (!nroTicket) {
            nroTicketAsignado = await getNextTicketNumber(pool, parseInt(empresa));
        }
        
        const mesaNum = parseInt(mesa);
        
        const checkRequest = pool.request();
        checkRequest.input('nro', sql.VarChar, nroTicketAsignado);
        checkRequest.input('mesa', sql.Int, mesaNum);
        
        const existing = await checkRequest.query(`
            SELECT NroTicket FROM Ticket_c 
            WHERE NroTicket = @nro AND NroMesa = @mesa
        `);
        
        if (existing.recordset.length > 0) {
            const mozoCod = parseInt(mozo) || 1;
            const usuarioSesion = req.session.user ? req.session.user.usuario : 'Sistema';
            await checkRequest
                .input('mozo', sql.Int, mozoCod)
                .input('usuario', sql.NVarChar, usuarioSesion)
                .query(`UPDATE Ticket_c SET Fecha = GETDATE(), Mozo = @mozo, Usuario = @usuario WHERE NroTicket = @nro`);
            await checkRequest.query(`DELETE FROM Ticket_d WHERE NroTicket = @nro`);
        } else {
            const mozoCod = parseInt(mozo) || 1;
            const usuarioSesion = req.session.user ? req.session.user.usuario : 'Sistema';
            await checkRequest
                .input('mozo', sql.Int, mozoCod)
                .input('total', sql.Money, 0)
                .input('turno', sql.Int, turno || 1)
                .input('usuario', sql.NVarChar, usuarioSesion)
                .query(`INSERT INTO Ticket_c (NroTicket, NroMesa, Mozo, Total, Estado, Fecha, Turno, Usuario)
                        VALUES (@nro, @mesa, @mozo, @total, 1, GETDATE(), @turno, @usuario)`);
        }
        
        let subtotal = 0;
        for (const item of items) {
            subtotal += item.importe || (item.precio * item.cantidad);
            
            const itemRequest = pool.request();
            itemRequest.input('nro', sql.VarChar, nroTicketAsignado);
            itemRequest.input('codpro', sql.Char(10), item.codPro);
            itemRequest.input('desc', sql.VarChar, item.nombre);
            itemRequest.input('cant', sql.Decimal(9,2), item.cantidad);
            itemRequest.input('precio', sql.Money, item.precio);
            itemRequest.input('importe', sql.Money, item.importe || (item.precio * item.cantidad));
            
            await itemRequest.query(`
                INSERT INTO Ticket_d (NroTicket, Codpro, Descripcion, Cantidad, Precio, Descuento, Importe) 
                VALUES (@nro, @codpro, @desc, @cant, @precio, 0, @importe)
            `);
        }
        
        await checkRequest.query(`UPDATE Ticket_c SET Total = ${subtotal} WHERE NroTicket = @nro`);
        
        res.json({ success: true, nroTicket: nroTicketAsignado, message: 'Pedido guardado' });
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
            const nroTicket = await getNextTicketNumber(pool, parseInt(empresa));
            
            const request = new sql.Request(transaction);
            await request.input('nro', sql.VarChar, nroTicket)
                .input('mesa', sql.Int, table)
                .input('mozo', sql.Int, mozoCod)
                .input('total', sql.Money, total)
                .input('turno', sql.Int, turno || 1)
                .input('user', sql.NVarChar, usuarioSesion)
                .query(`INSERT INTO Ticket_c (NroTicket, NroMesa, Mozo, Total, Estado, Fecha, Turno, Usuario) 
                        VALUES (@nro, @mesa, @mozo, @total, 2, GETDATE(), @turno, @user)`);

            for (const item of items) {
                const cp = item.codPro.trim();
                await request.input(`cod_${cp}`, sql.Char(10), item.codPro)
                    .input(`nom_${cp}`, sql.VarChar, item.nombre)
                    .input(`cant_${cp}`, sql.Decimal(9,2), item.cantidad)
                    .input(`pre_${cp}`, sql.Money, item.precio)
                    .input(`imp_${cp}`, sql.Money, item.importe)
                    .query(`INSERT INTO Ticket_d (NroTicket, Codpro, Descripcion, Cantidad, Precio, Descuento, Importe) 
                            VALUES (@nro, @cod_${cp}, @nom_${cp}, @cant_${cp}, @pre_${cp}, 0, @imp_${cp})`);
            }

            await transaction.commit();
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
    try {
        await runMigrations();
        console.log(`Server running on port ${PORT}`);
    } catch (err) {
        console.error('Server started but migrations failed:', err);
    }
});

function desencriptarPassword(hash) {
    let password = '';
    for (let i = 0; i < hash.length; i++) {
        password += String.fromCharCode(hash.charCodeAt(i) - (i + 1));
    }
    return password;
}

function encriptarPassword(password) {
    let hash = '';
    for (let i = 0; i < password.length; i++) {
        hash += String.fromCharCode(password.charCodeAt(i) + (i + 1));
    }
    return hash;
}
