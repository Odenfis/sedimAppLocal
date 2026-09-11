'use strict';
const { query, transaction } = require('./orders');
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
    async function tick() {
        try {
            // Hold a session-independent transaction application lock through transmission.
            // Prevents a second app instance from transmitting another job concurrently.
            const printed = await transaction(async db => {
                const r = (await query(db, `DECLARE @r INT; EXEC @r=sp_getapplock @Resource='sedim-printer',@LockMode='Exclusive',@LockOwner='Transaction',@LockTimeout=0; SELECT @r result;`)).recordset[0];
                if (r.result < 0) return;
                const recovered = await query(db, "UPDATE Impresion_trabajos SET Estado='incierto',Error=N'Servicio interrumpido durante transmisión',Actualizado=SYSUTCDATETIME() WHERE Estado='procesando'");
                const job = (await query(db, `SELECT TOP 1 * FROM Impresion_trabajos
                    WHERE Estado='en_cola' AND ProximoIntento<=SYSUTCDATETIME() ORDER BY Fecha,Id`)).recordset[0];
                if (!job) return recovered.rowsAffected[0] ? { type: 'impresion_updated' } : undefined;
                // Durable claim is separate: if the process dies, this row remains procesando.
                await transaction(claim => query(claim, `UPDATE Impresion_trabajos SET Estado='procesando',Intentos=Intentos+1,Actualizado=SYSUTCDATETIME() WHERE Id=@id`, { id: job.Id }));
                let state = 'enviado', error = null;
                try { const result = await transport.send(job.Documento, config); if (!result?.transmitted) throw new Error('Resultado de transmisión no confirmado'); }
                catch (e) { state = classifyFailure(e, job.Intentos + 1); error = String(e.message).slice(0, 1000); }
                await query(db, `UPDATE Impresion_trabajos SET Estado=@state,Error=@error,Actualizado=SYSUTCDATETIME(),ProximoIntento=DATEADD(SECOND,10,SYSUTCDATETIME()) WHERE Id=@id`, { id: job.Id, state, error });
                return { type: 'impresion_updated', envioId: job.EnvioId, estado: state };
            });
            if (printed) notify(printed);
        } catch (e) { console.error('Cola de impresión:', e.message); }
        if (!stopped) timer = setTimeout(tick, intervalMs);
    }
    tick();
    return () => { stopped = true; clearTimeout(timer); };
}
module.exports = { startPrintWorker, classifyFailure };
