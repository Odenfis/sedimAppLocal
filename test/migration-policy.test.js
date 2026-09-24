const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateMigration } = require('../migrate');

test('todas las migraciones cumplen la política de aislamiento', () => {
    for (const file of fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter(f => f.endsWith('.sql'))) {
        assert.doesNotThrow(() => validateMigration(fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'), file));
    }
});

test('la política rechaza modificaciones y escrituras a tablas protegidas', () => {
    assert.throws(() => validateMigration('ALTER TABLE Ticket_d ADD X INT', 'bad.sql'));
    assert.throws(() => validateMigration('UPDATE Pedido_control SET Version=1', 'bad.sql'));
    assert.throws(() => validateMigration('INSERT Ticket_d VALUES (1)', 'bad.sql'));
    assert.throws(() => validateMigration('CREATE INDEX ix ON Ticket_d(NroTicket)', 'bad.sql'));
});

test('la migración de rendimiento indexa solo tablas auxiliares', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'migrations', '007_performance_indexes.sql'), 'utf8');
    for (const table of ['Pedido_control', 'Cocina_estados', 'Impresion_trabajos']) assert.match(source, new RegExp(`ON dbo\\.${table}\\(`));
    for (const table of ['Mesas', 'Ticket_c', 'Ticket_d', 'Productos']) assert.doesNotMatch(source, new RegExp(`ON dbo\\.${table}\\(`));
});

test('la migración de Barra es aditiva y no altera tablas comerciales', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'migrations', '008_bar_printing.sql'), 'utf8');
    assert.match(source, /CREATE TABLE dbo\.Impresion_linea_rutas/);
    assert.match(source, /CREATE TABLE dbo\.Impresion_barra_trabajos/);
    for (const table of ['Mesas', 'Ticket_c', 'Ticket_d', 'Productos', 'Tablas', 'Impresion_trabajos']) {
        assert.doesNotMatch(source, new RegExp(`(?:ALTER|CREATE)\\s+TABLE\\s+(?:dbo\\.)?${table}\\b`, 'i'));
    }
});
