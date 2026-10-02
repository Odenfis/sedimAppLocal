const test = require('node:test');
const assert = require('node:assert/strict');
const { isCodeTable, normalizeOrderCode, printText } = require('../lib/order-domain');
const { buildEscPosFrame } = require('../lib/escpos-tcp');
test('referencias: límites, formato y obligatoriedad', () => {
    for (const mesa of [201,209,210,219,220,230]) {
        assert.equal(isCodeTable(mesa), true);
        assert.equal(normalizeOrderCode('  ab-001_X  ', mesa), 'ab-001_X');
        assert.equal(normalizeOrderCode(null, mesa), null);
        assert.throws(() => normalizeOrderCode('', mesa, true), e => e.errorCode === 'ORDER_CODE_REQUIRED');
    }
    for (const mesa of [200,231]) {
        assert.equal(isCodeTable(mesa), false);
        assert.equal(normalizeOrderCode(null, mesa, true), null);
        assert.throws(() => normalizeOrderCode('ABC', mesa), e => e.errorCode === 'INVALID_ORDER_CODE');
    }
    for (const value of ['a b', 'á', 'a\nB', 'a'.repeat(31), 123, {}, 'A!'])
        assert.throws(() => normalizeOrderCode(value, 201), e => e.errorCode === 'INVALID_ORDER_CODE');
    assert.equal(normalizeOrderCode('a'.repeat(30),201), 'a'.repeat(30));
});
test('documentos en todos los destinos capturan referencia sin cambiar históricos', () => {
    for (const empresa of [2,4,6]) for (const title of ['COMANDA DE COCINA','COMANDA DE BEBIDAS','COMANDA DE BARRA']) {
        const head = { empresa, mesa: 201, mozo:'José', nroTicket:'T001-1', numero:1, fecha:'2026-10-02', codigoPedido:'ab-001_X' };
        const doc = printText(head, [], false, title);
        assert.match(doc, /Mesa 201 \/ Mozo José\nCódigo: ab-001_X\n2026/);
        assert.ok(buildEscPosFrame(doc).includes(Buffer.from([0x1b,0x45,1])));
        head.codigoPedido = 'nuevo';
        assert.match(doc, /Código: ab-001_X/);
        assert.doesNotMatch(printText({ ...head, codigoPedido:null },[]), /Código:/);
        assert.doesNotMatch(printText({ ...head, mesa:231 },[]), /Código:/);
    }
});
