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

module.exports = { start, measureSql, diagnosticId, safeError };
