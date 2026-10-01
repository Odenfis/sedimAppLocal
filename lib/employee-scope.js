'use strict';

function isMarketplaceTable(empresa, mesa) {
    const number = Number(mesa);
    return Number(empresa) === 2 && Number.isInteger(number) && number >= 220 && number <= 230;
}

function employeeEligibilitySql(empresa, mesa) {
    return isMarketplaceTable(empresa, mesa)
        ? 'Codemp IN (195,203)'
        : 'Tipo=3 AND Codemp NOT IN (195,203)';
}

module.exports = { isMarketplaceTable, employeeEligibilitySql };
