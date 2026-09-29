'use strict';

const COMPANIES = Object.freeze({
    2: Object.freeze({ empresa: 2, codigo: '02', numeroTabla: 1 }),
    4: Object.freeze({ empresa: 4, codigo: '04', numeroTabla: 2 }),
    6: Object.freeze({ empresa: 6, codigo: '06', numeroTabla: 5 })
});

function invalidCompany() {
    const error = new Error('Empresa inválida');
    error.status = 400;
    error.errorCode = 'INVALID_COMPANY';
    return error;
}

function normalizeCompany(value) {
    if (typeof value !== 'number' && typeof value !== 'string') throw invalidCompany();
    const raw = typeof value === 'string' ? value.trim() : String(value);
    if (!/^(?:2|02|4|04|6|06)$/.test(raw)) throw invalidCompany();
    const company = COMPANIES[Number(raw)];
    if (!company) throw invalidCompany();
    return company;
}

module.exports = { COMPANIES, normalizeCompany };
