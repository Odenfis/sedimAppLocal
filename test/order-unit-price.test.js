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
