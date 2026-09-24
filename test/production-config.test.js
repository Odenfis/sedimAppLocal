'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server');

function withEnv(values, fn) {
    const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    Object.assign(process.env, values);
    try { return fn(); } finally {
        for (const [key, value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key] = value;
    }
}

test('configuración de producción rechaza secretos débiles y acepta variables completas', () => {
    const base = { DB_USER: 'db', DB_PASS: 'pass', DB_SERVER: 'host', DB_NAME: 'sedim', PRINTER_ENABLED: 'false' };
    withEnv({ ...base, SESSION_SECRET: 'secret' }, () => assert.throws(app.validateProductionConfig, /32 caracteres/));
    withEnv({ ...base, SESSION_SECRET: 'reemplace_con_un_valor_aleatorio_de_32_caracteres_o_mas' }, () => assert.throws(app.validateProductionConfig, /32 caracteres/));
    withEnv({ ...base, SESSION_SECRET: '12345678901234567890123456789012' }, () => assert.doesNotThrow(app.validateProductionConfig));
});

test('capacidades reflejan exclusivamente configuración operativa completa', () => {
    withEnv({ PRINTER_ENABLED: 'false', PRINTER_HOST: '', BAR_PRINTER_ENABLED: 'false', BAR_PRINTER_HOST: '', MAINTENANCE_PIN_HASH: '' }, () =>
        assert.deepEqual(app.features(), { printerEnabled: false, barPrinterEnabled: false, closuresEnabled: false }));
    withEnv({ PRINTER_ENABLED: 'true', PRINTER_HOST: '192.168.1.50', BAR_PRINTER_ENABLED: 'true', BAR_PRINTER_HOST: '192.168.1.180', MAINTENANCE_PIN_HASH: 'hash' }, () =>
        assert.deepEqual(app.features(), { printerEnabled: true, barPrinterEnabled: true, closuresEnabled: true }));
});

test('Barra exige host cuando está habilitada', () => {
    const base = { DB_USER: 'db', DB_PASS: 'pass', DB_SERVER: 'host', DB_NAME: 'sedim', PRINTER_ENABLED: 'false',
        SESSION_SECRET: '12345678901234567890123456789012' };
    withEnv({ ...base, BAR_PRINTER_ENABLED: 'true', BAR_PRINTER_HOST: '' }, () =>
        assert.throws(app.validateProductionConfig, /BAR_PRINTER_HOST/));
});

test('configuración de pool rechaza límites inválidos', () => {
    const base = { DB_USER: 'db', DB_PASS: 'pass', DB_SERVER: 'host', DB_NAME: 'sedim', PRINTER_ENABLED: 'false',
        SESSION_SECRET: '12345678901234567890123456789012' };
    withEnv({ ...base, DB_POOL_MIN: '8', DB_POOL_MAX: '4' }, () => assert.throws(app.validateProductionConfig, /DB_POOL_MAX/));
    withEnv({ ...base, DB_POOL_MIN: '2', DB_POOL_MAX: '20', DB_REQUEST_TIMEOUT_MS: 'rápido' }, () => assert.throws(app.validateProductionConfig, /DB_REQUEST_TIMEOUT_MS/));
});
