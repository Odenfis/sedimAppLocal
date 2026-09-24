'use strict';
const { query, transaction } = require('./orders');
const { getPrinterConnection } = require('../db');
// A transport must be installed only after validating the actual printer/manual.
// Contract: async send(document, config) -> { transmitted: true }.
// Errors must explicitly declare beforeTransmission=true to permit automatic retry.
function classifyFailure(error, attempt) {
    return error.beforeTransmission === true ? (attempt < 3 ? 'en_cola' : 'error') : 'incierto';
}
function startPrintWorker({ transport = null, intervalMs = 2000, notify = () => {} } = {}) {
    let stopped = false, timer;
    const config = { host: process.env.PRINTER_HOST, protocol: process.env.PRINTER_PROTOCOL,
        port: Number(process.env.PRINTER_PORT || 9100), timeoutMs: Number(process.env.PRINTER_TIMEOUT_MS || 5000), widthMm: 72,
        codepage: process.env.PRINTER_CODEPAGE || 'cp850', cut: process.env.PRINTER_CUT !== 'false' };
    if (process.env.PRINTER_ENABLED !== 'true' || !transport) {
        console.log('Impresión física deshabilitada: cola persistente disponible; configure y habilite la RPT004.');
        return () => {};
    }
    const staleSeconds = Math.max(30, Math.ceil(config.timeoutMs / 1000) * 2 + 10);
    async function claimJob() {
        return transaction(async db => {
            const lock = (await query(db, `DECLARE @r INT; EXEC @r=sp_getapplock @Resource='sedim-printer-claim',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=0; SELECT @r result;`)).recordset[0];
            if (lock.result < 0) return null;
            await query(db, `UPDATE Impresion_trabajos SET Estado='incierto',Error=N'Servicio interrumpido durante transmisión',Actualizado=SYSUTCDATETIME()
                WHERE Estado='procesando' AND Actualizado<DATEADD(SECOND,-@staleSeconds,SYSUTCDATETIME())`, { staleSeconds });
            const job = (await query(db, `SELECT TOP 1 * FROM Impresion_trabajos WITH(UPDLOCK,READPAST)
                WHERE Estado='en_cola' AND ProximoIntento<=SYSUTCDATETIME()
                AND NOT EXISTS(SELECT 1 FROM Impresion_trabajos WHERE Estado='procesando')
                ORDER BY Fecha,Id`)).recordset[0];
            if (!job) return null;
            await query(db, `UPDATE Impresion_trabajos SET Estado='procesando',Intentos=Intentos+1,Actualizado=SYSUTCDATETIME() WHERE Id=@id`, { id: job.Id });
            job.Intentos++;
            return job;
        }, getPrinterConnection);
    }
    async function tick() {
        try {
            const job = await claimJob();
            if (job) {
                let state = 'enviado', error = null;
                try { const result = await transport.send(job.Documento, config); if (!result?.transmitted) throw new Error('Resultado de transmisión no confirmado'); }
                catch (e) { state = classifyFailure(e, job.Intentos); error = String(e.message).slice(0, 1000); }
                await query(await getPrinterConnection(), `UPDATE Impresion_trabajos SET Estado=@state,Error=@error,Actualizado=SYSUTCDATETIME(),ProximoIntento=DATEADD(SECOND,10,SYSUTCDATETIME()) WHERE Id=@id`,
                    { id: job.Id, state, error });
                notify({ type: 'impresion_updated', envioId: job.EnvioId, estado: state });
            }
        } catch (e) { console.error('Cola de impresión:', e.message); }
        if (!stopped) timer = setTimeout(tick, intervalMs);
    }
    tick();
    return () => { stopped = true; clearTimeout(timer); };
}
module.exports = { startPrintWorker, classifyFailure };
