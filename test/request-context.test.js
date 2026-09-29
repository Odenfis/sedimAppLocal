'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyError, errorPayload, safeRequest } = require('../lib/request-context');

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

test('un conflicto de intercalación SQL se identifica sin reintento automático', () => {
    assert.deepEqual(classifyError({ code: 'EREQUEST', number: 468,
        message: 'Cannot resolve the collation conflict in the equal to operation.' }),
    { status: 500, retryable: false, kind: 'sql_collation_conflict', errorCode: 'SQL_COLLATION_CONFLICT' });
});

test('una clave SQL duplicada es un conflicto controlado y no un error 500', () => {
    assert.deepEqual(classifyError({ code: 'EREQUEST', number: 2627, message: 'Violation of PRIMARY KEY constraint' }),
        { status: 409, retryable: false, kind: 'sql_unique_conflict', errorCode: 'SQL_UNIQUE_CONFLICT' });
    const result = errorPayload({ locals: { diagnosticId: 'duplicate-1' } }, { number: 2627 });
    assert.equal(result.body.errorCode, 'SQL_UNIQUE_CONFLICT');
    assert.equal(result.classification.status, 409);
});

test('la respuesta clasificada conserva referencia y mensaje operativo', () => {
    const result = errorPayload({ locals: { diagnosticId: 'diag-123' } }, { code: 'ETIMEOUT' });
    assert.equal(result.classification.status, 504);
    assert.deepEqual(result.body, { success: false, message: 'La consulta excedió el tiempo de espera.', errorCode: 'SQL_TIMEOUT',
        diagnosticId: 'diag-123', retryable: true });
});

test('el contexto seguro registra empresa y mesa sin incluir el detalle del pedido', () => {
    const result = safeRequest({ body: { empresa: { unexpected: true }, mesa: '1', items: [{ nombre: 'secreto' }] }, query: {} });
    assert.deepEqual(result, { company: { type: 'object', value: '[object]' }, table: { type: 'string', value: '1' } });
    assert.equal(JSON.stringify(result).includes('secreto'), false);
});
