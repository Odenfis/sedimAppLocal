'use strict';
const { randomUUID } = require('node:crypto');
const { fail } = require('./order-domain');
const shiftClosures = require('./shift-closures');
// Above 200 the existing map classifies virtual channels and miscellaneous tables.
function isDiningTable(value) { return Number.isInteger(Number(value)) && Number(value) > 0 && Number(value) <= 200; }
function transferDocument({ origen, destino, nro, mozo, usuario, fecha }) {
    const safe = value => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ');
    return ['CAMBIO DE MESA', `Ticket ${safe(nro)}`, `Mesa ${origen} -> ${destino}`,
        `Mozo ${safe(mozo)}`, `Fecha: ${safe(fecha)}`, `Usuario: ${safe(usuario)}`,
        'Aviso de traslado de todo el pedido.', 'Conservar la preparación existente.'].join('\n');
}
function install({ route, query, lock, company, ticket, ticketReference, expected, response, id, printerEnabled, barPrinterEnabled }) {
    const jobsFor = async (db, traslado) => (await query(db, `SELECT j.* ,COALESCE(d.Destino,'cocina') Destino
        FROM Impresion_trabajos j LEFT JOIN Impresion_trabajo_destinos d ON d.TrabajoId=j.Id WHERE j.TrasladoId=@traslado
        UNION ALL SELECT j.*,'barra' Destino FROM Impresion_barra_trabajos j WHERE j.TrasladoId=@traslado
        ORDER BY Fecha,Id`, { traslado })).recordset;
    route('get', '/api/pos/pedido/:nro/ubicacion', async (db, req) => {
        const t = await ticketReference(db, req.params.nro, req.query.empresa, false);
        return { success: true, mesa: t.Estado == null ? null : t.NroMesa, version: t.Version };
    });
    route('get', '/api/pos/pedido/:nro/traslados', async (db, req) => {
        const t = await ticketReference(db, req.params.nro, req.query.empresa, false);
        const transfers = (await query(db, 'SELECT * FROM Pedido_traslados WHERE NroTicket=@nro AND Empresa=@empresa ORDER BY Fecha DESC,Id',
            { nro: t.NroTicket, empresa: t.Empresa })).recordset;
        const traslados = [];
        for (const transfer of transfers) traslados.push({ ...transfer, trabajos: await jobsFor(db, transfer.Id) });
        return { success: true, traslados };
    });
    route('post', '/api/pos/pedido/:nro/trasladar', async (db, req) => {
        const b = req.body, origen = Number(b.origen), destino = Number(b.destino), clave = id(b.clave);
        if (!isDiningTable(origen) || !isDiningTable(destino) || origen === destino) fail('Seleccione dos mesas de atención distintas', 400, 'INVALID_TRANSFER_TABLE');
        const cfg = await company(db, b.empresa, origen);
        await company(db, cfg.empresa, destino);
        // Match save's mesa -> pedido ordering; acquire row locks only after the ticket lock.
        for (const mesa of [origen, destino].sort((a, c) => a - c)) await lock(db, `mesa:${cfg.empresa}:${mesa}`);
        await lock(db, `traslado:${clave}`);
        const nro = String(req.params.nro).trim();
        await lock(db, `pedido:${nro}`);
        const previous = (await query(db, 'SELECT * FROM Pedido_traslados WHERE Clave=@clave', { clave })).recordset[0];
        if (previous) {
            if (previous.NroTicket.trim() !== nro || previous.Empresa !== cfg.empresa || previous.Origen !== origen || previous.Destino !== destino || previous.VersionOrigen !== b.version)
                fail('La clave ya se utilizó para otro traslado', 409, 'TRANSFER_KEY_CONFLICT');
            const current = await ticketReference(db, nro, cfg.empresa, false);
            return { success: true, trasladoId: previous.Id.toLowerCase(), mesa: current.Estado == null ? null : current.NroMesa,
                version: current.Version, avisos: await jobsFor(db, previous.Id), yaRealizado: true };
        }
        const t = await ticket(db, nro, cfg.empresa, true); expected(t, b.version);
        if (t.NroMesa !== origen) fail('El pedido ya no está en la mesa de origen', 409, 'ORDER_MOVED');
        const mesas = (await query(db, 'SELECT Numero,Estado FROM Mesas WITH(UPDLOCK,HOLDLOCK) WHERE Empresa=@empresa AND Numero IN(@origen,@destino)',
            { empresa: cfg.empresa, origen, destino })).recordset;
        if (mesas.length !== 2 || mesas.find(m => m.Numero === destino)?.Estado !== 1) fail('La mesa de destino ya no está libre', 409, 'TRANSFER_DESTINATION_UNAVAILABLE');
        const active = (await query(db, `SELECT NroTicket,NroMesa FROM Ticket_c WITH(UPDLOCK,HOLDLOCK)
            WHERE NroMesa IN(@origen,@destino) AND Estado IN(1,2) AND NroTicket LIKE @prefix`,
            { origen, destino, prefix: cfg.prefix + '-%' })).recordset;
        if (active.length !== 1 || active[0].NroTicket.trim() !== nro) fail('Las mesas tienen pedidos activos incompatibles con el traslado', 409, 'TRANSFER_DESTINATION_UNAVAILABLE');
        if (await shiftClosures.isTicketArchived(db, nro)) fail('El turno está cerrado', 409);
        const transfer = randomUUID(), usuario = req.session.user.usuario;
        const employee = (await query(db, 'SELECT Nombre FROM Empleados WHERE Codemp=@mozo AND Empresa=@empresa', { mozo: t.Mozo, empresa: cfg.empresa })).recordset[0];
        const doc = transferDocument({ origen, destino, nro, mozo: employee?.Nombre || t.Mozo, usuario,
            fecha: new Date().toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false }) });
        await query(db, `INSERT Pedido_traslados(Id,NroTicket,Empresa,Origen,Destino,VersionOrigen,VersionResultado,Clave,Usuario,Documento)
            VALUES(@transfer,@nro,@empresa,@origen,@destino,@version,@resultado,@clave,@usuario,@doc);
            UPDATE Ticket_c SET NroMesa=@destino WHERE NroTicket=@nro;
            UPDATE Pedido_control SET Version=Version+1 WHERE NroTicket=@nro;
            UPDATE Mesas SET Estado=CASE WHEN Numero=@origen THEN 1 ELSE 2 END WHERE Empresa=@empresa AND Numero IN(@origen,@destino);`,
            { transfer, nro, empresa: cfg.empresa, origen, destino, version: t.Version, resultado: t.Version + 1, clave, usuario, doc });
        // Captured routing, including already delivered products; never route by today's catalog.
        const destinations = (await query(db, `SELECT DISTINCT COALESCE(d.Destino,r.Destino,'cocina') Destino FROM Pedido_lineas l
            LEFT JOIN Impresion_linea_destinos d ON d.LineaId=l.LineaId LEFT JOIN Impresion_linea_rutas r ON r.LineaId=l.LineaId
            WHERE l.NroTicket=@nro AND (l.Enviada IS NOT NULL OR EXISTS(SELECT 1 FROM Cocina_envio_detalles ed WHERE ed.LineaId=l.LineaId))`, { nro })).recordset;
        for (const { Destino: destination } of destinations) {
            const job = randomUUID(), queue = destination === 'barra' ? 'Impresion_barra_trabajos' : 'Impresion_trabajos';
            await query(db, `INSERT ${queue}(Id,EnvioId,TrasladoId,Clave,Documento,Usuario) VALUES(@job,NULL,@transfer,@clave,@doc,@usuario);
                ${destination === 'barra' ? '' : 'INSERT Impresion_trabajo_destinos(TrabajoId,Destino) VALUES(@job,@destination);'}`,
                { job, transfer, clave: randomUUID(), doc, usuario, destination });
        }
        t.NroMesa = destino; t.Version++;
        return { ...await response(db, t), trasladoId: transfer, mesa: destino, avisos: await jobsFor(db, transfer),
            event: { empresa: cfg.empresa, numero: destino, origen, destino, nroTicket: nro, version: t.Version, trasladoId: transfer }, kitchen: true };
    });
    route('post', '/api/pos/pedido/:nro/traslados/:traslado/reimprimir', async (db, req) => {
        const destination = req.body.destino;
        if (!['cocina','bebidas','barra'].includes(destination)) fail('Destino inválido');
        if (destination === 'barra' ? !barPrinterEnabled() : !printerEnabled()) fail('Impresora no habilitada', 503);
        const t = await ticketReference(db, req.params.nro, req.body.empresa);
        if (await shiftClosures.isTicketArchived(db, t.NroTicket)) fail('El turno está cerrado', 409);
        const transfer = id(req.params.traslado), clave = id(req.body.clave);
        if (!(await query(db, 'SELECT Id FROM Pedido_traslados WHERE Id=@transfer AND NroTicket=@nro AND Empresa=@empresa',
            { transfer, nro: t.NroTicket, empresa: t.Empresa })).recordset.length) fail('Traslado no encontrado', 404);
        const queue = destination === 'barra' ? 'Impresion_barra_trabajos' : 'Impresion_trabajos';
        const duplicate = (await query(db, `SELECT * FROM ${queue} WHERE Clave=@clave`, { clave })).recordset[0];
        const jobs = (await jobsFor(db, transfer)).filter(j => j.Destino === destination);
        if (duplicate) {
            if (!jobs.some(j => j.Id === duplicate.Id)) fail('Clave usada en otro trabajo', 409);
            return { success: true, trabajoId: duplicate.Id.toLowerCase() };
        }
        if (!jobs.length) fail('El traslado no tiene aviso para este destino', 404);
        if (jobs.some(j => ['en_cola','procesando'].includes(j.Estado))) fail('Ya hay un aviso pendiente', 409);
        const original = jobs.find(j => !j.ReimpresionDe) || jobs[0], job = randomUUID();
        await query(db, `INSERT ${queue}(Id,EnvioId,TrasladoId,ReimpresionDe,Clave,Documento,Usuario)
            VALUES(@job,NULL,@transfer,@original,@clave,@doc,@usuario);
            ${destination === 'barra' ? '' : 'INSERT Impresion_trabajo_destinos(TrabajoId,Destino) VALUES(@job,@destination);'}`,
            { job, transfer, original: original.Id, clave, doc: '*** REIMPRESIÓN ***\n' + original.Documento, usuario: req.session.user.usuario, destination });
        return { success: true, trabajoId: job };
    });
}
module.exports = { install, isDiningTable, transferDocument };
