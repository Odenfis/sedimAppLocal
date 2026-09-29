'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHealthHandler } = require('../lib/health');

function response() {
    return { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
}

test('health responde 200 únicamente con conexión y esquema operativo', async () => {
    let inspected = false;
    const handler = createHealthHandler({ getConnection: async () => ({ id:'pool' }),
        assertOperationalSchema: async pool => { inspected = pool.id === 'pool'; }, logger: () => {} });
    const res = response();
    await handler({}, res);
    assert.equal(inspected, true);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { status:'ok' });
});

test('health responde 503 genérico cuando falta esquema y conserva detalle solo en logs', async () => {
    const logs = [];
    const handler = createHealthHandler({ getConnection: async () => ({}), assertOperationalSchema: async () => {
        const error = new Error('falta tabla privada'); error.code = 'ESCHEMA'; throw error;
    }, logger: message => logs.push(message), safeError: error => ({ code:error.code,message:error.message }) });
    const res = response();
    await handler({}, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, { status:'unavailable' });
    assert.match(logs[0], /falta tabla privada/);
    assert.doesNotMatch(JSON.stringify(res.body), /tabla/);
});
