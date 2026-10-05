const test = require('node:test');
const assert = require('node:assert/strict');
const { unitPrice, amounts } = require('../public/order-math');

test('unitario final conserva IGV y redondeo independientemente de cantidad', () => {
    for (const cantidad of [1,2,3]) {
        const line = {codPro:'02055',precio:11.82,afecto:1,cantidad};
        assert.equal(unitPrice(line.precio,line.afecto,10.5),13.06);
        assert.deepEqual(amounts([line],10.5),[13.06 * cantidad]);
    }
    assert.equal(unitPrice(20,1,10.5),22.1);
    assert.equal(unitPrice(20,true,18),23.6);
    assert.equal(unitPrice(20,0,18),20);
    assert.equal(unitPrice(0,1,18),0);
});

test('fracciones distribuyen centavos sin derivar el unitario del importe', () => {
    const line = {codPro:'02055',precio:11.82,afecto:1,cantidad:.01};
    assert.deepEqual(amounts([line,{...line,nota:'Sin sal'}],10.5),[.13,.13]);
    assert.equal(unitPrice(line.precio,line.afecto,10.5),13.06);
    assert.notEqual(.13 / .01,13.06);
    const variant = {codPro:'02056',precio:.5,afecto:0,cantidad:.01};
    assert.deepEqual(amounts([variant,{...variant,nota:'Otra'}],10.5),[.01,0]);
});

const { normalizeItems, normalizeManualPrice, changes, snapshot, validateEdits } = require('../lib/order-domain');
test('manual final price bypasses tax, preserves zero and allocates note fractions independently', () => {
    const line = { codPro: '02001', precio: 20, afecto: 1, cantidad: 2, precioManualFinal: 15 };
    for (const pct of [0, 10.5, 18]) {
        assert.equal(unitPrice(20, 1, pct, 15), 15);
        assert.deepEqual(amounts([line], pct), [30]);
    }
    assert.equal(unitPrice(20, 0, 18, 15), 15);
    assert.deepEqual(amounts([{...line, precioManualFinal:0}],18),[0]);
    assert.deepEqual(amounts([{...line,cantidad:.01,precioManualFinal:.5},{...line,cantidad:.01,precioManualFinal:.5},
        {...line,cantidad:1,precioManualFinal:null}],10.5),[.01,0,22.1]);
});
test('manual price validation and normalization preserve omitted versus null', () => {
    for (const mesa of [201,209,210,219,220,230]) assert.equal(normalizeManualPrice(15,mesa),15);
    for (const mesa of [200,231,235,236]) assert.throws(()=>normalizeManualPrice(15,mesa),{errorCode:'MANUAL_PRICE_NOT_ALLOWED'});
    for (const value of ['', '15', true, -1, NaN, Infinity, 1.001, 1000000000])
        assert.throws(()=>normalizeManualPrice(value,201),{errorCode:'INVALID_MANUAL_PRICE'});
    assert.equal(normalizeManualPrice(999999999,201),999999999);
    const line={codPro:'02001',nombre:'Producto',precio:20,cantidad:1};
    assert.equal(Object.hasOwn(normalizeItems([line])[0],'precioManualFinal'),false);
    assert.equal(normalizeItems([{...line,precioManualFinal:null}])[0].precioManualFinal,null);
});
test('commercial-only price edits do not create kitchen changes', () => {
    const old={lineaId:'test',codPro:'02001',nombre:'Producto',precio:20,cantidad:1,notasRapidas:[],nota:''};
    const line={...old,precioManualFinal:15,enviada:snapshot(old)};
    assert.deepEqual(changes([line]),[]);
    assert.doesNotThrow(()=>validateEdits([{...old,pendienteId:"pending"}],[line]));
});
