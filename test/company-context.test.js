'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCompany } = require('../lib/company-context');
const { selectedCompany } = require('../scripts/diagnose-pos-context');

test('normaliza únicamente las representaciones públicas válidas de empresa', () => {
    for (const [value, expected, table] of [[2,2,1],['2',2,1],['02',2,1],[4,4,2],['04',4,2],[6,6,5],['06',6,5]]) {
        const result = normalizeCompany(value);
        assert.equal(result.empresa, expected);
        assert.equal(result.numeroTabla, table);
    }
    assert.equal(normalizeCompany(' 02 ').empresa, 2);
});

test('rechaza valores ambiguos con contrato INVALID_COMPANY', () => {
    for (const value of ['', null, undefined, {}, [], NaN, 0, 3, '2.0', '002']) {
        assert.throws(() => normalizeCompany(value), error => error.status === 400 && error.errorCode === 'INVALID_COMPANY');
    }
});

test('el diagnóstico POS reutiliza el catálogo canónico', () => {
    assert.equal(selectedCompany([]).empresa, 2);
    assert.equal(selectedCompany(['--empresa=04']).numeroTabla, 2);
    assert.throws(() => selectedCompany(['--empresa=3']), error => error.errorCode === 'INVALID_COMPANY');
});
