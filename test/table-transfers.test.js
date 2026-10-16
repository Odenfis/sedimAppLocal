'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { isDiningTable, transferDocument } = require('../lib/table-transfers');
const { validateMigration } = require('../migrate');
test('solo mesas físicas de atención, incluidos desayunos, admiten traslado', () => {
    for (const mesa of [1, 99, 100, 200, '12']) assert.equal(isDiningTable(mesa), true);
    for (const mesa of [0, -1, 1.5, null, '', 201,209,210,219,220,230,231,235,236,999,NaN]) assert.equal(isDiningTable(mesa), false);
});
test('aviso conserva referencia y no contiene productos ni controles de impresora', () => {
    const doc = transferDocument({origen:12,destino:25,nro:'T001-1',mozo:'José\x1bX',usuario:'Mozo\nY',fecha:'15/10/2026'});
    assert.match(doc,/^CAMBIO DE MESA\nTicket T001-1\nMesa 12 -> 25/);
    assert.doesNotMatch(doc,/[\x00-\x09\x0b-\x1f\x7f]/);
    assert.match(doc,/Mozo José X/);
});
test('excepción de migración de traslado permite únicamente campos auxiliares previstos', () => {
    const source = fs.readFileSync(require.resolve('../migrations/014_table_transfers.sql'),'utf8');
    assert.doesNotThrow(()=>validateMigration(source,'014_table_transfers.sql'));
    for (const mutation of ['ALTER TABLE dbo.Ticket_c ADD TrasladoId UNIQUEIDENTIFIER NULL REFERENCES dbo.Pedido_traslados(Id);',
        'ALTER TABLE dbo.Impresion_trabajos DROP COLUMN EnvioId;',
        'ALTER TABLE dbo.Impresion_trabajos ALTER COLUMN Documento NVARCHAR(MAX) NULL;',
        'ALTER TABLE dbo.Impresion_trabajos ADD Otro INT NULL;']) assert.throws(()=>validateMigration(mutation,'014_table_transfers.sql'));
});
