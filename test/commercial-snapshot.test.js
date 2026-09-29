'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalCommercial, compareCommercial } = require('../lib/commercial-snapshot');

test('instantánea comercial ignora orden, espacios y representación decimal', () => {
    const expected = JSON.stringify([
        { codPro: '02002', nombre: 'Bebida', cantidad: 1, precio: 8, descuento: 0, importe: 8.84 },
        { codPro: '02001', nombre: 'Arroz', cantidad: 2, precio: 44.2, descuento: 0, importe: 44.2 }
    ]);
    const current = [
        { Codpro: '02001   ', Descripcion: 'Arroz   ', Cantidad: '2.00', Precio: '44.2000', Descuento: null, Importe: 44.2 },
        { Codpro: '02002', Descripcion: 'Bebida', Cantidad: 1, Precio: 8, Descuento: 0, Importe: '8.8400' }
    ];
    assert.equal(compareCommercial(expected, current).status, 'ok');
    assert.deepEqual(canonicalCommercial(expected), canonicalCommercial(current));
});

test('instantánea comercial detecta cambios reales y JSON inválido', () => {
    const base = [{ codPro: '02001', nombre: 'Arroz', cantidad: 1, precio: 22.1, descuento: 0, importe: 22.1 }];
    assert.equal(compareCommercial(base, [{ ...base[0], cantidad: 2 }]).code, 'COMMERCIAL_CONFLICT');
    assert.equal(compareCommercial('{no-json', base).code, 'COMMERCIAL_SNAPSHOT_INVALID');
});
