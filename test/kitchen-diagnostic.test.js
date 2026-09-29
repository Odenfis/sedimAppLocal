'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { selectedCompany, diagnosticFailure, EXPECTED_TABLES, EXPECTED_MIGRATIONS, EXPECTED_INDEXES } = require('../scripts/diagnose-kitchen-performance');

test('diagnóstico de Cocina limita la empresa y verifica migraciones e índices auxiliares', () => {
    assert.equal(selectedCompany([]), 2);
    assert.equal(selectedCompany(['--empresa=4']), 4);
    assert.throws(() => selectedCompany(['--empresa=3']), /empresa=2/);
    assert.ok(EXPECTED_MIGRATIONS.includes('009_beverage_printing.sql'));
    assert.ok(EXPECTED_MIGRATIONS.includes('010_repair_beverage_destinations.sql'));
    assert.ok(EXPECTED_MIGRATIONS.includes('011_ticket_residue_archive.sql'));
    assert.ok(EXPECTED_TABLES.includes('Impresion_linea_destinos'));
    assert.ok(EXPECTED_INDEXES.includes('IX_Cocina_estados_activos'));
    assert.ok(EXPECTED_INDEXES.includes('IX_Impresion_trabajo_destinos_destino'));
});

test('diagnóstico de Cocina informa código y detalle SQL sin volcar datos', () => {
    assert.equal(diagnosticFailure({ number: 207, message: "Invalid column name 'Cabecera'." }),
        "codigo=207; detalle=Invalid column name 'Cabecera'.");
});
