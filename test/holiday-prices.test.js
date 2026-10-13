'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePrice, preserveLinePrice, assertPriceVersion, priceProjection } = require('../lib/holiday-prices');
const { unitPrice, amounts } = require('../public/order-math');
const { normalizeItems, snapshot } = require('../lib/order-domain');
const { buildPOSProductsQuery } = require('../server');

test('las seis tarifas seleccionan exclusivamente su columna y conservan el precio normal', () => {
    for (let tarifa = 1; tarifa <= 6; tarifa++) {
        const config = { activo: true, tarifa, version: 7 };
        assert.equal(priceProjection(config, true), `R.PreTema${tarifa} PrecioTarifa`);
        assert.deepEqual(resolvePrice({ PventaMa: 10, PrecioTarifa: 20 + tarifa }, config), {
            PrecioBaseEfectivo: 20 + tarifa, precioOrigen: { tipo: 'feriado', tarifa }, precioVersion: 7
        });
        for (const PrecioTarifa of [null, undefined, 0, -1, NaN]) {
            assert.deepEqual(resolvePrice({ PventaMa: 10, PrecioTarifa }, config), {
                PrecioBaseEfectivo: 10, precioOrigen: { tipo: 'normal', tarifa: null }, precioVersion: 7
            });
        }
        assert.equal(resolvePrice({ PventaMa: 10, PrecioTarifa: 25 }, { ...config, activo: false }).PrecioBaseEfectivo, 10);
    }
    assert.throws(() => priceProjection({ tarifa: '1;DROP' }, true));
});

test('tarifas base usan IGV, exentos y el redondeo compartido; el manual final mantiene prioridad', () => {
    const { PrecioBaseEfectivo: base } = resolvePrice({ PventaMa: 10, PrecioTarifa: 20.1234 }, { activo: true, tarifa: 1, version: 1 });
    assert.equal(unitPrice(base, 1, 10.5), 22.24);
    assert.equal(unitPrice(base, 0, 10.5), 20.12);
    assert.equal(unitPrice(base, 1, 10.5, 15), 15);
    assert.equal(unitPrice(base, 1, 10.5, 0), 0);
    assert.deepEqual(amounts([{ codPro: '02001', precio: base, afecto: 1, cantidad: 2 }], 10.5), [44.48]);
});

test('precios guardados e históricos no se recalculan y no entran al snapshot de Cocina', () => {
    const source = { codPro: '02001', precio: 12, precioOrigen: { tipo: 'feriado', tarifa: 2 }, precioVersion: 3 };
    const next = { codPro: '02001', precio: 20, precioDerivadaDe: 'source' };
    preserveLinePrice(next, source);
    assert.equal(next.precio, 12); assert.deepEqual(next.precioOrigen, source.precioOrigen);
    assert.equal(next.precioVersion, 3); assert.equal(next.precioDerivadaDe, undefined);
    assert.equal(snapshot(next).precioOrigen, undefined);
    const legacy = {}; preserveLinePrice(legacy, { precio: 9 }); assert.deepEqual(legacy, { precio: 9 });
});

test('solo nuevas selecciones deben coincidir con la versión vigente; metadatos arbitrarios no se aceptan', () => {
    assert.doesNotThrow(() => assertPriceVersion({}, { version: 0 }));
    assert.doesNotThrow(() => assertPriceVersion({ precioVersion: 3 }, { version: 3 }));
    assert.throws(() => assertPriceVersion({ precioVersion: 2 }, { version: 3 }), e => e.status === 409 && e.errorCode === 'PRICE_CONFIG_CHANGED');
    const line = normalizeItems([{ codPro: '02001', nombre: 'Arroz', precio: 20, cantidad: 1,
        precioOrigen: { tipo: 'feriado', tarifa: 5 }, precioVersion: 2, precioDerivadaDe: 'not-a-uuid' }])[0];
    assert.equal(line.precioOrigen, undefined); assert.equal(line.precioVersion, 2); assert.equal(line.precioDerivadaDe, undefined);
});

test('catálogo mantiene filtros y tolera ausencia de Precios sin referenciarla', () => {
    const config = { activo: false, tarifa: 1, version: 0 };
    const normal = buildPOSProductsQuery({ empresa: '02', priceConfig: config, pricesAvailable: false });
    assert.doesNotMatch(normal, /JOIN Precios/); assert.match(normal, /CAST\(NULL AS MONEY\)/);
    const holiday = buildPOSProductsQuery({ empresa: '02', priceConfig: { ...config, activo: true }, pricesAvailable: true });
    assert.match(holiday, /LEFT JOIN Precios R/); assert.match(holiday, /COLLATE DATABASE_DEFAULT/);
    assert.match(holiday, /P\.Eliminado = 0 AND P\.Tipo = 3/);
});
