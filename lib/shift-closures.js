'use strict';
const { createHash, randomUUID } = require('node:crypto');
const bcrypt = require('bcryptjs');
const { getConnection, sql } = require('../db');
const { uuid } = require('./order-domain');

const attempts = new Map();
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RETENTION_DAYS = Math.min(3650, Math.max(1, Number.parseInt(process.env.KITCHEN_RETENTION_DAYS, 10) || 30));
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MS = 5 * 60 * 1000;

function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function sha(value) { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function limaDate() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }); }
function validScope(empresa, turno, fechaNegocio) {
    empresa = Number(empresa); turno = Number(turno);
    if (![2, 4, 6].includes(empresa)) fail('Empresa invalida');
    if (![1, 2].includes(turno)) fail('Turno invalido');
    if (!DATE.test(fechaNegocio || '') || fechaNegocio > limaDate()) fail('Fecha de negocio invalida');
    return { empresa, turno, fechaNegocio };
}
function request(db, text, values = {}) {
    const req = new sql.Request(db);
    for (const [name, value] of Object.entries(values)) req.input(name, value === undefined ? null : value);
    return req.query(text);
}
async function txRun(fn) {
    const tx = new sql.Transaction(await getConnection()); await tx.begin();
    try { const value = await fn(tx); await tx.commit(); return value; }
    catch (error) { try { await tx.rollback(); } catch {} throw error; }
}
async function appLock(db, resource) {
    await request(db, `DECLARE @r INT; EXEC @r=sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
        IF @r<0 THROW 51000,'Cierre ocupado. Reintente.',1;`, { resource });
}
function scopeSql(alias = 'pc') {
    return `${alias}.Empresa=@empresa AND ((t.NroTicket IS NOT NULL AND t.Turno=@turno AND CONVERT(char(10),t.Fecha,23)=@fecha)
        OR (t.NroTicket IS NULL AND TRY_CONVERT(INT,JSON_VALUE(lastSend.Cabecera,'$.turno'))=@turno
        AND JSON_VALUE(lastSend.Cabecera,'$.fechaNegocio')=@fecha))`;
}
function scopeFrom() {
    return `FROM Pedido_control pc LEFT JOIN Ticket_c t ON t.NroTicket=pc.NroTicket
        OUTER APPLY (SELECT TOP 1 Cabecera FROM Cocina_envios ce WHERE ce.NroTicket=pc.NroTicket ORDER BY ce.Numero DESC) lastSend`;
}
async function scopedTickets(db, scope) {
    return (await request(db, `SELECT pc.NroTicket ${scopeFrom()} WHERE ${scopeSql()} ORDER BY pc.NroTicket`, {
        empresa: scope.empresa, turno: scope.turno, fecha: scope.fechaNegocio
    })).recordset.map(row => String(row.NroTicket).trim());
}
async function preview(db, scope) {
    const tickets = await scopedTickets(db, scope);
    const values = { empresa: scope.empresa, turno: scope.turno, fecha: scope.fechaNegocio };
    const blockers = (await request(db, `WITH Scope AS (
            SELECT pc.NroTicket,t.Estado ${scopeFrom()} WHERE ${scopeSql()}
        ) SELECT
        (SELECT COUNT(*) FROM Scope WHERE Estado IN(1,2)) PedidosActivos,
        (SELECT COUNT(DISTINCT c.NroTicket) FROM Cocina_estados c JOIN Scope s ON s.NroTicket=c.NroTicket WHERE c.Anulada=0 AND c.Estado<4) CocinaPendiente,
        (SELECT COUNT(DISTINCT c.NroTicket) FROM Cocina_estados c JOIN Scope s ON s.NroTicket=c.NroTicket WHERE c.PendienteId IS NOT NULL) CorreccionesPendientes,
        (SELECT COUNT(DISTINCT e.NroTicket) FROM Impresion_trabajos j JOIN Cocina_envios e ON e.Id=j.EnvioId JOIN Scope s ON s.NroTicket=e.NroTicket WHERE j.Estado IN('en_cola','procesando')) ImpresionesActivas`, values)).recordset[0] || {};
    const legacy = (await request(db, `SELECT COUNT(*) Total FROM Pedido_control pc LEFT JOIN Ticket_c t ON t.NroTicket=pc.NroTicket
        OUTER APPLY (SELECT TOP 1 Cabecera FROM Cocina_envios ce WHERE ce.NroTicket=pc.NroTicket ORDER BY ce.Numero DESC) lastSend
        WHERE pc.Empresa=@empresa AND t.NroTicket IS NULL AND (lastSend.Cabecera IS NULL OR JSON_VALUE(lastSend.Cabecera,'$.turno') IS NULL OR JSON_VALUE(lastSend.Cabecera,'$.fechaNegocio') IS NULL)`, values)).recordset[0]?.Total || 0;
    const normalized = {
        pedidosActivos: Number(blockers.PedidosActivos || 0), cocinaPendiente: Number(blockers.CocinaPendiente || 0),
        correccionesPendientes: Number(blockers.CorreccionesPendientes || 0), impresionesActivas: Number(blockers.ImpresionesActivas || 0)
    };
    const existing = (await request(db, `SELECT * FROM Cierres_turno WHERE Empresa=@empresa AND Turno=@turno AND FechaNegocio=@fecha`, values)).recordset[0] || null;
    return { scope, tickets, totalTickets: tickets.length, bloqueos: normalized,
        elegible: Object.values(normalized).every(value => value === 0), registrosSinTurno: Number(legacy),
        cierre: existing ? publicClosure(existing) : null };
}
async function archiveTicket(db, cierreId, scope, nroTicket) {
    const control = (await request(db, 'SELECT * FROM Pedido_control WHERE NroTicket=@nro', { nro: nroTicket })).recordset[0] || null;
    const lines = (await request(db, 'SELECT * FROM Pedido_lineas WHERE NroTicket=@nro ORDER BY Orden,LineaId', { nro: nroTicket })).recordset;
    const sends = (await request(db, 'SELECT * FROM Cocina_envios WHERE NroTicket=@nro ORDER BY Numero,Id', { nro: nroTicket })).recordset;
    const details = (await request(db, `SELECT d.* FROM Cocina_envio_detalles d JOIN Cocina_envios e ON e.Id=d.EnvioId
        WHERE e.NroTicket=@nro ORDER BY e.Numero,d.Id`, { nro: nroTicket })).recordset;
    const states = (await request(db, 'SELECT * FROM Cocina_estados WHERE NroTicket=@nro ORDER BY LineaId', { nro: nroTicket })).recordset;
    const jobs = (await request(db, `SELECT j.* FROM Impresion_trabajos j JOIN Cocina_envios e ON e.Id=j.EnvioId
        WHERE e.NroTicket=@nro ORDER BY j.Fecha,j.Id`, { nro: nroTicket })).recordset;
    const payload = JSON.stringify({ schemaVersion: 1, scope, nroTicket, tables: {
        Pedido_control: control, Pedido_lineas: lines, Cocina_envios: sends,
        Cocina_envio_detalles: details, Cocina_estados: states, Impresion_trabajos: jobs
    }});
    const hash = sha(payload);
    await request(db, `INSERT Cierre_turno_archivos(CierreId,NroTicket,Payload,Hash) VALUES(@cierre,@nro,@payload,@hash)`,
        { cierre: cierreId, nro: nroTicket, payload, hash });
    return { hash, counts: { Pedido_control: control ? 1 : 0, Pedido_lineas: lines.length, Cocina_envios: sends.length,
        Cocina_envio_detalles: details.length, Cocina_estados: states.length, Impresion_trabajos: jobs.length } };
}
function addCounts(target, source) { for (const [key, value] of Object.entries(source)) target[key] = (target[key] || 0) + value; }
async function operationByKey(db, key, action) {
    const row = (await request(db, `SELECT o.Accion,o.CierreId,c.* FROM Cierre_turno_operaciones o JOIN Cierres_turno c ON c.Id=o.CierreId WHERE o.Clave=@key`, { key })).recordset[0];
    if (row && row.Accion !== action) fail('La clave idempotente ya fue usada en otra operacion', 409);
    return row;
}
async function recordOperation(db, cierreId, key, action, user, result = 'aplicado') {
    await request(db, `INSERT Cierre_turno_operaciones(Id,CierreId,Clave,Accion,Usuario,Resultado) VALUES(@id,@cierre,@key,@action,@user,@result)`,
        { id: randomUUID(), cierre: cierreId, key, action, user, result });
}
async function closeShift(scopeInput, user, key) {
    const scope = validScope(scopeInput.empresa, scopeInput.turno, scopeInput.fechaNegocio);
    if (!uuid.test(key || '')) fail('Clave idempotente invalida');
    return txRun(async db => {
        const duplicate = await operationByKey(db, key, 'cerrar');
        if (duplicate) return publicClosure(duplicate, true);
        await appLock(db, `cierre:${scope.empresa}:${scope.turno}:${scope.fechaNegocio}`);
        const status = await preview(db, scope);
        if (!status.elegible) fail('El turno tiene pedidos, cocina, correcciones o impresiones pendientes', 409);
        let closure = (await request(db, `SELECT * FROM Cierres_turno WITH(UPDLOCK,HOLDLOCK) WHERE Empresa=@empresa AND Turno=@turno AND FechaNegocio=@fecha`,
            { empresa: scope.empresa, turno: scope.turno, fecha: scope.fechaNegocio })).recordset[0];
        if (closure && closure.Estado !== 'reabierto') fail('El turno ya esta cerrado', 409);
        const cierreId = closure?.Id || randomUUID();
        if (!closure) {
            await request(db, `INSERT Cierres_turno(Id,Empresa,Turno,FechaNegocio,Usuario,Estado,RetencionDias,PurgaProgramada)
                VALUES(@id,@empresa,@turno,@fecha,@user,'cerrado',@days,DATEADD(DAY,@days,SYSUTCDATETIME()))`,
                { id: cierreId, ...scope, fecha: scope.fechaNegocio, user, days: RETENTION_DAYS });
        }
        if (closure) await request(db, 'DELETE Cierre_turno_archivos WHERE CierreId=@cierre', { cierre: cierreId });
        const counts = {}, archived = [];
        for (const ticket of status.tickets) { const item = await archiveTicket(db, cierreId, scope, ticket); archived.push(`${ticket}:${item.hash}`); addCounts(counts, item.counts); }
        const globalHash = sha(archived.sort().join('|'));
        await request(db, `UPDATE Cierres_turno SET Estado='cerrado',CorteUtc=SYSUTCDATETIME(),Usuario=@user,RetencionDias=@days,
            PurgaProgramada=DATEADD(DAY,@days,SYSUTCDATETIME()),PurgaFecha=NULL,Conteos=@counts,HashGlobal=@hash,Error=NULL,ActualizadoUtc=SYSUTCDATETIME() WHERE Id=@id`,
            { id: cierreId, user, days: RETENTION_DAYS, counts: JSON.stringify(counts), hash: globalHash });
        await recordOperation(db, cierreId, key, 'cerrar', user);
        closure = (await request(db, 'SELECT * FROM Cierres_turno WHERE Id=@id', { id: cierreId })).recordset[0];
        return { ...publicClosure(closure), preview: status };
    });
}
async function loadClosure(db, id, lock = false) {
    if (!uuid.test(id || '')) fail('Cierre invalido');
    const row = (await request(db, `SELECT * FROM Cierres_turno${lock ? ' WITH(UPDLOCK,HOLDLOCK)' : ''} WHERE Id=@id`, { id })).recordset[0];
    if (!row) fail('Cierre no encontrado', 404); return row;
}
function publicClosure(row, idempotent = false) {
    return { id: String(row.Id).toLowerCase(), empresa: row.Empresa, turno: row.Turno, fechaNegocio: row.FechaNegocio,
        estado: row.Estado, retencionDias: row.RetencionDias, purgaProgramada: row.PurgaProgramada,
        purgaFecha: row.PurgaFecha, conteos: typeof row.Conteos === 'string' ? JSON.parse(row.Conteos || '{}') : row.Conteos || {},
        hashGlobal: row.HashGlobal, error: row.Error, idempotente: idempotent };
}
async function reopenShift(id, user, key) {
    if (!uuid.test(key || '')) fail('Clave idempotente invalida');
    return txRun(async db => {
        const duplicate = await operationByKey(db, key, 'reabrir'); if (duplicate) return publicClosure(duplicate, true);
        const closure = await loadClosure(db, id, true); await appLock(db, `cierre:${closure.Empresa}:${closure.Turno}:${formatDate(closure.FechaNegocio)}`);
        if (closure.Estado === 'purgado' || closure.Estado === 'purgando') fail('El cierre ya no puede reabrirse', 409);
        if (closure.Estado !== 'reabierto') {
            await request(db, `UPDATE Cierres_turno SET Estado='reabierto',HashGlobal=NULL,Conteos=NULL,Error=NULL,ActualizadoUtc=SYSUTCDATETIME() WHERE Id=@id`, { id });
            await request(db, 'DELETE Cierre_turno_archivos WHERE CierreId=@id', { id });
        }
        await recordOperation(db, id, key, 'reabrir', user, closure.Estado === 'reabierto' ? 'idempotente' : 'aplicado');
        return publicClosure(await loadClosure(db, id), closure.Estado === 'reabierto');
    });
}
function formatDate(value) { return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10); }
async function purgeClosure(id, user, key = randomUUID(), automatic = false) {
    if (!uuid.test(key || '')) fail('Clave idempotente invalida');
    let purgeAttempted = false;
    try { return await txRun(async db => {
        const action = automatic ? 'purga_auto' : 'purgar';
        const duplicate = await operationByKey(db, key, action); if (duplicate) return publicClosure(duplicate, true);
        const closure = await loadClosure(db, id, true);
        await appLock(db, `cierre:${closure.Empresa}:${closure.Turno}:${formatDate(closure.FechaNegocio)}`);
        if (closure.Estado === 'purgado') { await recordOperation(db, id, key, action, user, 'idempotente'); return publicClosure(closure, true); }
        if (!['cerrado','error'].includes(closure.Estado)) fail('El cierre no esta disponible para purga', 409);
        if (new Date(closure.PurgaProgramada) > new Date()) fail('La retencion de datos aun no ha vencido', 409);
        purgeAttempted = true;
        const archives = (await request(db, 'SELECT NroTicket,Payload,Hash FROM Cierre_turno_archivos WHERE CierreId=@id ORDER BY NroTicket', { id })).recordset;
        const hashes = [];
        for (const archive of archives) { if (sha(archive.Payload) !== archive.Hash.trim()) fail('El archivo del cierre no supera la verificacion de integridad', 409); hashes.push(`${String(archive.NroTicket).trim()}:${archive.Hash.trim()}`); }
        if (sha(hashes.sort().join('|')) !== String(closure.HashGlobal || '').trim()) fail('El hash global del cierre no coincide', 409);
        const active = (await request(db, `SELECT COUNT(*) Total FROM Ticket_c WHERE NroTicket IN (SELECT NroTicket FROM Cierre_turno_archivos WHERE CierreId=@id) AND Estado IN(1,2)`, { id })).recordset[0]?.Total || 0;
        if (active) fail('Uno de los pedidos archivados volvio a estar activo', 409);
        await request(db, `UPDATE Cierres_turno SET Estado='purgando',ActualizadoUtc=SYSUTCDATETIME() WHERE Id=@id`, { id });
        for (const archive of archives) {
            const nro = String(archive.NroTicket).trim();
            await request(db, `UPDATE j SET ReimpresionDe=NULL FROM Impresion_trabajos j JOIN Cocina_envios e ON e.Id=j.EnvioId WHERE e.NroTicket=@nro;
                DELETE j FROM Impresion_trabajos j JOIN Cocina_envios e ON e.Id=j.EnvioId WHERE e.NroTicket=@nro;
                DELETE FROM Cocina_estados WHERE NroTicket=@nro;
                DELETE d FROM Cocina_envio_detalles d JOIN Cocina_envios e ON e.Id=d.EnvioId WHERE e.NroTicket=@nro;
                DELETE FROM Cocina_envios WHERE NroTicket=@nro;
                DELETE FROM Pedido_lineas WHERE NroTicket=@nro;
                DELETE FROM Pedido_control WHERE NroTicket=@nro;`, { nro });
        }
        await request(db, `UPDATE Cierres_turno SET Estado='purgado',PurgaFecha=SYSUTCDATETIME(),Error=NULL,ActualizadoUtc=SYSUTCDATETIME() WHERE Id=@id`, { id });
        await recordOperation(db, id, key, action, user);
        return publicClosure(await loadClosure(db, id));
    }); } catch (error) {
        if (purgeAttempted) try {
            const pool = await getConnection();
            await pool.request().input('id', id).input('error', String(error.message || error).slice(0, 1000))
                .query("UPDATE Cierres_turno SET Estado='error',Error=@error,ActualizadoUtc=SYSUTCDATETIME() WHERE Id=@id AND Estado IN('cerrado','error')");
        } catch (auditError) { console.error(`No se pudo registrar el error de purga ${id}: ${auditError.message}`); }
        throw error;
    }
}
async function assertPin(req) {
    const hash = process.env.MAINTENANCE_PIN_HASH;
    if (!hash) fail('El PIN de mantenimiento no esta configurado', 503);
    const identity = `${req.sessionID || 'session'}:${req.ip || 'ip'}`;
    const state = attempts.get(identity) || { failures: 0, lockedUntil: 0 };
    if (state.lockedUntil > Date.now()) fail('Demasiados intentos. Espere cinco minutos.', 429);
    const valid = typeof req.body?.pin === 'string' && await bcrypt.compare(req.body.pin, hash);
    if (!valid) {
        state.failures++; if (state.failures >= MAX_PIN_ATTEMPTS) { state.failures = 0; state.lockedUntil = Date.now() + PIN_LOCK_MS; }
        attempts.set(identity, state); fail('PIN de mantenimiento incorrecto', 403);
    }
    attempts.delete(identity);
}
function install(app, auth, broadcast) {
    const handler = fn => async (req, res) => {
        if (!process.env.MAINTENANCE_PIN_HASH) return res.status(503).json({ success: false, message: 'El cierre de turno todavía no está habilitado.' });
        try { res.json(await fn(req)); } catch (error) { res.status(error.status || 500).json({ success: false, message: error.status ? error.message : 'No se pudo completar el cierre de turno.' }); }
    };
    app.get('/api/admin/cierres/preview', auth, handler(async req => ({ success: true, ...await txRun(db => preview(db, validScope(req.query.empresa, req.query.turno, req.query.fechaNegocio))) })));
    app.get('/api/admin/cierres/:id', auth, handler(async req => txRun(async db => {
        const closure = await loadClosure(db, req.params.id); const files = (await request(db, 'SELECT NroTicket,Hash FROM Cierre_turno_archivos WHERE CierreId=@id ORDER BY NroTicket', { id: closure.Id })).recordset;
        return { success: true, ...publicClosure(closure), archivos: files.map(f => ({ nroTicket: String(f.NroTicket).trim(), hash: f.Hash.trim() })) };
    })));
    app.post('/api/admin/cierres', auth, handler(async req => {
        await assertPin(req); if (req.body.confirmacion !== 'CERRAR TURNO') fail('Confirmacion invalida');
        const result = await closeShift(req.body, req.session.user.usuario, req.body.clave); broadcast({ type: 'cierre_turno_updated', empresa: result.empresa, turno: result.turno, fechaNegocio: result.fechaNegocio, estado: result.estado });
        return { success: true, ...result };
    }));
    app.post('/api/admin/cierres/:id/reabrir', auth, handler(async req => {
        await assertPin(req); if (req.body.confirmacion !== 'REABRIR TURNO') fail('Confirmacion invalida');
        const result = await reopenShift(req.params.id, req.session.user.usuario, req.body.clave); broadcast({ type: 'cierre_turno_updated', empresa: result.empresa, turno: result.turno, fechaNegocio: result.fechaNegocio, estado: result.estado });
        return { success: true, ...result };
    }));
    app.post('/api/admin/cierres/:id/purgar', auth, handler(async req => {
        await assertPin(req); if (req.body.confirmacion !== 'PURGAR DATOS') fail('Confirmacion invalida');
        return { success: true, ...await purgeClosure(req.params.id, req.session.user.usuario, req.body.clave) };
    }));
}
async function isScopeClosed(db, empresa, turno, fechaNegocio) {
    return Boolean((await request(db, `SELECT TOP 1 1 Cerrado FROM Cierres_turno WHERE Empresa=@empresa AND Turno=@turno AND FechaNegocio=@fecha AND Estado IN('cerrado','purgando','purgado','error')`,
        { empresa: Number(empresa), turno: Number(turno), fecha: fechaNegocio })).recordset.length);
}
async function isTicketArchived(db, nroTicket) {
    return Boolean((await request(db, `SELECT TOP 1 1 Archivado FROM Cierre_turno_archivos a JOIN Cierres_turno c ON c.Id=a.CierreId WHERE a.NroTicket=@nro AND c.Estado IN('cerrado','purgando','purgado','error')`, { nro: nroTicket })).recordset.length);
}
async function purgeDueClosures() {
    const pool = await getConnection();
    const due = (await pool.request().query(`SELECT Id FROM Cierres_turno WHERE Estado IN('cerrado','error') AND PurgaProgramada<=SYSUTCDATETIME()`)).recordset;
    for (const row of due) try { await purgeClosure(String(row.Id).toLowerCase(), 'sistema-retencion', randomUUID(), true); }
    catch (error) { console.error(`Retencion cierre ${row.Id}: ${error.message}`); }
}
function startRetentionWorker() {
    const interval = Math.max(60000, Number.parseInt(process.env.KITCHEN_RETENTION_INTERVAL_MS, 10) || 21600000);
    const first = setTimeout(() => purgeDueClosures().catch(error => console.error(`Retencion: ${error.message}`)), 15000); first.unref?.();
    const timer = setInterval(() => purgeDueClosures().catch(error => console.error(`Retencion: ${error.message}`)), interval); timer.unref?.();
    return () => { clearTimeout(first); clearInterval(timer); };
}

module.exports = { install, startRetentionWorker, purgeDueClosures, closeShift, reopenShift, purgeClosure,
    isScopeClosed, isTicketArchived, validScope, preview, sha, RETENTION_DAYS };
