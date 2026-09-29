'use strict';
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { getConnection, closeConnections, sql } = require('../db');
const { compareCommercial, publicComparison } = require('../lib/commercial-snapshot');
const { reconcileCommercialOrder } = require('../lib/orders');

function arg(name, fallback = null) {
    const index = process.argv.indexOf(`--${name}`);
    return index >= 0 ? process.argv[index + 1] : fallback;
}
const rows = async (request, statement) => (await request.query(statement)).recordset;

async function main() {
    const empresa = Number(arg('empresa', 2));
    const mesa = Number(arg('mesa', 0));
    const requestedTicket = String(arg('ticket', '') || '').trim();
    const apply = process.argv.includes('--apply');
    if (![2, 4, 6].includes(empresa) || (!requestedTicket && (!Number.isInteger(mesa) || mesa <= 0))) {
        throw new Error('Indique --empresa y --ticket, o --empresa y --mesa para diagnóstico');
    }
    if (apply && !requestedTicket) throw new Error('--apply exige --ticket explícito; no se permite aplicar por mesa');

    const pool = await getConnection();
    const lookup = pool.request().input('empresa', sql.Int, empresa).input('ticket', sql.VarChar(20), requestedTicket || null).input('mesa', sql.Int, mesa || null);
    const tickets = await rows(lookup, `SELECT TOP 1 t.*,pc.Empresa,pc.Version,pc.UltimoEnvio,pc.SnapshotComercial
        FROM Ticket_c t JOIN Pedido_control pc
            ON pc.NroTicket COLLATE DATABASE_DEFAULT=t.NroTicket COLLATE DATABASE_DEFAULT
        WHERE pc.Empresa=@empresa AND ((@ticket IS NOT NULL AND RTRIM(t.NroTicket)=@ticket) OR (@ticket IS NULL AND t.NroMesa=@mesa))
            AND t.Estado IN(1,2) ORDER BY t.Fecha DESC`);
    if (!tickets.length) throw new Error('No se encontró un pedido activo con ese alcance');
    const ticket = tickets[0], nro = String(ticket.NroTicket).trim();
    const request = () => pool.request().input('nro', sql.VarChar(20), nro);
    const currentRows = await rows(request(), `SELECT RTRIM(Codpro) codPro,RTRIM(Descripcion) nombre,Cantidad cantidad,
        Precio precio,Descuento descuento,Importe importe FROM Ticket_d WHERE NroTicket=@nro`);
    const comparison = compareCommercial(ticket.SnapshotComercial, currentRows);
    const exportData = {
        exportedAt: new Date().toISOString(), empresa, ticket,
        ticketDetalle: currentRows,
        lineas: await rows(request(), 'SELECT * FROM Pedido_lineas WHERE NroTicket=@nro ORDER BY Orden'),
        estados: await rows(request(), 'SELECT * FROM Cocina_estados WHERE NroTicket=@nro'),
        envios: await rows(request(), 'SELECT * FROM Cocina_envios WHERE NroTicket=@nro ORDER BY Numero')
    };
    const backupDir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, `commercial-${nro.replace(/[^A-Za-z0-9_-]/g, '_')}-${Date.now()}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(exportData, null, 2));
    console.log(JSON.stringify({ nroTicket: nro, empresa, mesa: ticket.NroMesa, estado: ticket.Estado, version: ticket.Version,
        conciliacionComercial: publicComparison(comparison), lineasWeb: exportData.lineas.filter(line => !line.Baja).length,
        lineasComerciales: currentRows.length, backup: backupFile, aplicado: false }, null, 2));
    if (!apply) return console.log('Modo diagnóstico: no se realizaron cambios.');
    if (ticket.Estado !== 1) throw new Error('Solo se puede restaurar la versión web antes de Preventa');
    const result = await reconcileCommercialOrder({ nroTicket: nro, empresa, version: ticket.Version,
        usuario: String(arg('usuario', 'CONCILIACION_WEB')).slice(0, 50) });
    console.log(JSON.stringify({ aplicado: true, ...result, backup: backupFile }, null, 2));
}

main().then(closeConnections).catch(error => { console.error(error.message); process.exitCode = 1; closeConnections(); });
