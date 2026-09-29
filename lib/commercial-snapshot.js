'use strict';
const { createHash } = require('node:crypto');

const money = value => Math.round((Number(value || 0) + Number.EPSILON) * 10000) / 10000;
const quantity = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const text = value => String(value ?? '').trim();

function parse(value) {
    if (Array.isArray(value)) return value;
    if (value == null || value === '') return [];
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new TypeError('La instantánea comercial no es una lista');
    return parsed;
}

function canonicalCommercial(value) {
    return parse(value).map(row => ({
        codPro: text(row.codPro ?? row.Codpro ?? row.CodPro),
        nombre: text(row.nombre ?? row.Descripcion ?? row.Nombre),
        cantidad: quantity(row.cantidad ?? row.Cantidad),
        precio: money(row.precio ?? row.Precio),
        descuento: money(row.descuento ?? row.Descuento),
        importe: money(row.importe ?? row.Importe)
    })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function commercialDigest(value) {
    const canonical = canonicalCommercial(value);
    return { canonical, hash: createHash('sha256').update(JSON.stringify(canonical)).digest('hex') };
}

function compareCommercial(expected, current) {
    try {
        const left = commercialDigest(expected), right = commercialDigest(current);
        return { status: left.hash === right.hash ? 'ok' : 'conflict', code: left.hash === right.hash ? null : 'COMMERCIAL_CONFLICT',
            expectedHash: left.hash, currentHash: right.hash, expected: left.canonical, current: right.canonical };
    } catch {
        return { status: 'conflict', code: 'COMMERCIAL_SNAPSHOT_INVALID', expectedHash: null, currentHash: null, expected: [], current: [] };
    }
}

function publicComparison(comparison) {
    return { status: comparison.status, code: comparison.code,
        expectedHash: comparison.expectedHash, currentHash: comparison.currentHash };
}

module.exports = { canonicalCommercial, commercialDigest, compareCommercial, publicComparison };
