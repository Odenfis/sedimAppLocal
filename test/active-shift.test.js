'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const shift = require('../lib/active-shift');

test('Fase 78: conversion 1 permite turno 2 y conversion 2 permite turno 1', () => {
    assert.equal(shift.activeShiftFromConversion(2, 1).turno, 2);
    assert.equal(shift.activeShiftFromConversion('04', 2).turno, 1);
    assert.equal(shift.activeShiftFromConversion('6', 1).turno, 2);
    assert.equal(shift.activeShiftFromConversion(2, '1.00').turno, 2);
});

test('Fase 78: etiquetas por empresa, incluido Abruzzo igual que Mar Picante', () => {
    assert.equal(shift.activeShiftFromConversion(2, 1).etiqueta, 'manana');       // Cocineria: Turno 2 = Mañana
    assert.equal(shift.activeShiftFromConversion(4, 2).etiqueta, 'manana');       // Mar Picante: Turno 1 = Mañana
    assert.equal(shift.activeShiftFromConversion(6, 1).etiqueta, 'tarde-noche');  // Abruzzo: Turno 2 = Tarde-Noche
    assert.equal(shift.activeShiftFromConversion(2, 2).etiqueta, 'tarde-noche');
    assert.deepEqual(shift.TURN_LABELS[6], { manana: 1, 'tarde-noche': 2 });
    assert.equal(shift.labelFor(4, 2), 'tarde-noche');
});

test('Fase 78: conversion ausente o inválida falla cerrado', () => {
    for (const value of [null, undefined, 0, 3, 1.5, 'x']) {
        assert.throws(() => shift.activeShiftFromConversion(2, value), e => e.status === 503 && e.errorCode === 'SHIFT_CONFIG_INVALID');
    }
    assert.throws(() => shift.activeShiftFromConversion(5, 1), e => e.errorCode === 'INVALID_COMPANY');
});

test('Fase 78: consulta estrictamente Tablas 201 con n_numero = código de empresa', async () => {
    const calls = [];
    const execute = async (text, values) => { calls.push({ text, values }); return { recordset: [{ conversion: 2 }] }; };
    const result = await shift.readActiveShift(execute, '04');
    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /FROM Tablas WHERE n_codtabla=201 AND n_numero=@numero/);
    assert.deepEqual(calls[0].values, { numero: 4 });
    assert.equal(result.turno, 1);
    await assert.rejects(shift.readActiveShift(async () => ({ recordset: [] }), 2), e => e.errorCode === 'SHIFT_CONFIG_INVALID');
});

test('Fase 78: un turno distinto al activo se rechaza con 409', () => {
    const active = shift.activeShiftFromConversion(2, 1);
    assert.doesNotThrow(() => shift.assertActiveShift(active, 2));
    for (const turno of [1, '1', null, undefined]) {
        assert.throws(() => shift.assertActiveShift(active, turno),
            e => e.status === 409 && e.errorCode === 'SHIFT_NOT_ACTIVE' && /Cocineria es Mañana/.test(e.message));
    }
});
