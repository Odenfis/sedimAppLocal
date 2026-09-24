'use strict';
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { getConnection, closeConnections, sql } = require('../db');
const { recoverCancellation } = require('../lib/orders');

function arg(name, fallback) {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : fallback;
}
async function select(request, text) { return (await request.query(text)).recordset; }
async function main() {
    const empresa = Number(arg('empresa', 2)), mesa = Number(arg('mesa', 1));
    if (!Number.isInteger(empresa) || !Number.isInteger(mesa)) throw new Error('Empresa o mesa inválida');
    const pool = await getConnection();
    const ticketRows = await select(pool.request().input('empresa',sql.Int,empresa).input('mesa',sql.Int,mesa), `SELECT TOP 1 t.*,pc.Empresa,pc.Version,pc.UltimoEnvio,pc.SnapshotComercial
        FROM Ticket_c t JOIN Pedido_control pc ON pc.NroTicket=t.NroTicket
        WHERE t.NroMesa=@mesa AND pc.Empresa=@empresa AND t.Estado IN(1,2) ORDER BY t.Fecha DESC`);
    if (!ticketRows.length) { console.log('No existe un pedido activo para esa mesa y empresa.'); return; }
    const ticket = ticketRows[0], nro = String(ticket.NroTicket).trim();
    const request = () => pool.request().input('nro',sql.VarChar(20),nro);
    const exportData = {
        exportedAt: new Date().toISOString(), empresa, mesa, ticket,
        ticketDetalle: await select(request(), 'SELECT * FROM Ticket_d WHERE NroTicket=@nro'),
        control: await select(request(), 'SELECT * FROM Pedido_control WHERE NroTicket=@nro'),
        lineas: await select(request(), 'SELECT * FROM Pedido_lineas WHERE NroTicket=@nro ORDER BY Orden'),
        estados: await select(request(), 'SELECT * FROM Cocina_estados WHERE NroTicket=@nro'),
        envios: await select(request(), 'SELECT * FROM Cocina_envios WHERE NroTicket=@nro ORDER BY Numero'),
        detallesEnvio: await select(request(), `SELECT d.* FROM Cocina_envio_detalles d JOIN Cocina_envios e ON e.Id=d.EnvioId WHERE e.NroTicket=@nro ORDER BY e.Numero`),
        impresion: await select(request(), `SELECT j.* FROM Impresion_trabajos j JOIN Cocina_envios e ON e.Id=j.EnvioId WHERE e.NroTicket=@nro ORDER BY j.Fecha`)
    };
    const dir = path.join(__dirname, '..', 'backups'); fs.mkdirSync(dir, { recursive:true });
    const file = path.join(dir, `recovery-${nro.replace(/[^A-Za-z0-9_-]/g,'_')}-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(exportData, null, 2));
    console.log(`Diagnóstico exportado: ${file}`);
    console.log(JSON.stringify({ nroTicket:nro, estado:ticket.Estado, version:ticket.Version, lineas:exportData.lineas.length,
        lineasBaja:exportData.lineas.filter(l=>l.Baja).length, envios:exportData.envios.length, estados:exportData.estados.length }, null, 2));
    if (!process.argv.includes('--apply')) { console.log('Modo diagnóstico: no se realizaron cambios.'); return; }
    if (ticket.Estado !== 1) throw new Error('La recuperación solo admite pedidos editables en Estado=1');
    const result = await recoverCancellation({ nroTicket:nro, empresa, version:ticket.Version, clave:randomUUID(), usuario:arg('usuario','RECUPERACION_LOCAL') });
    console.log(JSON.stringify({ aplicado:true, ...result }, null, 2));
}
main().then(() => closeConnections()).catch(e => { console.error(e.message); process.exitCode=1; closeConnections(); });
