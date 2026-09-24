'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyError, errorPayload } = require('../lib/request-context');

test('clasifica timeouts SQL como reintentables y responde 504', () => {
    assert.deepEqual(classifyError({ code: 'ETIMEOUT', message: 'Request timeout' }),
        { status: 504, retryable: true, kind: 'sql_timeout' });
});

test('clasifica desconexiones y deadlocks como indisponibilidad transitoria', () => {
    assert.deepEqual(classifyError({ code: 'ESOCKET', message: 'socket closed' }),
        { status: 503, retryable: true, kind: 'database_unavailable' });
    assert.deepEqual(classifyError({ number: 1205, message: 'deadlock victim' }),
        { status: 503, retryable: true, kind: 'sql_deadlock' });
});

test('un error inesperado no se reintenta automáticamente', () => {
    assert.deepEqual(classifyError(new Error('programming error')),
        { status: 500, retryable: false, kind: 'unexpected' });
});

test('la respuesta clasificada conserva referencia y mensaje operativo', () => {
    const result = errorPayload({ locals: { diagnosticId: 'diag-123' } }, { code: 'ETIMEOUT' });
    assert.equal(result.classification.status, 504);
    assert.deepEqual(result.body, { success: false, message: 'La consulta excedió el tiempo de espera.',
        diagnosticId: 'diag-123', retryable: true });
});
