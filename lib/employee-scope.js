'use strict';

function isMarketplaceTable(empresa, mesa) {
    const number = Number(mesa);
    return Number(empresa) === 2 && Number.isInteger(number) && number >= 220 && number <= 230;
}

function isDiscardGiftsTable(empresa, mesa) {
    const number = Number(mesa);
    return [2, 4, 6].includes(Number(empresa)) && Number.isInteger(number) && number >= 231 && number <= 235;
}

function employeeEligibilitySql(empresa, mesa) {
    if (isDiscardGiftsTable(empresa, mesa)) return '1=1';
    const role = isMarketplaceTable(empresa, mesa)
        ? 'Codemp IN (195,203)'
        : 'Tipo=3 AND Codemp NOT IN (195,203)';
    return `Empresa=@empresa AND FecCese IS NULL AND ${role}`;
}

// Expressions are static SQL identifiers supplied by callers, never request values.
function employeeCompanyMatchSql(employeeCompany, orderCompany, orderTable) {
    return `(${employeeCompany}=${orderCompany} OR (${orderCompany} IN (2,4,6) AND ${orderTable} BETWEEN 231 AND 235))`;
}

module.exports = { isMarketplaceTable, isDiscardGiftsTable, employeeEligibilitySql, employeeCompanyMatchSql };
