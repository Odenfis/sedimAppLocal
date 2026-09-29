'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const KitchenSnapshotStore = require('../lib/kitchen-snapshot-store');

const retryable = error => ({ retryable: error?.code === 'ETIMEOUT', kind: error?.code === 'ETIMEOUT' ? 'sql_timeout' : 'unexpected' });

test('consolida lecturas concurrentes por empresa y reutiliza la instantánea vigente', async () => {
    let loads = 0, release;
    const store = new KitchenSnapshotStore({ classifyError: retryable });
    const loader = () => new Promise(resolve => { loads++; release = resolve; });
    const first = store.read(2, loader, 'one');
    const second = store.read(2, loader, 'two');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(loads, 1);
    release({ success: true, pedidos: [{ nroTicket: 'T001-1' }] });
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a.pedidos, b.pedidos);
    assert.equal(a.sincronizacion.desactualizado, false);
    await store.read(2, loader, 'three');
    assert.equal(loads, 1);
});

test('mantiene empresas independientes y sirve el último tablero ante un timeout', async () => {
    let now = 1000;
    const store = new KitchenSnapshotStore({ ttlMs: 100, now: () => now, classifyError: retryable });
    await store.read(2, async () => ({ success: true, pedidos: [{ nroTicket: 'T001-1' }] }), 'fresh-2');
    await store.read(4, async () => ({ success: true, pedidos: [{ nroTicket: 'T002-1' }] }), 'fresh-4');
    store.invalidate(2);
    const stale = await store.read(2, async () => { const error = new Error('timeout'); error.code = 'ETIMEOUT'; throw error; }, 'diag-45');
    assert.equal(stale.pedidos[0].nroTicket, 'T001-1');
    assert.deepEqual(stale.sincronizacion, { desactualizado: true, actualizadaEn: new Date(1000).toISOString(), diagnosticId: 'diag-45' });
    const other = await store.read(4, async () => ({ success: true, pedidos: [] }), 'current-4');
    assert.equal(other.pedidos[0].nroTicket, 'T002-1');
});

test('sin instantánea previa propaga el timeout y no oculta errores inesperados', async () => {
    const store = new KitchenSnapshotStore({ classifyError: retryable });
    const timeout = new Error('timeout'); timeout.code = 'ETIMEOUT';
    await assert.rejects(store.read(2, async () => { throw timeout; }, 'first'), timeout);
    await store.read(2, async () => ({ success: true, pedidos: [] }), 'ok');
    store.invalidate(2);
    await assert.rejects(store.read(2, async () => { throw new Error('bug'); }, 'bug'), /bug/);
});

test('una invalidación durante la lectura descarta el resultado anterior y consulta la generación nueva', async () => {
    let loads = 0, releaseFirst;
    const store = new KitchenSnapshotStore({ classifyError: retryable });
    const loader = () => {
        loads++;
        if (loads === 1) return new Promise(resolve => { releaseFirst = resolve; });
        return Promise.resolve({ success: true, pedidos: [{ nroTicket: 'nuevo' }] });
    };
    const pending = store.read(2, loader, 'race');
    await new Promise(resolve => setImmediate(resolve));
    store.invalidate(2);
    releaseFirst({ success: true, pedidos: [{ nroTicket: 'antiguo' }] });
    const result = await pending;
    assert.equal(loads, 2);
    assert.equal(result.pedidos[0].nroTicket, 'nuevo');
});
