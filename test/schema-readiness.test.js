'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { REQUIRED_TABLES, REQUIRED_INDEXES, REQUIRED_MIGRATIONS, inspectOperationalSchema, assertOperationalSchema } = require('../lib/schema-readiness');

function poolWith(recordset) {
    return { request: () => ({ query: async source => {
        assert.match(source, /OBJECT_ID/);
        return { recordset };
    } }) };
}

test('la preparación exige objetos e índices de Cocina, Bebidas y Barra', () => {
    assert.ok(REQUIRED_TABLES.includes('Impresion_linea_destinos'));
    assert.ok(REQUIRED_TABLES.includes('Impresion_trabajo_destinos'));
    assert.ok(REQUIRED_TABLES.includes('Impresion_barra_trabajos'));
    assert.ok(REQUIRED_INDEXES.includes('IX_Impresion_trabajo_destinos_destino'));
    assert.ok(REQUIRED_MIGRATIONS.includes('010_repair_beverage_destinations.sql'));
});

test('el esquema completo queda listo y uno incompleto informa solo identificadores técnicos', async () => {
    assert.deepEqual(await inspectOperationalSchema(poolWith([{ Kind:'table',Name:'A',Present:1 }])), { ready:true,missing:[] });
    const incomplete = poolWith([{ Kind:'table',Name:'Impresion_trabajo_destinos',Present:0 }]);
    await assert.rejects(assertOperationalSchema(incomplete), error => {
        assert.equal(error.code, 'ESCHEMA');
        assert.deepEqual(error.missing, ['table:Impresion_trabajo_destinos']);
        return true;
    });
});
