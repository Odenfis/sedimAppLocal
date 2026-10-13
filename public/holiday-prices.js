/* Company-wide tariff state. Orders keep their own saved price independently. */
const holidayConfigs = new Map(), holidayLoads = new Map();
let holidayEditorBusy = false, holidayEditorMessage = '', holidayEditorGeneration = 0;
const orderSavedPriceIds = new Set();
let orderPriceConflict = false, holidayReviewGeneration = null;
function holidayCompany() { return document.getElementById('holiday-empresa').value; }
function normalizePriceReferences() {
    // If an unsaved source was removed, promote its descendants to catalog selections.
    // Saved sources can be referenced even when removed from the current draft.
    const ids = new Set(posCart.map(l => l.lineaId));
    for (const line of posCart) if (line.precioDerivadaDe && !ids.has(line.precioDerivadaDe) && !orderSavedPriceIds.has(line.precioDerivadaDe)) delete line.precioDerivadaDe;
}
function renderHolidayIndicators() {
    for (const [id, empresa] of [['holiday-map-indicator', document.getElementById('pos-empresa-select')?.value], ['holiday-order-indicator', posCurrentTableEmpresa]]) {
        const element = document.getElementById(id), config = holidayConfigs.get(Number(empresa));
        element.hidden = !config?.activo;
        element.textContent = config?.activo ? `Precios Feriado · Tarifa ${config.tarifa}` : '';
    }
}
function renderHolidayEditor() {
    const config = holidayConfigs.get(Number(holidayCompany()));
    const toggle = document.getElementById('holiday-active'), tariff = document.getElementById('holiday-tariff');
    if (!holidayEditorBusy) { toggle.checked = Boolean(config?.activo); tariff.value = String(config?.tarifa || 1); }
    toggle.disabled = holidayEditorBusy || !config || (!config.disponible && !config.activo);
    tariff.disabled = holidayEditorBusy || !config || !config.disponible;
    document.getElementById('holiday-selected-tariff').textContent = !config || config.tarifa === 1 ? 'Tarifa 1 · Habitual' : `Tarifa ${config.tarifa} · Alternativa`;
    document.getElementById('holiday-state').textContent = config?.activo ? `Activo · Tarifa ${config.tarifa}` : 'Precio normal';
    document.getElementById('holiday-last-change').textContent = config?.usuario
        ? `Último cambio: ${config.usuario} · ${new Date(config.fecha).toLocaleString('es-PE', { timeZone: 'America/Lima' })}` : 'Sin cambios registrados';
    document.getElementById('holiday-message').textContent = holidayEditorMessage || (!config ? 'Cargando configuración…' : !config.disponible ? 'La tabla Precios o sus columnas no están disponibles. Puede continuar con el precio normal.' : 'Se aplica a nuevas selecciones en todos los dispositivos de esta empresa.');
    const coverage = config?.cobertura;
    document.getElementById('holiday-coverage').textContent = coverage ? `${coverage.conTarifa} productos con Tarifa ${config.tarifa} · ${coverage.precioNormal} usarán precio normal` : '';
    const list = document.getElementById('holiday-fallback-list'); list.replaceChildren();
    for (const product of coverage?.productosPrecioNormal || []) {
        const row = document.createElement('li'); row.textContent = `${product.CodPro} · ${product.Nombre}`; list.append(row);
    }
    renderHolidayIndicators();
}
async function loadHolidayConfig(empresa, editor = false) {
    renderHolidayIndicators();
    if (!empresa) return;
    const company = Number(empresa), sequence = (holidayLoads.get(company) || 0) + 1;
    holidayLoads.set(company, sequence);
    try {
        const config = await orderRequest(`/api/configuraciones/precios-feriado?empresa=${encodeURIComponent(empresa)}`);
        if (holidayLoads.get(company) !== sequence) return;
        const current = holidayConfigs.get(company);
        if (current && current.version > config.version) return current;
        holidayConfigs.set(company, config);
        if (Number(holidayCompany()) === company && !holidayEditorBusy) { holidayEditorMessage = ''; renderHolidayEditor(); }
        renderHolidayIndicators(); return config;
    } catch (e) {
        if (holidayLoads.get(company) !== sequence) return;
        if (editor && Number(holidayCompany()) === company) { holidayEditorMessage = e.message; renderHolidayEditor(); }
    }
}
function openHolidaySettings() {
    const select = document.getElementById('holiday-empresa');
    if (!select.value) select.value = document.getElementById('pos-empresa-select').value || '02';
    return selectHolidayCompany();
}
async function selectHolidayCompany() {
    holidayEditorGeneration++; holidayEditorBusy = false; holidayEditorMessage = ''; renderHolidayEditor();
    await loadHolidayConfig(holidayCompany(), true);
}
async function saveHolidayConfig() {
    if (holidayEditorBusy) return;
    const empresa = holidayCompany(), config = holidayConfigs.get(Number(empresa));
    if (!config) return;
    const body = { activo: document.getElementById('holiday-active').checked, tarifa: Number(document.getElementById('holiday-tariff').value), version: config.version };
    const generation = holidayEditorGeneration;
    holidayEditorBusy = true; holidayEditorMessage = 'Guardando…'; renderHolidayEditor();
    // Invalidate older reads; their responses must not undo a committed switch.
    holidayLoads.set(Number(empresa), (holidayLoads.get(Number(empresa)) || 0) + 1);
    try {
        const saved = await orderRequest(`/api/configuraciones/precios-feriado/${empresa}`, 'PUT', body);
        const current = holidayConfigs.get(Number(empresa));
        if (!current || saved.version >= current.version) holidayConfigs.set(Number(empresa), saved);
        if (generation === holidayEditorGeneration) holidayEditorMessage = 'Configuración guardada';
        refreshHolidayPOS(empresa);
    } catch (e) {
        if (generation === holidayEditorGeneration) holidayEditorMessage = e.message;
        if (e.errorCode === 'PRICE_CONFIG_CONFLICT') {
            await loadHolidayConfig(empresa);
            if (generation === holidayEditorGeneration) holidayEditorMessage = e.message;
        }
    } finally {
        if (generation === holidayEditorGeneration) { holidayEditorBusy = false; renderHolidayEditor(); }
        renderHolidayIndicators();
    }
}
function refreshHolidayPOS(empresa) {
    renderHolidayIndicators();
    if (isViewVisible('view-pos-order') && Number(posCurrentTableEmpresa) === Number(empresa)) {
        posCatalogReady = false;
        loadPOSProducts();
    }
}
function syncHolidayPrices(empresa = null) {
    const companies = new Set([empresa || document.getElementById('pos-empresa-select')?.value]);
    if (isViewVisible('view-configuraciones')) companies.add(holidayCompany());
    if (isViewVisible('view-pos-order')) companies.add(posCurrentTableEmpresa);
    for (const company of companies) if (company) {
        loadHolidayConfig(company, isViewVisible('view-configuraciones'));
        if (!empresa || Number(company) === Number(empresa)) refreshHolidayPOS(company);
    }
}
async function handleHolidayPriceConflict() {
    orderPriceConflict = true;
    clearTimeout(posAutoSaveTimer);
    await loadHolidayConfig(posCurrentTableEmpresa);
    posCatalogReady = false;
    await loadPOSProducts();
    renderOrderStatus();
}
async function reviewHolidayPrices() {
    if (orderBusy || orderSavePromise) return;
    const generation = posOrderLoadGeneration;
    posCatalogReady = false; await loadPOSProducts();
    if (generation !== posOrderLoadGeneration || !isViewVisible('view-pos-order')) return;
    if (!posCatalogReady) return;
    normalizePriceReferences();
    const container = document.getElementById('holiday-review-list'); container.replaceChildren();
    for (const line of posCart.filter(l => !l.precioPersistido && !l.precioDerivadaDe)) {
        const product = posProducts.find(p => p.CodPro.trim() === line.codPro);
        const row = document.createElement('li');
        row.textContent = product ? `${line.nombre}: S/ ${precioFinalUnitario(line.precioBase, line.afecto, line.precioManualFinal).toFixed(2)} → S/ ${precioFinalUnitario(product.PrecioBaseEfectivo ?? product.PventaMa, line.afecto, line.precioManualFinal).toFixed(2)}` : `${line.nombre}: producto no disponible`;
        container.append(row);
    }
    holidayReviewGeneration = { order: orderGeneration, catalog: posProductsLoadSequence, company: posCurrentTableEmpresa };
    document.getElementById('holiday-review-dialog').showModal();
}
function acceptHolidayPrices() {
    if (orderBusy || orderSavePromise || !holidayReviewGeneration || holidayReviewGeneration.order !== orderGeneration
        || holidayReviewGeneration.catalog !== posProductsLoadSequence || holidayReviewGeneration.company !== posCurrentTableEmpresa) {
        document.getElementById('holiday-review-dialog').close(); return reviewHolidayPrices();
    }
    const updates = new Map();
    for (const line of posCart) {
        if (line.precioPersistido || line.precioDerivadaDe) continue;
        const product = posProducts.find(p => p.CodPro.trim() === line.codPro);
        if (!product) return alert('Hay productos no disponibles. Retírelos del borrador antes de guardar.');
        updates.set(line.lineaId, { precioBase: Number(product.PrecioBaseEfectivo ?? product.PventaMa), precioVersion: product.precioVersion ?? 0, precioOrigen: product.precioOrigen || null });
    }
    for (const line of posCart) {
        const update = updates.get(line.lineaId) || updates.get(line.precioDerivadaDe);
        if (update && !line.precioPersistido) { Object.assign(line, update); updates.set(line.lineaId, update); line.precio = precioFinalUnitario(line.precioBase, line.afecto, line.precioManualFinal); }
    }
    document.getElementById('holiday-review-dialog').close();
    orderPriceConflict = false; orderSaveError = ''; orderGeneration++; updateCartUI();
    guardarMesa();
}
