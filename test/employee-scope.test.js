'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isMarketplaceTable, employeeEligibilitySql } = require('../lib/employee-scope');

test('el alcance de plataformas solo cubre mesas 220–230 de Empresa 2', () => {
    for (const mesa of [220, 225, 230]) assert.equal(isMarketplaceTable(2, mesa), true);
    for (const mesa of [219, 231]) assert.equal(isMarketplaceTable(2, mesa), false);
    assert.equal(isMarketplaceTable(4, 220), false);
    assert.equal(isMarketplaceTable(6, 230), false);
});

test('las condiciones SQL separan plataformas y mozos normales', () => {
    assert.equal(employeeEligibilitySql(2, 220), 'Codemp IN (195,203)');
    assert.equal(employeeEligibilitySql(2, 230), 'Codemp IN (195,203)');
    assert.equal(employeeEligibilitySql(2, 219), 'Tipo=3 AND Codemp NOT IN (195,203)');
    assert.equal(employeeEligibilitySql(4, 220), 'Tipo=3 AND Codemp NOT IN (195,203)');
});
