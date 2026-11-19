'use strict';
// Fase 78: turno activo por empresa desde Tablas (n_codtabla = 201, «Cierre empresa»).
// `conversion` indica el último turno cerrado; el POS solo permite el turno contrario.
const { normalizeCompany } = require('./company-context');

// Etiqueta visible -> número de turno grabado en Ticket_c.Turno.
// Mantener sincronizado con getTurnoValue() en public/script.js.
const TURN_LABELS = Object.freeze({
    2: Object.freeze({ manana: 2, 'tarde-noche': 1 }),
    4: Object.freeze({ manana: 1, 'tarde-noche': 2 }),
    6: Object.freeze({ manana: 1, 'tarde-noche': 2 })
});
const LABEL_TEXT = Object.freeze({ manana: 'Mañana', 'tarde-noche': 'Tarde-Noche' });
const COMPANY_NAMES = Object.freeze({ 2: 'Cocineria', 4: 'Mar Picante 1', 6: 'Inversiones Abruzzo SAC' });
const ACTIVE_SHIFT_SQL = 'SELECT conversion FROM Tablas WHERE n_codtabla=201 AND n_numero=@numero';

function shiftError(message, status, errorCode) {
    const error = new Error(message); error.status = status; error.errorCode = errorCode;
    return error;
}

function labelFor(empresa, turno) {
    const labels = TURN_LABELS[normalizeCompany(empresa).empresa];
    return Object.keys(labels).find(label => labels[label] === Number(turno)) || null;
}

function activeShiftFromConversion(empresa, conversion) {
    const company = normalizeCompany(empresa).empresa;
    const value = conversion == null ? NaN : Number(conversion);
    if (value !== 1 && value !== 2) {
        throw shiftError('No se pudo determinar el turno activo de la empresa. Revise Tablas 201.', 503, 'SHIFT_CONFIG_INVALID');
    }
    const turno = value === 1 ? 2 : 1;
    const etiqueta = labelFor(company, turno);
    return { empresa: company, empresaNombre: COMPANY_NAMES[company], conversion: value, turno, etiqueta,
        etiquetaTexto: LABEL_TEXT[etiqueta] };
}

// `execute(text, values)` debe devolver el resultado de mssql (con recordset).
async function readActiveShift(execute, empresa) {
    const company = normalizeCompany(empresa).empresa;
    const result = await execute(ACTIVE_SHIFT_SQL, { numero: company });
    const row = result?.recordset?.[0];
    return activeShiftFromConversion(company, row ? row.conversion : null);
}

function assertActiveShift(active, requestedTurno) {
    if (Number(requestedTurno) !== active.turno) {
        throw shiftError(`El turno activo de ${active.empresaNombre} es ${active.etiquetaTexto}. Actualice el mapa antes de crear el pedido.`,
            409, 'SHIFT_NOT_ACTIVE');
    }
}

module.exports = { TURN_LABELS, LABEL_TEXT, ACTIVE_SHIFT_SQL, labelFor, activeShiftFromConversion, readActiveShift, assertActiveShift };
