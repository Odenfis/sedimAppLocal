'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { barConfig, validateConfig } = require('../scripts/diagnose-bar-printer');

test('diagnóstico de Barra acepta la configuración RPT004 acordada', () => {
    const config = barConfig({ BAR_PRINTER_ENABLED:'true', BAR_PRINTER_HOST:'192.168.1.180', BAR_PRINTER_PROTOCOL:'escpos_tcp',
        BAR_PRINTER_PORT:'9100', BAR_PRINTER_TIMEOUT_MS:'5000', BAR_PRINTER_CODEPAGE:'cp850', BAR_PRINTER_CUT:'true' });
    assert.deepEqual(validateConfig(config), []);
    assert.equal(config.cut, true);
});

test('diagnóstico rechaza host ausente, protocolo incorrecto y puerto inválido', () => {
    const config = barConfig({ BAR_PRINTER_ENABLED:'false', BAR_PRINTER_PROTOCOL:'usb', BAR_PRINTER_PORT:'70000' });
    const errors = validateConfig(config).join(' | ');
    assert.match(errors,/ENABLED/); assert.match(errors,/HOST/); assert.match(errors,/PROTOCOL/); assert.match(errors,/PORT/);
});
