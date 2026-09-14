'use strict';
const { randomUUID } = require('node:crypto');
const { getConnection, sql } = require('../db');
const { fail, uuid, normalizeItems, snapshot, same, changes, validateEdits, printText } = require('./order-domain');
const { amounts } = require('../public/order-math');
const shiftClosures = require('./shift-closures');
const nowLima = () => new Date().toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false });
const limaBusinessDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
const printerEnabled = () => String(process.env.PRINTER_ENABLED).toLowerCase() === 'true' && Boolean(process.env.PRINTER_HOST);
function query(db, text, values = {}) {
    const request = new sql.Request(db);
    for (const [key, value] of Object.entries(values)) request.input(key, value === undefined ? null : value);
    return request.query(text);
}
async function transaction(fn) {
    const tx = new sql.Transaction(await getConnection()); await tx.begin();
    try { const result = await fn(tx); await tx.commit(); return result; }
    catch (e) { try { await tx.rollback(); } catch {} throw e; }
}
function id(value) { if (!uuid.test(value || '')) fail('Identificador inválido'); return value.toLowerCase(); }
async function lock(db, resource) {
    await query(db, `DECLARE @r INT; EXEC @r=sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
        IF @r<0 THROW 51000,'Pedido ocupado. Reintente.',1;`, { resource });
}
async function company(db, empresa, mesa) {
    empresa = Number(empresa);
    const numero = { 2: 1, 4: 2, 6: 5 }[empresa];
    if (!numero) fail('Empresa inválida');
    const cfg = (await query(db, 'SELECT c_describe FROM Tablas WHERE n_codtabla=23 AND n_numero=@numero', { numero })).recordset[0];
    if (!cfg || !cfg.c_describe.includes('-')) fail('No hay configuración de cocina para esta empresa', 404);
    if (mesa != null && !(await query(db, 'SELECT Numero FROM Mesas WHERE Numero=@mesa AND Empresa=@empresa', { mesa: Number(mesa), empresa })).recordset.length) fail('Mesa no pertenece a empresa', 404);
    return { empresa, numero, prefix: cfg.c_describe.trim().split('-')[0] };
}
async function ticket(db, nro, empresa, editable = false) {
    const cfg = await company(db, empresa);
    await lock(db, `pedido:${String(nro).trim()}`);
    const t = (await query(db, `SELECT t.*,CONVERT(char(10),t.Fecha,23) FechaNegocio,pc.Empresa,pc.Version,pc.UltimoEnvio,pc.SnapshotComercial FROM Ticket_c t WITH(UPDLOCK,HOLDLOCK)
        JOIN Pedido_control pc ON pc.NroTicket=t.NroTicket WHERE t.NroTicket=@nro AND pc.Empresa=@empresa`, { nro, empresa: cfg.empresa })).recordset[0];
    if (!t || !t.NroTicket.trim().startsWith(cfg.prefix + '-')) fail('Pedido no encontrado en esta empresa', 404);
    await company(db, empresa, t.NroMesa);
    const current = await commercialSnapshot(db, t.NroTicket);
    if (t.SnapshotComercial !== current) fail('El detalle comercial fue modificado por otro sistema. Se requiere conciliación antes de continuar.', 409);
    if (editable && t.Estado !== 1) fail('Pedido no editable', 409);
    return t;
}
function expected(t, version) { if (!Number.isInteger(version) || version !== t.Version) fail('El pedido cambió en otro dispositivo. Revise la versión actual.', 409); }
async function lines(db, nro) {
    return (await query(db, `SELECT l.*,c.PendienteId,c.Estado,c.Anulada FROM Pedido_lineas l
        LEFT JOIN Cocina_estados c ON c.LineaId=l.LineaId WHERE l.NroTicket=@nro ORDER BY l.Orden,l.LineaId`, { nro })).recordset.map(r => ({
        ...JSON.parse(r.Datos), lineaId: r.LineaId.toLowerCase(), orden: r.Orden, baja: r.Baja,
        enviada: r.Enviada ? snapshot(JSON.parse(r.Enviada)) : null, pendienteId: r.PendienteId,
        estadoCocina: r.Estado, anulada: Boolean(r.Anulada)
    }));
}
function summary(t, ls) {
    const pending = changes(ls).length;
    const sent = ls.filter(line => !line.baja && line.enviada && !line.anulada);
    let state = 'Sin enviar';
    if (pending) state = t.UltimoEnvio ? 'Cambios pendientes' : 'Sin enviar';
    else if (t.UltimoEnvio) {
        const states = sent.map(line => Number(line.estadoCocina) || 1);
        state = states.length && states.every(value => value >= 4) ? 'Producto Entregado'
            : states.length && states.every(value => value >= 3) ? 'Listo en Cocina'
            : states.length && states.every(value => value >= 2) ? 'En preparación' : 'Enviado a cocina';
    }
    return { pendientes: pending, ultimoEnvio: t.UltimoEnvio, estado: state };
}
async function response(db, t) {
    const ls = await lines(db, t.NroTicket);
    const printing = (await query(db, `SELECT TOP 1 j.Id,j.Estado,j.Error FROM Impresion_trabajos j JOIN Cocina_envios e ON e.Id=j.EnvioId
        WHERE e.NroTicket=@nro ORDER BY j.Fecha DESC,j.Id`, { nro: t.NroTicket })).recordset[0] || null;
    const cocina = summary(t, ls);
    cocina.anulaciones = changes(ls).filter(c => c.tipo === 'ANULACIÓN').map(c => c.anterior);
    return { success: true, nroTicket: t.NroTicket.trim(), version: t.Version, pedido: t, items: ls.filter(l => !l.baja).map(l => ({ ...l,
        Codpro: l.codPro, Descripcion: l.nombre, Cantidad: l.cantidad, Precio: l.precio, Afecto: l.afecto,
        enviada: l.enviada, pendienteEnvio: !same(snapshot(l), l.enviada) })), cocina, impresion: printing };
}
async function commercialSnapshot(db, nro) {
    return (await query(db, `SELECT (SELECT RTRIM(Codpro) codPro,RTRIM(Descripcion) nombre,Cantidad cantidad,Precio precio,Descuento descuento,Importe importe
        FROM Ticket_d WITH(UPDLOCK,HOLDLOCK) WHERE NroTicket=@nro ORDER BY Codpro,Precio,Descripcion,Cantidad,Descuento,Importe FOR JSON PATH) Documento`, { nro })).recordset[0].Documento || '[]';
}
async function commercial(db, nro, incoming) {
    const pct = Number((await query(db, "SELECT n_valor FROM Valores WHERE c_valor='Igvv'")).recordset[0]?.n_valor ?? 10.5);
    const groups = new Map(); let total = 0;
    const allocated = amounts(incoming, pct);
    for (const [index, l] of incoming.entries()) {
        const amount = allocated[index];
        total = round(total + amount);
        const key = `${l.codPro}:${l.precio}`;
        const g = groups.get(key) || { ...l, cantidad: 0, importe: 0 };
        g.cantidad += l.cantidad; g.importe = round(g.importe + amount); groups.set(key, g);
    }
    await query(db, 'DELETE Ticket_d WHERE NroTicket=@nro', { nro });
    for (const g of groups.values()) {
        if (g.cantidad > 9999999.99) fail('Cantidad agrupada excede el límite');
        await query(db, `INSERT Ticket_d(NroTicket,Codpro,Descripcion,Cantidad,Precio,Descuento,Importe)
            VALUES(@nro,@codPro,@nombre,@cantidad,@precio,0,@importe)`, { nro, codPro: g.codPro, nombre: g.nombre, cantidad: g.cantidad, precio: g.precio, importe: g.importe });
    }
    await query(db, 'UPDATE Ticket_c SET Total=@total WHERE NroTicket=@nro', { nro, total });
    await query(db, 'UPDATE Pedido_control SET SnapshotComercial=@snapshot WHERE NroTicket=@nro', { nro, snapshot: await commercialSnapshot(db, nro) });
}
async function createSend(db, t, clave, usuario) {
    clave = id(clave);
    const existing = (await query(db, 'SELECT Id FROM Cocina_envios WHERE NroTicket=@nro AND Clave=@clave', { nro: t.NroTicket, clave })).recordset[0];
    if (existing) return existing.Id.toLowerCase();
    const ls = await lines(db, t.NroTicket), movements = changes(ls);
    if (!movements.length) fail('No hay novedades para enviar', 409);
    if (movements.some(m => ls.find(l => l.lineaId === m.lineaId).pendienteId)) fail('Hay una corrección sin reconocer', 409);
    const envioId = randomUUID(), numero = t.UltimoEnvio + 1;
    const mozo = (await query(db, 'SELECT Nombre FROM Empleados WHERE Codemp=@mozo AND Empresa=@empresa', { mozo: t.Mozo, empresa: t.Empresa })).recordset[0]?.Nombre?.trim() || String(t.Mozo);
    const empresaNombre = (await query(db, 'SELECT c_describe FROM Tablas WHERE n_codtabla=200 AND n_numero=@empresa', { empresa: t.Empresa })).recordset[0]?.c_describe?.trim();
    const head = { empresaNombre, empresa: t.Empresa, turno: Number(t.Turno), fechaNegocio: t.FechaNegocio,
        nroTicket: t.NroTicket.trim(), numero, mesa: t.NroMesa, mozo, usuario, fecha: nowLima() };
    const doc = printText(head, movements);
    await query(db, `INSERT Cocina_envios(Id,NroTicket,Numero,Clave,Version,Cabecera,Documento) VALUES(@envioId,@nro,@numero,@clave,@version,@head,@doc)`,
        { envioId, nro: t.NroTicket, numero, clave, version: t.Version, head: JSON.stringify(head), doc });
    for (const m of movements) {
        const detailId = randomUUID(), l = ls.find(l => l.lineaId === m.lineaId);
        await query(db, `INSERT Cocina_envio_detalles(Id,EnvioId,LineaId,Movimiento) VALUES(@detailId,@envioId,@lineaId,@movement)`,
            { detailId, envioId, lineaId: m.lineaId, movement: JSON.stringify(m) });
        const operative = m.nueva || m.anterior;
        const values = { lineaId: m.lineaId, nro: t.NroTicket, cod: l.codPro, operative: JSON.stringify(operative), detailId, usuario };
        if (l.estadoCocina == null) {
            if (!m.nueva) fail('La línea enviada no tiene estado operativo de cocina. Se requiere conciliación.', 409);
            await query(db, `INSERT Cocina_estados(NroTicket,Codpro,Estado,FechaEstado,Usuario,LineaId,Operativa,FechaEnvio)
                VALUES(@nro,@cod,1,GETDATE(),@usuario,@lineaId,@operative,SYSUTCDATETIME())`, values);
        } else if (l.estadoCocina >= 2) {
            await query(db, 'UPDATE Cocina_estados SET PendienteId=@detailId WHERE LineaId=@lineaId', values);
        } else if (!m.nueva) {
            await query(db, `UPDATE Cocina_estados SET Anulada=1,PendienteId=NULL,Usuario=@usuario,FechaEstado=GETDATE()
                WHERE LineaId=@lineaId`, values);
        } else {
            await query(db, `UPDATE Cocina_estados SET Operativa=@operative,Anulada=0,PendienteId=NULL,Usuario=@usuario,FechaEstado=GETDATE()
                WHERE LineaId=@lineaId`, values);
        }
        await query(db, 'UPDATE Pedido_lineas SET Enviada=@enviada WHERE LineaId=@lineaId', { lineaId: m.lineaId, enviada: m.nueva ? JSON.stringify(m.nueva) : null });
    }
    if (printerEnabled()) {
        await query(db, `INSERT Impresion_trabajos(Id,EnvioId,Clave,Documento,Usuario) VALUES(@job,@envioId,@clave,@doc,@usuario)`,
            { job: randomUUID(), envioId, clave: randomUUID(), doc, usuario });
    }
    await query(db, 'UPDATE Pedido_control SET UltimoEnvio=@numero,Version=Version+1 WHERE NroTicket=@nro', { nro: t.NroTicket, numero });
    t.UltimoEnvio = numero; t.Version++;
    return envioId;
}
async function ticketReference(db, nro, empresa) {
    const cfg = await company(db, empresa);
    nro = String(nro || '').trim();
    await lock(db, `pedido:${nro}`);
    const ref = (await query(db, `SELECT pc.NroTicket,pc.Empresa,pc.Version,pc.UltimoEnvio,
        t.NroMesa,t.Mozo,t.Estado,t.Fecha,
        TRY_CONVERT(INT,JSON_VALUE(lastSend.Cabecera,'$.mesa')) MesaHistorica
        FROM Pedido_control pc
        LEFT JOIN Ticket_c t ON t.NroTicket=pc.NroTicket
        OUTER APPLY (SELECT TOP 1 Cabecera FROM Cocina_envios WHERE NroTicket=pc.NroTicket ORDER BY Numero DESC) lastSend
        WHERE pc.NroTicket=@nro AND pc.Empresa=@empresa`, { nro, empresa: cfg.empresa })).recordset[0];
    if (!ref || !String(ref.NroTicket).trim().startsWith(cfg.prefix + '-')) fail('Pedido no encontrado en esta empresa', 404);
    ref.NroTicket = String(ref.NroTicket).trim();
    ref.NroMesa = ref.NroMesa ?? ref.MesaHistorica ?? null;
    return ref;
}
async function deleteCommercialOrder(db, nro, empresa, version, usuario, expectedMesa = null) {
    const ref = await ticketReference(db, nro, empresa);
    if (ref.Estado == null) return { deleted: true, alreadyDeleted: true, ticket: ref };
    if (ref.Estado !== 1) fail('Pedido no editable', 409);
    expected(ref, version);
    if (expectedMesa != null && ref.NroMesa !== Number(expectedMesa)) fail('La mesa no corresponde al pedido');
    await company(db, empresa, ref.NroMesa);
    const control = (await query(db, 'SELECT SnapshotComercial FROM Pedido_control WHERE NroTicket=@nro', { nro: ref.NroTicket })).recordset[0];
    if (control.SnapshotComercial !== await commercialSnapshot(db, ref.NroTicket)) fail('El detalle comercial fue modificado por otro sistema. Se requiere conciliación antes de continuar.', 409);

    await query(db, `UPDATE Pedido_lineas SET Baja=1 WHERE NroTicket=@nro;
        UPDATE Cocina_estados SET Anulada=1,PendienteId=NULL,Usuario=@usuario,FechaEstado=GETDATE() WHERE NroTicket=@nro;
        UPDATE Cocina_envios SET Historico=1 WHERE NroTicket=@nro;
        DELETE FROM Ticket_d WHERE NroTicket=@nro;
        DELETE FROM Ticket_c WHERE NroTicket=@nro;
        UPDATE Pedido_control SET SnapshotComercial='[]',Version=Version+1 WHERE NroTicket=@nro;`,
        { nro: ref.NroTicket, usuario });
    const other = (await query(db, `SELECT TOP 1 1 Existe FROM Ticket_c tc JOIN Pedido_control pc ON pc.NroTicket=tc.NroTicket
        WHERE tc.NroMesa=@mesa AND pc.Empresa=@empresa AND tc.Estado IN(1,2)`, { mesa: ref.NroMesa, empresa: ref.Empresa })).recordset.length;
    if (!other) await query(db, 'UPDATE Mesas SET Estado=1 WHERE Numero=@mesa AND Empresa=@empresa', { mesa: ref.NroMesa, empresa: ref.Empresa });
    ref.Version++;
    return { deleted: true, alreadyDeleted: false, ticket: ref };
}
function install(app, auth, broadcast) {
    const route = (method, path, fn) => app[method](path, auth, async (req, res) => {
        try { const result = await transaction(db => fn(db, req));
            if (result.event) {
                broadcast({ type: 'mesa_updated', ...result.event, operacionId: req.body?.operacionId });
                if (result.kitchen) broadcast({ type: 'cocina_updated', ...result.event });
            }
            delete result.event; delete result.kitchen;
            res.json(result);
        } catch (e) {
            const diagnosticId = `KDS-${Date.now().toString(36).toUpperCase()}`;
            if (!e.status) console.error(`[${diagnosticId}] Pedidos:`, e.stack || e.message);
            res.status(e.status || 500).json({ success: false, message: e.status ? e.message : 'No se pudo cargar la cocina. Revise el registro del servidor.', diagnosticId: e.status ? undefined : diagnosticId });
        }
    });
    const event = t => ({ empresa: t.Empresa, numero: t.NroMesa, nroTicket: t.NroTicket.trim(), version: t.Version });
    route('get', '/api/pos/pedido', async (db, req) => {
        const cfg = await company(db, req.query.empresa, req.query.mesa);
        const found = (await query(db, `SELECT TOP 1 NroTicket FROM Ticket_c WHERE NroMesa=@mesa AND Estado IN(1,2) AND NroTicket LIKE @prefix ORDER BY Fecha DESC`,
            { mesa: Number(req.query.mesa), prefix: cfg.prefix + '-%' })).recordset[0];
        if (!found) return { success: true, pedido: null };
        return response(db, await ticket(db, found.NroTicket.trim(), cfg.empresa));
    });
    route('get', '/api/pos/pedido/:nro/estados-cocina', async (db, req) => {
        const t = await ticket(db, req.params.nro, req.query.empresa);
        const states = (await query(db, `SELECT l.LineaId,c.Estado,c.PendienteId,c.Anulada
            FROM Pedido_lineas l LEFT JOIN Cocina_estados c ON c.LineaId=l.LineaId
            WHERE l.NroTicket=@nro AND l.Baja=0 ORDER BY l.Orden,l.LineaId`, { nro: t.NroTicket })).recordset;
        return { success: true, nroTicket: t.NroTicket.trim(), version: t.Version, estados: states.map(row => ({
            lineaId: row.LineaId.toLowerCase(), estadoCocina: row.Estado, pendienteId: row.PendienteId?.toLowerCase() || null,
            anulada: Boolean(row.Anulada)
        })) };
    });
    route('post', '/api/pos/pedido', async (db, req) => {
        const b = req.body, incoming = normalizeItems(b.items), cfg = await company(db, b.empresa, b.mesa);
        await lock(db, `mesa:${cfg.empresa}:${Number(b.mesa)}`);
        const existingNro = b.nroTicket?.trim();
        if (existingNro && !incoming.length) {
            const result = await deleteCommercialOrder(db, existingNro, cfg.empresa, b.version, req.session.user.usuario, b.mesa);
            return { success: true, pedidoEliminado: true, nroTicket: existingNro, event: result.alreadyDeleted ? null : event(result.ticket), kitchen: true };
        }
        const mozo = Number(b.mozo);
        if (!Number.isInteger(mozo) || !(await query(db, 'SELECT Codemp FROM Empleados WHERE Codemp=@mozo AND Empresa=@empresa AND Tipo=3 AND FecCese IS NULL', { mozo, empresa: cfg.empresa })).recordset.length) fail('Seleccione un mozo activo de esta empresa');
        let nro = existingNro, t;
        if (!nro) {
            if (!incoming.length) fail('Agregue productos antes de crear un pedido');
            const turno = Number(b.turno) || 1, fechaNegocio = limaBusinessDate();
            if (await shiftClosures.isScopeClosed(db, cfg.empresa, turno, fechaNegocio)) fail('El turno seleccionado ya fue cerrado para hoy', 409);
            const active = (await query(db, 'SELECT NroTicket FROM Ticket_c WHERE NroMesa=@mesa AND Estado IN(1,2) AND NroTicket LIKE @prefix', { mesa: Number(b.mesa), prefix: cfg.prefix + '-%' })).recordset;
            if (active.length) fail('Esta mesa ya tiene un pedido. Recargue antes de continuar.', 409);
            await lock(db, `correlativo:${cfg.empresa}`);
            const raw = (await query(db, 'SELECT c_describe FROM Tablas WITH(UPDLOCK,HOLDLOCK) WHERE n_codtabla=23 AND n_numero=@numero', { numero: cfg.numero })).recordset[0].c_describe.trim();
            const count = Number(raw.split('-')[1]); if (!Number.isInteger(count)) fail('Correlativo inválido');
            nro = `${cfg.prefix}-${String(count + 1).padStart(6, '0')}`;
            await query(db, 'UPDATE Tablas SET c_describe=@nro WHERE n_codtabla=23 AND n_numero=@numero', { nro, numero: cfg.numero });
            await query(db, `INSERT Ticket_c(NroTicket,NroMesa,Mozo,Total,Estado,Fecha,Turno,Usuario)
                VALUES(@nro,@mesa,@mozo,0,1,CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SA Pacific Standard Time' AS SMALLDATETIME),@turno,@usuario);
                INSERT Pedido_control(NroTicket,Empresa) VALUES(@nro,@empresa);`,
                { nro, mesa: Number(b.mesa), mozo: Number(b.mozo) || 1, turno, usuario: req.session.user.usuario, empresa: cfg.empresa });
            t = await ticket(db, nro, cfg.empresa, true);
        } else { t = await ticket(db, nro, cfg.empresa, true); expected(t, b.version); }
        if (t.NroMesa !== Number(b.mesa)) fail('La mesa no corresponde al pedido');
        const previous = await lines(db, nro); validateEdits(previous, incoming);
        for (const l of incoming) {
            const product = (await query(db, 'SELECT CodPro,Nombre,Afecto,PventaMa FROM Productos WHERE CodPro=@cod AND Eliminado=0', { cod: l.codPro })).recordset[0];
            if (!product || !l.codPro.startsWith(String(cfg.empresa).padStart(2, '0'))) fail('Producto inexistente o de otra empresa');
            l.nombre = product.Nombre.trim().slice(0, 70); l.afecto = product.Afecto ? 1 : 0;
            const old = previous.find(p => p.lineaId === l.lineaId);
            l.precio = old ? old.precio : Number(product.PventaMa);
            const values = { nro, lineaId: l.lineaId, orden: l.orden, datos: JSON.stringify(l) };
            if (old) await query(db, 'UPDATE Pedido_lineas SET Datos=@datos,Orden=@orden,Baja=0 WHERE LineaId=@lineaId AND NroTicket=@nro', values);
            else {
                if ((await query(db, 'SELECT LineaId FROM Pedido_lineas WHERE LineaId=@lineaId', values)).recordset.length) fail('Línea pertenece a otro pedido', 409);
                await query(db, 'INSERT Pedido_lineas(LineaId,NroTicket,Orden,Datos) VALUES(@lineaId,@nro,@orden,@datos)', values);
            }
        }
        for (const old of previous.filter(l => !incoming.some(n => n.lineaId === l.lineaId))) await query(db, 'UPDATE Pedido_lineas SET Baja=1 WHERE LineaId=@lineaId', { lineaId: old.lineaId });
        await commercial(db, nro, incoming);
        await query(db, `UPDATE Ticket_c SET Mozo=@mozo,Usuario=@usuario WHERE NroTicket=@nro;
            UPDATE Pedido_control SET Version=Version+1 WHERE NroTicket=@nro;
            UPDATE Mesas SET Estado=2 WHERE Numero=@mesa AND Empresa=@empresa`,
            { nro, mozo: Number(b.mozo) || 1, usuario: req.session.user.usuario, mesa: t.NroMesa, empresa: t.Empresa });
        t.Version++;
        return { ...await response(db, t), event: event(t) };
    });
    route('post', '/api/pos/pedido/:nro/enviar-cocina', async (db, req) => {
        const t = await ticket(db, req.params.nro, req.body.empresa);
        const clave = id(req.body.clave);
        const existing = (await query(db, 'SELECT Id FROM Cocina_envios WHERE NroTicket=@nro AND Clave=@clave', { nro: t.NroTicket, clave })).recordset[0];
        if (!existing) { if (t.Estado !== 1) fail('Pedido no editable', 409); expected(t, req.body.version); }
        const envioId = existing?.Id?.toLowerCase() || await createSend(db, t, clave, req.session.user.usuario);
        return { ...await response(db, t), envioId, event: event(t), kitchen: true };
    });
    route('put', '/api/pos/pedido/:nro/pagar', async (db, req) => {
        const t = await ticket(db, req.params.nro, req.body.empresa, true); expected(t, req.body.version);
        const ls = await lines(db, t.NroTicket);
        if (!ls.some(l => !l.baja) || changes(ls).length) fail('Envíe los cambios a cocina antes de generar preventa', 409);
        await query(db, `UPDATE Ticket_c SET Estado=2 WHERE NroTicket=@nro; UPDATE Pedido_control SET Version=Version+1 WHERE NroTicket=@nro;
            UPDATE Mesas SET Estado=5 WHERE Numero=@mesa AND Empresa=@empresa`, { nro: t.NroTicket, mesa: t.NroMesa, empresa: t.Empresa });
        t.Version++; return { success: true, event: event(t) };
    });
    route('post', '/api/pos/ticket', async () => fail('Guarde el pedido y envíelo a cocina antes de generar preventa', 409));
    route('put', '/api/pos/pedido/:nro/reabrir', async (db, req) => {
        const t = await ticket(db, req.params.nro, req.body.empresa); expected(t, req.body.version);
        if (t.Estado !== 2) fail('Solo se puede reabrir una preventa', 409);
        await query(db, `UPDATE Ticket_c SET Estado=1 WHERE NroTicket=@nro; UPDATE Pedido_control SET Version=Version+1 WHERE NroTicket=@nro;
            UPDATE Mesas SET Estado=2 WHERE Numero=@mesa AND Empresa=@empresa`, { nro: t.NroTicket, mesa: t.NroMesa, empresa: t.Empresa });
        t.Version++; return { success: true, event: event(t) };
    });
    route('delete', '/api/pos/comanda/:nro', async (db, req) => {
        id(req.body.clave);
        const result = await deleteCommercialOrder(db, req.params.nro, req.query.empresa, req.body.version, req.session.user.usuario);
        return { success: true, pedidoEliminado: true, yaEliminado: result.alreadyDeleted,
            event: result.alreadyDeleted ? null : event(result.ticket), kitchen: true };
    });
    route('get', '/api/pos/pedido/:nro/envios', async (db, req) => {
        const t = await ticketReference(db, req.params.nro, req.query.empresa);
        const envios = (await query(db, `SELECT e.Id,e.Numero,e.Fecha,e.Historico,e.Documento,
            (SELECT j.Id,j.Estado,j.Error,j.Intentos,j.ReimpresionDe,j.Fecha FROM Impresion_trabajos j WHERE j.EnvioId=e.Id ORDER BY j.Fecha FOR JSON PATH) Trabajos
            FROM Cocina_envios e WHERE e.NroTicket=@nro ORDER BY e.Numero DESC`, { nro: t.NroTicket })).recordset;
        return { success: true, envios: envios.map(e => ({ ...e, trabajos: JSON.parse(e.Trabajos || '[]') })) };
    });
    route('get', '/api/pos/pedido/:nro/envios/:envio/documento', async (db, req) => {
        const t = await ticketReference(db, req.params.nro, req.query.empresa);
        const e = (await query(db, 'SELECT Documento FROM Cocina_envios WHERE Id=@envio AND NroTicket=@nro', { envio: id(req.params.envio), nro: t.NroTicket })).recordset[0];
        if (!e) fail('Envío no encontrado', 404); return { success: true, documento: e.Documento };
    });
    route('post', '/api/pos/pedido/:nro/envios/:envio/reimprimir', async (db, req) => {
        if (!printerEnabled()) fail('La impresión física todavía no está habilitada.', 503);
        const t = await ticketReference(db, req.params.nro, req.body.empresa);
        if (await shiftClosures.isTicketArchived(db, t.NroTicket)) fail('El turno esta cerrado. Reabra el turno antes de reimprimir.', 409);
        const envio = id(req.params.envio), clave = id(req.body.clave);
        const e = (await query(db, 'SELECT * FROM Cocina_envios WHERE Id=@envio AND NroTicket=@nro', { envio, nro: t.NroTicket })).recordset[0];
        if (!e) fail('Envío no encontrado', 404);
        const duplicate = (await query(db, 'SELECT Id,EnvioId FROM Impresion_trabajos WHERE Clave=@clave', { clave })).recordset[0];
        if (duplicate) { if (duplicate.EnvioId.toLowerCase() !== envio) fail('Clave usada en otro envío', 409); return { success: true, trabajoId: duplicate.Id.toLowerCase() }; }
        const jobs = (await query(db, 'SELECT * FROM Impresion_trabajos WHERE EnvioId=@envio ORDER BY Fecha DESC', { envio })).recordset;
        if (jobs.some(j => ['en_cola','procesando'].includes(j.Estado))) fail('Ya existe un trabajo pendiente para este envío', 409);
        const job = randomUUID();
        await query(db, `INSERT Impresion_trabajos(Id,EnvioId,ReimpresionDe,Clave,Documento,Usuario)
            VALUES(@job,@envio,@original,@clave,@doc,@usuario)`,
            { job, envio, original: jobs[0]?.Id || null, clave, doc: '*** REIMPRESIÓN ***\n' + e.Documento, usuario: req.session.user.usuario });
        return { success: true, trabajoId: job, event: t.NroMesa == null ? null : event(t) };
    });
    route('get', '/api/cocina/pedidos', async (db, req) => {
        const cfg = await company(db, req.query.empresa);
        const rows = (await query(db, `SELECT c.LineaId,c.NroTicket,c.Codpro,c.Estado,c.Operativa,c.PendienteId,c.Anulada,
            c.FechaEnvio,c.FechaEstado,t.NroMesa,t.Mozo,pc.Empresa,
            e.Id EnvioId,e.Numero NumeroEnvio,e.Documento,e.Fecha FechaEnvioDocumento,pd.Movimiento,
            pj.Id TrabajoId,pj.Estado EstadoImpresion,pj.Error ErrorImpresion,
            DATEDIFF(MINUTE,c.FechaEnvio,SYSUTCDATETIME()) MinutosEspera,L.Descripcion Categoria,
            em.Nombre MozoNombre
            FROM Cocina_estados c JOIN Ticket_c t ON t.NroTicket=c.NroTicket
            JOIN Pedido_control pc ON pc.NroTicket=c.NroTicket
            OUTER APPLY (SELECT TOP 1 ce.Id,ce.Numero,ce.Documento,ce.Fecha FROM Cocina_envios ce
                WHERE ce.NroTicket=c.NroTicket ORDER BY ce.Numero DESC) e
            OUTER APPLY (SELECT TOP 1 j.Id,j.Estado,j.Error FROM Impresion_trabajos j
                WHERE j.EnvioId=e.Id ORDER BY j.Fecha DESC,j.Id) pj
            LEFT JOIN Cocina_envio_detalles pd ON pd.Id=c.PendienteId
            LEFT JOIN Productos p ON p.CodPro=c.Codpro LEFT JOIN Lineas L ON L.CodLinea=p.Clinea
            LEFT JOIN Empleados em ON em.Codemp=t.Mozo AND em.Empresa=pc.Empresa
            WHERE pc.Empresa=@empresa AND ((c.Estado<4 AND c.Anulada=0) OR c.PendienteId IS NOT NULL)
            ORDER BY c.FechaEnvio,c.LineaId`, { empresa: cfg.empresa })).recordset;
        const grouped = new Map();
        for (const r of rows) {
            const operative = JSON.parse(r.Operativa || 'null');
            const ticket = String(r.NroTicket).trim();
            if (!grouped.has(ticket)) grouped.set(ticket, { nroTicket: ticket, envioId: r.EnvioId?.toLowerCase() || null,
                numeroEnvio: r.NumeroEnvio || null, mesa: r.NroMesa,
                mozo: (r.MozoNombre || r.Mozo || '').toString().trim(), fechaEnvio: r.FechaEnvioDocumento || r.FechaEnvio,
                minutosEspera: r.MinutosEspera || 0, documentoDisponible: Boolean(r.Documento), documento: r.Documento || '',
                impresion: r.TrabajoId ? { id: r.TrabajoId.toLowerCase(), estado: r.EstadoImpresion, error: r.ErrorImpresion } : null, lineas: [] });
            grouped.get(ticket).lineas.push({ lineaId: r.LineaId.toLowerCase(), codPro: String(r.Codpro).trim(), cantidad: operative?.cantidad,
                nombre: operative?.nombre, notasRapidas: operative?.notasRapidas || [], nota: operative?.nota || '', estado: r.Estado,
                Categoria: r.Categoria, correccionPendiente: r.Movimiento ? JSON.parse(r.Movimiento) : null });
        }
        const pedidos = [...grouped.values()].map(p => ({ ...p, estadoTicket: p.lineas.some(l => l.correccionPendiente) ? 'pendiente' : p.lineas.every(l => l.estado >= 3) ? 'listo' : p.lineas.every(l => l.estado >= 2) ? 'preparacion' : 'pendiente' }));
        return { success: true, pedidos };
    });
    route('get', '/api/cocina/historial', async (db, req) => {
        const cfg = await company(db, req.query.empresa);
        const page = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
        const size = Math.min(50, Math.max(5, Number.parseInt(req.query.tamano, 10) || 20));
        const date = /^\d{4}-\d{2}-\d{2}$/;
        const from = date.test(req.query.desde || '') ? new Date(`${req.query.desde}T05:00:00.000Z`) : new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }) + 'T05:00:00.000Z');
        const untilDay = date.test(req.query.hasta || '') ? req.query.hasta : new Date(from).toLocaleDateString('en-CA', { timeZone: 'UTC' });
        const until = new Date(`${untilDay}T05:00:00.000Z`); until.setUTCDate(until.getUTCDate() + 1);
        if (Number.isNaN(from.valueOf()) || Number.isNaN(until.valueOf()) || from >= until) fail('Rango de fechas inválido');
        const mesa = req.query.mesa === '' || req.query.mesa == null ? null : Number(req.query.mesa);
        if (mesa != null && (!Number.isInteger(mesa) || mesa <= 0)) fail('Mesa inválida');
        const ticketFilter = String(req.query.ticket || '').trim().slice(0, 20);
        const state = ['activo','cerrado','anulado'].includes(req.query.estado) ? req.query.estado : '';
        const values = { empresa: cfg.empresa, from, until, mesa, ticket: ticketFilter, state, offset: (page - 1) * size, size };
        const where = `pc.Empresa=@empresa AND e.Fecha>=@from AND e.Fecha<@until
            AND (@mesa IS NULL OR COALESCE(t.NroMesa,TRY_CONVERT(INT,JSON_VALUE(e.Cabecera,'$.mesa')))=@mesa)
            AND (@ticket='' OR e.NroTicket LIKE '%'+@ticket+'%')
            AND (@state='' OR (@state='activo' AND t.Estado IN(1,2))
                OR (@state='anulado' AND (t.NroTicket IS NULL OR t.Estado=4))
                OR (@state='cerrado' AND t.NroTicket IS NOT NULL AND t.Estado NOT IN(1,2,4)))`;
        const total = (await query(db, `SELECT COUNT(*) Total FROM Cocina_envios e JOIN Pedido_control pc ON pc.NroTicket=e.NroTicket
            LEFT JOIN Ticket_c t ON t.NroTicket=e.NroTicket WHERE ${where}`, values)).recordset[0].Total;
        const rows = (await query(db, `SELECT e.Id,e.NroTicket,e.Numero,e.Fecha,e.Historico,e.Documento,e.Cabecera,
            COALESCE(t.NroMesa,TRY_CONVERT(INT,JSON_VALUE(e.Cabecera,'$.mesa'))) NroMesa,t.Estado TicketEstado,
            (SELECT COUNT(*) FROM Cocina_envio_detalles d WHERE d.EnvioId=e.Id) Movimientos,
            (SELECT COUNT(*) FROM Cocina_envio_detalles d WHERE d.EnvioId=e.Id AND d.ReconocidoFecha IS NOT NULL) Reconocidos,
            (SELECT j.Id,j.Estado,j.Error,j.Intentos,j.ReimpresionDe,j.Fecha FROM Impresion_trabajos j WHERE j.EnvioId=e.Id ORDER BY j.Fecha FOR JSON PATH) Trabajos
            FROM Cocina_envios e JOIN Pedido_control pc ON pc.NroTicket=e.NroTicket LEFT JOIN Ticket_c t ON t.NroTicket=e.NroTicket
            WHERE ${where} ORDER BY e.Fecha DESC,e.Numero DESC OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY`, values)).recordset;
        return { success: true, pagina: page, tamano: size, total, envios: rows.map(r => ({ ...r, nroTicket: String(r.NroTicket).trim(),
            cabecera: JSON.parse(r.Cabecera), trabajos: JSON.parse(r.Trabajos || '[]'),
            estadoPedido: r.TicketEstado == null || r.TicketEstado === 4 ? 'anulado' : [1,2].includes(r.TicketEstado) ? 'activo' : 'cerrado' })) };
    });
    route('put', '/api/cocina/linea', async (db, req) => {
        const t = await ticket(db, req.body.nroTicket, req.body.empresa);
        const lineaId = id(req.body.lineaId), estado = Number(req.body.estado);
        const c = (await query(db, 'SELECT * FROM Cocina_estados WHERE LineaId=@lineaId AND NroTicket=@nro', { lineaId, nro: t.NroTicket })).recordset[0];
        if (!c) fail('Línea no encontrada', 404);
        if (c.PendienteId || c.Anulada || ![2,3].includes(estado) || estado !== c.Estado + 1) fail('Transición inválida o corrección sin reconocer', 409);
        await query(db, 'UPDATE Cocina_estados SET Estado=@estado,Usuario=@usuario,FechaEstado=GETDATE() WHERE LineaId=@lineaId', { lineaId, estado, usuario: req.session.user.usuario });
        return { success: true, event: event(t), kitchen: true };
    });
    route('put', '/api/cocina/linea/:linea/reconocer', async (db, req) => {
        const t = await ticket(db, req.body.nroTicket, req.body.empresa), lineaId = id(req.params.linea);
        const c = (await query(db, `SELECT c.PendienteId,d.Movimiento FROM Cocina_estados c JOIN Cocina_envio_detalles d ON d.Id=c.PendienteId
            WHERE c.LineaId=@lineaId AND c.NroTicket=@nro`, { lineaId, nro: t.NroTicket })).recordset[0];
        if (!c) fail('No hay corrección pendiente', 409);
        const m = JSON.parse(c.Movimiento);
        const values = { lineaId, operative: m.nueva ? JSON.stringify(m.nueva) : null, usuario: req.session.user.usuario, detail: c.PendienteId, nro: t.NroTicket };
        if (m.nueva) await query(db, 'UPDATE Cocina_estados SET Operativa=@operative,Anulada=0,PendienteId=NULL,Usuario=@usuario,FechaEstado=GETDATE() WHERE LineaId=@lineaId', values);
        else await query(db, 'UPDATE Cocina_estados SET Anulada=1,PendienteId=NULL,Usuario=@usuario,FechaEstado=GETDATE() WHERE LineaId=@lineaId', values);
        await query(db, `UPDATE Cocina_envio_detalles SET ReconocidoPor=@usuario,ReconocidoFecha=SYSUTCDATETIME() WHERE Id=@detail;
            UPDATE Pedido_control SET Version=Version+1 WHERE NroTicket=@nro`, values);
        t.Version++; return { success: true, event: event(t), kitchen: true };
    });
    for (const action of ['todo-listo','entregado']) route('put', `/api/cocina/ticket/:nro/${action}`, async (db, req) => {
        const t = await ticket(db, req.params.nro, req.body.empresa);
        const active = (await query(db, 'SELECT * FROM Cocina_estados WHERE NroTicket=@nro AND (Anulada=0 OR PendienteId IS NOT NULL)', { nro: t.NroTicket })).recordset;
        if (action === 'entregado' && active.some(l => l.PendienteId || l.Estado < 3)) fail('Resuelva las correcciones y complete los platos antes de entregar', 409);
        await query(db, `UPDATE Cocina_estados SET Estado=@estado,Usuario=@usuario,FechaEstado=GETDATE()
            WHERE NroTicket=@nro AND Anulada=0 AND PendienteId IS NULL AND Estado<@estado`,
            { nro: t.NroTicket, estado: action === 'entregado' ? 4 : 3, usuario: req.session.user.usuario });
        return { success: true, event: event(t), kitchen: true };
    });
}
async function recoverCancellation({ nroTicket, empresa, version, clave, usuario }) {
    return transaction(async db => {
        id(clave);
        const result = await deleteCommercialOrder(db, nroTicket, empresa, version, usuario);
        return { nroTicket: result.ticket.NroTicket.trim(), mesa: result.ticket.NroMesa,
            version: result.ticket.Version, deleted: result.deleted, alreadyDeleted: result.alreadyDeleted };
    });
}
module.exports = { install, query, transaction, recoverCancellation, deleteCommercialOrder };
