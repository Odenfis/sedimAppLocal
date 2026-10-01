'use strict';
const { createHash, randomUUID } = require('node:crypto');
const { getConnection, sql } = require('../db');
const { fail, uuid, normalizeItems, snapshot, same, changes, validateEdits, printText } = require('./order-domain');
const { amounts } = require('../public/order-math');
const shiftClosures = require('./shift-closures');
const requestContext = require('./request-context');
const KitchenSnapshotStore = require('./kitchen-snapshot-store');
const { compareCommercial, publicComparison } = require('./commercial-snapshot');
const { normalizeCompany } = require('./company-context');
const { employeeEligibilitySql, isMarketplaceTable } = require('./employee-scope');
const nowLima = () => new Date().toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false });
const limaBusinessDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
const printerEnabled = () => String(process.env.PRINTER_ENABLED).toLowerCase() === 'true' && Boolean(process.env.PRINTER_HOST);
const barPrinterEnabled = () => String(process.env.BAR_PRINTER_ENABLED).toLowerCase() === 'true' && Boolean(process.env.BAR_PRINTER_HOST);
const printQueue = destination => destination === 'barra' ? 'Impresion_barra_trabajos' : 'Impresion_trabajos';
const kitchenSnapshots = new KitchenSnapshotStore({
    ttlMs: 2000,
    classifyError: requestContext.classifyError,
    logger(record, level) {
        const output = JSON.stringify(record);
        if (level === 'warn') console.warn(output);
        else console.log(output);
    }
});
function query(db, text, values = {}) {
    const request = new sql.Request(db);
    for (const [key, value] of Object.entries(values)) {
        const normalized = value === undefined ? null : value;
        if (typeof normalized === 'string' && normalized.length > 4000) request.input(key, sql.NVarChar(sql.MAX), normalized);
        else request.input(key, normalized);
    }
    return requestContext.measureSql(() => request.query(text));
}
async function transaction(fn, connectionProvider = getConnection) {
    const tx = new sql.Transaction(await connectionProvider()); await tx.begin();
    try { const result = await fn(tx); await tx.commit(); return result; }
    catch (e) { try { await tx.rollback(); } catch {} throw e; }
}
function id(value) { if (!uuid.test(value || '')) fail('Identificador inválido'); return value.toLowerCase(); }
function safeJson(value, fallback, field) {
    if (value == null || value === '') return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); }
    catch (error) {
        console.warn(JSON.stringify({ type: 'invalid_auxiliary_json', requestId: requestContext.currentId(), field,
            error: { name: error?.name || 'SyntaxError' } }));
        return fallback;
    }
}
function publicPrintings(jobs) {
    return jobs.map(job => ({ id: job.Id.toLowerCase(), destino: job.Destino || 'cocina', estado: job.Estado,
        error: job.Error, intentos: job.Intentos, reimpresionDe: job.ReimpresionDe?.toLowerCase?.() || null, fecha: job.Fecha }));
}
async function lock(db, resource) {
    await query(db, `DECLARE @r INT; EXEC @r=sp_getapplock @Resource=@resource,@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=10000;
        IF @r<0 THROW 51000,'Pedido ocupado. Reintente.',1;`, { resource });
}
async function archiveOrphanedDraft(db, nro, cfg, usuario) {
    const control = (await query(db, `SELECT pc.*,
            CASE WHEN t.NroTicket IS NULL THEN 0 ELSE 1 END HasCommercial,
            (SELECT COUNT(*) FROM Ticket_d d WHERE d.NroTicket COLLATE DATABASE_DEFAULT=pc.NroTicket COLLATE DATABASE_DEFAULT) CommercialLines,
            (SELECT COUNT(*) FROM Cocina_envios e WHERE e.NroTicket COLLATE DATABASE_DEFAULT=pc.NroTicket COLLATE DATABASE_DEFAULT) Sends,
            (SELECT COUNT(*) FROM Cocina_estados s WHERE s.NroTicket COLLATE DATABASE_DEFAULT=pc.NroTicket COLLATE DATABASE_DEFAULT) KitchenStates
        FROM Pedido_control pc WITH(UPDLOCK,HOLDLOCK)
        LEFT JOIN Ticket_c t WITH(UPDLOCK,HOLDLOCK) ON t.NroTicket COLLATE DATABASE_DEFAULT=pc.NroTicket COLLATE DATABASE_DEFAULT
        WHERE pc.NroTicket=@nro`, { nro })).recordset[0];
    if (!control) {
        const commercial = (await query(db, 'SELECT TOP 1 NroTicket FROM Ticket_c WITH(UPDLOCK,HOLDLOCK) WHERE NroTicket=@nro', { nro })).recordset[0];
        if (commercial) fail('El correlativo comercial ya está ocupado. Revise Tablas antes de continuar.', 409, 'TICKET_SEQUENCE_CONFLICT');
        return false;
    }
    if (control.Empresa !== cfg.empresa || control.HasCommercial || control.CommercialLines || control.UltimoEnvio || control.Sends || control.KitchenStates) {
        fail('El correlativo está asociado a un pedido o historial operativo y no puede recuperarse automáticamente.', 409, 'TICKET_SEQUENCE_CONFLICT');
    }
    const lines = (await query(db, 'SELECT * FROM Pedido_lineas WHERE NroTicket=@nro ORDER BY Orden,LineaId', { nro })).recordset;
    const routes = (await query(db, `SELECT r.* FROM Impresion_linea_rutas r JOIN Pedido_lineas l ON l.LineaId=r.LineaId
        WHERE l.NroTicket=@nro ORDER BY r.LineaId`, { nro })).recordset;
    const destinations = (await query(db, `SELECT d.* FROM Impresion_linea_destinos d JOIN Pedido_lineas l ON l.LineaId=d.LineaId
        WHERE l.NroTicket=@nro ORDER BY d.LineaId`, { nro })).recordset;
    const publicControl = { NroTicket: String(control.NroTicket).trim(), Empresa: control.Empresa, Version: control.Version,
        UltimoEnvio: control.UltimoEnvio, SnapshotComercial: control.SnapshotComercial };
    const payload = JSON.stringify({ schemaVersion: 1, reason: 'correlativo_auxiliar_huerfano',
        tables: { Pedido_control: publicControl, Pedido_lineas: lines, Impresion_linea_rutas: routes, Impresion_linea_destinos: destinations } });
    const hash = createHash('sha256').update(payload, 'utf8').digest('hex');
    const archiveId = randomUUID();
    await query(db, `INSERT Pedido_residuos_archivo(Id,NroTicket,Empresa,Motivo,Payload,Hash,Usuario)
            VALUES(@id,@nro,@empresa,'correlativo_auxiliar_huerfano',@payload,@hash,@usuario);
        DELETE r FROM Impresion_linea_rutas r JOIN Pedido_lineas l ON l.LineaId=r.LineaId WHERE l.NroTicket=@nro;
        DELETE d FROM Impresion_linea_destinos d JOIN Pedido_lineas l ON l.LineaId=d.LineaId WHERE l.NroTicket=@nro;
        DELETE FROM Pedido_lineas WHERE NroTicket=@nro;
        DELETE FROM Pedido_control WHERE NroTicket=@nro;`,
        { id: archiveId, nro, empresa: cfg.empresa, payload, hash, usuario });
    console.warn(JSON.stringify({ type: 'orphaned_draft_archived', requestId: requestContext.currentId(), empresa: cfg.empresa,
        nroTicket: nro, archiveId, lines: lines.length, hash }));
    return true;
}
function companyNumber(empresa) {
    const normalized = normalizeCompany(empresa);
    return { empresa: normalized.empresa, numero: normalized.numeroTabla };
}
async function company(db, empresa, mesa) {
    const normalized = companyNumber(empresa);
    empresa = normalized.empresa;
    const numero = normalized.numero;
    const cfg = (await query(db, 'SELECT c_describe FROM Tablas WHERE n_codtabla=23 AND n_numero=@numero', { numero })).recordset[0];
    if (!cfg || !cfg.c_describe.includes('-')) fail('No hay configuración de cocina para esta empresa', 404);
    if (mesa != null && !(await query(db, 'SELECT Numero FROM Mesas WHERE Numero=@mesa AND Empresa=@empresa', { mesa: Number(mesa), empresa })).recordset.length) {
        fail('La mesa no corresponde a la empresa seleccionada', 409, 'COMPANY_CONTEXT_MISMATCH');
    }
    return { empresa, numero, prefix: cfg.c_describe.trim().split('-')[0] };
}
async function ticket(db, nro, empresa, editable = false, forUpdate = true, validateCommercial = true) {
    const cfg = await company(db, empresa);
    if (forUpdate) await lock(db, `pedido:${String(nro).trim()}`);
    const hint = forUpdate ? 'WITH(UPDLOCK,HOLDLOCK)' : '';
    const readSnapshot = forUpdate ? '' : `,(SELECT RTRIM(d.Codpro) codPro,RTRIM(d.Descripcion) nombre,d.Cantidad cantidad,d.Precio precio,d.Descuento descuento,d.Importe importe
        FROM Ticket_d d WHERE d.NroTicket=t.NroTicket ORDER BY d.Codpro,d.Precio,d.Descripcion,d.Cantidad,d.Descuento,d.Importe FOR JSON PATH) CurrentCommercial`;
    const t = (await query(db, `SELECT t.*,CONVERT(char(10),t.Fecha,23) FechaNegocio,pc.Empresa,pc.Version,pc.UltimoEnvio,pc.SnapshotComercial${readSnapshot} FROM Ticket_c t ${hint}
        JOIN Pedido_control pc ON pc.NroTicket COLLATE DATABASE_DEFAULT=t.NroTicket COLLATE DATABASE_DEFAULT
        WHERE t.NroTicket=@nro AND pc.Empresa=@empresa`, { nro, empresa: cfg.empresa })).recordset[0];
    if (!t || !t.NroTicket.trim().startsWith(cfg.prefix + '-')) fail('Pedido no encontrado en esta empresa', 404);
    await company(db, empresa, t.NroMesa);
    const current = forUpdate ? await commercialSnapshot(db, t.NroTicket, true) : (t.CurrentCommercial || '[]');
    delete t.CurrentCommercial;
    const comparison = compareCommercial(t.SnapshotComercial, current);
    Object.defineProperty(t, '_commercialComparison', { value: comparison, configurable: true });
    if (validateCommercial && comparison.status !== 'ok') fail('El detalle comercial fue modificado por otro sistema. Se requiere conciliación antes de continuar.', 409, comparison.code);
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
    const printingRows = (await query(db, `SELECT Id,Estado,Error,Destino FROM (
            SELECT j.Id,j.Estado,j.Error,COALESCE(d.Destino,'cocina') Destino,j.Fecha,
                ROW_NUMBER() OVER(PARTITION BY COALESCE(d.Destino,'cocina') ORDER BY j.Fecha DESC,j.Id) rn
            FROM Impresion_trabajos j JOIN Cocina_envios e ON e.Id=j.EnvioId
            LEFT JOIN Impresion_trabajo_destinos d ON d.TrabajoId=j.Id WHERE e.NroTicket=@nro
            UNION ALL
            SELECT j.Id,j.Estado,j.Error,'barra' Destino,j.Fecha,ROW_NUMBER() OVER(PARTITION BY 'barra' ORDER BY j.Fecha DESC,j.Id) rn
            FROM Impresion_barra_trabajos j JOIN Cocina_envios e ON e.Id=j.EnvioId WHERE e.NroTicket=@nro
        ) jobs WHERE rn=1 ORDER BY Destino`, { nro: t.NroTicket })).recordset;
    const printings = printingRows.map(j => ({ id: j.Id.toLowerCase(), estado: j.Estado, error: j.Error, destino: j.Destino }));
    const kitchenPrinting = printingRows.find(j => j.Destino === 'cocina');
    const printing = kitchenPrinting ? { Id: kitchenPrinting.Id.toLowerCase(), Estado: kitchenPrinting.Estado, Error: kitchenPrinting.Error } : null;
    const cocina = summary(t, ls);
    cocina.anulaciones = changes(ls).filter(c => c.tipo === 'ANULACIÓN').map(c => c.anterior);
    const conciliacionComercial = publicComparison(t._commercialComparison || compareCommercial(t.SnapshotComercial, t.SnapshotComercial));
    return { success: true, nroTicket: t.NroTicket.trim(), version: t.Version, pedido: t, conciliacionComercial, items: ls.filter(l => !l.baja).map(l => ({ ...l,
        Codpro: l.codPro, Descripcion: l.nombre, Cantidad: l.cantidad, Precio: l.precio, Afecto: l.afecto,
        enviada: l.enviada, pendienteEnvio: !same(snapshot(l), l.enviada) })), cocina, impresion: printing, impresiones: printings };
}
async function commercialSnapshot(db, nro, forUpdate = true) {
    const hint = forUpdate ? 'WITH(UPDLOCK,HOLDLOCK)' : '';
    return (await query(db, `SELECT (SELECT RTRIM(Codpro) codPro,RTRIM(Descripcion) nombre,Cantidad cantidad,Precio precio,Descuento descuento,Importe importe
        FROM Ticket_d ${hint} WHERE NroTicket=@nro ORDER BY Codpro,Precio,Descripcion,Cantidad,Descuento,Importe FOR JSON PATH) Documento`, { nro })).recordset[0].Documento || '[]';
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
    const detail = [...groups.values()].map(g => {
        if (g.cantidad > 9999999.99) fail('Cantidad agrupada excede el límite');
        return { codPro: g.codPro, nombre: g.nombre, cantidad: g.cantidad, importe: g.importe };
    });
    await query(db, `DELETE Ticket_d WHERE NroTicket=@nro;
        INSERT Ticket_d(NroTicket,Codpro,Descripcion,Cantidad,Precio,Descuento,Importe)
        SELECT @nro,CodPro,Nombre,Cantidad,Importe,0,Importe
        FROM OPENJSON(@detail) WITH(CodPro VARCHAR(10) '$.codPro',Nombre NVARCHAR(70) '$.nombre',Cantidad DECIMAL(9,2) '$.cantidad',Importe MONEY '$.importe');
        UPDATE Ticket_c SET Total=@total WHERE NroTicket=@nro;
        DECLARE @snapshot NVARCHAR(MAX)=(SELECT RTRIM(Codpro) codPro,RTRIM(Descripcion) nombre,Cantidad cantidad,Precio precio,Descuento descuento,Importe importe
            FROM Ticket_d WITH(UPDLOCK,HOLDLOCK) WHERE NroTicket=@nro ORDER BY Codpro,Precio,Descripcion,Cantidad,Descuento,Importe FOR JSON PATH);
        UPDATE Pedido_control SET SnapshotComercial=COALESCE(@snapshot,'[]') WHERE NroTicket=@nro;`,
        { nro, total, detail: JSON.stringify(detail) });
}
async function createSend(db, t, clave, usuario) {
    clave = id(clave);
    const existing = (await query(db, 'SELECT Id FROM Cocina_envios WHERE NroTicket=@nro AND Clave=@clave', { nro: t.NroTicket, clave })).recordset[0];
    if (existing) return existing.Id.toLowerCase();
    const ls = await lines(db, t.NroTicket), movements = changes(ls);
    if (!movements.length) fail('No hay novedades para enviar', 409);
    if (movements.some(m => ls.find(l => l.lineaId === m.lineaId).pendienteId)) fail('Hay una corrección sin reconocer', 409);
    const envioId = randomUUID(), numero = t.UltimoEnvio + 1;
    const metadata = (await query(db, `SELECT
        (SELECT TOP 1 Nombre FROM Empleados WHERE Codemp=@mozo AND Empresa=@empresa) Mozo,
        (SELECT TOP 1 c_describe FROM Tablas WHERE n_codtabla=200 AND n_numero=@empresa) EmpresaNombre`,
        { mozo: t.Mozo, empresa: t.Empresa })).recordset[0] || {};
    const mozo = metadata.Mozo?.trim() || String(t.Mozo);
    const empresaNombre = metadata.EmpresaNombre?.trim();
    const head = { empresaNombre, empresa: t.Empresa, turno: Number(t.Turno), fechaNegocio: t.FechaNegocio,
        nroTicket: t.NroTicket.trim(), numero, mesa: t.NroMesa, mozo, usuario, fecha: nowLima() };
    const doc = printText(head, movements);
    const routeRows = (await query(db, `SELECT input.LineaId,r.Destino,p.Clinea,p.Tipo
        FROM OPENJSON(@routes) WITH(LineaId UNIQUEIDENTIFIER '$.lineaId',CodPro VARCHAR(10) '$.codPro') input
        LEFT JOIN Impresion_linea_destinos r ON r.LineaId=input.LineaId
        OUTER APPLY (SELECT TOP 1 Clinea,Tipo FROM Productos WHERE CodPro=input.CodPro) p`, {
        routes: JSON.stringify(movements.map(m => ({ lineaId: m.lineaId, codPro: ls.find(l => l.lineaId === m.lineaId).codPro })))
    })).recordset;
    const routes = new Map(routeRows.map(r => [r.LineaId.toLowerCase(), r.Destino
        || (Number(r.Clinea) === 7 && Number(r.Tipo) === 3 ? 'barra' : Number(r.Clinea) === 2 ? 'bebidas' : 'cocina')]));
    const batch = movements.map(m => {
        const detailId = randomUUID(), l = ls.find(l => l.lineaId === m.lineaId);
        const operative = m.nueva || m.anterior;
        if (l.estadoCocina == null) {
            if (!m.nueva) fail('La línea enviada no tiene estado operativo de cocina. Se requiere conciliación.', 409);
        }
        return { detailId, lineaId: m.lineaId, codPro: l.codPro, destination: routes.get(m.lineaId) || 'cocina', movement: JSON.stringify(m), operative: JSON.stringify(operative),
            sent: m.nueva ? JSON.stringify(m.nueva) : null,
            mode: l.estadoCocina == null ? 'insert' : l.estadoCocina >= 2 ? 'pending' : !m.nueva ? 'cancel' : 'replace' };
    });
    const kitchenMovements = movements.filter(m => routes.get(m.lineaId) === 'cocina');
    const beverageMovements = movements.filter(m => routes.get(m.lineaId) === 'bebidas');
    const barMovements = movements.filter(m => routes.get(m.lineaId) === 'barra');
    const kitchenPrintSql = printerEnabled() && kitchenMovements.length
        ? `INSERT Impresion_trabajos(Id,EnvioId,Clave,Documento,Usuario) VALUES(@kitchenJob,@envioId,@kitchenKey,@kitchenDoc,@usuario);
            INSERT Impresion_trabajo_destinos(TrabajoId,Destino) VALUES(@kitchenJob,'cocina');`
        : '';
    const beveragePrintSql = printerEnabled() && beverageMovements.length
        ? `INSERT Impresion_trabajos(Id,EnvioId,Clave,Documento,Usuario) VALUES(@beverageJob,@envioId,@beverageKey,@beverageDoc,@usuario);
            INSERT Impresion_trabajo_destinos(TrabajoId,Destino) VALUES(@beverageJob,'bebidas');`
        : '';
    const barPrintSql = barPrinterEnabled() && barMovements.length
        ? `INSERT Impresion_barra_trabajos(Id,EnvioId,Clave,Documento,Usuario) VALUES(@barJob,@envioId,@barKey,@barDoc,@usuario);`
        : '';
    await query(db, `DECLARE @batch TABLE(DetailId UNIQUEIDENTIFIER,LineaId UNIQUEIDENTIFIER,CodPro VARCHAR(10),Destino VARCHAR(16),Movement NVARCHAR(MAX),Operative NVARCHAR(MAX),Sent NVARCHAR(MAX),Mode VARCHAR(10));
        INSERT @batch SELECT DetailId,LineaId,CodPro,Destino,Movement,Operative,Sent,Mode FROM OPENJSON(@batchJson)
        WITH(DetailId UNIQUEIDENTIFIER '$.detailId',LineaId UNIQUEIDENTIFIER '$.lineaId',CodPro VARCHAR(10) '$.codPro',Destino VARCHAR(16) '$.destination',Movement NVARCHAR(MAX) '$.movement',Operative NVARCHAR(MAX) '$.operative',Sent NVARCHAR(MAX) '$.sent',Mode VARCHAR(10) '$.mode');
        INSERT Impresion_linea_destinos(LineaId,Destino)
            SELECT b.LineaId,MIN(b.Destino) FROM @batch b LEFT JOIN Impresion_linea_destinos r ON r.LineaId=b.LineaId
            WHERE r.LineaId IS NULL GROUP BY b.LineaId;
        INSERT Cocina_envios(Id,NroTicket,Numero,Clave,Version,Cabecera,Documento) VALUES(@envioId,@nro,@numero,@clave,@version,@head,@doc);
        INSERT Cocina_envio_detalles(Id,EnvioId,LineaId,Movimiento) SELECT DetailId,@envioId,LineaId,Movement FROM @batch;
        INSERT Cocina_estados(NroTicket,Codpro,Estado,FechaEstado,Usuario,LineaId,Operativa,FechaEnvio)
            SELECT @nro,CodPro,1,GETDATE(),@usuario,LineaId,Operative,SYSUTCDATETIME() FROM @batch WHERE Mode='insert';
        UPDATE c SET PendienteId=b.DetailId FROM Cocina_estados c JOIN @batch b ON b.LineaId=c.LineaId WHERE b.Mode='pending';
        UPDATE c SET Anulada=1,PendienteId=NULL,Usuario=@usuario,FechaEstado=GETDATE() FROM Cocina_estados c JOIN @batch b ON b.LineaId=c.LineaId WHERE b.Mode='cancel';
        UPDATE c SET Operativa=b.Operative,Anulada=0,PendienteId=NULL,Usuario=@usuario,FechaEstado=GETDATE() FROM Cocina_estados c JOIN @batch b ON b.LineaId=c.LineaId WHERE b.Mode='replace';
        UPDATE l SET Enviada=b.Sent FROM Pedido_lineas l JOIN @batch b ON b.LineaId=l.LineaId;
        ${kitchenPrintSql}
        ${beveragePrintSql}
        ${barPrintSql}
        UPDATE Pedido_control SET UltimoEnvio=@numero,Version=Version+1 WHERE NroTicket=@nro;`,
        { batchJson: JSON.stringify(batch), envioId, nro: t.NroTicket, numero, clave, version: t.Version, head: JSON.stringify(head), doc,
            usuario, kitchenJob: randomUUID(), kitchenKey: randomUUID(), kitchenDoc: printText(head, kitchenMovements, false, 'COMANDA DE COCINA'),
            beverageJob: randomUUID(), beverageKey: randomUUID(), beverageDoc: printText(head, beverageMovements, false, 'COMANDA DE BEBIDAS'),
            barJob: randomUUID(), barKey: randomUUID(), barDoc: printText(head, barMovements, false, 'COMANDA DE BARRA') });
    t.UltimoEnvio = numero; t.Version++;
    return envioId;
}
async function ticketReference(db, nro, empresa, forUpdate = true) {
    const cfg = await company(db, empresa);
    nro = String(nro || '').trim();
    if (forUpdate) await lock(db, `pedido:${nro}`);
    const ref = (await query(db, `SELECT pc.NroTicket,pc.Empresa,pc.Version,pc.UltimoEnvio,
        t.NroMesa,t.Mozo,t.Estado,t.Fecha,
        TRY_CONVERT(INT,JSON_VALUE(lastSend.Cabecera,'$.mesa')) MesaHistorica
        FROM Pedido_control pc
        LEFT JOIN Ticket_c t ON t.NroTicket COLLATE DATABASE_DEFAULT=pc.NroTicket COLLATE DATABASE_DEFAULT
        OUTER APPLY (SELECT TOP 1 Cabecera FROM Cocina_envios
            WHERE NroTicket COLLATE DATABASE_DEFAULT=pc.NroTicket COLLATE DATABASE_DEFAULT ORDER BY Numero DESC) lastSend
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
    const comparison = compareCommercial(control.SnapshotComercial, await commercialSnapshot(db, ref.NroTicket));
    if (comparison.status !== 'ok') console.warn(JSON.stringify({ type: 'commercial_conflict_discarded', requestId: requestContext.currentId(),
        nroTicket: ref.NroTicket, empresa: ref.Empresa, expectedHash: comparison.expectedHash, currentHash: comparison.currentHash }));

    await query(db, `UPDATE Pedido_lineas SET Baja=1 WHERE NroTicket=@nro;
        UPDATE Cocina_estados SET Anulada=1,PendienteId=NULL,Usuario=@usuario,FechaEstado=GETDATE() WHERE NroTicket=@nro;
        UPDATE Cocina_envios SET Historico=1 WHERE NroTicket=@nro;
        DELETE FROM Ticket_d WHERE NroTicket=@nro;
        DELETE FROM Ticket_c WHERE NroTicket=@nro;
        UPDATE Pedido_control SET SnapshotComercial='[]',Version=Version+1 WHERE NroTicket=@nro;`,
        { nro: ref.NroTicket, usuario });
    const other = (await query(db, `SELECT TOP 1 1 Existe FROM Ticket_c tc
        JOIN Pedido_control pc ON pc.NroTicket COLLATE DATABASE_DEFAULT=tc.NroTicket COLLATE DATABASE_DEFAULT
        WHERE tc.NroMesa=@mesa AND pc.Empresa=@empresa AND tc.Estado IN(1,2)`, { mesa: ref.NroMesa, empresa: ref.Empresa })).recordset.length;
    if (!other) await query(db, 'UPDATE Mesas SET Estado=1 WHERE Numero=@mesa AND Empresa=@empresa', { mesa: ref.NroMesa, empresa: ref.Empresa });
    ref.Version++;
    return { deleted: true, alreadyDeleted: false, ticket: ref, commercialConflict: comparison.status !== 'ok' };
}

async function loadKitchenBoard(db, empresa) {
    const result = await query(db, `CREATE TABLE #ActiveLines (
            LineaId UNIQUEIDENTIFIER NOT NULL PRIMARY KEY,
            NroTicket VARCHAR(20) COLLATE DATABASE_DEFAULT NOT NULL,
            Codpro CHAR(10) COLLATE DATABASE_DEFAULT NOT NULL,
            Estado INT NOT NULL,
            Operativa NVARCHAR(MAX) COLLATE DATABASE_DEFAULT NOT NULL,
            PendienteId UNIQUEIDENTIFIER NULL,
            Anulada BIT NOT NULL,
            FechaEnvio DATETIME2 NOT NULL,
            FechaEstado DATETIME2 NULL
        );
        INSERT #ActiveLines(LineaId,NroTicket,Codpro,Estado,Operativa,PendienteId,Anulada,FechaEnvio,FechaEstado)
        SELECT c.LineaId,c.NroTicket,c.Codpro,c.Estado,c.Operativa,c.PendienteId,c.Anulada,c.FechaEnvio,c.FechaEstado
        FROM Pedido_control pc JOIN Cocina_estados c ON c.NroTicket=pc.NroTicket
        WHERE pc.Empresa=@empresa AND c.Anulada=0 AND c.Estado<4
        UNION ALL
        SELECT c.LineaId,c.NroTicket,c.Codpro,c.Estado,c.Operativa,c.PendienteId,c.Anulada,c.FechaEnvio,c.FechaEstado
        FROM Pedido_control pc JOIN Cocina_estados c ON c.NroTicket=pc.NroTicket
        WHERE pc.Empresa=@empresa AND c.PendienteId IS NOT NULL AND (c.Anulada<>0 OR c.Estado>=4);

        CREATE TABLE #ActiveTickets (NroTicket VARCHAR(20) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY, FechaEnvio DATETIME2 NOT NULL);
        INSERT #ActiveTickets(NroTicket,FechaEnvio)
        SELECT NroTicket,MIN(FechaEnvio) FROM #ActiveLines GROUP BY NroTicket;

        SELECT c.LineaId,c.NroTicket,c.Codpro,c.Estado,c.Operativa,c.PendienteId,c.Anulada,
            c.FechaEnvio,c.FechaEstado,pd.Movimiento,L.Descripcion Categoria
        FROM #ActiveLines c
        LEFT JOIN Cocina_envio_detalles pd ON pd.Id=c.PendienteId
        LEFT JOIN Productos p ON p.CodPro=c.Codpro
        LEFT JOIN Lineas L ON L.CodLinea=p.Clinea
        ORDER BY c.FechaEnvio,c.LineaId;

        SELECT at.NroTicket,at.FechaEnvio,
            COALESCE(t.NroMesa,TRY_CONVERT(INT,JSON_VALUE(e.Cabecera,'$.mesa'))) NroMesa,t.Mozo,pc.Empresa,
            e.Id EnvioId,e.Numero NumeroEnvio,e.Documento,e.Fecha FechaEnvioDocumento,
            DATEDIFF(MINUTE,at.FechaEnvio,SYSUTCDATETIME()) MinutosEspera,
            COALESCE(em.Nombre,JSON_VALUE(e.Cabecera,'$.mozo')) MozoNombre
        FROM #ActiveTickets at
        LEFT JOIN Ticket_c t ON t.NroTicket COLLATE DATABASE_DEFAULT=at.NroTicket COLLATE DATABASE_DEFAULT
        JOIN Pedido_control pc ON pc.NroTicket COLLATE DATABASE_DEFAULT=at.NroTicket COLLATE DATABASE_DEFAULT
        OUTER APPLY (SELECT TOP 1 ce.Id,ce.Numero,ce.Documento,ce.Fecha,ce.Cabecera
            FROM Cocina_envios ce WHERE ce.NroTicket=at.NroTicket ORDER BY ce.Numero DESC,ce.Id) e
        LEFT JOIN Empleados em ON em.Codemp=t.Mozo AND em.Empresa=pc.Empresa
        ORDER BY at.FechaEnvio,at.NroTicket;

        WITH latest_envios AS (
            SELECT at.NroTicket,e.Id EnvioId
            FROM #ActiveTickets at
            OUTER APPLY (SELECT TOP 1 ce.Id FROM Cocina_envios ce
                WHERE ce.NroTicket=at.NroTicket ORDER BY ce.Numero DESC,ce.Id) e
        ), all_jobs AS (
            SELECT le.NroTicket,j.Id,j.Estado,j.Error,COALESCE(d.Destino,'cocina') Destino,j.Fecha
            FROM latest_envios le JOIN Impresion_trabajos j ON j.EnvioId=le.EnvioId
            LEFT JOIN Impresion_trabajo_destinos d ON d.TrabajoId=j.Id
            UNION ALL
            SELECT le.NroTicket,j.Id,j.Estado,j.Error,'barra' Destino,j.Fecha
            FROM latest_envios le JOIN Impresion_barra_trabajos j ON j.EnvioId=le.EnvioId
        ), ranked_jobs AS (
            SELECT *,ROW_NUMBER() OVER(PARTITION BY NroTicket,Destino ORDER BY Fecha DESC,Id) rn FROM all_jobs
        )
        SELECT NroTicket,Id,Estado,Error,Destino FROM ranked_jobs WHERE rn=1 ORDER BY NroTicket,Destino;`, { empresa });

    const [lineRows = [], ticketRows = [], jobRows = []] = result.recordsets;
    const jobsByTicket = new Map();
    for (const row of jobRows) {
        const ticket = String(row.NroTicket || '').trim();
        if (!jobsByTicket.has(ticket)) jobsByTicket.set(ticket, []);
        jobsByTicket.get(ticket).push({ id: row.Id.toLowerCase(), estado: row.Estado, error: row.Error, destino: row.Destino });
    }

    const grouped = new Map();
    for (const row of ticketRows) {
        const ticket = String(row.NroTicket || '').trim();
        const printings = jobsByTicket.get(ticket) || [];
        grouped.set(ticket, {
            nroTicket: ticket,
            envioId: row.EnvioId?.toLowerCase() || null,
            numeroEnvio: row.NumeroEnvio || null,
            mesa: row.NroMesa,
            mozo: (row.MozoNombre || row.Mozo || '').toString().trim(),
            fechaEnvio: row.FechaEnvioDocumento || row.FechaEnvio,
            minutosEspera: row.MinutosEspera || 0,
            documentoDisponible: Boolean(row.Documento),
            documento: row.Documento || '',
            impresion: printings.find(item => item.destino === 'cocina') || null,
            impresiones: printings,
            lineas: []
        });
    }

    for (const row of lineRows) {
        const codPro = String(row.Codpro || '').trim();
        const ticket = String(row.NroTicket || '').trim();
        const parsedOperative = safeJson(row.Operativa, null, 'Cocina_estados.Operativa');
        if (!row.LineaId || !codPro) {
            console.warn(JSON.stringify({ type: 'invalid_kitchen_line', requestId: requestContext.currentId(),
                ticket, lineId: row.LineaId?.toLowerCase?.() || null }));
            continue;
        }
        const target = grouped.get(ticket);
        if (!target) continue;
        const operative = parsedOperative && typeof parsedOperative === 'object' ? parsedOperative
            : { cantidad: 0, nombre: `Producto ${codPro}`, notasRapidas: [], nota: '', datosIncompletos: true };
        const parsedCorrection = safeJson(row.Movimiento, null, 'Cocina_envio_detalles.Movimiento');
        const correction = row.PendienteId && !parsedCorrection
            ? { tipo: 'CORRECCIÓN PENDIENTE', datosIncompletos: true }
            : parsedCorrection;
        target.lineas.push({
            lineaId: row.LineaId.toLowerCase(), codPro, cantidad: operative.cantidad,
            nombre: operative.nombre || codPro,
            notasRapidas: Array.isArray(operative.notasRapidas) ? operative.notasRapidas : [],
            nota: typeof operative.nota === 'string' ? operative.nota : '', estado: row.Estado,
            Categoria: row.Categoria, datosIncompletos: Boolean(operative.datosIncompletos),
            correccionPendiente: correction
        });
    }

    const pedidos = [...grouped.values()].filter(item => item.lineas.length).map(item => ({
        ...item,
        estadoTicket: item.lineas.some(line => line.correccionPendiente) ? 'pendiente'
            : item.lineas.every(line => line.estado >= 3) ? 'listo'
                : item.lineas.every(line => line.estado >= 2) ? 'preparacion' : 'pendiente'
    }));
    return { success: true, pedidos };
}

function install(app, auth, broadcast) {
    const route = (method, path, fn) => app[method](path, auth, async (req, res) => {
        try {
            const result = method === 'get'
                ? await fn(await getConnection(), req)
                : await transaction(db => fn(db, req));
            if (result.event) {
                broadcast({ type: 'mesa_updated', ...result.event, operacionId: req.body?.operacionId });
                if (result.kitchen) {
                    kitchenSnapshots.invalidate(result.event.empresa);
                    broadcast({ type: 'cocina_updated', ...result.event });
                }
            }
            delete result.event; delete result.kitchen;
            res.json(result);
        } catch (e) {
            const diagnosticId = requestContext.diagnosticId(res);
            if (e.status) {
                console.warn(JSON.stringify({ type: 'api_rejection', diagnosticId, context: path, method: req.method,
                    status: e.status, errorCode: e.errorCode || null, request: requestContext.safeRequest(req) }));
                return res.status(e.status).json({ success: false, message: e.message,
                    ...(e.errorCode ? { errorCode: e.errorCode } : {}), diagnosticId, retryable: false });
            }
            const { classification, body } = requestContext.errorPayload(res, e);
            console.error(JSON.stringify({ type: 'api_error', diagnosticId, context: path, classification: classification.kind,
                error: requestContext.safeError(e) }));
            res.status(classification.status).json(body);
        }
    });
    const event = t => ({ empresa: t.Empresa, numero: t.NroMesa, nroTicket: t.NroTicket.trim(), version: t.Version });
    route('get', '/api/pos/pedido', async (db, req) => {
        const cfg = await company(db, req.query.empresa, req.query.mesa);
        const found = (await query(db, `SELECT TOP 1 NroTicket FROM Ticket_c WHERE NroMesa=@mesa AND Estado IN(1,2) AND NroTicket LIKE @prefix ORDER BY Fecha DESC`,
            { mesa: Number(req.query.mesa), prefix: cfg.prefix + '-%' })).recordset[0];
        if (!found) return { success: true, pedido: null };
        return response(db, await ticket(db, found.NroTicket.trim(), cfg.empresa, false, false, false));
    });
    route('get', '/api/pos/pedido/:nro/estados-cocina', async (db, req) => {
        const t = await ticket(db, req.params.nro, req.query.empresa, false, false, false);
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
            return { success: true, pedidoEliminado: true, nroTicket: existingNro,
                conciliacionDivergente: Boolean(result.commercialConflict),
                event: result.alreadyDeleted ? null : event(result.ticket), kitchen: true };
        }
        const mozo = Number(b.mozo);
        const employeeSql = `SELECT Codemp FROM Empleados WHERE Codemp=@mozo AND Empresa=@empresa AND FecCese IS NULL AND ${employeeEligibilitySql(cfg.empresa, b.mesa)}`;
        if (!Number.isInteger(mozo) || !(await query(db, employeeSql, { mozo, empresa: cfg.empresa })).recordset.length) {
            fail(isMarketplaceTable(cfg.empresa, b.mesa)
                ? 'Seleccione PEDIDOS YA o RAPPI para esta mesa' : 'Seleccione un mozo activo de esta empresa');
        }
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
            await archiveOrphanedDraft(db, nro, cfg, req.session.user.usuario);
            await query(db, 'UPDATE Tablas SET c_describe=@nro WHERE n_codtabla=23 AND n_numero=@numero', { nro, numero: cfg.numero });
            await query(db, `INSERT Ticket_c(NroTicket,NroMesa,Mozo,Total,Estado,Fecha,Turno,Usuario)
                VALUES(@nro,@mesa,@mozo,0,1,CAST(SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'SA Pacific Standard Time' AS SMALLDATETIME),@turno,@usuario);
                INSERT Pedido_control(NroTicket,Empresa) VALUES(@nro,@empresa);`,
                { nro, mesa: Number(b.mesa), mozo: Number(b.mozo) || 1, turno, usuario: req.session.user.usuario, empresa: cfg.empresa });
            t = await ticket(db, nro, cfg.empresa, true);
        } else { t = await ticket(db, nro, cfg.empresa, true); expected(t, b.version); }
        if (t.NroMesa !== Number(b.mesa)) fail('La mesa no corresponde al pedido');
        const previous = await lines(db, nro); validateEdits(previous, incoming);
        const products = (await query(db, `SELECT CodPro,Nombre,Afecto,PventaMa FROM Productos
            WHERE Eliminado=0 AND CodPro IN (SELECT CodPro FROM OPENJSON(@items) WITH(CodPro VARCHAR(10) '$.codPro'))`,
            { items: JSON.stringify(incoming) })).recordset;
        const productsByCode = new Map(products.map(product => [String(product.CodPro).trim(), product]));
        for (const l of incoming) {
            const product = productsByCode.get(l.codPro);
            if (!product || !l.codPro.startsWith(String(cfg.empresa).padStart(2, '0'))) fail('Producto inexistente o de otra empresa');
            l.nombre = product.Nombre.trim().slice(0, 70); l.afecto = product.Afecto ? 1 : 0;
            const old = previous.find(p => p.lineaId === l.lineaId);
            l.precio = old ? old.precio : Number(product.PventaMa);
        }
        const lineBatch = incoming.map(l => ({ lineaId: l.lineaId, orden: l.orden, datos: JSON.stringify(l) }));
        const conflict = (await query(db, `SELECT TOP 1 l.LineaId FROM Pedido_lineas l
            JOIN OPENJSON(@lines) WITH(LineaId UNIQUEIDENTIFIER '$.lineaId') b ON b.LineaId=l.LineaId WHERE l.NroTicket<>@nro`,
            { nro, lines: JSON.stringify(lineBatch) })).recordset[0];
        if (conflict) fail('Línea pertenece a otro pedido', 409);
        await query(db, `DECLARE @linesTable TABLE(LineaId UNIQUEIDENTIFIER,Orden INT,Datos NVARCHAR(MAX));
            INSERT @linesTable SELECT LineaId,Orden,Datos FROM OPENJSON(@lines)
                WITH(LineaId UNIQUEIDENTIFIER '$.lineaId',Orden INT '$.orden',Datos NVARCHAR(MAX) '$.datos');
            UPDATE l SET Datos=b.Datos,Orden=b.Orden,Baja=0 FROM Pedido_lineas l JOIN @linesTable b ON b.LineaId=l.LineaId WHERE l.NroTicket=@nro;
            INSERT Pedido_lineas(LineaId,NroTicket,Orden,Datos)
                SELECT b.LineaId,@nro,b.Orden,b.Datos FROM @linesTable b WHERE NOT EXISTS(SELECT 1 FROM Pedido_lineas l WHERE l.LineaId=b.LineaId);
            UPDATE l SET Baja=1 FROM Pedido_lineas l WHERE l.NroTicket=@nro AND NOT EXISTS(SELECT 1 FROM @linesTable b WHERE b.LineaId=l.LineaId);`,
            { nro, lines: JSON.stringify(lineBatch) });
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
            conciliacionDivergente: Boolean(result.commercialConflict),
            event: result.alreadyDeleted ? null : event(result.ticket), kitchen: true };
    });
    route('get', '/api/pos/pedido/:nro/envios', async (db, req) => {
        const t = await ticketReference(db, req.params.nro, req.query.empresa, false);
        const envios = (await query(db, `SELECT e.Id,e.Numero,e.Fecha,e.Historico,e.Documento,
            (SELECT j.Id,j.Estado,j.Error,j.Intentos,j.ReimpresionDe,j.Fecha,j.Destino FROM (
                SELECT j.Id,j.Estado,j.Error,j.Intentos,j.ReimpresionDe,j.Fecha,COALESCE(d.Destino,'cocina') Destino
                FROM Impresion_trabajos j LEFT JOIN Impresion_trabajo_destinos d ON d.TrabajoId=j.Id WHERE j.EnvioId=e.Id
                UNION ALL
                SELECT Id,Estado,Error,Intentos,ReimpresionDe,Fecha,'barra' Destino FROM Impresion_barra_trabajos WHERE EnvioId=e.Id
            ) j ORDER BY j.Fecha FOR JSON PATH) Trabajos
            FROM Cocina_envios e WHERE e.NroTicket=@nro ORDER BY e.Numero DESC`, { nro: t.NroTicket })).recordset;
        return { success: true, envios: envios.map(e => {
            const trabajos = JSON.parse(e.Trabajos || '[]');
            return { ...e, trabajos, impresiones: publicPrintings(trabajos) };
        }) };
    });
    route('get', '/api/pos/pedido/:nro/envios/:envio/documento', async (db, req) => {
        const t = await ticketReference(db, req.params.nro, req.query.empresa, false);
        const e = (await query(db, 'SELECT Documento FROM Cocina_envios WHERE Id=@envio AND NroTicket=@nro', { envio: id(req.params.envio), nro: t.NroTicket })).recordset[0];
        if (!e) fail('Envío no encontrado', 404); return { success: true, documento: e.Documento };
    });
    route('post', '/api/pos/pedido/:nro/envios/:envio/reimprimir', async (db, req) => {
        const destination = req.body.destino == null ? 'cocina' : String(req.body.destino).toLowerCase();
        if (!['cocina','bebidas','barra'].includes(destination)) fail('Destino de impresión inválido');
        if (destination === 'barra' ? !barPrinterEnabled() : !printerEnabled()) fail(`La impresión de ${destination} todavía no está habilitada.`, 503);
        const t = await ticketReference(db, req.params.nro, req.body.empresa);
        if (await shiftClosures.isTicketArchived(db, t.NroTicket)) fail('El turno esta cerrado. Reabra el turno antes de reimprimir.', 409);
        const envio = id(req.params.envio), clave = id(req.body.clave);
        const e = (await query(db, 'SELECT * FROM Cocina_envios WHERE Id=@envio AND NroTicket=@nro', { envio, nro: t.NroTicket })).recordset[0];
        if (!e) fail('Envío no encontrado', 404);
        const queue = printQueue(destination);
        const duplicateSql = destination === 'barra'
            ? 'SELECT Id,EnvioId,\'barra\' Destino FROM Impresion_barra_trabajos WHERE Clave=@clave'
            : `SELECT j.Id,j.EnvioId,COALESCE(d.Destino,'cocina') Destino FROM Impresion_trabajos j
                LEFT JOIN Impresion_trabajo_destinos d ON d.TrabajoId=j.Id WHERE j.Clave=@clave`;
        const duplicate = (await query(db, duplicateSql, { clave })).recordset[0];
        if (duplicate) {
            if (duplicate.EnvioId.toLowerCase() !== envio || duplicate.Destino !== destination) fail('Clave usada en otro envío o destino', 409);
            return { success: true, trabajoId: duplicate.Id.toLowerCase(), destino: destination };
        }
        const jobsSql = destination === 'barra'
            ? 'SELECT * FROM Impresion_barra_trabajos WHERE EnvioId=@envio ORDER BY Fecha DESC'
            : `SELECT j.* FROM Impresion_trabajos j LEFT JOIN Impresion_trabajo_destinos d ON d.TrabajoId=j.Id
                WHERE j.EnvioId=@envio AND COALESCE(d.Destino,'cocina')=@destination ORDER BY j.Fecha DESC`;
        const jobs = (await query(db, jobsSql, { envio, destination })).recordset;
        if (!jobs.length) fail(`El envío no tiene comanda de ${destination}.`, 404);
        if (jobs.some(j => ['en_cola','procesando'].includes(j.Estado))) fail('Ya existe un trabajo pendiente para este envío', 409);
        const job = randomUUID();
        const destinationSql = destination === 'barra' ? '' : 'INSERT Impresion_trabajo_destinos(TrabajoId,Destino) VALUES(@job,@destination);';
        await query(db, `INSERT ${queue}(Id,EnvioId,ReimpresionDe,Clave,Documento,Usuario)
            VALUES(@job,@envio,@original,@clave,@doc,@usuario); ${destinationSql}`,
            { job, envio, original: jobs[0].Id, clave, destination, doc: '*** REIMPRESIÓN ***\n' + jobs[0].Documento, usuario: req.session.user.usuario });
        return { success: true, trabajoId: job, destino: destination, event: t.NroMesa == null ? null : event(t) };
    });
    route('get', '/api/cocina/pedidos', async (db, req) => {
        const normalized = companyNumber(req.query.empresa);
        return kitchenSnapshots.read(normalized.empresa, async () => {
            const cfg = await company(db, normalized.empresa);
            return loadKitchenBoard(db, cfg.empresa);
        }, requestContext.currentId());
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
        const total = (await query(db, `SELECT COUNT(*) Total FROM Cocina_envios e
            JOIN Pedido_control pc ON pc.NroTicket COLLATE DATABASE_DEFAULT=e.NroTicket COLLATE DATABASE_DEFAULT
            LEFT JOIN Ticket_c t ON t.NroTicket COLLATE DATABASE_DEFAULT=e.NroTicket COLLATE DATABASE_DEFAULT WHERE ${where}`, values)).recordset[0].Total;
        const rows = (await query(db, `SELECT e.Id,e.NroTicket,e.Numero,e.Fecha,e.Historico,e.Documento,e.Cabecera,
            COALESCE(t.NroMesa,TRY_CONVERT(INT,JSON_VALUE(e.Cabecera,'$.mesa'))) NroMesa,t.Estado TicketEstado,
            (SELECT COUNT(*) FROM Cocina_envio_detalles d WHERE d.EnvioId=e.Id) Movimientos,
            (SELECT COUNT(*) FROM Cocina_envio_detalles d WHERE d.EnvioId=e.Id AND d.ReconocidoFecha IS NOT NULL) Reconocidos,
            (SELECT j.Id,j.Estado,j.Error,j.Intentos,j.ReimpresionDe,j.Fecha,j.Destino FROM (
                SELECT j.Id,j.Estado,j.Error,j.Intentos,j.ReimpresionDe,j.Fecha,COALESCE(d.Destino,'cocina') Destino
                FROM Impresion_trabajos j LEFT JOIN Impresion_trabajo_destinos d ON d.TrabajoId=j.Id WHERE j.EnvioId=e.Id
                UNION ALL
                SELECT Id,Estado,Error,Intentos,ReimpresionDe,Fecha,'barra' Destino FROM Impresion_barra_trabajos WHERE EnvioId=e.Id
            ) j ORDER BY j.Fecha FOR JSON PATH) Trabajos
            FROM Cocina_envios e JOIN Pedido_control pc ON pc.NroTicket COLLATE DATABASE_DEFAULT=e.NroTicket COLLATE DATABASE_DEFAULT
            LEFT JOIN Ticket_c t ON t.NroTicket COLLATE DATABASE_DEFAULT=e.NroTicket COLLATE DATABASE_DEFAULT
            WHERE ${where} ORDER BY e.Fecha DESC,e.Numero DESC OFFSET @offset ROWS FETCH NEXT @size ROWS ONLY`, values)).recordset;
        return { success: true, pagina: page, tamano: size, total, envios: rows.map(r => {
            const trabajos = JSON.parse(r.Trabajos || '[]');
            return { ...r, nroTicket: String(r.NroTicket).trim(), cabecera: JSON.parse(r.Cabecera), trabajos,
                impresiones: publicPrintings(trabajos),
                estadoPedido: r.TicketEstado == null || r.TicketEstado === 4 ? 'anulado' : [1,2].includes(r.TicketEstado) ? 'activo' : 'cerrado' };
        }) };
    });
    route('put', '/api/cocina/linea', async (db, req) => {
        const t = await ticketReference(db, req.body.nroTicket, req.body.empresa);
        const lineaId = id(req.body.lineaId), estado = Number(req.body.estado);
        const c = (await query(db, 'SELECT * FROM Cocina_estados WHERE LineaId=@lineaId AND NroTicket=@nro', { lineaId, nro: t.NroTicket })).recordset[0];
        if (!c) fail('Línea no encontrada', 404);
        if (c.PendienteId || c.Anulada || ![2,3].includes(estado) || estado !== c.Estado + 1) fail('Transición inválida o corrección sin reconocer', 409);
        await query(db, 'UPDATE Cocina_estados SET Estado=@estado,Usuario=@usuario,FechaEstado=GETDATE() WHERE LineaId=@lineaId', { lineaId, estado, usuario: req.session.user.usuario });
        return { success: true, event: event(t), kitchen: true };
    });
    route('put', '/api/cocina/linea/:linea/reconocer', async (db, req) => {
        const t = await ticketReference(db, req.body.nroTicket, req.body.empresa), lineaId = id(req.params.linea);
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
        const t = await ticketReference(db, req.params.nro, req.body.empresa);
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
async function reconcileCommercialOrder({ nroTicket, empresa, version, usuario }) {
    return transaction(async db => {
        const ref = await ticketReference(db, nroTicket, empresa);
        if (ref.Estado !== 1) fail('La conciliación solo admite pedidos editables anteriores a Preventa', 409);
        expected(ref, version);
        const activeLines = (await lines(db, ref.NroTicket)).filter(line => !line.baja);
        if (!activeLines.length) fail('El pedido web no contiene líneas activas para restaurar', 409);
        await commercial(db, ref.NroTicket, activeLines);
        await query(db, `UPDATE Ticket_c SET Usuario=@usuario WHERE NroTicket=@nro;
            UPDATE Pedido_control SET Version=Version+1 WHERE NroTicket=@nro`,
            { nro: ref.NroTicket, usuario });
        ref.Version++;
        return { nroTicket: ref.NroTicket, mesa: ref.NroMesa, version: ref.Version, lineas: activeLines.length };
    });
}
module.exports = { install, query, transaction, recoverCancellation, reconcileCommercialOrder, deleteCommercialOrder, loadKitchenBoard };
