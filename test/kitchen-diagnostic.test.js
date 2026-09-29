'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectedCompany, EXPECTED_MIGRATIONS, EXPECTED_INDEXES } = require('../scripts/diagnose-kitchen-performance');

test('diagnóstico de Cocina limita la empresa y verifica migraciones e índices auxiliares', () => {
    assert.equal(selectedCompany([]), 2);
    assert.equal(selectedCompany(['--empresa=4']), 4);
    assert.throws(() => selectedCompany(['--empresa=3']), /empresa=2/);
    assert.deepEqual(EXPECTED_MIGRATIONS, ['007_performance_indexes.sql', '009_beverage_printing.sql']);
    assert.ok(EXPECTED_INDEXES.includes('IX_Cocina_estados_activos'));
    assert.ok(EXPECTED_INDEXES.includes('IX_Impresion_trabajo_destinos_destino'));
});
