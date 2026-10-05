'use strict';
const { randomUUID } = require('node:crypto');
const QUICK_NOTES = ['Sin cebolla', 'Término medio', 'Bien cocido', 'Poco picante', 'Sin picante', 'Hielo aparte', 'Helada', 'Sin Helar', 'Sin azúcar', 'Para llevar', 'Servir primero', 'Con salsa aparte'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(message, status = 400, errorCode = null) {
    const e = new Error(message); e.status = status;
    if (errorCode) e.errorCode = errorCode;
    throw e;
}
function isCodeTable(mesa) { return Number.isInteger(Number(mesa)) && Number(mesa) >= 201 && Number(mesa) <= 230; }
function normalizeOrderCode(value, mesa, required = false) {
    if (value != null && typeof value !== 'string') fail('Código de pedido inválido', 400, 'INVALID_ORDER_CODE');
    const code = (value || '').trim();
    if (code && (!isCodeTable(mesa) || !/^[A-Za-z0-9_-]{1,30}$/.test(code)))
        fail('Use hasta 30 letras, números, guiones o guiones bajos para el código de pedido', 400, 'INVALID_ORDER_CODE');
    if (required && isCodeTable(mesa) && !code) fail('Ingrese el código de pedido antes de enviar', 400, 'ORDER_CODE_REQUIRED');
    return code || null;
}
function clean(value, max) {
    if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b-\x1f\x7f]/.test(value)) fail('Texto inválido o demasiado largo');
    return value.trim();
}
function normalizeManualPrice(value, mesa) {
    if (value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 999999999
        || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001)
        fail('Precio manual inválido: use un importe positivo o cero con hasta dos decimales', 400, 'INVALID_MANUAL_PRICE');
    if (mesa !== undefined && !isCodeTable(mesa)) fail('Esta mesa no permite precios manuales', 400, 'MANUAL_PRICE_NOT_ALLOWED');
    return value;
}
function normalizeItems(items) {
    if (!Array.isArray(items) || items.length > 300) fail('Detalle inválido (máximo 300 líneas)');
    const ids = new Set();
    return items.map((i, orden) => {
        const lineaId = i.lineaId || randomUUID();
        if (!uuid.test(lineaId) || ids.has(lineaId.toLowerCase())) fail('Identificador de línea inválido o duplicado');
        ids.add(lineaId.toLowerCase());
        const cantidad = Number(i.cantidad), precio = Number(i.precio);
        if (!Number.isFinite(cantidad) || cantidad <= 0 || cantidad > 9999999.99 || Math.abs(cantidad * 100 - Math.round(cantidad * 100)) > 0.00001) fail('Cantidad inválida');
        if (!Number.isFinite(precio) || precio < 0 || precio > 999999999) fail('Precio inválido');
        const notasRapidas = i.notasRapidas || [];
        if (!Array.isArray(notasRapidas) || notasRapidas.some(n => !QUICK_NOTES.includes(n))) fail('Notas rápidas inválidas');
        const codPro = clean(i.codPro, 10);
        if (!codPro) fail('Producto requerido');
        return { ...(Object.prototype.hasOwnProperty.call(i, 'precioManualFinal') ? { precioManualFinal: normalizeManualPrice(i.precioManualFinal) } : {}),
            lineaId: lineaId.toLowerCase(), codPro, nombre: clean(i.nombre, 70), cantidad, precio, afecto: i.afecto === true || i.afecto === 1 ? 1 : 0,
            notasRapidas: QUICK_NOTES.filter(n => notasRapidas.includes(n)), nota: clean(i.nota || '', 500), orden };
    });
}
function snapshot(line) {
    if (!line || line.baja) return null;
    return { lineaId: line.lineaId?.toLowerCase(), codPro: line.codPro, nombre: line.nombre, cantidad: line.cantidad,
        notasRapidas: line.notasRapidas || [], nota: line.nota || '' };
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function changes(lines) {
    return lines.flatMap(l => {
        const nueva = snapshot(l), anterior = l.enviada || null;
        return same(nueva, anterior) ? [] : [{ lineaId: l.lineaId, tipo: !anterior ? 'ADICIÓN' : !nueva ? 'ANULACIÓN' : 'CORRECCIÓN', anterior, nueva }];
    });
}
function validateEdits(previous, incoming) {
    const next = new Map(incoming.map(l => [l.lineaId, l]));
    for (const old of previous) {
        const line = next.get(old.lineaId);
        if (old.pendienteId && !same(snapshot(old), snapshot(line))) fail('Cocina debe reconocer la corrección pendiente de esta línea', 409);
        if (line && old.enviada && line.cantidad > old.cantidad) fail('Agregue las unidades adicionales como una nueva línea');
        if (line && old.codPro !== line.codPro) fail('No se puede cambiar el producto de una línea');
    }
}
function printText(envio, movements, reprint = false, title = 'COMANDA DE COCINA') {
    // Plain text is also the persisted document. No printer control bytes from user input.
    const safe = s => String(s ?? '').replace(/[\x00-\x1f\x7f]/g, ' ');
    const wrap = s => {
        const out = []; let row = '';
        for (const word of safe(s).split(/\s+/)) {
            if (row && row.length + word.length + 1 > 42) { out.push(row); row = ''; }
            let rest = word;
            while (rest.length > 42) { if (row) { out.push(row); row = ''; } out.push(rest.slice(0, 42)); rest = rest.slice(42); }
            row += (row ? ' ' : '') + rest;
        }
        if (row) out.push(row);
        return out.join('\n');
    };
    const lines = [wrap(envio.empresaNombre || `Empresa ${envio.empresa}`), wrap(title), reprint ? '*** REIMPRESIÓN ***' : '',
        wrap(`Ticket ${envio.nroTicket} / Envío ${envio.numero}`), wrap(`Mesa ${envio.mesa} / Mozo ${envio.mozo}`), envio.codigoPedido && isCodeTable(envio.mesa) ? wrap(`Código: ${envio.codigoPedido}`) : '', safe(envio.fecha), '-'.repeat(42)];
    const detail = l => [wrap(`${l.cantidad} x ${l.nombre}`), ...[...(l.notasRapidas || []), l.nota].filter(Boolean).map(n => wrap(`  NOTA: ${n}`))];
    for (const m of movements) {
        lines.push(m.tipo);
        if (m.anterior) lines.push('ANTES:', ...detail(m.anterior));
        if (m.nueva) lines.push(m.anterior ? 'AHORA:' : '', ...detail(m.nueva));
        lines.push('-'.repeat(42));
    }
    return lines.filter(Boolean).join('\n') + '\n';
}
module.exports = { normalizeManualPrice, isCodeTable, normalizeOrderCode, QUICK_NOTES, uuid, clean, fail, normalizeItems, snapshot, same, changes, validateEdits, printText };
