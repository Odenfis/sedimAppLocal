/* Fase 22: shared order state. Loaded before script.js; handlers run after both scripts. */
let orderVersion = 0, orderSummary = { pendientes: 0, ultimoEnvio: 0, estado: 'Sin enviar' };
let orderDirty = false, orderConflict = false, orderBusy = false, orderSavePromise = null;
let orderSaveError = '', orderConfirmation = '', orderGeneration = 0, orderSendAttempt = null, orderPrinting = null, orderPrintings = [], orderPendingCancellations = [];
const ownOrderOperations = new Set();
const QUICK_ORDER_NOTES = ['Sin cebolla', 'Término medio', 'Bien cocido', 'Poco picante', 'Sin picante', 'Hielo aparte', 'Helada', 'Sin Helar', 'Sin azúcar', 'Para llevar', 'Servir primero', 'Con salsa aparte'];
function newOrderId() {
    // crypto.randomUUID is unavailable on HTTP LAN origins in some browsers.
    const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const h = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
function escapeOrderText(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function orderLinePending(l) {
    if (!l.enviada) return true;
    return l.cantidad !== l.enviada.cantidad || l.nota !== l.enviada.nota || JSON.stringify(l.notasRapidas || []) !== JSON.stringify(l.enviada.notasRapidas || []);
}
function orderNotes(l) { return [...(l.notasRapidas || []), l.nota || ''].filter(Boolean).join(' · '); }
function orderKitchenStatus(lines) {
    const roundQuantity = value => Math.round((value + Number.EPSILON) * 100) / 100;
    const sent = lines.filter(line => line.enviada && !line.anulada);
    if (!sent.length) return 'Sin enviar';
    const totals = new Map();
    for (const line of sent) {
        const state = Number(line.estadoCocina) || 1;
        totals.set(state, roundQuantity((totals.get(state) || 0) + Number(line.cantidad || 0)));
    }
    const single = { 1: 'Enviado a Cocina', 2: 'En preparación', 3: 'Listo en Cocina', 4: 'Producto Entregado' };
    if (totals.size === 1) return single[totals.keys().next().value] || 'Enviado a Cocina';
    const mixed = {
        1: amount => `${amount} enviado${amount === 1 ? '' : 's'}`,
        2: amount => `${amount} en preparación`,
        3: amount => `${amount} listo${amount === 1 ? '' : 's'}`,
        4: amount => `${amount} entregado${amount === 1 ? '' : 's'}`
    };
    return [...totals.entries()].sort(([a], [b]) => a - b).map(([state, amount]) => (mixed[state] || mixed[1])(amount)).join(' · ');
}
function orderKitchenHeadline(lines) {
    const states = lines.filter(line => line.enviada && !line.anulada).map(line => Number(line.estadoCocina) || 1);
    if (!states.length) return 'Sin enviar';
    if (states.every(state => state >= 4)) return 'Producto Entregado';
    if (states.every(state => state >= 3)) return 'Listo en Cocina';
    if (states.every(state => state >= 2)) return 'En preparación';
    return 'Enviado a cocina';
}
function orderOperation() {
    const id = newOrderId(); ownOrderOperations.add(id);
    if (ownOrderOperations.size > 200) ownOrderOperations.delete(ownOrderOperations.values().next().value);
    return id;
}
async function orderRequest(url, method = 'GET', body) {
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({ message: 'Respuesta no válida del servidor' }));
    if (!res.ok) {
        const reference = data.diagnosticId ? ` Referencia: ${data.diagnosticId}.` : '';
        const e = new Error(`${data.message || 'No se pudo completar la operación'}${reference}`);
        e.status = res.status; e.diagnosticId = data.diagnosticId; e.retryable = data.retryable === true; throw e;
    }
    return data;
}
function orderReset() {
    orderVersion = 0; orderSummary = { pendientes: 0, ultimoEnvio: 0, estado: 'Sin enviar' };
    orderDirty = false; orderConflict = false; orderSaveError = ''; orderConfirmation = ''; orderPrinting = null; orderPrintings = []; orderSendAttempt = null; orderPendingCancellations = [];
    orderGeneration++; clearTimeout(posAutoSaveTimer);
}
function orderAccept(data) {
    if (!data.pedido) return;
    orderVersion = data.version || 0; orderSummary = data.cocina || orderSummary; orderPrinting = data.impresion || null;
    orderPrintings = Array.isArray(data.impresiones) ? data.impresiones : (orderPrinting ? [{ ...orderPrinting, destino: 'cocina' }] : []);
    orderPendingCancellations = data.cocina?.anulaciones || [];
    if (data.nroTicket) posCurrentNroTicket = data.nroTicket;
    for (const l of posCart) {
        const saved = data.items?.find(i => i.lineaId === l.lineaId);
        if (saved) { l.nombre = saved.Descripcion; l.precioBase = Number(saved.Precio); l.afecto = saved.Afecto; l.precio = precioFinalUnitario(l.precioBase, l.afecto); l.enviada = saved.enviada; l.pendienteId = saved.pendienteId; l.estadoCocina = saved.estadoCocina; l.pendienteEnvio = saved.pendienteEnvio; }
    }
    renderOrderStatus();
}
function orderFinishDeletion() {
    clearTimeout(posAutoSaveTimer);
    orderDirty = false; orderConflict = false; orderSaveError = ''; orderConfirmation = ''; orderPrinting = null; orderPrintings = [];
    orderVersion = 0; orderSummary = { pendientes: 0, ultimoEnvio: 0, estado: 'Sin enviar' };
    posCurrentNroTicket = null; posCart = []; posIsReadOnly = false;
    updateCartUI(); showView('pos-tables'); closeCartSheet(); loadPOSTables();
}
function orderPayload() {
    return {
        mesa: posCurrentTable, empresa: posCurrentTableEmpresa, turno: getTurnoValue(posCurrentTableEmpresa, posCurrentTurnoLabel),
        mozo: document.getElementById('pos-mojo-select').value || 1, nroTicket: posCurrentNroTicket,
        version: orderVersion, operacionId: orderOperation(), items: posCart.map(i => ({
            lineaId: i.lineaId, codPro: i.codPro,
            nombre: i.nombre, precio: i.precioBase ?? i.precio, cantidad: i.cantidad, afecto: i.afecto,
            notasRapidas: i.notasRapidas || [], nota: i.nota || ''
        }))
    };
}
function orderSchedule() {
    if (posIsReadOnly || orderBusy) return;
    orderDirty = true; orderGeneration++; orderSaveError = ''; orderConfirmation = ''; clearTimeout(posAutoSaveTimer); updateCartUI();
    posAutoSaveTimer = setTimeout(() => orderFlush().catch(() => { }), POS_AUTOSAVE_DEBOUNCE_MS);
}
async function orderFlush() {
    clearTimeout(posAutoSaveTimer);
    if (orderSavePromise) { await orderSavePromise; if (orderDirty) return orderFlush(); return; }
    if (orderConflict) throw new Error('Revise la versión actual antes de guardar. Su borrador se conserva.');
    if (!posCurrentNroTicket && !posCart.length) { orderDirty = false; return; }
    if (!orderDirty || posIsReadOnly) return;
    const generation = orderGeneration, payload = orderPayload();
    orderSavePromise = (async () => {
        try {
            const data = await orderRequest('/api/pos/pedido', 'POST', payload);
            if (data.pedidoEliminado) { orderFinishDeletion(); return; }
            orderAccept(data); orderDirty = generation !== orderGeneration; orderSaveError = ''; updateCartUI();
        } catch (e) {
            orderSaveError = e.message; if (e.status === 409) orderConflict = true; throw e;
        } finally { orderSavePromise = null; renderOrderStatus(); }
    })();
    await orderSavePromise;
    if (orderDirty) await orderFlush();
}
function renderOrderStatus() {
    const status = document.getElementById('order-kitchen-status'); if (!status) return;
    status.textContent = orderDirty ? (orderSummary.ultimoEnvio ? 'Cambios pendientes' : 'Sin enviar') : orderSummary.estado;
    const msg = document.getElementById('order-save-message');
    msg.textContent = orderSaveError || (orderSavePromise ? 'Guardando…' : orderDirty ? 'Cambios por guardar' : orderConfirmation);
    msg.classList.toggle('is-confirmation', !orderSaveError && !orderSavePromise && !orderDirty && Boolean(orderConfirmation));
    document.getElementById('order-retry-save').hidden = !orderSaveError || orderConflict;
    document.getElementById('order-review-conflict').hidden = !orderConflict;
    const print = document.getElementById('order-print-status');
    const labels = { en_cola: 'En cola de impresión', procesando: 'Transmitiendo a impresora', enviado: 'Enviado a impresora', error: 'Error de impresión', incierto: 'Impresión incierta: revise el papel antes de reimprimir' };
    print.textContent = orderPrintings.map(item => {
        const name = item.destino === 'barra' ? 'Barra' : 'Cocina';
        const state = item.estado || item.Estado, error = item.error || item.Error;
        return `${name}: ${labels[state] || state}${error ? ': ' + error : ''}`;
    }).join(' · ');
    document.getElementById('btn-enviar-cocina').disabled = posIsReadOnly || orderBusy || orderConflict || (!orderDirty && !orderSummary.pendientes && !orderSendAttempt);
    const pay = document.querySelector('.btn-pay-now');
    if (pay) pay.disabled = posIsReadOnly || orderBusy || orderConflict || orderDirty || !!orderSummary.pendientes || !posCart.length;
    document.getElementById('order-envios').disabled = !posCurrentNroTicket || orderBusy;
}
async function orderBeforeOpen() {
    if (orderBusy) return false;
    if (orderDirty || orderSavePromise) {
        try { await orderFlush(); } catch { alert('Hay cambios sin guardar. Reintente o revise el conflicto antes de cambiar de mesa.'); return false; }
    }
    return true;
}
async function sendOrderKitchen() {
    if (orderBusy || posIsReadOnly) return;
    orderBusy = true; renderOrderStatus();
    try {
        await orderFlush();
        const retryKey = `sedim-send:${posCurrentTableEmpresa}:${posCurrentNroTicket}`;
        orderSendAttempt ||= JSON.parse(sessionStorage.getItem(retryKey) || 'null') || { clave: newOrderId(), version: orderVersion };
        sessionStorage.setItem(retryKey, JSON.stringify(orderSendAttempt));
        const data = await orderRequest(`/api/pos/pedido/${encodeURIComponent(posCurrentNroTicket)}/enviar-cocina`, 'POST',
            { ...orderSendAttempt, empresa: posCurrentTableEmpresa, operacionId: orderOperation() });
        sessionStorage.removeItem(retryKey); orderSendAttempt = null; orderAccept(data);
        orderConfirmation = `Envío registrado en Cocina${data.envioId ? ` · ${data.envioId.slice(0, 8)}` : ''}.`;
        updateCartUI();
    } catch (e) { orderSaveError = e.message; if (e.status === 409) { sessionStorage.removeItem(`sedim-send:${posCurrentTableEmpresa}:${posCurrentNroTicket}`); orderSendAttempt = null; orderConflict = true; } }
    finally { orderBusy = false; renderOrderStatus(); }
}
async function orderPay() {
    if (orderBusy || posIsReadOnly) return;
    orderBusy = true; renderOrderStatus();
    try {
        await orderFlush();
        if (orderSummary.pendientes) throw new Error('Envíe los cambios a cocina antes de generar preventa.');
        await orderRequest(`/api/pos/pedido/${encodeURIComponent(posCurrentNroTicket)}/pagar`, 'PUT',
            { empresa: posCurrentTableEmpresa, version: orderVersion, operacionId: orderOperation() });
        posIsReadOnly = true; orderBusy = false; await openPOSOrder(posCurrentTable, posCurrentTableEmpresa);
    } catch (e) { orderSaveError = e.message; if (e.status === 409) orderConflict = true; }
    finally { orderBusy = false; renderOrderStatus(); }
}
async function orderDelete() {
    if (orderBusy || posIsReadOnly || !posCurrentNroTicket) return;
    if (!confirm('Se eliminará el pedido y la mesa quedará libre. El historial previo de Cocina se conservará. ¿Continuar?')) return;
    orderBusy = true;
    try {
        await orderFlush();
        const retryKey = `sedim-cancel:${posCurrentTableEmpresa}:${posCurrentNroTicket}`;
        const attempt = JSON.parse(sessionStorage.getItem(retryKey) || 'null') || { clave: newOrderId(), version: orderVersion };
        sessionStorage.setItem(retryKey, JSON.stringify(attempt));
        const data = await orderRequest(`/api/pos/comanda/${encodeURIComponent(posCurrentNroTicket)}?empresa=${posCurrentTableEmpresa}`, 'DELETE',
            { ...attempt, operacionId: orderOperation() });
        sessionStorage.removeItem(retryKey);
        orderDirty = false;
        alert('Pedido eliminado y mesa liberada.');
        orderBusy = false; orderFinishDeletion();
    } catch (e) { orderSaveError = e.message; } finally { orderBusy = false; renderOrderStatus(); }
}
let noteLineId = null, noteSelection = new Set(), noteReturnFocus;
function openOrderNotes(index) {
    const l = posCart[index]; if (!l || posIsReadOnly || orderBusy || l.pendienteId) return;
    noteLineId = l.lineaId; noteSelection = new Set(l.notasRapidas || []); noteReturnFocus = document.activeElement;
    document.getElementById('order-note-product').textContent = l.nombre;
    document.getElementById('order-note-text').value = l.nota || ''; renderQuickOrderNotes();
    document.getElementById('order-notes-dialog').showModal();
}
function renderQuickOrderNotes() {
    const el = document.getElementById('order-quick-notes'); el.replaceChildren();
    for (const n of QUICK_ORDER_NOTES) {
        const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = (noteSelection.has(n) ? '✓ ' : '+ ') + n;
        btn.setAttribute('aria-pressed', String(noteSelection.has(n)));
        btn.onclick = () => { noteSelection.has(n) ? noteSelection.delete(n) : noteSelection.add(n); renderQuickOrderNotes(); }; el.append(btn);
    }
}
function closeOrderNotes() { document.getElementById('order-notes-dialog').close(); noteReturnFocus?.focus(); }
function saveOrderNotes(clear = false) {
    const l = posCart.find(i => i.lineaId === noteLineId); if (!l || orderBusy || posIsReadOnly || l.pendienteId) return closeOrderNotes();
    l.notasRapidas = clear ? [] : QUICK_ORDER_NOTES.filter(n => noteSelection.has(n));
    l.nota = clear ? '' : document.getElementById('order-note-text').value.trim();
    closeOrderNotes(); updateCartUI(); orderSchedule();
}
function splitOrderLine(index) {
    const l = posCart[index]; if (orderBusy || posIsReadOnly || l.pendienteId || l.enviada) return;
    const amount = Number(prompt(`Cantidad que tendrá instrucciones distintas (menor que ${l.cantidad}):`, '1'));
    if (!Number.isFinite(amount) || amount <= 0 || amount >= l.cantidad || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) return;
    l.cantidad = redondear2(l.cantidad - amount);
    posCart.splice(index + 1, 0, { ...l, lineaId: newOrderId(), cantidad: amount, notasRapidas: [...(l.notasRapidas || [])] });
    updateCartUI(); orderSchedule(); openOrderNotes(index + 1);
}
async function showOrderHistory() {
    try {
        const data = await orderRequest(`/api/pos/pedido/${encodeURIComponent(posCurrentNroTicket)}/envios?empresa=${posCurrentTableEmpresa}`);
        const container = document.getElementById('order-history-content'); container.replaceChildren();
        for (const e of data.envios) {
            const section = document.createElement('section'), h = document.createElement('h3'), pre = document.createElement('pre');
            h.textContent = `Envío ${e.Numero}${e.Historico ? ' · Histórico' : ''}`; pre.textContent = e.Documento; section.append(h, pre);
            for (const j of e.trabajos) { const p = document.createElement('p'); p.textContent = `${j.Destino === 'barra' ? 'Barra' : 'Cocina'}: ${j.Estado} · Intentos: ${j.Intentos}${j.Error ? ' · ' + j.Error : ''}`; section.append(p); }
            for (const destination of ['cocina','barra']) {
                const destinationEnabled = destination === 'cocina' ? APP_FEATURES.printerEnabled : APP_FEATURES.barPrinterEnabled;
                const jobs = e.trabajos.filter(j => (j.Destino || 'cocina') === destination);
                if (!destinationEnabled || !jobs.length) continue;
                const btn = document.createElement('button'); btn.textContent = `Reimprimir ${destination === 'barra' ? 'Barra' : 'Cocina'}`; btn.disabled = jobs.some(j => ['en_cola', 'procesando'].includes(j.Estado));
                let attempt = null;
                btn.onclick = async () => {
                    if (!confirm('Revise si el ticket ya salió. Esta acción imprimirá una copia marcada REIMPRESIÓN.')) return;
                    btn.disabled = true;
                    try { attempt ||= newOrderId(); await orderRequest(`/api/pos/pedido/${encodeURIComponent(posCurrentNroTicket)}/envios/${e.Id}/reimprimir`, 'POST', { empresa: posCurrentTableEmpresa, clave: attempt, destino: destination }); await showOrderHistory(); }
                    catch (err) { alert(err.message); btn.disabled = false; }
                };
                section.append(btn);
            }
            container.append(section);
        }
        if (!data.envios.length) container.textContent = 'Todavía no hay envíos a cocina.';
        const dialog = document.getElementById('order-history-dialog'); if (!dialog.open) dialog.showModal();
    } catch (e) { alert(e.message); }
}
async function reviewOrderConflict() {
    // Preserve the complete draft for explicit comparison. Nothing is overwritten until the user chooses.
    try {
        const data = await orderRequest(`/api/pos/pedido?mesa=${posCurrentTable}&empresa=${posCurrentTableEmpresa}`);
        const format = items => items.map(l => `${l.cantidad ?? l.Cantidad} × ${l.nombre ?? l.Descripcion}\n  ${orderNotes(l)}`).join('\n');
        document.getElementById('order-conflict-local').textContent = format(posCart);
        document.getElementById('order-conflict-server').textContent = format(data.items || []);
        document.getElementById('order-conflict-dialog').showModal();
    } catch (e) { alert(e.message); }
}
async function discardOrderDraft() {
    if (!confirm('¿Descartar el borrador local y cargar la versión actual?')) return;
    document.getElementById('order-conflict-dialog').close(); orderDirty = false; orderConflict = false; orderSaveError = '';
    await openPOSOrder(posCurrentTable, posCurrentTableEmpresa);
}
function kitchenCompany() { return Number(document.getElementById('cocina-empresa-select').value); }
async function acknowledgeKitchenLine(nroTicket, lineaId) {
    try { await orderRequest(`/api/cocina/linea/${lineaId}/reconocer`, 'PUT', { empresa: kitchenCompany(), nroTicket }); await loadCocinaPedidos(true); }
    catch (e) { alert(e.message); }
}

if (typeof window !== 'undefined') window.addEventListener('beforeunload', e => { if (orderDirty || orderSavePromise || orderBusy) { e.preventDefault(); e.returnValue = ''; } });

if (typeof module !== 'undefined') module.exports = { orderKitchenStatus, orderKitchenHeadline };
