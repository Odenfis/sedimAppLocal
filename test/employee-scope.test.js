'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { isMarketplaceTable, isDiscardGiftsTable, employeeEligibilitySql, employeeCompanyMatchSql } = require('../lib/employee-scope');

test('el alcance de plataformas solo cubre mesas 220–230 de Empresa 2', () => {
    for (const mesa of [220, 225, 230]) assert.equal(isMarketplaceTable(2, mesa), true);
    for (const mesa of [219, 231]) assert.equal(isMarketplaceTable(2, mesa), false);
    assert.equal(isMarketplaceTable(4, 220), false);
    assert.equal(isMarketplaceTable(6, 230), false);
});

test('las condiciones SQL separan plataformas y mozos normales', () => {
    assert.equal(employeeEligibilitySql(2, 220), 'Empresa=@empresa AND FecCese IS NULL AND Codemp IN (195,203)');
    assert.equal(employeeEligibilitySql(2, 230), 'Empresa=@empresa AND FecCese IS NULL AND Codemp IN (195,203)');
    assert.equal(employeeEligibilitySql(2, 219), 'Empresa=@empresa AND FecCese IS NULL AND Tipo=3 AND Codemp NOT IN (195,203)');
    assert.equal(employeeEligibilitySql(4, 220), 'Empresa=@empresa AND FecCese IS NULL AND Tipo=3 AND Codemp NOT IN (195,203)');
});


test('Descarte y obsequios no limita empresa, tipo ni cese en 231–235 de las tres empresas', () => {
    for (const empresa of [2, '04', 6]) for (const mesa of [231, 233, 235]) {
        assert.equal(isDiscardGiftsTable(empresa, mesa), true);
        assert.equal(employeeEligibilitySql(empresa, mesa), '1=1');
    }
    for (const mesa of [230, 236, 231.5, null, 'invalid']) assert.equal(isDiscardGiftsTable(2, mesa), false);
    assert.equal(isDiscardGiftsTable(3, 231), false);
    assert.equal(employeeEligibilitySql(2, 230), 'Empresa=@empresa AND FecCese IS NULL AND Codemp IN (195,203)');
    assert.equal(employeeEligibilitySql(2, 236), 'Empresa=@empresa AND FecCese IS NULL AND Tipo=3 AND Codemp NOT IN (195,203)');
    assert.equal(employeeEligibilitySql(4, 230), 'Empresa=@empresa AND FecCese IS NULL AND Tipo=3 AND Codemp NOT IN (195,203)');
});


test('resolución de nombre conserva empresa fuera de Descarte y obsequios', () => {
    assert.equal(employeeCompanyMatchSql('em.Empresa', 'pc.Empresa', 't.NroMesa'),
        '(em.Empresa=pc.Empresa OR (pc.Empresa IN (2,4,6) AND t.NroMesa BETWEEN 231 AND 235))');
    assert.equal(employeeCompanyMatchSql('e.Empresa', '@empresa', '@mesa'),
        '(e.Empresa=@empresa OR (@empresa IN (2,4,6) AND @mesa BETWEEN 231 AND 235))');
});
