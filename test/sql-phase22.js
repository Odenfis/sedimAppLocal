'use strict';
// Integration harness: unique schema in tempdb, never the configured business database.
// Creates only fixture data; drops its own schema in finally. Does not print credentials.
require('dotenv').config();
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const sql = require('mssql');
const schema = 'phase22_test_' + randomUUID().replaceAll('-', '');
const tables = ['Ticket_c','Ticket_d','Cocina_pedidos','Cocina_pedidos_legacy','Pedido_control','Pedido_lineas','Cocina_envios','Cocina_envio_detalles','Cocina_estados','Impresion_trabajos','Impresion_linea_rutas','Impresion_barra_trabajos','Cierres_turno','Cierre_turno_archivos','Cierre_turno_operaciones','Web_sessions','Migrations','Mesas','Productos','Lineas','Empleados','Valores','Tablas'];
const names = new RegExp('(?<![#\\w.\\[])\\b(' + tables.join('|') + ')\\b', 'gi');
const dboNames = new RegExp('\\bdbo\\.(' + tables.join('|') + ')\\b', 'gi');
const originalQuery = sql.Request.prototype.query;
const originalInput = sql.Request.prototype.input;
function qualify(text) { return text.replace(dboNames, (_, name) => `[${schema}].[${name}]`).replace(names, name => `[${schema}].[${name}]`).replace(/@Resource='([^']+)'/gi, (_, r) => `@Resource='${schema}:${r}'`); }
async function main() {
    const pool = await new sql.ConnectionPool({ user: process.env.DB_USER, password: process.env.DB_PASS,
        server: process.env.DB_SERVER, database: 'tempdb', connectionTimeout: 5000,
        options: { encrypt: false, trustServerCertificate: true } }).connect();
    await pool.request().query(`CREATE SCHEMA [${schema}]`);
    console.log('SQL integration: fixture schema created in tempdb.');
    sql.Request.prototype.query = function(text, ...args) { return originalQuery.call(this, qualify(text), ...args); };
    sql.Request.prototype.input = function(name, ...args) {
        if (name.toLowerCase() === 'resource') args[args.length - 1] = schema + ':' + args[args.length - 1];
        return originalInput.call(this, name, ...args);
    };
    const dbPath = require.resolve('../db'); require(dbPath); require.cache[dbPath].exports = {
        sql, getConnection: async () => pool, getPrinterConnection: async () => pool, closeConnections: async () => {}
    };
    let passed = 0;
    try {
        await pool.request().query(`
            CREATE TABLE Ticket_c(NroTicket CHAR(20) PRIMARY KEY,NroMesa INT NOT NULL,Mozo INT NOT NULL,Total MONEY NOT NULL,Estado INT NOT NULL,
                Fecha SMALLDATETIME,Turno INT,Usuario NVARCHAR(50));
            CREATE TABLE Ticket_d(NroTicket CHAR(20) NOT NULL,Codpro CHAR(10) NOT NULL,Descripcion CHAR(70),Cantidad DECIMAL(9,2) NOT NULL,Precio MONEY NOT NULL,Descuento MONEY,Importe MONEY NOT NULL);
            CREATE TABLE Mesas(Numero INT,Empresa INT,Estado INT);
            CREATE TABLE Tablas(n_codtabla INT,n_numero INT,c_describe VARCHAR(100));
            CREATE TABLE Productos(CodPro CHAR(10),Nombre VARCHAR(70),PventaMa MONEY,Afecto INT,Eliminado BIT,Clinea INT,Tipo INT);
            CREATE TABLE Lineas(CodLinea INT,Descripcion VARCHAR(50));
            CREATE TABLE Empleados(Codemp INT,Nombre VARCHAR(50),Empresa INT,Tipo INT,FecCese DATETIME);
            CREATE TABLE Valores(c_valor VARCHAR(20),n_valor DECIMAL(9,2));
            CREATE TABLE Migrations(Id INT IDENTITY PRIMARY KEY,MigrationName NVARCHAR(255),AppliedAt DATETIME DEFAULT GETDATE());
            INSERT Migrations(MigrationName) VALUES('001_create_cocina_pedidos.sql');
            INSERT Tablas VALUES(23,1,'T001-000001'),(23,2,'T002-000001'),(23,5,'T005-000001'),(200,2,'Cocinería');
            INSERT Mesas VALUES(1,2,2),(2,2,1),(3,2,1),(4,2,1),(5,2,1),(6,2,1),(1,4,1);
            INSERT Productos VALUES('02001','Arroz con mariscos',20,1,0,1,3),('02007','Pisco sour',18,1,0,7,3),('04001','Otro producto',30,1,0,1,3);
            INSERT Lineas VALUES(1,'Platos'),(7,'Barra'); INSERT Empleados VALUES(1,'José',2,3,NULL),(2,'María',4,3,NULL);
            INSERT Valores VALUES('Igvv',10.5);
            INSERT Ticket_c VALUES('T001-000001',1,1,44.2,1,GETDATE(),1,'Legacy'),('T001-000000',4,1,0,1,GETDATE(),1,'Legacy');
            INSERT Ticket_d VALUES('T001-000001','02001','Arroz con mariscos',2,20,0,44.2);
        `);
        await pool.request().query(fs.readFileSync(path.join(__dirname,'../migrations/001_create_cocina_pedidos.sql'),'utf8'));
        await pool.request().query("INSERT Cocina_pedidos(NroTicket,Codpro,Estado) VALUES('T001-000001','02001',2)");
        await require('../migrate')(); await require('../migrate')();
        const router = {};
        const app = Object.fromEntries(['get','post','put','delete'].map(method => [method, (url, auth, handler) => { router[method + ' ' + url] = handler; }]));
        require('../lib/orders').install(app, () => {}, () => {});
        require('../lib/shift-closures').install(app, () => {}, () => {});
        async function call(method, url, body = {}, params = {}, query = {}) {
            let status = 200, result;
            await router[method + ' ' + url]({ body, params, query, sessionID: 'sql-test', ip: '127.0.0.1', session: { user: { usuario: 'QA' } } }, { status(code) { status = code; return this; }, json(data) { result = data; } });
            return { status, ...result };
        }
        const get = (mesa = 1) => call('get','/api/pos/pedido',{}, {}, { empresa: 2, mesa });
        const legacy = await get(); assert.equal(legacy.status,200); assert.equal(legacy.cocina.pendientes,1); assert.equal(legacy.items[0].estadoCocina,null);
        const legacyCommercial = (await pool.request().query("SELECT Precio,Importe FROM Ticket_d WHERE NroTicket='T001-000001'")).recordset[0];
        assert.equal(legacyCommercial.Precio,20); assert.equal(legacyCommercial.Importe,44.2);
        assert.equal((await pool.request().query('SELECT COUNT(*) n FROM Impresion_trabajos')).recordset[0].n,0);
        assert.equal((await get(4)).items.length,0);
        passed++; console.log('✓ migration backfill preserves kitchen state, no print jobs, rerun is safe');
        const history = await call('get','/api/pos/pedido/:nro/envios',{}, {nro:'T001-000001'}, {empresa:2});
        assert.deepEqual(history.envios,[]);
        assert.equal((await pool.request().query('SELECT COUNT(*) n FROM Cocina_pedidos_legacy')).recordset[0].n,1);
        const base = { lineaId: randomUUID(), codPro: '02001', nombre: 'Arroz con mariscos', cantidad: 1, precio: 20, afecto: 1, notasRapidas: ['Sin cebolla'], nota: 'Sin sal' };
        const save = (items, version, nro, mesa = 2) => call('post','/api/pos/pedido',{ items, version, nroTicket: nro, mesa, empresa: 2, mozo: 1, turno: 1 });
        let saved = await save([base, { ...base, lineaId: randomUUID(), notasRapidas: [], nota: 'Poco picante' }]);
        assert.equal(saved.status,200, JSON.stringify(saved)); const nro = saved.nroTicket;
        let kds = await call('get','/api/cocina/pedidos',{}, {}, { empresa: 2 }); assert.equal(kds.pedidos.filter(p => p.nroTicket === nro).length,0);
        let payment = await call('put','/api/pos/pedido/:nro/pagar',{ empresa: 2,version:saved.version },{nro}); assert.equal(payment.status,409);
        passed++; console.log('✓ save keeps notes separate and out of kitchen; pre-sale blocked');
        const clave = randomUUID(), body = { empresa:2,version:saved.version,clave };
        await pool.request().query(`CREATE TRIGGER [${schema}].[RejectPrint] ON Impresion_trabajos AFTER INSERT AS THROW 51000,'Injected print queue failure',1;`);
        const failedSend = await call('post','/api/pos/pedido/:nro/enviar-cocina',body,{nro});
        assert.equal(failedSend.status,500); assert.equal((await get(2)).cocina.ultimoEnvio,0);
        assert.equal((await pool.request().query('SELECT COUNT(*) n FROM Impresion_trabajos')).recordset[0].n,0);
        await pool.request().query(`DROP TRIGGER [${schema}].[RejectPrint]`);
        passed++; console.log('✓ failed queue insertion rolls back shipment and kitchen updates atomically');
        const sends = await Promise.all([call('post','/api/pos/pedido/:nro/enviar-cocina',body,{nro}),call('post','/api/pos/pedido/:nro/enviar-cocina',body,{nro})]);
        assert.equal(sends[0].status,200,JSON.stringify(sends[0])); assert.equal(sends[1].status,200); assert.equal(sends[0].envioId,sends[1].envioId);
        assert.equal((await pool.request().query('SELECT COUNT(*) n FROM Impresion_trabajos')).recordset[0].n,1);
        saved = await get(2); assert.equal(saved.cocina.pendientes,0);
        const grouped = (await pool.request().input('nro',nro).query('SELECT * FROM Ticket_d WHERE NroTicket=@nro')).recordset;
        assert.equal(grouped.length,1); assert.equal(grouped[0].Cantidad,2); assert.equal(grouped[0].Precio,44.2); assert.equal(grouped[0].Importe,44.2);
        for (const [count, mesa] of [[10,5],[30,6]]) {
            const many = Array.from({ length: count }, (_, index) => ({ ...base, lineaId: randomUUID(), cantidad: 1,
                notasRapidas: index % 2 ? ['Sin cebolla'] : [], nota: `Línea ${index + 1}` }));
            const bulkSaved = await save(many, undefined, undefined, mesa);
            assert.equal(bulkSaved.status,200,JSON.stringify(bulkSaved)); assert.equal(bulkSaved.items.length,count);
            const bulkSent = await call('post','/api/pos/pedido/:nro/enviar-cocina',
                {empresa:2,version:bulkSaved.version,clave:randomUUID()},{nro:bulkSaved.nroTicket});
            assert.equal(bulkSent.status,200,JSON.stringify(bulkSent)); assert.equal(bulkSent.cocina.pendientes,0);
            const detailCount = (await pool.request().input('nro',bulkSaved.nroTicket).query('SELECT COUNT(*) n FROM Cocina_envio_detalles d JOIN Cocina_envios e ON e.Id=d.EnvioId WHERE e.NroTicket=@nro')).recordset[0].n;
            assert.equal(detailCount,count);
            await call('delete','/api/pos/comanda/:nro',{version:bulkSent.version,clave:randomUUID()},{nro:bulkSaved.nroTicket},{empresa:2});
        }
        passed++; console.log('✓ batch save and send preserve 10-line and 30-line orders');
        passed++; console.log('✓ duplicate send is idempotent; new commercial rows store Precio = Importe with IGV');
        const previousBarEnabled = process.env.BAR_PRINTER_ENABLED, previousBarHost = process.env.BAR_PRINTER_HOST;
        try {
            process.env.BAR_PRINTER_ENABLED = 'true'; process.env.BAR_PRINTER_HOST = '192.168.1.180';
            const kitchenLine = { ...base, lineaId: randomUUID(), notasRapidas:[], nota:'Cocina' };
            const barLine = { ...base, lineaId: randomUUID(), codPro:'02007', nombre:'Pisco sour', notasRapidas:['Helada'], nota:'Barra' };
            const mixed = await save([kitchenLine,barLine],undefined,undefined,3);
            const mixedSend = await call('post','/api/pos/pedido/:nro/enviar-cocina',
                {empresa:2,version:mixed.version,clave:randomUUID()},{nro:mixed.nroTicket});
            assert.equal(mixedSend.status,200,JSON.stringify(mixedSend));
            const kitchenJob = (await pool.request().input('envio',mixedSend.envioId).query('SELECT Documento FROM Impresion_trabajos WHERE EnvioId=@envio')).recordset[0];
            const barJob = (await pool.request().input('envio',mixedSend.envioId).query('SELECT Documento FROM Impresion_barra_trabajos WHERE EnvioId=@envio')).recordset[0];
            assert.match(kitchenJob.Documento,/COMANDA DE COCINA/); assert.match(kitchenJob.Documento,/Arroz con mariscos/); assert.doesNotMatch(kitchenJob.Documento,/Pisco sour/);
            assert.match(barJob.Documento,/COMANDA DE BARRA/); assert.match(barJob.Documento,/Pisco sour/); assert.doesNotMatch(barJob.Documento,/Arroz con mariscos/);
            assert.equal((await pool.request().input('nro',mixed.nroTicket).query("SELECT COUNT(*) n FROM Impresion_linea_rutas r JOIN Pedido_lineas l ON l.LineaId=r.LineaId WHERE l.NroTicket=@nro AND r.Destino='barra'")).recordset[0].n,1);
            await pool.request().query("UPDATE Productos SET Clinea=1 WHERE CodPro='02007'");
            const correctedMixed = await save(mixedSend.items.map(line => ({ ...line, nota: line.codPro === '02007' ? 'Barra corregida' : line.nota })),mixedSend.version,mixed.nroTicket,3);
            const correctedMixedSend = await call('post','/api/pos/pedido/:nro/enviar-cocina',
                {empresa:2,version:correctedMixed.version,clave:randomUUID()},{nro:mixed.nroTicket});
            assert.equal(correctedMixedSend.status,200,JSON.stringify(correctedMixedSend));
            assert.equal((await pool.request().input('envio',correctedMixedSend.envioId).query('SELECT COUNT(*) n FROM Impresion_trabajos WHERE EnvioId=@envio')).recordset[0].n,0);
            const frozenBarJob = (await pool.request().input('envio',correctedMixedSend.envioId).query('SELECT Documento FROM Impresion_barra_trabajos WHERE EnvioId=@envio')).recordset[0];
            assert.match(frozenBarJob.Documento,/Barra corregida/);
            await pool.request().query("UPDATE Productos SET Clinea=7 WHERE CodPro='02007'");
            const barReprint = await call('post','/api/pos/pedido/:nro/envios/:envio/reimprimir',
                {empresa:2,clave:randomUUID(),destino:'barra'},{nro:mixed.nroTicket,envio:mixedSend.envioId});
            assert.equal(barReprint.status,409); // el trabajo automático de Barra aún está pendiente
            await pool.request().input('envio',mixedSend.envioId).query("UPDATE Impresion_barra_trabajos SET Estado='enviado' WHERE EnvioId=@envio");
            const reprintKey = randomUUID();
            const queuedBar = await call('post','/api/pos/pedido/:nro/envios/:envio/reimprimir',
                {empresa:2,clave:reprintKey,destino:'barra'},{nro:mixed.nroTicket,envio:mixedSend.envioId});
            const duplicateBar = await call('post','/api/pos/pedido/:nro/envios/:envio/reimprimir',
                {empresa:2,clave:reprintKey,destino:'barra'},{nro:mixed.nroTicket,envio:mixedSend.envioId});
            assert.equal(queuedBar.status,200); assert.equal(queuedBar.trabajoId,duplicateBar.trabajoId);
            await call('delete','/api/pos/comanda/:nro',{version:correctedMixedSend.version,clave:randomUUID()},{nro:mixed.nroTicket},{empresa:2});
        } finally {
            if(previousBarEnabled===undefined) delete process.env.BAR_PRINTER_ENABLED; else process.env.BAR_PRINTER_ENABLED=previousBarEnabled;
            if(previousBarHost===undefined) delete process.env.BAR_PRINTER_HOST; else process.env.BAR_PRINTER_HOST=previousBarHost;
        }
        passed++; console.log('✓ mixed send splits immutable Cocina/Barra documents and reprints Barra independently');
        const lineId = saved.items[0].lineaId;
        const prep = await call('put','/api/cocina/linea',{ empresa:2,nroTicket:nro,lineaId:lineId,estado:2 }); assert.equal(prep.status,200);
        const edits = saved.items.map(l => ({ ...l, precio:l.Precio, nota:l.lineaId===lineId?'Sin azúcar':l.nota }));
        const corrected = await save(edits,saved.version,nro); assert.equal(corrected.status,200,JSON.stringify(corrected));
        const correction = await call('post','/api/pos/pedido/:nro/enviar-cocina',{ empresa:2,version:corrected.version,clave:randomUUID() },{nro}); assert.equal(correction.status,200);
        kds = await call('get','/api/cocina/pedidos',{}, {}, { empresa:2 }); const operative = kds.pedidos.flatMap(p=>p.lineas).find(l=>l.lineaId===lineId);
        assert.ok(operative.correccionPendiente); assert.notEqual(operative.nota,'Sin azúcar');
        const blocked = await save(edits.map(l=>({...l,nota:'Otro cambio'})),correction.version,nro); assert.equal(blocked.status,409);
        const delivered = await call('put','/api/cocina/ticket/:nro/entregado',{empresa:2},{nro}); assert.equal(delivered.status,409);
        const ack = await call('put','/api/cocina/linea/:linea/reconocer',{empresa:2,nroTicket:nro},{linea:lineId}); assert.equal(ack.status,200);
        kds = await call('get','/api/cocina/pedidos',{}, {}, { empresa:2 }); const recognized = kds.pedidos.flatMap(p=>p.lineas).find(l=>l.lineaId===lineId);
        assert.equal(recognized.nota,'Sin azúcar'); assert.equal(recognized.estado,2); assert.equal(recognized.correccionPendiente,null);
        passed++; console.log('✓ correction requires acknowledgement and preserves preparation state');
        saved = await get(2);
        const stale = await save(edits,saved.version-1,nro); assert.equal(stale.status,409);
        const wrongCompany = await call('post','/api/pos/pedido/:nro/enviar-cocina',{empresa:4,version:saved.version,clave:randomUUID()},{nro}); assert.equal(wrongCompany.status,404);
        passed++; console.log('✓ stale saves and cross-company requests rejected');
        // An invalid product must roll back all prior updates in the same transaction.
        const before = await get(2); const invalid = await save([...edits,{...base,lineaId:randomUUID(),codPro:'02999'}],before.version,nro);
        assert.equal(invalid.status,400); assert.equal((await get(2)).version,before.version);
        passed++; console.log('✓ transaction rollback leaves version and order intact');
        payment = await call('put','/api/pos/pedido/:nro/pagar',{empresa:2,version:before.version},{nro}); assert.equal(payment.status,200);
        let reopened = await get(2); assert.equal(reopened.pedido.Estado,2);
        const reopen = await call('put','/api/pos/pedido/:nro/reabrir',{empresa:2,version:reopened.version},{nro}); assert.equal(reopen.status,200);
        reopened = await get(2); assert.equal(reopened.items.length,2); assert.equal(reopened.items.find(l=>l.lineaId===lineId).estadoCocina,2);
        passed++; console.log('✓ pre-sale/reopen preserves lines, notes, history and progress');
        const cancelKey = randomUUID();
        const deleted = await call('delete','/api/pos/comanda/:nro',{version:reopened.version,clave:cancelKey},{nro},{empresa:2});
        assert.equal(deleted.status,200); assert.equal(deleted.pedidoEliminado,true); assert.equal(deleted.yaEliminado,false);
        const commercialDeleted = (await pool.request().input('nro',nro).query(`SELECT
            (SELECT COUNT(*) FROM Ticket_d WHERE NroTicket=@nro) Detalles,
            (SELECT COUNT(*) FROM Ticket_c WHERE NroTicket=@nro) Cabeceras,
            (SELECT Estado FROM Mesas WHERE Numero=2 AND Empresa=2) MesaEstado,
            (SELECT COUNT(*) FROM Ticket_c WHERE NroTicket=@nro AND Estado=4) EstadoCuatro`)).recordset[0];
        assert.deepEqual(commercialDeleted,{Detalles:0,Cabeceras:0,MesaEstado:1,EstadoCuatro:0});
        const archivedLines = (await pool.request().input('nro',nro).query(`SELECT
            (SELECT COUNT(*) FROM Pedido_lineas WHERE NroTicket=@nro AND Baja=1) Bajas,
            (SELECT COUNT(*) FROM Cocina_estados WHERE NroTicket=@nro AND Anulada=1 AND PendienteId IS NULL) Anuladas,
            (SELECT COUNT(*) FROM Cocina_envios WHERE NroTicket=@nro AND Historico=1) Historicos`)).recordset[0];
        assert.equal(archivedLines.Bajas,2); assert.equal(archivedLines.Anuladas,2); assert.equal(archivedLines.Historicos,2);
        const retriedCancel = await call('delete','/api/pos/comanda/:nro',{version:reopened.version,clave:cancelKey},{nro},{empresa:2});
        assert.equal(retriedCancel.status,200); assert.equal(retriedCancel.yaEliminado,true);
        assert.equal((await get(2)).pedido,null);
        const audit = (await pool.request().input('nro',nro).query('SELECT COUNT(*) n FROM Cocina_envios WHERE NroTicket=@nro')).recordset[0].n;
        assert.equal(audit,2);
        const day = new Date().toISOString().slice(0,10);
        const kitchenHistory = await call('get','/api/cocina/historial',{}, {}, {empresa:2,desde:day,hasta:day,estado:'anulado',pagina:1,tamano:20});
        assert.equal(kitchenHistory.status,200); assert.ok(kitchenHistory.envios.some(e => e.nroTicket === nro && e.estadoPedido === 'anulado'));
        passed++; console.log('✓ hard deletion removes commercial ticket, frees table immediately and retains audit without state 4');
        const emptyLine = { ...base, lineaId:randomUUID(), notasRapidas:[], nota:'' };
        const emptyCandidate = await save([emptyLine],undefined,undefined,3);
        const emptied = await save([],emptyCandidate.version,emptyCandidate.nroTicket,3);
        assert.equal(emptied.status,200); assert.equal(emptied.pedidoEliminado,true);
        const emptyCounts = (await pool.request().input('nro',emptyCandidate.nroTicket).query(`SELECT
            (SELECT COUNT(*) FROM Ticket_d WHERE NroTicket=@nro) Detalles,
            (SELECT COUNT(*) FROM Ticket_c WHERE NroTicket=@nro) Cabeceras,
            (SELECT Estado FROM Mesas WHERE Numero=3 AND Empresa=2) MesaEstado`)).recordset[0];
        assert.deepEqual(emptyCounts,{Detalles:0,Cabeceras:0,MesaEstado:1});
        passed++; console.log('✓ POST pedido with an empty existing detail performs the same hard deletion');
        const previousPrinterEnabled = process.env.PRINTER_ENABLED;
        try {
            process.env.PRINTER_ENABLED = 'false';
            const visualOrder = await save([{ ...base, lineaId:randomUUID(), notasRapidas:[], nota:'Solo KDS' }],undefined,undefined,3);
            const visualSend = await call('post','/api/pos/pedido/:nro/enviar-cocina',
                {empresa:2,version:visualOrder.version,clave:randomUUID()},{nro:visualOrder.nroTicket});
            assert.equal(visualSend.status,200,JSON.stringify(visualSend));
            const visualJobs = (await pool.request().input('envio',visualSend.envioId).query('SELECT COUNT(*) n FROM Impresion_trabajos WHERE EnvioId=@envio')).recordset[0].n;
            assert.equal(visualJobs,0);
            const disabledReprint = await call('post','/api/pos/pedido/:nro/envios/:envio/reimprimir',
                {empresa:2,clave:randomUUID()},{nro:visualOrder.nroTicket,envio:visualSend.envioId});
            assert.equal(disabledReprint.status,503);
            await call('delete','/api/pos/comanda/:nro',{version:visualSend.version,clave:randomUUID()},{nro:visualOrder.nroTicket},{empresa:2});
        } finally {
            if (previousPrinterEnabled === undefined) delete process.env.PRINTER_ENABLED;
            else process.env.PRINTER_ENABLED = previousPrinterEnabled;
        }
        passed++; console.log('✓ KDS funciona sin crear cola y la reimpresión queda deshabilitada en v1');
        await pool.request().query("UPDATE Ticket_d SET Cantidad=3 WHERE NroTicket='T001-000001'");
        assert.equal((await get()).status,409);
        passed++; console.log('✓ external commercial edits are detected before overwriting');
        // Real queue transactions with an injected transport: never opens a printer socket.
        await pool.request().query("UPDATE Impresion_trabajos SET Estado='error'");
        const retryKey = randomUUID();
        const reprint = await call('post','/api/pos/pedido/:nro/envios/:envio/reimprimir',{empresa:2,clave:retryKey},{nro,envio:sends[0].envioId});
        assert.equal(reprint.status,200);
        const repeated = await call('post','/api/pos/pedido/:nro/envios/:envio/reimprimir',{empresa:2,clave:retryKey},{nro,envio:sends[0].envioId});
        assert.equal(reprint.trabajoId,repeated.trabajoId);
        const queuedCopy = (await pool.request().input('job',reprint.trabajoId).query('SELECT * FROM Impresion_trabajos WHERE Id=@job')).recordset[0];
        assert.match(queuedCopy.Documento,/REIMPRESIÓN/);
        const { startPrintWorker } = require('../lib/print-worker');
        const previousEnabled = process.env.PRINTER_ENABLED; process.env.PRINTER_ENABLED = 'true';
        let attempts=0, concurrent=0, maxConcurrent=0;
        const transport = { async send() {
            attempts++; concurrent++; maxConcurrent=Math.max(maxConcurrent,concurrent);
            await new Promise(r=>setTimeout(r,40)); concurrent--;
            if(attempts<3) { const e=new Error('Not connected'); e.beforeTransmission=true; throw e; }
            return {transmitted:true};
        } };
        const stopA=startPrintWorker({transport,intervalMs:25}), stopB=startPrintWorker({transport,intervalMs:25});
        async function waitFor(fn) { const until=Date.now()+10000; while(Date.now()<until) { if(await fn()) return; await new Promise(r=>setTimeout(r,40)); } throw new Error('Queue test timed out'); }
        try {
            await waitFor(async()=> {
                await pool.request().query("UPDATE Impresion_trabajos SET ProximoIntento=SYSUTCDATETIME() WHERE Estado='en_cola'");
                return (await pool.request().input('job',reprint.trabajoId).query('SELECT Estado FROM Impresion_trabajos WHERE Id=@job')).recordset[0].Estado==='enviado';
            });
            assert.equal(attempts,3); assert.equal(maxConcurrent,1);
            await pool.request().input('job',reprint.trabajoId).query("UPDATE Impresion_trabajos SET Estado='procesando',Actualizado=DATEADD(SECOND,-60,SYSUTCDATETIME()) WHERE Id=@job");
            await waitFor(async()=> (await pool.request().input('job',reprint.trabajoId).query('SELECT Estado FROM Impresion_trabajos WHERE Id=@job')).recordset[0].Estado==='incierto');
            assert.equal(attempts,3);
        } finally { stopA();stopB(); if(previousEnabled===undefined) delete process.env.PRINTER_ENABLED; else process.env.PRINTER_ENABLED=previousEnabled; await new Promise(r=>setTimeout(r,100)); }
        passed++; console.log('✓ reprint idempotency, serial workers, retry limit and interrupted-job recovery');

        const shiftLine = { ...base, lineaId:randomUUID(), notasRapidas:[], nota:'Turno 2' };
        let shiftOrder = await call('post','/api/pos/pedido',{items:[shiftLine],mesa:2,empresa:2,mozo:1,turno:2});
        assert.equal(shiftOrder.status,200,JSON.stringify(shiftOrder));
        const shiftNro = shiftOrder.nroTicket;
        const shiftSend = await call('post','/api/pos/pedido/:nro/enviar-cocina',{empresa:2,version:shiftOrder.version,clave:randomUUID()},{nro:shiftNro});
        assert.equal(shiftSend.status,200,JSON.stringify(shiftSend));
        await pool.request().input('nro',shiftNro).query("UPDATE j SET Estado='enviado' FROM Impresion_trabajos j JOIN Cocina_envios e ON e.Id=j.EnvioId WHERE e.NroTicket=@nro");
        assert.equal((await call('put','/api/cocina/ticket/:nro/todo-listo',{empresa:2},{nro:shiftNro})).status,200);
        assert.equal((await call('put','/api/cocina/ticket/:nro/entregado',{empresa:2},{nro:shiftNro})).status,200);
        const kitchenStates = await call('get','/api/pos/pedido/:nro/estados-cocina',{}, {nro:shiftNro}, {empresa:2});
        assert.equal(kitchenStates.estados[0].estadoCocina,4);
        await pool.request().input('nro',shiftNro).query('UPDATE Ticket_c SET Estado=3 WHERE NroTicket=@nro');
        const businessDay = new Date().toLocaleDateString('en-CA',{timeZone:'America/Lima'});
        const previousPin = process.env.MAINTENANCE_PIN_HASH;
        process.env.MAINTENANCE_PIN_HASH = require('bcryptjs').hashSync('2468',4);
        const shiftPreview = await call('get','/api/admin/cierres/preview',{}, {}, {empresa:2,turno:2,fechaNegocio:businessDay});
        assert.equal(shiftPreview.status,200); assert.equal(shiftPreview.elegible,true); assert.ok(shiftPreview.tickets.includes(shiftNro));
        const closeKey = randomUUID();
        let closed = await call('post','/api/admin/cierres',{empresa:2,turno:2,fechaNegocio:businessDay,pin:'2468',confirmacion:'CERRAR TURNO',clave:closeKey});
        assert.equal(closed.status,200,JSON.stringify(closed)); assert.equal(closed.estado,'cerrado'); assert.equal(closed.conteos.Pedido_control,1);
        assert.equal(closed.conteos.Impresion_linea_rutas,1); assert.equal(closed.conteos.Impresion_barra_trabajos,0);
        assert.equal((await pool.request().input('id',closed.id).query('SELECT COUNT(*) n FROM Cierre_turno_archivos WHERE CierreId=@id')).recordset[0].n,1);
        const reopenedShift = await call('post','/api/admin/cierres/:id/reabrir',{pin:'2468',confirmacion:'REABRIR TURNO',clave:randomUUID()},{id:closed.id});
        assert.equal(reopenedShift.status,200); assert.equal(reopenedShift.estado,'reabierto');
        assert.equal((await pool.request().input('id',closed.id).query('SELECT COUNT(*) n FROM Cierre_turno_archivos WHERE CierreId=@id')).recordset[0].n,0);
        closed = await call('post','/api/admin/cierres',{empresa:2,turno:2,fechaNegocio:businessDay,pin:'2468',confirmacion:'CERRAR TURNO',clave:randomUUID()});
        assert.equal(closed.status,200); assert.equal(closed.estado,'cerrado');
        const blockedReprint = await call('post','/api/pos/pedido/:nro/envios/:envio/reimprimir',{empresa:2,clave:randomUUID()},{nro:shiftNro,envio:shiftSend.envioId});
        assert.equal(blockedReprint.status,409);
        const blockedOrder = await call('post','/api/pos/pedido',{items:[{...shiftLine,lineaId:randomUUID()}],mesa:3,empresa:2,mozo:1,turno:2});
        assert.equal(blockedOrder.status,409);
        await pool.request().input('id',closed.id).query('UPDATE Cierres_turno SET PurgaProgramada=DATEADD(DAY,-1,SYSUTCDATETIME()) WHERE Id=@id');
        const purgeKey = randomUUID();
        const purged = await call('post','/api/admin/cierres/:id/purgar',{pin:'2468',confirmacion:'PURGAR DATOS',clave:purgeKey},{id:closed.id});
        assert.equal(purged.status,200,JSON.stringify(purged)); assert.equal(purged.estado,'purgado');
        const remaining = (await pool.request().input('nro',shiftNro).query(`SELECT
            (SELECT COUNT(*) FROM Pedido_control WHERE NroTicket=@nro) Control,
            (SELECT COUNT(*) FROM Pedido_lineas WHERE NroTicket=@nro) LineasAux,
            (SELECT COUNT(*) FROM Impresion_linea_rutas r JOIN Pedido_lineas l ON l.LineaId=r.LineaId WHERE l.NroTicket=@nro) Rutas,
            (SELECT COUNT(*) FROM Cocina_envios WHERE NroTicket=@nro) Envios,
            (SELECT COUNT(*) FROM Impresion_barra_trabajos j JOIN Cocina_envios e ON e.Id=j.EnvioId WHERE e.NroTicket=@nro) Barra,
            (SELECT COUNT(*) FROM Cocina_estados WHERE NroTicket=@nro) Estados,
            (SELECT COUNT(*) FROM Ticket_c WHERE NroTicket=@nro) Comercial,
            (SELECT COUNT(*) FROM Ticket_d WHERE NroTicket=@nro) DetalleComercial,
            (SELECT COUNT(*) FROM Cocina_pedidos) Legacy`)).recordset[0];
        assert.deepEqual(remaining,{Control:0,LineasAux:0,Rutas:0,Envios:0,Barra:0,Estados:0,Comercial:1,DetalleComercial:1,Legacy:1});
        const repeatedPurge = await call('post','/api/admin/cierres/:id/purgar',{pin:'2468',confirmacion:'PURGAR DATOS',clave:purgeKey},{id:closed.id});
        assert.equal(repeatedPurge.status,200); assert.equal(repeatedPurge.idempotente,true);
        if(previousPin===undefined) delete process.env.MAINTENANCE_PIN_HASH; else process.env.MAINTENANCE_PIN_HASH=previousPin;
        passed++; console.log('✓ kitchen state 4 is visible; shift archive, lock, retention purge and idempotency preserve commercial/legacy tables');
        console.log(`${passed} SQL integration scenarios passed.`);
    } finally {
        sql.Request.prototype.query = originalQuery; sql.Request.prototype.input = originalInput;
        // Only objects inside the generated test schema are eligible for cleanup.
        for (const table of ['Cierre_turno_operaciones','Cierre_turno_archivos','Cierres_turno','Impresion_barra_trabajos','Impresion_trabajos','Cocina_estados','Cocina_pedidos','Cocina_pedidos_legacy','Cocina_envio_detalles','Cocina_envios','Impresion_linea_rutas','Pedido_lineas','Pedido_control','Web_sessions','Ticket_d','Ticket_c','Mesas','Productos','Lineas','Empleados','Valores','Tablas','Migrations']) {
            await pool.request().query(`IF OBJECT_ID('[${schema}].[${table}]') IS NOT NULL DROP TABLE [${schema}].[${table}]`);
        }
        await pool.request().query(`DROP SCHEMA [${schema}]`); await pool.close();
        console.log('SQL integration: fixture schema removed.');
    }
}
main().catch(e => { console.error(e.stack || e.message); process.exitCode=1; });
