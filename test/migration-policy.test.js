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
