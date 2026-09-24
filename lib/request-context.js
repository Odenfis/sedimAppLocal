'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

const storage = new AsyncLocalStorage();
const slowRequestMs = () => Number(process.env.SLOW_REQUEST_MS || 750);

function start(req, res, next) {
    if (!req.path.startsWith('/api/')) return next();
    const started = process.hrtime.bigint();
    const requestId = randomUUID();
    const context = { requestId, sqlCount: 0, sqlMs: 0 };
    res.locals.diagnosticId = requestId;
    res.setHeader('X-Request-Id', requestId);
    storage.run(context, () => {
        res.once('finish', () => {
            const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
            const record = {
                type: elapsedMs >= slowRequestMs() || res.statusCode >= 500 ? 'slow_request' : 'request',
                requestId,
                method: req.method,
                path: req.route?.path || req.path,
                status: res.statusCode,
                elapsedMs: Number(elapsedMs.toFixed(1)),
                sqlCount: context.sqlCount,
                sqlMs: Number(context.sqlMs.toFixed(1))
            };
            try { record.pool = require('../db').poolStats(); } catch {}
            const output = JSON.stringify(record);
            if (record.type === 'slow_request') console.warn(output);
            else console.log(output);
        });
        next();
    });
}

async function measureSql(operation) {
    const context = storage.getStore();
    const started = process.hrtime.bigint();
    try { return await operation(); }
    finally {
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
        if (context) {
            context.sqlCount++;
            context.sqlMs += elapsedMs;
            if (elapsedMs >= slowRequestMs()) console.warn(JSON.stringify({ type: 'slow_sql', requestId: context.requestId,
                ordinal: context.sqlCount, elapsedMs: Number(elapsedMs.toFixed(1)) }));
        }
    }
}

function diagnosticId(res) {
    return res.locals?.diagnosticId || randomUUID();
}

function safeError(error) {
    return {
        name: error?.name,
        code: error?.code,
        number: error?.number,
        state: error?.state,
        class: error?.class,
        message: String(error?.message || error).slice(0, 500)
    };
}

function classifyError(error) {
    const code = String(error?.code || error?.originalError?.code || '').toUpperCase();
    const number = Number(error?.number ?? error?.originalError?.number);
    const message = String(error?.message || '').toLowerCase();
    if (code === 'ETIMEOUT' || /request timeout|query timeout|timeout.*query/.test(message)) {
        return { status: 504, retryable: true, kind: 'sql_timeout' };
    }
    if (number === 1205) return { status: 503, retryable: true, kind: 'sql_deadlock' };
    if (['ESOCKET', 'ECONNCLOSED', 'ENOTOPEN', 'ECONNRESET', 'ECONNREFUSED'].includes(code)
        || /resource request timed out|failed to connect|connection.*closed|socket/.test(message)) {
        return { status: 503, retryable: true, kind: 'database_unavailable' };
    }
    return { status: 500, retryable: false, kind: 'unexpected' };
}

function errorPayload(res, error) {
    const requestId = diagnosticId(res);
    const classification = classifyError(error);
    const message = classification.status === 504 ? 'La consulta excedió el tiempo de espera.'
        : classification.status === 503 ? 'El servidor de datos no está disponible temporalmente.'
            : 'No se pudo completar la operación.';
    return { diagnosticId: requestId, classification,
        body: { success: false, message, diagnosticId: requestId, retryable: classification.retryable } };
}

function currentId() { return storage.getStore()?.requestId || null; }

module.exports = { start, measureSql, diagnosticId, safeError, classifyError, errorPayload, currentId };
