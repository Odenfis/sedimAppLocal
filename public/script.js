let appData = null;
let reportPage = 1;
let reportFilters = {};
let reportDebounceTimer;

// Variables Modales
let currentSedeIdForComp = null;
let currentCompId = null;
let currentAreaIdForSede = null;
let currentSedeId = null;

//variables globales
let prodPage = 1;
let GLOBAL_IGV_PCT = 18;
let GLOBAL_IGVV_PCT = 10;
let APP_FEATURES = { printerEnabled: true, closuresEnabled: true };

function applyFeatureFlags(features = {}) {
    APP_FEATURES = { ...APP_FEATURES, ...features };
    const closuresMenu = document.querySelector('[data-module="cierres"]');
    if (closuresMenu) closuresMenu.classList.toggle('feature-disabled', !APP_FEATURES.closuresEnabled);
    const printButton = document.getElementById('cocina-ticket-print');
    if (printButton) printButton.classList.toggle('feature-disabled', !APP_FEATURES.printerEnabled);
    document.body.classList.toggle('printing-disabled', !APP_FEATURES.printerEnabled);
}

function redondear2(x) {
    return Math.round((x + Number.EPSILON) * 100) / 100;
}

function factorIgv(afecto) {
    return (afecto === 1 || afecto === true) ? (1 + GLOBAL_IGVV_PCT / 100) : 1;
}

function precioFinalUnitario(precioBase, afecto) {
    return redondear2(precioBase * factorIgv(afecto));
}

//variables reporte cargos caja
let reportCargosPage = 1;
let reportCargosFilters = {};
let reportCargosDebounceTimer;

// Variables Recetas
let recetaItems = []; // Array temporal de la receta actual
let debounceReceta;

// ==========================================
//  INICIO
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateIcon(savedTheme);

    const today = new Date().toISOString().split('T')[0];
    document.querySelectorAll('input[type="date"]').forEach(input => input.value = today);

    // Año reporte
    const yearSelect = document.getElementById('rep-anio');
    const audAnioSelect = document.getElementById('aud-anio');

    if (yearSelect) {
        const currentYear = new Date().getFullYear();
        for (let i = 0; i < 5; i++) {
            const opt = document.createElement('option');
            opt.value = currentYear - i; opt.innerText = currentYear - i;
            yearSelect.appendChild(opt);
        }
    }

    if (audAnioSelect) {
        const currentYear = new Date().getFullYear();
        for (let i = 0; i < 5; i++) {
            const opt = document.createElement('option');
            opt.value = currentYear - i;
            opt.innerText = currentYear - i;
            audAnioSelect.appendChild(opt);
        }
    }

    // Llenar combo de empresas para la nueva vista
    cargarEmpresasAuditoria();
    // Llenar selector de año para la nueva vista
    const audDocAnio = document.getElementById('aud-doc-anio');
    if (audDocAnio) {
        const currentYear = new Date().getFullYear();
        for (let i = 0; i < 5; i++) {
            const opt = document.createElement('option');
            opt.value = currentYear - i; opt.innerText = currentYear - i;
            audDocAnio.appendChild(opt);
        }
    }

    // Llenar select año Cargos Caja
    const yearSelectC = document.getElementById('repc-anio');
    if (yearSelectC) {
        const currentYear = new Date().getFullYear();
        for (let i = 0; i < 5; i++) {
            const opt = document.createElement('option');
            opt.value = currentYear - i; opt.innerText = currentYear - i;
            yearSelectC.appendChild(opt);
        }
    }

    try {
        const res = await fetch('/api/session');
        if (!res.ok) window.location.href = '/login.html';
        else {
            const data = await res.json();
            const user = data.user;
            applyFeatureFlags(data.features || {});
            if (user.permisos) aplicarPermisos(user.permisos);
            if (user.permisos && user.permisos.includes('equipos')) fetchData();
            if (user.permisos && user.permisos.includes('reportes')) {
                cargarReporte(1);
                cargarEmpresasReporte();
            }
            if (user.usuario) {
                document.getElementById('sidebar-user-name').innerText = toTitleCase(user.usuario);
                const info = document.querySelector('.sidebar-footer .user-info');
                if (info) { info.title = user.usuario; info.setAttribute('aria-label', `Usuario: ${user.usuario}`); }
            }
            if (document.getElementById('view-pos-tables').style.display !== 'none') {
                loadPOSTables();
            }
        }
    } catch (e) { window.location.href = '/login.html'; }

    // Eventos Filtros Reporte
    document.querySelectorAll('.col-filter').forEach(input => {
        input.addEventListener('keyup', (e) => {
            clearTimeout(reportDebounceTimer);
            reportFilters[e.target.dataset.col] = e.target.value;
            reportDebounceTimer = setTimeout(() => cargarReporte(1), 500);
        });
    });

    // Listener Filtros Cargos Caja
    document.querySelectorAll('.col-filter-cargos').forEach(input => {
        input.addEventListener('keyup', (e) => {
            clearTimeout(reportCargosDebounceTimer);
            reportCargosFilters[e.target.dataset.col] = e.target.value;
            reportCargosDebounceTimer = setTimeout(() => cargarReporteCargos(1), 500);
        });
    });

});

// ==========================================
//  NAVEGACIÓN
// ==========================================
function aplicarPermisos(permisos) {
    const menuItems = document.querySelectorAll('.sidebar li[data-module]');
    menuItems.forEach(item => item.style.display = 'none');

    const permisosUsuario = permisos || [];
    menuItems.forEach(item => {
        const mod = item.getAttribute('data-module');
        // Forzamos la visibilidad del módulo POS para asegurar que el usuario lo vea
        if (mod === 'pos' || permisosUsuario.includes(mod)) item.style.display = 'block';
    });
}

// ==========================================
//  NAVEGACIÓN (ACTUALIZADA PARA SUBMENÚS)
// ==========================================
function showView(viewName) {
    if (viewName !== 'pos-order') {
        resetMobilePOSSearch();
        resetMobilePOSHeader();
        resetPOSAddFeedback();
    }
    // 1. PASO CRUCIAL: Ocultar TODAS las secciones por su clase CSS
    // Esto asegura que 'view-recetas' y cualquier futura vista se puedan ocultar
    document.querySelectorAll('.view-section').forEach(el => {
        el.style.display = 'none';
    });

    // 2. Resetear 'active' del menú principal
    document.querySelectorAll('.sidebar li').forEach(li => li.classList.remove('active'));

    // 3. Mostrar la vista deseada
    const target = document.getElementById(`view-${viewName}`);
    if (target) {
        target.style.display = 'block';
    } else {
        console.warn(`La vista view-${viewName} no fue encontrada.`);
    }

    // 4. Activar visualmente el ítem del menú correspondiente
    // Buscamos el LI específico que llama a esta vista
    const activeLink = document.querySelector(`.sidebar li[onclick="showView('${viewName}')"]`);

    if (activeLink) {
        activeLink.classList.add('active');

        // Si el ítem está dentro de un submenú, aseguramos que el padre esté abierto
        const parentUl = activeLink.closest('ul.submenu');
        if (parentUl) {
            parentUl.classList.add('open');
            // Rotar la flecha del padre si es necesario
            const parentLi = parentUl.parentElement;
            const arrow = parentLi.querySelector('.arrow-icon');
            if (arrow) arrow.style.transform = 'rotate(180deg)';
        }
    }
}
/*
function showView(viewName) {
    // 1. Ocultar todas las vistas
    const views = ['view-equipos', 'view-usuarios', 'view-precios', 'view-revision', 'view-reportes-salida', 'view-reportes-cargos', 'view-prod-almacen'];
    views.forEach(v => {
        const el = document.getElementById(v);
        if (el) el.style.display = 'none';
    });

    // 2. Resetear 'active' de todos los items del menú (padres e hijos)
    document.querySelectorAll('.sidebar li').forEach(li => li.classList.remove('active'));

    // 3. Mostrar vista deseada
    const target = document.getElementById(`view-${viewName}`);
    if (target) {
        target.style.display = 'block';

        // LOGICA ESPECIFICA DE CARGA
        if (viewName === 'prod-almacen') buscarProductos();
    }

    // 4. Activar visualmente el ítem del menú correspondiente
    // Buscamos el LI que tiene el onclick exacto que acabamos de llamar
    const activeLink = document.querySelector(`.sidebar li[onclick="showView('${viewName}')"]`);

    if (activeLink) {
        // Activamos el item
        activeLink.classList.add('active');

        // Si el item está dentro de un submenú, abrimos el padre
        const parentUl = activeLink.closest('ul.submenu');
        if (parentUl) {
            parentUl.classList.add('open');
            // Rotamos la flecha del padre
            const parentLi = parentUl.parentElement;
            const arrow = parentLi.querySelector('.arrow-icon');
            if (arrow) arrow.style.transform = 'rotate(180deg)';
        }
    }
}*/

function toggleSubmenu(element) {
    const submenu = element.nextElementSibling;
    const arrow = element.querySelector('.arrow-icon');
    submenu.classList.toggle('open');
    if (arrow) arrow.style.transform = submenu.classList.contains('open') ? 'rotate(180deg)' : 'rotate(0deg)';
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-overlay');
    const isCompact = window.innerWidth <= 1200;
    if (isCompact) { sidebar.classList.toggle('open'); overlay.classList.toggle('active'); }
    else {
        sidebar.classList.toggle('collapsed');
        const icon = document.querySelector('.toggle-btn i');
        if (sidebar.classList.contains('collapsed')) { icon.classList.remove('fa-bars'); icon.classList.add('fa-arrow-right'); }
        else { icon.classList.remove('fa-arrow-right'); icon.classList.add('fa-bars'); }
    }
}
let lastViewportOrientation = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
let lastTableMapCompact = window.innerWidth <= 1200;
window.addEventListener('resize', () => {
    const viewportOrientation = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
    const tableMapCompact = window.innerWidth <= 1200;
    if (window.innerWidth > 1200 || viewportOrientation !== lastViewportOrientation) {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('mobile-overlay').classList.remove('active');
    }
    if (window.innerWidth > 1200 || viewportOrientation !== lastViewportOrientation) closeCartSheet();
    if (window.innerWidth > 480 || viewportOrientation !== lastViewportOrientation) {
        resetMobilePOSSearch();
        resetMobilePOSHeader();
    }
    if ((tableMapCompact && !lastTableMapCompact) || viewportOrientation !== lastViewportOrientation) {
        closePOSTableGroups();
    } else {
        syncPOSTableGroupDisclosure();
    }
    lastTableMapCompact = tableMapCompact;
    lastViewportOrientation = viewportOrientation;
});
// ... existing code ...
async function logout() { await fetch('/api/logout', { method: 'POST' }); window.location.href = '/login.html'; }

// ==========================================
//  MÓDULO: POS DE VENTAS
// ==========================================
let posCurrentTable = null;
let posCart = [];
let posProducts = [];
let posAllTables = [];
let posCurrentTableGroup = 'all';
let posTableGroupsExpanded = false;
let posCurrentCategory = null;
let posSearchTerm = '';
let posIsReadOnly = false;

const POS_NORMAL_TABLE_VISUAL = Object.freeze({
    key: 'normal',
    label: 'Atención normal',
    icon: 'fa-chair'
});
const POS_BREAKFAST_TABLE_VISUAL = Object.freeze({
    key: 'breakfast',
    label: 'Desayunos',
    icons: Object.freeze(['fa-mug-hot', 'fa-bread-slice'])
});
const POS_SPECIAL_TABLE_VISUALS = Object.freeze([
    Object.freeze({ key: 'delivery', min: 201, max: 209, label: 'Delivery', icon: 'fa-motorcycle' }),
    Object.freeze({ key: 'takeaway', min: 210, max: 219, label: 'Para llevar', icon: 'fa-bag-shopping' }),
    Object.freeze({
        key: 'marketplaces',
        min: 220,
        max: 230,
        label: 'PedidosYa | Rappi',
        brands: Object.freeze([
            Object.freeze({ name: 'PedidosYa', src: '/icons/order-channels/pedidosya.svg', fallback: 'PY' }),
            Object.freeze({ name: 'Rappi', src: '/icons/order-channels/rappi.svg', fallback: 'R' })
        ])
    }),
    Object.freeze({
        key: 'discard-gifts',
        min: 231,
        max: 235,
        label: 'Descarte y obsequios',
        icons: Object.freeze(['fa-trash-can', 'fa-gift'])
    }),
    Object.freeze({ key: 'misc', min: 236, max: Infinity, label: 'Varios', icon: 'fa-boxes-stacked' })
]);
const POS_TABLE_GROUP_FILTERS = Object.freeze([
    POS_NORMAL_TABLE_VISUAL,
    ...POS_SPECIAL_TABLE_VISUALS
]);

function isCompactTableMapView() {
    return window.innerWidth <= 1200;
}

function getPOSTableGroupLabel() {
    if (posCurrentTableGroup === 'all') return 'Todos';
    const group = [POS_NORMAL_TABLE_VISUAL, POS_BREAKFAST_TABLE_VISUAL, ...POS_SPECIAL_TABLE_VISUALS]
        .find(item => item.key === posCurrentTableGroup);
    return group?.label || 'Todos';
}

function syncPOSTableGroupDisclosure() {
    const toggle = document.getElementById('pos-table-group-toggle');
    const container = document.getElementById('pos-table-group-filters');
    const current = document.getElementById('pos-table-group-current');
    if (!toggle || !container || !current) return;

    const compact = isCompactTableMapView();
    const expanded = compact ? posTableGroupsExpanded : true;
    toggle.setAttribute('aria-expanded', String(expanded));
    container.hidden = !expanded;
    current.innerText = getPOSTableGroupLabel();
}

function closePOSTableGroups() {
    posTableGroupsExpanded = false;
    syncPOSTableGroupDisclosure();
}

function togglePOSTableGroups() {
    if (!isCompactTableMapView()) return;
    posTableGroupsExpanded = !posTableGroupsExpanded;
    syncPOSTableGroupDisclosure();
}

function isCocineria(empresa) {
    return Number(empresa) === 2;
}

function getPOSTableVisual(numero, empresa) {
    const tableNumber = Number(numero);
    if (isCocineria(empresa) && tableNumber >= 81 && tableNumber <= 120) {
        return POS_BREAKFAST_TABLE_VISUAL;
    }
    return POS_SPECIAL_TABLE_VISUALS.find(type => tableNumber >= type.min && tableNumber <= type.max)
        || POS_NORMAL_TABLE_VISUAL;
}

function renderPOSTableVisual(visual) {
    if (visual.brands) {
        const brands = visual.brands.map(brand => `
            <span class="pos-brand-logo" title="${brand.name}">
                <img src="${brand.src}" alt="">
                <span class="pos-brand-fallback">${brand.fallback}</span>
            </span>
        `).join('');
        return `<div class="pos-table-icon pos-table-icon--brands" aria-hidden="true">${brands}</div>`;
    }

    const icons = visual.icons || [visual.icon];
    return `
        <div class="pos-table-icon${visual.key === 'normal' ? '' : ' pos-table-icon--special'}" aria-hidden="true">
            ${icons.map(icon => `<i class="fas ${icon}"></i>`).join('')}
        </div>
    `;
}

// Búsqueda móvil: usa el viewport visual real para no quedar detrás del
// teclado virtual. No depende del navegador ni del sistema operativo.
const mobilePOSSearchMedia = window.matchMedia('(max-width: 480px)');
let posSearchKeyboardSeen = false;
let posSearchViewportBaseline = window.innerHeight;
let posSearchBlurTimer = null;
let posAddFeedbackTimer = null;
let posCartFeedbackTimer = null;
const posCardFeedbackTimers = new Map();

function setMobilePOSHeaderExpanded(expanded) {
    const header = document.querySelector('.pos-order-header');
    const toggle = document.getElementById('pos-header-toggle');
    if (!header || !toggle) return;
    header.classList.toggle('mobile-expanded', expanded);
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', expanded ? 'Ocultar acciones de la mesa' : 'Mostrar acciones de la mesa');
}

function toggleMobilePOSHeader() {
    if (!mobilePOSSearchMedia.matches || posIsReadOnly) return;
    const header = document.querySelector('.pos-order-header');
    setMobilePOSHeaderExpanded(!header?.classList.contains('mobile-expanded'));
}

function resetMobilePOSHeader() {
    const toggle = document.getElementById('pos-header-toggle');
    if (toggle) {
        toggle.hidden = false;
        delete toggle.dataset.forcedOpen;
    }
    setMobilePOSHeaderExpanded(false);
}

function syncMobilePOSHeaderReadOnly(readOnly) {
    const toggle = document.getElementById('pos-header-toggle');
    if (!toggle) return;
    if (readOnly) {
        toggle.dataset.forcedOpen = 'true';
        toggle.hidden = true;
        setMobilePOSHeaderExpanded(true);
        return;
    }
    const wasForced = toggle.dataset.forcedOpen === 'true';
    toggle.hidden = false;
    delete toggle.dataset.forcedOpen;
    if (wasForced) setMobilePOSHeaderExpanded(false);
}

function resetPOSAddFeedback() {
    clearTimeout(posAddFeedbackTimer);
    clearTimeout(posCartFeedbackTimer);
    const feedback = document.getElementById('pos-add-feedback');
    if (feedback) {
        feedback.hidden = true;
        feedback.classList.remove('is-visible');
        feedback.textContent = '';
    }
    document.getElementById('pos-cart-fab')?.classList.remove('is-bumping');
    document.querySelectorAll('.pos-product-card.is-added').forEach(card => card.classList.remove('is-added'));
    posCardFeedbackTimers.forEach(timer => clearTimeout(timer));
    posCardFeedbackTimers.clear();
}

function showPOSAddFeedback(product, card) {
    const codPro = String(product.CodPro || '').trim();
    const quantity = posCart.reduce((total, item) => total + (String(item.codPro || '').trim() === codPro ? Number(item.cantidad) || 0 : 0), 0);
    const feedback = document.getElementById('pos-add-feedback');
    if (feedback) {
        clearTimeout(posAddFeedbackTimer);
        feedback.textContent = `Agregado al pedido: ${String(product.Nombre || 'Producto').trim()} · Cantidad ${quantity}`;
        feedback.hidden = false;
        feedback.classList.remove('is-visible');
        void feedback.offsetWidth;
        feedback.classList.add('is-visible');
        posAddFeedbackTimer = setTimeout(() => {
            feedback.hidden = true;
            feedback.classList.remove('is-visible');
        }, 1400);
    }

    if (card?.isConnected) {
        clearTimeout(posCardFeedbackTimers.get(card));
        card.classList.remove('is-added');
        void card.offsetWidth;
        card.classList.add('is-added');
        posCardFeedbackTimers.set(card, setTimeout(() => {
            card.classList.remove('is-added');
            posCardFeedbackTimers.delete(card);
        }, 450));
    }

    const cart = document.getElementById('pos-cart-fab');
    if (cart) {
        clearTimeout(posCartFeedbackTimer);
        cart.classList.remove('is-bumping');
        void cart.offsetWidth;
        cart.classList.add('is-bumping');
        posCartFeedbackTimer = setTimeout(() => cart.classList.remove('is-bumping'), 450);
    }
}

function updatePOSSearchClear() {
    const input = document.getElementById('pos-product-search');
    const clear = document.getElementById('pos-search-clear');
    if (clear) clear.hidden = !input?.value;
}

function syncPOSVisualViewport() {
    const viewport = window.visualViewport;
    const height = Math.round(viewport?.height || window.innerHeight);
    const offsetTop = Math.round(viewport?.offsetTop || 0);
    document.documentElement.style.setProperty('--pos-visual-viewport-height', `${height}px`);
    document.documentElement.style.setProperty('--pos-visual-viewport-offset-top', `${offsetTop}px`);

    const view = document.getElementById('view-pos-order');
    if (!view?.classList.contains('pos-mobile-search-mode')) return;
    if (posSearchViewportBaseline - height > 120) posSearchKeyboardSeen = true;
    else if (posSearchKeyboardSeen && height >= posSearchViewportBaseline - 80) finishPOSProductSearch();
}

function startPOSProductSearch() {
    if (!mobilePOSSearchMedia.matches || posIsReadOnly) return;
    clearTimeout(posSearchBlurTimer);
    posSearchViewportBaseline = Math.max(window.innerHeight, window.visualViewport?.height || 0);
    posSearchKeyboardSeen = false;
    document.getElementById('view-pos-order')?.classList.add('pos-mobile-search-mode');
    syncPOSVisualViewport();
}

function finishPOSProductSearch() {
    clearTimeout(posSearchBlurTimer);
    const input = document.getElementById('pos-product-search');
    if (document.activeElement === input) input.blur();
    document.getElementById('view-pos-order')?.classList.remove('pos-mobile-search-mode');
    posSearchKeyboardSeen = false;
}

function resetMobilePOSSearch() {
    finishPOSProductSearch();
    document.documentElement.style.removeProperty('--pos-visual-viewport-height');
    document.documentElement.style.removeProperty('--pos-visual-viewport-offset-top');
}

function clearPOSProductSearch() {
    const input = document.getElementById('pos-product-search');
    if (!input) return;
    input.value = '';
    searchPOSProducts();
    input.focus({ preventScroll: true });
}

function retainMobilePOSSearchFocus() {
    const view = document.getElementById('view-pos-order');
    const input = document.getElementById('pos-product-search');
    if (!view?.classList.contains('pos-mobile-search-mode') || !input || posIsReadOnly) return;
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
}

const posProductSearchInput = document.getElementById('pos-product-search');
if (posProductSearchInput) {
    posProductSearchInput.addEventListener('focus', startPOSProductSearch);
    posProductSearchInput.addEventListener('pointerdown', startPOSProductSearch);
    posProductSearchInput.addEventListener('blur', () => {
        clearTimeout(posSearchBlurTimer);
        posSearchBlurTimer = setTimeout(() => {
            if (document.activeElement !== posProductSearchInput) finishPOSProductSearch();
        }, 160);
    });
    posProductSearchInput.addEventListener('keydown', event => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        finishPOSProductSearch();
    });
}
if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncPOSVisualViewport);
    window.visualViewport.addEventListener('scroll', syncPOSVisualViewport);
}
if (mobilePOSSearchMedia.addEventListener) mobilePOSSearchMedia.addEventListener('change', event => {
    if (!event.matches) resetMobilePOSSearch();
});
else mobilePOSSearchMedia.addListener(event => {
    if (!event.matches) resetMobilePOSSearch();
});
syncPOSVisualViewport();
let posCurrentTurnoLabel = null;
let posAutoSaveTimer = null;
let posCartGroupMembers = new Map();
let posTablesLoadGeneration = 0;
const POS_AUTOSAVE_DEBOUNCE_MS = 700;

function getTurnoValue(empresa, turnoLabel) {
    const map = {
        2: { manana: 2, 'tarde-noche': 1 },
        4: { manana: 1, 'tarde-noche': 2 },
        6: { manana: 1, 'tarde-noche': 1 }
    };
    const emp = parseInt(empresa);
    return (map[emp] && map[emp][turnoLabel]) || 1;
}

function selectTurno(label) {
    posCurrentTurnoLabel = label;
    document.querySelectorAll('.turno-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.turno === label);
    });
    onEmpresaOrTurnoChange();
}

function onEmpresaOrTurnoChange() {
    closePOSTableGroups();
    loadPOSTables();
}

async function loadPOSConfig() {
    try {
        const res = await fetch('/api/pos/config');
        const config = await res.json();
        if (config.igvv !== undefined) GLOBAL_IGVV_PCT = config.igvv;
    } catch (e) {
        console.error('Error cargando configuración POS:', e);
    }
}

async function loadPOSTables() {
    console.log("POS: Iniciando loadPOSTables...");
    const generation = ++posTablesLoadGeneration;
    const empresaSelect = document.getElementById('pos-empresa-select');
    const empresa = empresaSelect ? empresaSelect.value : null;
    const turno = posCurrentTurnoLabel;
    const grid = document.getElementById('pos-tables-grid');
    console.log(`POS: Empresa seleccionada: ${empresa}`);
    
    if (!grid) {
        console.error("POS: Error - No se encontró el elemento 'pos-tables-grid'");
        return;
    }

    if (!empresa || !turno) {
        const msg = !empresa && !turno
            ? 'Seleccione una empresa y un turno para ver las mesas.'
            : !empresa
                ? 'Seleccione una empresa para ver las mesas.'
                : 'Seleccione un turno para ver las mesas.';
        console.warn("POS: Faltan selecciones", { empresa, turno });
        grid.innerHTML = `<div style="text-align:center; width:100%; padding:20px;">${msg}</div>`;
        return;
    }

    grid.innerHTML = '<div style="text-align:center; width:100%;">Cargando mesas...</div>';
    
    try {
        await loadPOSConfig();
        if (generation !== posTablesLoadGeneration) return;
        console.log(`POS: Fetching /api/pos/tables?empresa=${empresa}`);
        const res = await fetch(`/api/pos/tables?empresa=${encodeURIComponent(empresa)}`);
        if (!res.ok) throw new Error(`Error servidor: ${res.status}`);

        const tables = await res.json();
        if (generation !== posTablesLoadGeneration || empresaSelect?.value !== empresa || posCurrentTurnoLabel !== turno) return;
        posAllTables = tables;
        console.log(`POS: Mesas recibidas: ${posAllTables.length}`);
        
        renderTableGroupFilters(empresa);
        renderPOSTables(posAllTables);
    } catch (e) {
        console.error("POS: Error en loadPOSTables:", e);
        if (generation === posTablesLoadGeneration) {
            grid.innerHTML = `<div style="color:red; text-align:center; width:100%;">Error al cargar mesas: ${e.message}</div>`;
        }
    }
}

function renderTableGroupFilters(empresa) {
    const container = document.getElementById('pos-table-group-filters');
    if (!container) return;

    container.innerHTML = '';
    const availableGroups = isCocineria(empresa)
        ? [POS_NORMAL_TABLE_VISUAL, POS_BREAKFAST_TABLE_VISUAL, ...POS_SPECIAL_TABLE_VISUALS]
        : POS_TABLE_GROUP_FILTERS;
    if (posCurrentTableGroup !== 'all' && !availableGroups.some(group => group.key === posCurrentTableGroup)) {
        posCurrentTableGroup = 'all';
    }
    const filters = [{ key: 'all', label: 'Todos' }, ...availableGroups];
    filters.forEach(filter => {
        const btn = document.createElement('button');
        btn.className = `table-group-btn ${posCurrentTableGroup === filter.key ? 'active' : ''}`;
        btn.type = 'button';
        btn.dataset.tableGroup = filter.key;
        btn.innerText = filter.label;
        btn.onclick = () => {
            posCurrentTableGroup = filter.key;
            container.querySelectorAll('.table-group-btn').forEach(button => button.classList.remove('active'));
            btn.classList.add('active');
            renderPOSTables(posAllTables);
            closePOSTableGroups();
        };
        container.appendChild(btn);
    });
    syncPOSTableGroupDisclosure();
}

function renderPOSTables(tables) {
    const grid = document.getElementById('pos-tables-grid');
    grid.innerHTML = '';

    const filteredTables = tables.filter(table => {
        const visual = getPOSTableVisual(table.Numero, table.Empresa);
        return posCurrentTableGroup === 'all' || visual.key === posCurrentTableGroup;
    });

    if (filteredTables.length === 0) {
        grid.innerHTML = '<div class="pos-tables-empty">No hay mesas para los filtros seleccionados.</div>';
        return;
    }

    filteredTables.forEach(t => {
        const card = document.createElement('div');
        const visual = getPOSTableVisual(t.Numero, t.Empresa);
        let stateClass = 'available';
        let stateText = 'Libre';
        const state = Number(t.Estado);
        
        // Mapeo basado en Tablas n_codtabla = 530
        if (state === 2) { stateClass = 'occupied'; stateText = 'Ocupada'; }
        else if (state === 3) { stateClass = 'reserved'; stateText = 'Reservada'; }
        else if (state === 4) { stateClass = 'merged'; stateText = 'Unida'; }
        else if (state === 5) { stateClass = 'preventa'; stateText = 'Preventa'; }
        else if (state === 6) { stateClass = 'unavailable'; stateText = 'No disponible'; }
        else { stateClass = 'available'; stateText = 'Libre'; }

        card.className = `pos-table-card ${stateClass}${visual.key === 'normal' ? '' : ' pos-table-card--special'}`;
        card.dataset.tableNumber = String(t.Numero);
        card.dataset.tableType = visual.key;
        card.setAttribute('aria-label', `Mesa ${t.Numero}, ${visual.label}, ${stateText}`);
        card.innerHTML = `
            ${visual.key === 'normal' ? '' : `<span class="pos-table-type">${visual.label}</span>`}
            ${renderPOSTableVisual(visual)}
            <span class="pos-table-number">${visual.key === 'normal' ? '' : '<span class="pos-table-number-prefix">Mesa</span> '}${t.Numero}</span>
            <span class="pos-table-info">${stateText}</span>
        `;
        card.querySelectorAll('.pos-brand-logo img').forEach(img => {
            img.addEventListener('error', () => img.closest('.pos-brand-logo')?.classList.add('is-fallback'));
        });
        card.onclick = () => openPOSOrder(t.Numero, t.Empresa);
        grid.appendChild(card);
    });
}

async function openPOSOrder(tableNum, tableEmpresa = null) {
    if (!await orderBeforeOpen()) return;
    resetMobilePOSSearch();
    resetMobilePOSHeader();
    resetPOSAddFeedback();
    orderReset();
    posIsReadOnly = false;
    posCurrentTable = tableNum;
    posCurrentTableEmpresa = tableEmpresa || document.getElementById('pos-empresa-select')?.value;
    document.getElementById('pos-current-table').innerText = tableNum;
    showView('pos-order');
    closeCartSheet();
    
    posCart = [];
    posCurrentNroTicket = null;
    updateCartUI();
    updateStateButtons();
    
    posSearchTerm = '';
    posCurrentCategory = null;
    const searchInput = document.getElementById('pos-product-search');
    if (searchInput) searchInput.value = '';
    updatePOSSearchClear();
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    
    document.getElementById('pos-mojo-select').value = '';
    document.getElementById('pos-mojo-name').innerText = 'Sin asignar';
    
    const empresa = tableEmpresa || document.getElementById('pos-empresa-select')?.value;
    if (empresa) {
        await loadMozos(empresa);
        
        try {
            const res = await fetch(`/api/pos/pedido?mesa=${tableNum}&empresa=${empresa}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'No se pudo cargar el pedido');
            if (data.success && data.pedido) {
                posCurrentNroTicket = data.pedido.NroTicket;
                document.getElementById('pos-guests').value = data.pedido.Comensales || 1;
                
                if (data.pedido.Mozo) {
                    const mozoActual = posMozosList.find(m => m.Codemp === data.pedido.Mozo);
                    if (mozoActual) {
                        document.getElementById('pos-mojo-select').value = mozoActual.Codemp;
                        document.getElementById('pos-mojo-name').innerText = mozoActual.Nombre;
                    }
                }
                
                posCart = (data.items || []).map(item => ({
                    lineaId: item.lineaId, codPro: item.Codpro.trim(), nombre: item.Descripcion.trim(),
                    precioBase: Number(item.Precio), precio: precioFinalUnitario(Number(item.Precio), item.Afecto),
                    cantidad: Number(item.Cantidad), afecto: item.Afecto, descuento: 0,
                    notasRapidas: item.notasRapidas || [], nota: item.nota || '', enviada: item.enviada,
                    pendienteId: item.pendienteId, pendienteEnvio: item.pendienteEnvio, estadoCocina: item.estadoCocina,
                    anulada: item.anulada
                }));
                orderAccept(data);
                updateCartUI();
                posIsReadOnly = data.pedido.Estado === 2;
                document.getElementById('btn-guardar-mesa').classList.add('active-state');
                updatePOSViewMode();
            } else {
                posIsReadOnly = false;
                updatePOSViewMode();
            }
        } catch (e) {
            console.error('Error al cargar pedido:', e);
            orderConflict = true; orderSaveError = e.message;
            posIsReadOnly = true;
            updatePOSViewMode();
        }
    } else {
        posIsReadOnly = false;
        updatePOSViewMode();
    }
    
    renderOrderStatus();
    if (!posIsReadOnly) {
        await loadPOSCategories();
        await loadPOSProducts();
    }
}

let posCurrentTableEmpresa = null;
let posCurrentNroTicket = null;

function updatePOSViewMode() {
    const payBtn = document.querySelector('.btn-pay-now');
    const borrarBtn = document.getElementById('btn-borrar-comanda');
    const guardarBtn = document.getElementById('btn-guardar-mesa');
    const reservarBtn = document.getElementById('btn-reservar-mesa');
    const liberarBtn = document.getElementById('btn-liberar-mesa');
    const guestsInput = document.getElementById('pos-guests');
    const mozoBadge = document.querySelector('.pos-mojo-badge');
    const categories = document.getElementById('pos-categories-container');
    const searchBox = document.getElementById('pos-search-container');
    const productsGrid = document.getElementById('pos-products-grid');
    const sidebarHeader = document.querySelector('.pos-sidebar-header');
    const badge = document.getElementById('pos-preventa-badge');
    const reabrirBtn = document.getElementById('btn-reabrir-pedido');

    if (posIsReadOnly) {
        resetMobilePOSSearch();
        syncMobilePOSHeaderReadOnly(true);
        if (payBtn) {
            payBtn.disabled = true;
            payBtn.innerHTML = '<i class="fas fa-check-circle"></i> <span>PREVENTA REALIZADA</span>';
            payBtn.style.background = '#9ca3af';
            payBtn.style.cursor = 'not-allowed';
            payBtn.style.boxShadow = 'none';
        }
        if (borrarBtn) borrarBtn.disabled = true;
        if (guardarBtn) guardarBtn.disabled = true;
        if (reservarBtn) reservarBtn.disabled = true;
        if (liberarBtn) liberarBtn.disabled = true;
        if (guestsInput) guestsInput.readOnly = true;
        if (mozoBadge) mozoBadge.style.pointerEvents = 'none';
        if (categories) categories.style.display = 'none';
        if (searchBox) searchBox.style.display = 'none';
        if (productsGrid) productsGrid.style.display = 'none';
        if (sidebarHeader) {
            const clearBtn = sidebarHeader.querySelector('.btn-clear');
            if (clearBtn) clearBtn.disabled = true;
        }
        if (badge) badge.style.display = 'inline-flex';
        if (reabrirBtn) reabrirBtn.style.display = 'inline-flex';
    } else {
        syncMobilePOSHeaderReadOnly(false);
        if (payBtn) {
            payBtn.disabled = false;
            payBtn.innerHTML = '<i class="fas fa-file-invoice"></i> <span>GENERAR PREVENTA</span>';
            payBtn.style.background = '';
            payBtn.style.cursor = 'pointer';
            payBtn.style.boxShadow = '';
        }
        if (borrarBtn) borrarBtn.disabled = false;
        if (guardarBtn) guardarBtn.disabled = false;
        if (reservarBtn) reservarBtn.disabled = false;
        if (liberarBtn) liberarBtn.disabled = false;
        if (guestsInput) guestsInput.readOnly = false;
        if (mozoBadge) mozoBadge.style.pointerEvents = '';
        if (categories) categories.style.display = '';
        if (searchBox) searchBox.style.display = '';
        if (productsGrid) productsGrid.style.display = '';
        if (sidebarHeader) {
            const clearBtn = sidebarHeader.querySelector('.btn-clear');
            if (clearBtn) clearBtn.disabled = false;
        }
        if (badge) badge.style.display = 'none';
        if (reabrirBtn) reabrirBtn.style.display = 'none';
    }
    updateCartUI();
}

async function loadMozos(empresa) {
    const select = document.getElementById('pos-mojo-select');
    if (!select) return;
    
    if (!empresa) {
        select.innerHTML = '<option value="">Seleccione empresa</option>';
        return;
    }
    
    try {
        const res = await fetch(`/api/pos/mozos?empresa=${empresa}`);
        const mozos = await res.json();
        
        select.innerHTML = '<option value="">Seleccione mozo</option>';
        posMozosList = mozos;
        
        const currentMozo = document.getElementById('pos-mojo-select').value;
        const badge = document.querySelector('.pos-mojo-badge');
        
        if (mozos.length > 0) {
            if (!currentMozo) {
                select.value = mozos[0].Codemp;
                document.getElementById('pos-mojo-name').innerText = mozos[0].Nombre;
            }
            if (badge) badge.classList.add('has-mozos');
        } else {
            document.getElementById('pos-mojo-name').innerText = 'Sin mozos';
        }
    } catch (e) {
        console.error('Error al cargar mozos:', e);
    }
}

let posMozosList = [];

function openMozoModal() {
    const container = document.getElementById('mozo-list');
    container.innerHTML = '';
    
    if (posMozosList.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:20px;">No hay mozos disponibles</div>';
    } else {
        const currentMozo = document.getElementById('pos-mojo-select').value;
        posMozosList.forEach(m => {
            const div = document.createElement('div');
            div.className = 'mozo-option';
            if (m.Codemp == currentMozo) div.classList.add('selected');
            div.innerHTML = `<i class="fas fa-user"></i> <span>${m.Nombre}</span>`;
            div.onclick = () => selectMozo(m.Codemp, m.Nombre);
            container.appendChild(div);
        });
    }
    
    const modal = document.getElementById('modal-mozo');
    modal.style.display = 'block';
    modal.onclick = (e) => {
        if (e.target === modal) closeModal('modal-mozo');
    };
}

function selectMozo(codemp, nombre) {
    if (orderBusy || posIsReadOnly) return;
    document.getElementById('pos-mojo-select').value = codemp;
    document.getElementById('pos-mojo-name').innerText = nombre;
    document.querySelector('.pos-mojo-badge').classList.add('has-mozos');
    closeModal('modal-mozo');
    if (posCurrentNroTicket || posCart.length) scheduleAutoSave();
}

function updateStateButtons() {
    const empresa = document.getElementById('pos-empresa-select')?.value;
    posCurrentTableEmpresa = posCurrentTableEmpresa || empresa;
}

function buildPosPedidoPayload() { return orderPayload(); }

function isPOSOrderViewVisible() {
    const view = document.getElementById('view-pos-order');
    return view && view.style.display !== 'none';
}

function scheduleAutoSave() { orderSchedule(); }
async function runAutoSave() { return orderFlush(); }
async function guardarMesa() {
    try { await orderFlush(); } catch (e) { alert(e.message); }
}

async function reservarMesa() {
    if (posIsReadOnly) return;
    if (!posCurrentTable || !posCurrentTableEmpresa) {
        alert('Error: No se ha seleccionado una mesa');
        return;
    }
    
    try {
        const res = await fetch(`/api/pos/tables/${posCurrentTable}/estado`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estado: 3, empresa: posCurrentTableEmpresa })
        });
        
        if (res.ok) {
            alert('Mesa RESERVADA');
            document.getElementById('btn-reservar-mesa').classList.add('active-state');
            document.getElementById('btn-guardar-mesa').classList.remove('active-state');
            loadPOSTables();
        } else {
            alert('Error al reservar mesa');
        }
    } catch (e) {
        alert('Error de conexión');
    }
}

async function liberarMesa() {
    if (posIsReadOnly) return;
    if (!posCurrentTable || !posCurrentTableEmpresa) {
        alert('Error: No se ha seleccionado una mesa');
        return;
    }

    if (!confirm('¿Está seguro de liberar esta mesa? Volverá a estado Libre.')) return;

    try {
        const res = await fetch(`/api/pos/tables/${posCurrentTable}/liberar-reservada`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ empresa: posCurrentTableEmpresa, version: orderVersion, operacionId: orderOperation() })
        });

        const data = await res.json();

        if (res.ok) {
            alert('Mesa LIBERADA');
            document.getElementById('btn-guardar-mesa').classList.remove('active-state');
            document.getElementById('btn-reservar-mesa').classList.remove('active-state');
            document.getElementById('btn-liberar-mesa').classList.remove('active-state');
            showView('pos-tables');
            loadPOSTables();
        } else {
            alert(data.message || 'Error al liberar mesa');
        }
    } catch (e) {
        alert('Error de conexión');
    }
}

async function borrarComanda() { return orderDelete(); }

async function loadPOSCategories() {
    console.log("POS: Cargando categorías...");
    const empresaSelect = document.getElementById('pos-empresa-select');
    const empresa = empresaSelect ? empresaSelect.value : null;
    const container = document.getElementById('pos-categories-container');
    
    if (!container) {
        console.error("POS: Error - No se encontró el contenedor de categorías");
        return;
    }
    
    if (!empresa) {
        container.innerHTML = '<div style="padding:10px;">Seleccione una empresa primero</div>';
        return;
    }
    
    try {
        const res = await fetch(`/api/pos/categories?empresa=${encodeURIComponent(empresa)}`);
        if (!res.ok) throw new Error(`Error servidor: ${res.status}`);
        
        const categories = await res.json();
        console.log(`POS: Categorías recibidas: ${categories.length}`, categories);
        
        renderPOSCategories(categories);
    } catch (e) {
        console.error("POS: Error cargando categorías:", e);
        container.innerHTML = `<div style="color:red; padding:10px;">Error: ${e.message}</div>`;
    }
}

function renderPOSCategories(categories) {
    const container = document.getElementById('pos-categories-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    const btnTodos = document.createElement('button');
    btnTodos.className = 'cat-btn active';
    btnTodos.innerText = 'Todos';
    btnTodos.onclick = (e) => {
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        posCurrentCategory = null;
        searchPOSProducts();
    };
    container.appendChild(btnTodos);
    
    if (!categories || categories.length === 0) {
        return;
    }
    
    categories.forEach((cat) => {
        const btn = document.createElement('button');
        btn.className = 'cat-btn';
        btn.innerText = cat;
        btn.onclick = (e) => {
            document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            posCurrentCategory = cat;
            searchPOSProducts();
        };
        container.appendChild(btn);
    });
    
    // Mostrar todos los productos al inicio
    posCurrentCategory = null;
    searchPOSProducts();
}

async function loadPOSProducts() {
    console.log("POS: Iniciando carga de productos...");
    const empresaSelect = document.getElementById('pos-empresa-select');
    const empresa = empresaSelect ? empresaSelect.value : null;
    const grid = document.getElementById('pos-products-grid');
    
    if (!grid) {
        console.error("POS: Error crítico - No se encontró el elemento 'pos-products-grid' en el DOM");
        return;
    }

    if (!empresa) {
        console.warn("POS: No hay empresa seleccionada");
        grid.innerHTML = '<div style="text-align:center; width:100%; padding:20px;">Por favor, seleccione una empresa primero en el mapa de mesas.</div>';
        return;
    }

    console.log(`POS: Solicitando productos para la empresa: ${empresa}`);
    grid.innerHTML = '<div style="text-align:center; width:100%;">Cargando productos...</div>';
    
    try {
        const res = await fetch(`/api/pos/products?empresa=${encodeURIComponent(empresa)}`);
        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Error servidor (${res.status}): ${errText}`);
        }
        
        posProducts = await res.json();
        console.log(`POS: Productos recibidos: ${posProducts.length} ítems`);
        
        // No renderizamos aquí, deixe que renderPOSCategories defina qué mostrar
        renderPOSProducts(posProducts);
    } catch (e) {
        console.error("POS: Error detallando la carga de productos:", e);
        grid.innerHTML = `<div style="color:red; text-align:center; width:100%; padding:20px;">
            <strong>Error al cargar productos</strong><br>
            ${e.message}
        </div>`;
    }
}

function renderPOSProducts(products) {
    console.log(`POS: Renderizando ${products ? products.length : 0} productos`);
    const grid = document.getElementById('pos-products-grid');
    if (!grid) {
        console.error("POS: Error - No se encontró el grid para renderizar productos");
        return;
    }
    grid.innerHTML = '';
    
    if (!products || products.length === 0) {
        console.log("POS: No hay productos para renderizar");
        grid.innerHTML = '<div style="text-align:center; width:100%; padding:20px;">No se encontraron productos para esta empresa en la categoría seleccionada.</div>';
        return;
    }

    try {
        products.forEach((p, index) => {
            const card = document.createElement('div');
            card.className = 'pos-product-card';
            
            const lineColors = {
                'Entradas': '#ffeb3b',
                'Platos de Fondo': '#ff9800',
                'Bebidas': '#2196f3',
                'Postres': '#e91e63'
            };
            const color = lineColors[p.Linea] || '#ccc';
            
            // Aseguramos que el precio sea un número válido
            let precioBase = p.PventaMa;
            if (typeof precioBase !== 'number') {
                precioBase = parseFloat(precioBase) || 0;
            }
            const esAfecto = p.Afecto === 1 || p.Afecto === true;
            const precioConIgv = redondear2(precioBase * factorIgv(esAfecto));
            const priceFormatted = precioConIgv.toFixed(2);

            card.innerHTML = `
                <div class="pos-product-accent" style="background-color: ${color}"></div>
                <div class="pos-product-content">
                    <div class="pos-product-cat">${p.Linea || 'General'}</div>
                    <div class="pos-product-name">${p.Nombre || 'Producto sin nombre'}</div>
                    <div class="pos-product-price">S/ ${priceFormatted}</div>
                    ${esAfecto ? '<div class="pos-product-igv">(inc. IGV)</div>' : ''}
                </div>
            `;
            card.onclick = () => addToCart(p, card);
            grid.appendChild(card);
        });
    } catch (err) {
        console.error("POS: Error durante el bucle de renderizado:", err);
        grid.innerHTML = `<div style="color:red; text-align:center; width:100%;">Error al renderizar la lista de productos.</div>`;
    }
}

function filterPosProducts(category, btnElement = null) {
    if (btnElement) {
        document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
        btnElement.classList.add('active');
    }
    
    posCurrentCategory = category;
    searchPOSProducts();
}

function searchPOSProducts() {
    const searchInput = document.getElementById('pos-product-search');
    posSearchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    updatePOSSearchClear();
    
    let filtered = posProducts;
    
    // Filtrar por categoría si hay una seleccionada
    if (posCurrentCategory) {
        filtered = filtered.filter(p => p.Linea === posCurrentCategory);
    }
    
    // Filtrar por término de búsqueda
    if (posSearchTerm) {
        filtered = filtered.filter(p => {
            const nombre = (p.Nombre || '').toLowerCase();
            return nombre.includes(posSearchTerm);
        });
    }
    
    renderPOSProducts(filtered);
}

function addToCart(product, card = null) {
    if (posIsReadOnly || orderBusy) return;
    const existing = posCart.find(item => item.codPro === product.CodPro.trim() && !item.enviada && !item.pendienteId && !orderNotes(item));
    const precioBase = typeof product.PventaMa === 'number' ? product.PventaMa : (parseFloat(product.PventaMa) || 0);
    const esAfecto = product.Afecto === 1 || product.Afecto === true;
    if (existing) {
        existing.cantidad++;
    } else {
        posCart.push({
            lineaId: newOrderId(), codPro: product.CodPro.trim(), notasRapidas: [], nota: '', enviada: null,
            nombre: product.Nombre,
            precio: precioFinalUnitario(precioBase, esAfecto),
            precioBase: precioBase,
            cantidad: 1,
            descuento: 0,
            afecto: esAfecto
        });
    }
    updateCartUI();
    showPOSAddFeedback(product, card);
    scheduleAutoSave();
    retainMobilePOSSearchFocus();
}

let cartDelegationBound = false;
function bindCartDelegation(container) {
    if (cartDelegationBound) return;
    cartDelegationBound = true;
    container.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-action]');
        if (!btn || posIsReadOnly || orderBusy) return;
        const memberIds = posCartGroupMembers.get(btn.dataset.cod) || [btn.dataset.cod];
        const indexes = memberIds.map(id => posCart.findIndex(i => i.lineaId === id)).filter(i => i >= 0);
        if (!indexes.length) return;
        const editable = indexes.filter(i => !posCart[i].pendienteId);
        if (!editable.length) return;
        const pending = editable.find(i => !posCart[i].enviada);
        const idx = pending ?? editable[0];
        if (btn.dataset.action === 'notes') return openOrderNotes(idx);
        if (btn.dataset.action === 'split') return splitOrderLine(idx);
        if (btn.dataset.action === 'inc') changeQty(idx, 1);
        else if (btn.dataset.action === 'dec') changeQty(idx, -1);
        else if (btn.dataset.action === 'del') removeCartGroup(memberIds);
    });
}

function updateCartUI() {
    const container = document.getElementById('pos-cart-items');
    if (!container) return;
    bindCartDelegation(container);

    let subtotal = 0;
    let totalIgv = 0;
    let total = 0;

    const allocatedAmounts = orderAmounts(posCart, GLOBAL_IGVV_PCT);
    const grouped = new Map();
    posCart.forEach((item, index) => {
        const precioBase = item.precioBase != null ? item.precioBase : item.precio;
        const key = JSON.stringify([item.codPro, precioBase, item.afecto ? 1 : 0, item.notasRapidas || [], item.nota || '']);
        if (!grouped.has(key)) grouped.set(key, { item, indexes: [], cod: item.lineaId });
        grouped.get(key).indexes.push(index);
    });
    posCartGroupMembers = new Map([...grouped.values()].map(g => [g.cod, g.indexes.map(i => posCart[i].lineaId)]));

    const filas = [...grouped.values()].map(group => {
        const item = group.item;
        const esAfecto = item.afecto === 1 || item.afecto === true;
        const precioBaseUnit = item.precioBase != null ? item.precioBase : (item.precio / factorIgv(esAfecto));
        const cantidad = redondear2(group.indexes.reduce((sum, index) => sum + posCart[index].cantidad, 0));
        const importe = redondear2(group.indexes.reduce((sum, index) => sum + allocatedAmounts[index], 0));
        const subtotalLinea = redondear2(group.indexes.reduce((sum, index) => {
            const line = posCart[index], base = line.precioBase != null ? line.precioBase : precioBaseUnit;
            return sum + redondear2(base * line.cantidad);
        }, 0));
        const igvLinea = importe - subtotalLinea;
        subtotal += subtotalLinea;
        totalIgv += igvLinea;
        total += importe;

        const hasSent = group.indexes.some(index => !!posCart[index].enviada);
        const pendingAdded = redondear2(group.indexes.reduce((sum, index) => sum + (!posCart[index].enviada ? posCart[index].cantidad : 0), 0));
        const pendingLabel = hasSent && pendingAdded > 0 ? `<span class="order-quantity-pending">+${pendingAdded} pendiente de enviar</span>` : '';
        const pendingRecognition = group.indexes.some(index => posCart[index].pendienteId);
        const changesPending = group.indexes.some(index => orderLinePending(posCart[index]));
        const kitchenStatus = orderKitchenStatus(group.indexes.map(index => posCart[index]));
        const statusPrefix = pendingRecognition ? 'Cocina debe reconocer el cambio' : changesPending && hasSent ? 'Cambios pendientes' : '';
        const lineStatus = statusPrefix && kitchenStatus !== 'Sin enviar' ? `${statusPrefix} · ${kitchenStatus}` : statusPrefix || kitchenStatus;
        const canSplit = group.indexes.length === 1 && !item.enviada && item.cantidad > 0.01;
        const controles = (posIsReadOnly || pendingRecognition)
            ? `<div style="font-weight:bold; white-space:nowrap;">S/ ${importe.toFixed(2)}</div>`
            : `<div class="cart-item-controls">
                    <button type="button" class="qty-btn" data-action="dec" data-cod="${item.lineaId}">-</button>
                    <span>${cantidad}</span>
                    <button type="button" class="qty-btn" data-action="inc" data-cod="${item.lineaId}">+</button>
                    <button type="button" class="qty-btn" style="color:red" data-action="del" data-cod="${item.lineaId}"><i class="fas fa-times"></i></button>
                </div>
                <div style="font-weight:bold; margin-left:10px;">S/ ${importe.toFixed(2)}</div>`;

        return {
            cod: group.cod,
            html: `
                <div class="cart-item-info">
                    <span class="cart-item-name">${escapeOrderText(item.nombre)}</span>
                    <span class="cart-item-details">S/ ${item.precio.toFixed(2)} x ${cantidad}</span>
                    ${pendingLabel}
                    <span class="order-line-notes">${escapeOrderText(orderNotes(item))}</span>
                    <small class="order-kitchen-line-status">${escapeOrderText(lineStatus)}</small>
                    ${!posIsReadOnly ? `<span class="order-line-tools"><button type="button" data-action="notes" data-cod="${group.cod}" ${pendingRecognition ? 'disabled' : ''}>✎ Notas</button>
                    ${canSplit ? `<button type="button" data-action="split" data-cod="${group.cod}">Separar</button>` : ''}</span>` : ''}
                </div>${controles}`
        };
    });

    const claseEsperada = `cart-item ${posIsReadOnly ? 'read-only' : ''}`;
    const previosPorCod = {};
    container.querySelectorAll('.cart-item[data-cod]').forEach(el => {
        previosPorCod[el.dataset.cod] = el;
    });
    const codsActuales = new Set(filas.map(f => f.cod));

    const scrollPrevio = container.scrollTop;

    filas.forEach(f => {
        let el = previosPorCod[f.cod];
        if (!el) {
            el = document.createElement('div');
            el.dataset.cod = f.cod;
            el.innerHTML = f.html;
            container.appendChild(el);
        } else if (el.dataset.sig !== f.html) {
            el.innerHTML = f.html;
        }
        if (el.className !== claseEsperada) el.className = claseEsperada;
        el.dataset.sig = f.html;
        const position = filas.indexOf(f);
        if (container.children[position] !== el) container.insertBefore(el, container.children[position] || null);
    });

    Object.entries(previosPorCod).forEach(([cod, el]) => {
        if (!codsActuales.has(cod)) el.remove();
    });

    container.scrollTop = scrollPrevio;

    const cancellations = document.getElementById('order-pending-cancellations');
    if (cancellations) {
        cancellations.hidden = !orderPendingCancellations.length;
        cancellations.replaceChildren();
        if (orderPendingCancellations.length) {
            const title = document.createElement('strong'); title.textContent = 'Anulaciones pendientes de enviar'; cancellations.appendChild(title);
            for (const line of orderPendingCancellations) {
                const row = document.createElement('div');
                row.textContent = `${fmtCantCocina(line.cantidad)} × ${line.nombre}${orderNotes(line) ? ` · ${orderNotes(line)}` : ''}`;
                cancellations.appendChild(row);
            }
        }
    }

    const emptyState = document.getElementById('pos-cart-empty');
    if (emptyState) emptyState.hidden = filas.length > 0 || orderPendingCancellations.length > 0;

    document.getElementById('pos-subtotal').innerText = `S/ ${subtotal.toFixed(2)}`;
    document.getElementById('pos-igv').innerText = `S/ ${totalIgv.toFixed(2)}`;
    document.getElementById('pos-total').innerText = `S/ ${total.toFixed(2)}`;
    updateCartFab();
    renderOrderStatus();
}

function removeCartGroup(memberIds) {
    if (posIsReadOnly || orderBusy) return;
    const ids = new Set(memberIds);
    if (posCart.some(line => ids.has(line.lineaId) && line.pendienteId)) return;
    posCart = posCart.filter(line => !ids.has(line.lineaId));
    updateCartUI(); scheduleAutoSave();
}

function changeQty(index, delta) {
    if (posIsReadOnly || orderBusy || posCart[index].pendienteId) return;
    if (delta > 0 && posCart[index].enviada) {
        const l = posCart[index]; posCart.push({ ...l, lineaId: newOrderId(), cantidad: delta, enviada: null, pendienteId: null, pendienteEnvio: true });
        updateCartUI(); scheduleAutoSave(); return;
    }
    posCart[index].cantidad += delta;
    if (posCart[index].cantidad <= 0) {
        removeFromCart(index);
    } else {
        updateCartUI();
        scheduleAutoSave();
    }
}

function removeFromCart(index) {
    if (posIsReadOnly || orderBusy || posCart[index].pendienteId) return;
    posCart.splice(index, 1);
    updateCartUI();
    scheduleAutoSave();
}

function clearCurrentOrder() {
    if (posIsReadOnly || orderBusy) return;
    if (posCart.some(l => l.pendienteId)) return alert('Cocina debe reconocer los cambios pendientes primero.');
    if (confirm("¿Limpiar todo el pedido?")) {
        posCart = [];
        updateCartUI();
        scheduleAutoSave();
    }
}

async function processPOSPayment() { return orderPay(); }

async function reabrirPedido() {
    if (!posCurrentNroTicket) return;
    if (!confirm('¿Reabrir este pedido? El ticket volverá a estado Guardada y la mesa a Ocupada.')) return;

    try {
        const res = await fetch(`/api/pos/pedido/${posCurrentNroTicket}/reabrir`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ empresa: posCurrentTableEmpresa, version: orderVersion, operacionId: orderOperation() })
        });
        const data = await res.json();

        if (data.success) {
            alert('Pedido reabierto - Mesa Ocupada');
            await openPOSOrder(posCurrentTable, posCurrentTableEmpresa);
        } else {
            alert(data.message);
        }
    } catch (e) {
        alert('Error de conexión');
    }
}

// Modificar showView para cargar POS
const originalShowView = showView;
showView = function(viewName) {
    if (viewName !== 'pos-order' && (orderBusy || orderConflict)) return;
    if (viewName !== 'pos-order' && (orderDirty || orderSavePromise)) {
        orderFlush().then(() => showView(viewName)).catch(e => alert(e.message)); return;
    }
    originalShowView(viewName);
    const cartTrigger = document.getElementById('pos-cart-fab');
    if (cartTrigger) cartTrigger.hidden = viewName !== 'pos-order';
    if (viewName !== 'pos-order') closeCartSheet();
    if (viewName === 'pos-tables') {
        closePOSTableGroups();
        loadPOSTables();
    }
    if (viewName === 'cocina') loadCocinaPedidos();
    if (viewName === 'cierres') loadShiftClosurePreview();
};

// ==========================================
//  RESPONSIVE: DRAWER DEL CARRITO (MÓVIL Y TABLET)
// ==========================================
const compactOrderMedia = window.matchMedia('(max-width: 1200px)');
let cartSheetReturnFocus = null;
let cartSheetFocusTimer = null;

function isCompactOrderView() { return compactOrderMedia.matches; }

function syncCartSheetAccessibility() {
    const sheet = document.getElementById('pos-order-sidebar');
    const trigger = document.getElementById('pos-cart-fab');
    if (!sheet || !trigger) return;
    const compact = isCompactOrderView();
    const open = sheet.classList.contains('open') && compact;
    sheet.setAttribute('aria-hidden', String(compact && !open));
    sheet.setAttribute('aria-modal', String(open));
    trigger.setAttribute('aria-expanded', String(open));
    const totals = document.getElementById('pos-totals-details');
    if (totals && !compact) totals.open = true;
}

function toggleCartSheet(force) {
    const sheet = document.getElementById('pos-order-sidebar');
    const backdrop = document.getElementById('cart-sheet-backdrop');
    if (!sheet || !backdrop || !isCompactOrderView()) return;
    const abrir = force !== undefined ? force : !sheet.classList.contains('open');
    clearTimeout(cartSheetFocusTimer);
    if (abrir && !sheet.classList.contains('open')) cartSheetReturnFocus = document.activeElement;
    sheet.classList.toggle('open', abrir);
    backdrop.classList.toggle('active', abrir);
    document.body.classList.toggle('cart-drawer-open', abrir);
    syncCartSheetAccessibility();
    if (abrir) cartSheetFocusTimer = setTimeout(() => {
        if (sheet.classList.contains('open') && isCompactOrderView() && !document.querySelector('dialog[open]')) document.getElementById('pos-cart-close')?.focus();
    }, 300);
    else {
        document.getElementById('pos-totals-details')?.removeAttribute('open');
        if (cartSheetReturnFocus?.isConnected) cartSheetReturnFocus.focus();
        cartSheetReturnFocus = null;
    }
}

function closeCartSheet() {
    const sheet = document.getElementById('pos-order-sidebar');
    const backdrop = document.getElementById('cart-sheet-backdrop');
    const wasOpen = sheet?.classList.contains('open');
    clearTimeout(cartSheetFocusTimer);
    if (sheet) sheet.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');
    document.body.classList.remove('cart-drawer-open');
    document.getElementById('pos-totals-details')?.removeAttribute('open');
    syncCartSheetAccessibility();
    if (wasOpen && cartSheetReturnFocus?.isConnected) cartSheetReturnFocus.focus();
    cartSheetReturnFocus = null;
}

compactOrderMedia.addEventListener('change', closeCartSheet);
document.addEventListener('keydown', event => {
    const sheet = document.getElementById('pos-order-sidebar');
    if (!sheet?.classList.contains('open') || !isCompactOrderView()) return;
    if (document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closeCartSheet();
        return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...sheet.querySelectorAll('button:not([disabled]):not([hidden]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')]
        .filter(element => element.getClientRects().length);
    if (!focusable.length) { event.preventDefault(); sheet.focus(); return; }
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
syncCartSheetAccessibility();

function updateCartFab() {
    const countEl = document.getElementById('pos-cart-fab-count');
    const totalEl = document.getElementById('pos-cart-fab-total');
    if (!countEl || !totalEl) return;
    const count = posCart.reduce((acc, i) => acc + i.cantidad, 0);
    const total = redondear2(orderAmounts(posCart, GLOBAL_IGVV_PCT).reduce((acc, amount) => acc + amount, 0));
    countEl.innerText = count;
    totalEl.innerText = `S/ ${total.toFixed(2)}`;
}

// ==========================================
//  REAL-TIME: SERVER-SENT EVENTS
// ==========================================
let sseConnection = null;
let sseRetryTimer = null;
let sessionRedirecting = false;
let appResumeTimer = null;
let appResumePromise = null;
let appResumePending = false;
let lastAppResumeAt = 0;
const APP_RESUME_DEBOUNCE_MS = 250;
const APP_RESUME_COOLDOWN_MS = 1200;

function appCanUseNetwork() {
    return document.visibilityState !== 'hidden' && navigator.onLine !== false;
}

function closeSSE() {
    clearTimeout(sseRetryTimer);
    sseRetryTimer = null;
    if (!sseConnection) return;
    sseConnection.onopen = null;
    sseConnection.onmessage = null;
    sseConnection.onerror = null;
    sseConnection.close();
    sseConnection = null;
}

function redirectExpiredSession() {
    if (sessionRedirecting) return;
    sessionRedirecting = true;
    closeSSE();
    window.location.replace('/login.html');
}

async function verifyActiveSession() {
    try {
        const res = await fetch('/api/session', { cache: 'no-store' });
        if (res.status === 401) {
            redirectExpiredSession();
            return false;
        }
        return res.ok;
    } catch (error) {
        console.warn('Sesión: no se pudo verificar al reactivar:', error.message);
        return false;
    }
}

function scheduleSSEReconnect() {
    if (sseRetryTimer || !appCanUseNetwork() || sessionRedirecting) return;
    sseRetryTimer = setTimeout(async () => {
        sseRetryTimer = null;
        if (!appCanUseNetwork()) return;
        if (!await verifyActiveSession()) {
            if (!sessionRedirecting) scheduleSSEReconnect();
            return;
        }
        connectSSE();
    }, 3000);
}

function connectSSE(force = false) {
    if (!appCanUseNetwork() || sessionRedirecting) return;
    if (sseConnection && !force) return;
    closeSSE();

    const connection = new EventSource('/api/events');
    sseConnection = connection;

    connection.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleSSEEvent(data);
        } catch (e) {
            console.error('SSE: Error parseando evento:', e);
        }
    };

    connection.onerror = () => {
        if (sseConnection !== connection) return;
        console.warn('SSE: Conexión perdida. Reconectando en 3s...');
        closeSSE();
        scheduleSSEReconnect();
    };
}

function isViewVisible(id) {
    const view = document.getElementById(id);
    return Boolean(view && view.style.display !== 'none');
}

async function reconcileActiveOrder() {
    if (!posCurrentTable || !posCurrentTableEmpresa) return;
    const hasProtectedWork = orderDirty || orderSavePromise || orderBusy || document.querySelector('dialog[open]');
    if (!hasProtectedWork) {
        await openPOSOrder(posCurrentTable, posCurrentTableEmpresa);
        return;
    }

    try {
        const data = await orderRequest(`/api/pos/pedido?mesa=${posCurrentTable}&empresa=${posCurrentTableEmpresa}`);
        if (Number(data.version || 0) !== Number(orderVersion || 0)) {
            orderConflict = true;
            orderSaveError = 'El pedido cambió mientras el dispositivo estaba en reposo. Revise la versión actual.';
            renderOrderStatus();
        }
    } catch (error) {
        if (error.status === 401) redirectExpiredSession();
        else console.warn('No se pudo reconciliar el pedido al reactivar:', error.message);
    }
}

async function reconcileActiveView() {
    if (isViewVisible('view-pos-tables')) {
        await loadPOSTables();
        return;
    }
    if (isViewVisible('view-pos-order')) {
        await reconcileActiveOrder();
        return;
    }
    if (isViewVisible('view-cocina')) await loadCocinaPedidos(true);
}

async function runAppResumeSync() {
    if (!appCanUseNetwork() || sessionRedirecting) return;
    if (appResumePromise) {
        appResumePending = true;
        return appResumePromise;
    }

    appResumePromise = (async () => {
        if (!await verifyActiveSession()) {
            if (!sessionRedirecting) scheduleAppResumeSync(3000);
            return;
        }
        connectSSE(true);
        await reconcileActiveView();
        lastAppResumeAt = Date.now();
    })().catch(error => console.warn('Reactivación: no se pudo actualizar la vista:', error.message))
        .finally(() => {
            appResumePromise = null;
            if (appResumePending) {
                appResumePending = false;
                scheduleAppResumeSync();
            }
        });
    return appResumePromise;
}

function scheduleAppResumeSync(delayOverride = null) {
    if (!appCanUseNetwork() || sessionRedirecting) return;
    clearTimeout(appResumeTimer);
    const cooldown = Math.max(0, APP_RESUME_COOLDOWN_MS - (Date.now() - lastAppResumeAt));
    appResumeTimer = setTimeout(() => {
        appResumeTimer = null;
        runAppResumeSync();
    }, delayOverride ?? Math.max(APP_RESUME_DEBOUNCE_MS, cooldown));
}

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleAppResumeSync();
    else {
        clearTimeout(sseRetryTimer);
        sseRetryTimer = null;
    }
});
window.addEventListener('pageshow', event => { if (event.persisted) scheduleAppResumeSync(); });
window.addEventListener('online', () => scheduleAppResumeSync());
window.addEventListener('offline', closeSSE);
window.addEventListener('focus', () => scheduleAppResumeSync());

function handleSSEEvent(data) {
    console.log('SSE: Evento recibido:', data);

    if (data.type === 'mesa_updated') {
        const empresaSelect = document.getElementById('pos-empresa-select');
        const empresaActual = empresaSelect ? empresaSelect.value : null;

        const tableView = document.getElementById('view-pos-tables');
        const isTableView = tableView && tableView.style.display !== 'none';

        if (isTableView && empresaActual && parseInt(data.empresa) === parseInt(empresaActual)) {
            console.log('SSE: Actualizando mapa de mesas...');
            loadPOSTables();
        }

        if (posCurrentTable && parseInt(data.numero) === parseInt(posCurrentTable) &&
            empresaActual && parseInt(data.empresa) === parseInt(empresaActual)) {
            const orderView = document.getElementById('view-pos-order');
            if (orderView && orderView.style.display !== 'none') {
                if (ownOrderOperations.has(data.operacionId)) {
                    console.log('SSE: Evento propio (eco del guardado), se omite recarga del pedido');
                    return;
                }
                if (orderDirty || orderSavePromise || orderBusy || document.getElementById('order-notes-dialog').open) {
                    if (data.version !== orderVersion) { orderConflict = true; orderSaveError = 'El pedido cambió en otro dispositivo. Revise la versión actual.'; renderOrderStatus(); }
                    return;
                }
                console.log('SSE: Mesa asignada cambió, recargando pedido...');
                openPOSOrder(posCurrentTable, posCurrentTableEmpresa);
            }
        }
    }

    if (data.type === 'impresion_updated' && posCurrentNroTicket && !orderDirty && !orderBusy) {
        orderRequest(`/api/pos/pedido?mesa=${posCurrentTable}&empresa=${posCurrentTableEmpresa}`).then(orderAccept).catch(() => {});
    }
    if (data.type === 'impresion_updated' && typeof cocinaTicketActual !== 'undefined' && cocinaTicketActual?.EnvioId === data.envioId) {
        cocinaTicketActual.Impresion = { estado: data.estado };
        const status = document.getElementById('cocina-ticket-print-status');
        if (status) status.textContent = estadoImpresionCocina(cocinaTicketActual.Impresion);
        const button = document.getElementById('cocina-ticket-print');
        if (button) button.disabled = ['en_cola','procesando'].includes(data.estado);
    }
    if (data.type === 'cocina_updated') {
        if (posCurrentNroTicket && data.nroTicket === posCurrentNroTicket &&
            Number(data.empresa) === Number(posCurrentTableEmpresa) && isPOSOrderViewVisible()) syncPOSKitchenStatuses();
        const cocinaView = document.getElementById('view-cocina');
        if (cocinaView && cocinaView.style.display !== 'none') {
            console.log('SSE: Actualizando tablero de cocina...');
            loadCocinaPedidos(true);
        }
    }
}

let kitchenStatusSync = null;
async function syncPOSKitchenStatuses() {
    if (!posCurrentNroTicket || kitchenStatusSync) return kitchenStatusSync;
    const nro = posCurrentNroTicket;
    kitchenStatusSync = orderRequest(`/api/pos/pedido/${encodeURIComponent(nro)}/estados-cocina?empresa=${posCurrentTableEmpresa}`)
        .then(data => {
            if (posCurrentNroTicket !== nro) return;
            const byId = new Map((data.estados || []).map(state => [state.lineaId, state]));
            for (const line of posCart) {
                const state = byId.get(line.lineaId);
                if (state) { line.estadoCocina = state.estadoCocina; line.pendienteId = state.pendienteId; line.anulada = state.anulada; }
            }
            if (!orderDirty && !orderSummary.pendientes) orderSummary.estado = orderKitchenHeadline(posCart);
            updateCartUI(); renderOrderStatus();
        }).catch(error => console.warn('No se pudieron sincronizar estados de Cocina:', error.message))
        .finally(() => { kitchenStatusSync = null; });
    return kitchenStatusSync;
}

connectSSE();

// ==========================================
//  FASE 21: PEDIDO COCINA (KDS)
// ==========================================
let cocinaFiltro = 'todas';
let cocinaSoundOn = false;
let cocinaUltimoTotal = null;
let cocinaFetchTime = null;
let cocinaData = [];
let cocinaAudioCtx = null;

function unlockCocinaAudio() {
    try {
        if (!cocinaAudioCtx) {
            cocinaAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (cocinaAudioCtx.state === 'suspended') cocinaAudioCtx.resume();
    } catch (e) { /* audio no disponible */ }
}

function toggleCocinaSound() {
    cocinaSoundOn = !cocinaSoundOn;
    const icon = document.getElementById('cocina-sound-icon');
    if (icon) icon.className = cocinaSoundOn ? 'fas fa-volume-high' : 'fas fa-volume-xmark';
    if (cocinaSoundOn) unlockCocinaAudio();
}

function playTonoCocina(frecuencia, inicio, duracion) {
    const ctx = cocinaAudioCtx;
    if (!ctx || ctx.state !== 'running') return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = frecuencia;
    const t0 = ctx.currentTime + inicio;
    gain.gain.setValueAtTime(0.4, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duracion);
    osc.start(t0);
    osc.stop(t0 + duracion);
}

function playCocinaBeep() {
    if (!cocinaSoundOn) return;
    try {
        if (!cocinaAudioCtx) unlockCocinaAudio();
        if (cocinaAudioCtx && cocinaAudioCtx.state === 'suspended') cocinaAudioCtx.resume();
        // Doble pitido para destacar en ambiente ruidoso
        playTonoCocina(880, 0, 0.25);
        playTonoCocina(660, 0.3, 0.35);
    } catch (e) { /* audio no disponible */ }
}

function setCocinaFiltro(f) {
    cocinaFiltro = f;
    document.querySelectorAll('.cocina-chip').forEach(c => c.classList.toggle('active', c.dataset.filtro === f));
    renderCocinaBoard();
}

function cocinaColorCategoria(nombre) {
    if (!nombre) return '#94a3b8';
    let hash = 0;
    for (let i = 0; i < nombre.length; i++) hash = nombre.charCodeAt(i) + ((hash << 5) - hash);
    const paleta = ['#ef4444', '#f97316', '#d97706', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777'];
    return paleta[Math.abs(hash) % paleta.length];
}

function fmtCantCocina(c) {
    const n = parseFloat(c);
    return Number.isInteger(n) ? n : n.toFixed(2).replace(/\.?0+$/, '');
}

function semaforoCocina(minutos) {
    if (minutos >= 20) return 'tarde';
    if (minutos >= 10) return 'por-vencer';
    return 'a-tiempo';
}

function isCocinaViewVisible() {
    const v = document.getElementById('view-cocina');
    return v && v.style.display !== 'none';
}

async function loadCocinaPedidos(silencioso = false) {
    const empresaSelect = document.getElementById('cocina-empresa-select');
    const board = document.getElementById('cocina-board');
    if (!empresaSelect || !board) return;
    if (typeof cocinaVista !== 'undefined' && cocinaVista === 'historial') return loadCocinaHistorial(1);
    if (!empresaSelect.value) {
        cocinaData = [];
        renderCocinaBoard();
        return;
    }

    try {
        const res = await fetch(`/api/cocina/pedidos?empresa=${empresaSelect.value}`);
        const data = await res.json();
        if (!res.ok) {
            const message = res.status === 401 ? 'Sesión expirada. Vuelva a iniciar sesión.' : res.status === 400 ? 'Seleccione una empresa válida.' : res.status === 404 ? 'No hay configuración de cocina para esta empresa.' : 'No se pudo cargar la cocina. Revise el registro del servidor.';
            throw new Error(message);
        }
        // Normaliza el contrato agrupado de la API al modelo interno del tablero.
        cocinaData = (data.pedidos || []).flatMap(p => (p.lineas || []).map(l => ({
            NroTicket: p.nroTicket, NroMesa: p.mesa, EnvioId: p.envioId, NumeroEnvio: p.numeroEnvio, Mozo: p.mozo,
            FechaTicket: p.fechaEnvio, MinutosEspera: p.minutosEspera, Documento: p.documento,
            Impresion: p.impresion,
            EstadoCocina: l.estado, LineaId: l.lineaId, Codpro: l.codPro, Cantidad: l.cantidad,
            Descripcion: l.nombre, notasRapidas: l.notasRapidas || [], nota: l.nota || '',
            Categoria: l.Categoria, pendiente: l.correccionPendiente || null
        })));
        cocinaFetchTime = Date.now();

        const totalTickets = new Set(cocinaData.map(r => r.NroTicket)).size;
        if (cocinaSoundOn && cocinaUltimoTotal !== null && totalTickets > cocinaUltimoTotal) {
            playCocinaBeep();
        }
        cocinaUltimoTotal = totalTickets;

        renderCocinaBoard();
    } catch (e) {
        console.error(e);
        if (!silencioso) alert(e.message);
    }
}

function agruparCocinaPorTicket() {
    const mapa = new Map();
    cocinaData.forEach(r => {
        if (!mapa.has(r.NroTicket)) {
            mapa.set(r.NroTicket, {
                NroTicket: r.NroTicket,
                NroMesa: r.NroMesa,
                FechaTicket: r.FechaTicket,
                MinutosEspera: r.MinutosEspera || 0,
                EnvioId: r.EnvioId, NumeroEnvio: r.NumeroEnvio, Mozo: r.Mozo, Documento: r.Documento, Impresion: r.Impresion,
                lineas: []
            });
        }
        mapa.get(r.NroTicket).lineas.push(r);
    });
    return Array.from(mapa.values()).sort((a, b) =>
        new Date(a.FechaTicket) - new Date(b.FechaTicket));
}

function columnaDeTicket(t) {
    if (t.lineas.some(l => l.pendiente)) return 'pendiente';
    const estados = t.lineas.map(l => l.EstadoCocina);
    if (estados.every(e => e === 3)) return 'listo';
    if (estados.every(e => e >= 2)) return 'preparacion';
    return 'pendiente';
}

function renderCocinaBoard() {
    const board = document.getElementById('cocina-board');
    if (!board) return;

    const columnas = {
        pendiente: board.querySelector('[data-col="pendiente"] .cocina-col-body'),
        preparacion: board.querySelector('[data-col="preparacion"] .cocina-col-body'),
        listo: board.querySelector('[data-col="listo"] .cocina-col-body')
    };
    Object.values(columnas).forEach(b => { if (b) b.innerHTML = ''; });

    const tickets = agruparCocinaPorTicket();

    document.querySelectorAll('.cocina-columna').forEach(col => {
        const colKey = col.dataset.col;
        const count = tickets.filter(t => columnaDeTicket(t) === colKey &&
            (cocinaFiltro === 'todas' || cocinaFiltro === colKey)).length;
        const countEl = col.querySelector('.cocina-col-count');
        if (countEl) countEl.innerText = count;
    });

    if (!cocinaData.length) {
        columnas.pendiente.innerHTML =
            '<div class="cocina-vacio"><i class="fas fa-mug-hot"></i><p>Sin comandas pendientes</p></div>';
        return;
    }

    tickets.forEach(t => {
        const colKey = columnaDeTicket(t);
        if (cocinaFiltro !== 'todas' && cocinaFiltro !== colKey) return;
        const card = construirTarjetaCocina(t);
        columnas[colKey].appendChild(card);
    });

    document.querySelectorAll('.cocina-columna').forEach(col => {
        const body = col.querySelector('.cocina-col-body');
        col.classList.toggle('sin-tarjetas', !body || body.children.length === 0);
    });
}

function construirTarjetaCocina(t) {
    const minutos = (t.MinutosEspera || 0) +
        (cocinaFetchTime ? Math.floor((Date.now() - cocinaFetchTime) / 60000) : 0);
    const todosListos = t.lineas.every(l => l.EstadoCocina >= 3 && !l.pendiente);

    const card = document.createElement('div');
    card.className = `cocina-card ${semaforoCocina(minutos)} ${todosListos ? 'todos-listos' : ''}`;
    card.dataset.minutos = t.MinutosEspera || 0;
    card.dataset.ticket = t.NroTicket;

    const head = document.createElement('div');
    head.className = 'cocina-card-head';
        head.innerHTML = `
        <span class="cocina-ticket">${t.NroTicket}</span>
        <span class="cocina-mesa">Mesa ${t.NroMesa}</span>
        <span class="cocina-envio">Envío ${t.NumeroEnvio || '—'}</span>
        <span class="cocina-mozo">${escapeOrderText(t.Mozo || '')}</span>
        <span class="cocina-timer"><i class="fas fa-stopwatch"></i> ${minutos}'</span>
    `;
    card.appendChild(head);

    const items = document.createElement('div');
    items.className = 'cocina-items';
    t.lineas.forEach(l => {
        const item = document.createElement('div');
        item.className = `cocina-item estado-${l.EstadoCocina}`;
        item.onclick = () => l.pendiente ? null : ciclarCocinaLinea(t.NroTicket, l.LineaId, l.EstadoCocina);
        item.innerHTML = `
            <span class="cocina-item-chip" style="background:${cocinaColorCategoria(l.Categoria)}"></span>
            <span class="cocina-item-cant">${fmtCantCocina(l.Cantidad)}×</span>
            <span class="cocina-item-nombre">${escapeOrderText(l.Descripcion)}<small class="order-line-notes">${escapeOrderText(orderNotes(l))}</small></span>
            <i class="fas fa-check cocina-item-check"></i>
        `;
        if (l.pendiente) {
            const notice = document.createElement('div'); notice.className = 'kitchen-correction';
            const m = l.pendiente;
            const text = document.createElement('p'); text.textContent = `${m.tipo} · ANTES: ${m.anterior?.cantidad || 0} × ${m.anterior?.nombre || ''} ${orderNotes(m.anterior || {})} → AHORA: ${m.nueva ? `${m.nueva.cantidad} × ${m.nueva.nombre} ${orderNotes(m.nueva)}` : 'ANULADO'}`;
            const ack = document.createElement('button'); ack.textContent = 'Reconocer cambio';
            ack.onclick = e => { e.stopPropagation(); acknowledgeKitchenLine(t.NroTicket, l.LineaId); };
            notice.append(text, ack); item.append(notice);
        }
        items.appendChild(item);
    });
    card.appendChild(items);

    const actions = document.createElement('div');
    actions.className = 'cocina-card-actions';
    if (todosListos) {
        actions.innerHTML = `<button type="button" class="cocina-btn-entregar" onclick="entregarCocina('${t.NroTicket}')">
            <i class="fas fa-check-double"></i> ENTREGAR</button>`;
    } else {
        actions.innerHTML = `<button type="button" class="cocina-btn-listo" onclick="todoListoCocina('${t.NroTicket}')">
            <i class="fas fa-bell-concierge"></i> TODO LISTO</button>`;
    }
    card.appendChild(actions);

    const ticketBtn = document.createElement('button');
    ticketBtn.type = 'button'; ticketBtn.className = 'cocina-btn-ticket'; ticketBtn.textContent = 'Ver ticket';
    ticketBtn.onclick = e => { e.stopPropagation(); abrirTicketCocina(t); };
    actions.appendChild(ticketBtn);

    return card;
}

let cocinaTicketActual = null;
let cocinaPrintAttempt = null;
function estadoImpresionCocina(impresion) {
    if (!APP_FEATURES.printerEnabled) return 'Impresión física deshabilitada.';
    if (!impresion) return 'Documento listo para imprimir.';
    const labels = { en_cola:'En cola de impresión', procesando:'Transmitiendo a impresora', enviado:'Enviado a impresora', error:'Error de impresión', incierto:'Impresión incierta: revise el papel antes de reimprimir' };
    const estado = impresion.estado || impresion.Estado;
    const error = impresion.error || impresion.Error;
    return `${labels[estado] || estado}${error ? `: ${error}` : ''}`;
}
function abrirTicketCocina(t) {
    const dialog = document.getElementById('cocina-ticket-dialog');
    const pre = document.getElementById('cocina-ticket-documento');
    if (!dialog || !pre) return;
    cocinaTicketActual = t;
    cocinaPrintAttempt = null;
    const printButton = document.getElementById('cocina-ticket-print');
    const estado = t.Impresion?.estado || t.Impresion?.Estado;
    if (printButton) {
        printButton.classList.toggle('feature-disabled', !APP_FEATURES.printerEnabled);
        printButton.disabled = !APP_FEATURES.printerEnabled || !t.EnvioId || ['en_cola','procesando'].includes(estado);
    }
    if (t.Documento) {
        pre.textContent = t.Documento;
        const status = document.getElementById('cocina-ticket-print-status');
        if (status) status.textContent = estadoImpresionCocina(t.Impresion);
        dialog.showModal(); return;
    }
    const fecha = t.FechaTicket ? new Date(t.FechaTicket).toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false }) : '';
    const lines = ['COMANDA DE COCINA', `Ticket: ${t.NroTicket}`, `Envío: ${t.NumeroEnvio || '—'}`, `Mesa: ${t.NroMesa}`, `Mozo: ${t.Mozo || ''}`, `Fecha: ${fecha}`, '------------------------------'];
    t.lineas.forEach(l => {
        const movement = l.pendiente;
        lines.push(movement ? movement.tipo : 'ADICIÓN');
        const render = x => { if (!x) return; lines.push(`${fmtCantCocina(x.cantidad)} x ${x.nombre}`); [...(x.notasRapidas || []), x.nota || ''].filter(Boolean).forEach(n => lines.push(`  NOTA: ${n}`)); };
        if (movement?.anterior) { lines.push('ANTES:'); render(movement.anterior); }
        lines.push(movement ? 'AHORA:' : ''); render(movement?.nueva || l);
        lines.push('------------------------------');
    });
    pre.textContent = lines.filter(Boolean).join('\n');
    const status = document.getElementById('cocina-ticket-print-status');
    if (status) status.textContent = t.Documento ? 'Documento registrado en la cola de impresión.' : 'Documento aún no disponible.';
    dialog.showModal();
}

async function imprimirTicketCocina() {
    const t = cocinaTicketActual, button = document.getElementById('cocina-ticket-print');
    const status = document.getElementById('cocina-ticket-print-status');
    if (!APP_FEATURES.printerEnabled || !t?.EnvioId || !t?.NroTicket || button?.disabled) return;
    button.disabled = true;
    if (status) status.textContent = 'Solicitando impresión…';
    try {
        cocinaPrintAttempt ||= newOrderId();
        await orderRequest(`/api/pos/pedido/${encodeURIComponent(t.NroTicket)}/envios/${encodeURIComponent(t.EnvioId)}/reimprimir`, 'POST',
            { empresa: kitchenCompany(), clave: cocinaPrintAttempt });
        if (status) status.textContent = 'Reimpresión en cola.';
    } catch (e) {
        if (status) status.textContent = e.message;
        button.disabled = false;
    }
}

let cocinaVista = 'tablero';
function limaDateInput() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' });
}
function setCocinaVista(vista) {
    cocinaVista = vista === 'historial' ? 'historial' : 'tablero';
    document.querySelectorAll('.cocina-view-tab').forEach(b => b.classList.toggle('active', b.dataset.vista === cocinaVista));
    document.getElementById('cocina-board').hidden = cocinaVista !== 'tablero';
    document.getElementById('cocina-chips').hidden = cocinaVista !== 'tablero';
    document.getElementById('cocina-history').hidden = cocinaVista !== 'historial';
    if (cocinaVista === 'historial') {
        const from = document.getElementById('cocina-history-from'), to = document.getElementById('cocina-history-to');
        if (!from.value) from.value = limaDateInput();
        if (!to.value) to.value = limaDateInput();
        loadCocinaHistorial(1);
    }
}
async function loadCocinaHistorial(page = 1) {
    const empresa = document.getElementById('cocina-empresa-select').value;
    const results = document.getElementById('cocina-history-results');
    if (!empresa) { results.textContent = 'Seleccione una empresa.'; return; }
    const params = new URLSearchParams({ empresa, pagina: page, tamano: 20,
        desde: document.getElementById('cocina-history-from').value,
        hasta: document.getElementById('cocina-history-to').value,
        mesa: document.getElementById('cocina-history-table').value,
        ticket: document.getElementById('cocina-history-ticket').value,
        estado: document.getElementById('cocina-history-state').value });
    results.textContent = 'Cargando historial…';
    try {
        const data = await orderRequest(`/api/cocina/historial?${params}`);
        results.replaceChildren();
        if (!data.envios.length) results.textContent = 'No hay envíos para estos filtros.';
        for (const envio of data.envios) {
            const article = document.createElement('article'); article.className = 'cocina-history-card';
            const heading = document.createElement('h3'); heading.textContent = `${envio.nroTicket} · Envío ${envio.Numero}`;
            const meta = document.createElement('p');
            meta.textContent = `Mesa ${envio.NroMesa} · ${new Date(envio.Fecha).toLocaleString('es-PE', { timeZone: 'America/Lima', hour12: false })} · ${envio.estadoPedido}`;
            const audit = document.createElement('p'); audit.textContent = `${envio.Movimientos} movimiento(s) · ${envio.Reconocidos} reconocimiento(s)`;
            const actions = document.createElement('div'); actions.className = 'cocina-history-actions';
            const view = document.createElement('button'); view.type = 'button'; view.textContent = 'Ver ticket';
            const latestJob = envio.trabajos[envio.trabajos.length - 1] || null;
            view.onclick = () => abrirTicketCocina({ Documento: envio.Documento, NroTicket: envio.nroTicket,
                EnvioId: envio.Id, Impresion: latestJob }); actions.appendChild(view);
            if (APP_FEATURES.printerEnabled) {
                const reprint = document.createElement('button'); reprint.type = 'button'; reprint.textContent = 'Reimprimir';
                reprint.disabled = envio.trabajos.some(j => ['en_cola','procesando'].includes(j.Estado));
                reprint.onclick = async () => {
                    if (!confirm('Revise si el ticket ya salió. Se imprimirá una copia marcada REIMPRESIÓN.')) return;
                    reprint.disabled = true;
                    try { await orderRequest(`/api/pos/pedido/${encodeURIComponent(envio.nroTicket)}/envios/${envio.Id}/reimprimir`, 'POST', { empresa: Number(empresa), clave: newOrderId() }); await loadCocinaHistorial(page); }
                    catch (e) { alert(e.message); reprint.disabled = false; }
                };
                actions.appendChild(reprint);
            }
            article.append(heading, meta, audit, actions); results.appendChild(article);
        }
        const pages = Math.max(1, Math.ceil(data.total / data.tamano));
        const pager = document.getElementById('cocina-history-pagination'); pager.replaceChildren();
        const previous = document.createElement('button'); previous.textContent = 'Anterior'; previous.disabled = data.pagina <= 1; previous.onclick = () => loadCocinaHistorial(data.pagina - 1);
        const label = document.createElement('span'); label.textContent = `Página ${data.pagina} de ${pages}`;
        const next = document.createElement('button'); next.textContent = 'Siguiente'; next.disabled = data.pagina >= pages; next.onclick = () => loadCocinaHistorial(data.pagina + 1);
        pager.append(previous, label, next);
    } catch (e) { results.textContent = e.message; }
}

async function ciclarCocinaLinea(nroTicket, lineaId, estadoActual) {
    const siguiente = estadoActual < 3 ? estadoActual + 1 : null;
    if (!siguiente) return;
    try {
        const res = await fetch('/api/cocina/linea', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nroTicket, lineaId, empresa: kitchenCompany(), estado: siguiente })
        });
        if (!res.ok) throw new Error(await res.text());
        const fila = cocinaData.find(r => r.NroTicket === nroTicket && r.LineaId === lineaId);
        if (fila) fila.EstadoCocina = siguiente;
        renderCocinaBoard();
    } catch (e) {
        console.error(e);
        alert('Error al actualizar el plato: ' + e.message);
    }
}

async function todoListoCocina(nroTicket) {
    try {
        const res = await fetch(`/api/cocina/ticket/${nroTicket}/todo-listo`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ empresa: kitchenCompany() }) });
        if (!res.ok) throw new Error(await res.text());
        await loadCocinaPedidos(true);
    } catch (e) {
        console.error(e);
        alert('Error: ' + e.message);
    }
}

async function entregarCocina(nroTicket) {
    try {
        const res = await fetch(`/api/cocina/ticket/${nroTicket}/entregado`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ empresa: kitchenCompany() }) });
        if (!res.ok) throw new Error(await res.text());
        cocinaData = cocinaData.filter(r => r.NroTicket !== nroTicket);
        cocinaUltimoTotal = new Set(cocinaData.map(r => r.NroTicket)).size;
        renderCocinaBoard();
    } catch (e) {
        console.error(e);
        alert('Error: ' + e.message);
    }
}

setInterval(() => {
    if (!isCocinaViewVisible() || !cocinaData.length || !cocinaFetchTime) return;
    const transcurrido = Math.floor((Date.now() - cocinaFetchTime) / 60000);
    document.querySelectorAll('.cocina-card').forEach(card => {
        const base = parseInt(card.dataset.minutos) || 0;
        const minutos = base + transcurrido;
        const timer = card.querySelector('.cocina-timer');
        if (timer) timer.innerHTML = `<i class="fas fa-stopwatch"></i> ${minutos}'`;
        ['a-tiempo', 'por-vencer', 'tarde'].forEach(c => card.classList.remove(c));
        card.classList.add(semaforoCocina(minutos));
    });
}, 30000);

// ==========================================
// FASE 24: CIERRE Y RETENCION DE TURNOS
// ==========================================
let selectedShiftClosure = null;
function shiftCloseScope() {
    const date = document.getElementById('shift-close-date');
    if (date && !date.value) date.value = limaDateInput();
    return { empresa: Number(document.getElementById('shift-close-company').value),
        turno: Number(document.getElementById('shift-close-turn').value), fechaNegocio: date.value };
}
function renderShiftClosurePreview(data) {
    const container = document.getElementById('shift-close-preview');
    if (!container) return;
    selectedShiftClosure = data.cierre || null;
    container.replaceChildren();
    const summary = document.createElement('div'); summary.className = 'shift-close-summary';
    const metrics = [
        ['Tickets identificados', data.totalTickets], ['Pedidos activos', data.bloqueos.pedidosActivos],
        ['Cocina pendiente', data.bloqueos.cocinaPendiente], ['Correcciones', data.bloqueos.correccionesPendientes],
        ['Impresiones activas', data.bloqueos.impresionesActivas]
    ];
    for (const [label, value] of metrics) {
        const metric = document.createElement('div'); metric.className = 'shift-close-metric';
        const strong = document.createElement('strong'); strong.textContent = value;
        metric.append(strong, document.createTextNode(label)); summary.append(metric);
    }
    container.append(summary);
    const status = document.createElement('p'); status.className = data.elegible ? 'shift-close-ok' : 'shift-close-warning';
    status.textContent = data.elegible ? 'El alcance no tiene operaciones pendientes.' : 'Resuelva los bloqueos antes de cerrar.'; container.append(status);
    if (data.registrosSinTurno) {
        const warning = document.createElement('p'); warning.className = 'shift-close-warning';
        warning.textContent = `${data.registrosSinTurno} registro(s) históricos de la empresa no tienen turno/fecha verificables y no serán purgados.`; container.append(warning);
    }
    if (selectedShiftClosure) {
        const existing = document.createElement('p'); existing.textContent = `Cierre: ${selectedShiftClosure.estado}. Purga prevista: ${selectedShiftClosure.purgaProgramada ? new Date(selectedShiftClosure.purgaProgramada).toLocaleString('es-PE') : '—'}`;
        container.append(existing);
    }
    const canClose = data.elegible && (!selectedShiftClosure || selectedShiftClosure.estado === 'reabierto');
    document.getElementById('shift-close-submit').disabled = !canClose;
    document.getElementById('shift-reopen-submit').disabled = !selectedShiftClosure || !['cerrado','error'].includes(selectedShiftClosure.estado);
    document.getElementById('shift-purge-submit').disabled = !selectedShiftClosure || !['cerrado','error'].includes(selectedShiftClosure.estado) || new Date(selectedShiftClosure.purgaProgramada) > new Date();
}
async function loadShiftClosurePreview() {
    const container = document.getElementById('shift-close-preview'); if (!container) return;
    const params = new URLSearchParams(shiftCloseScope()); container.textContent = 'Revisando datos del turno…';
    try { renderShiftClosurePreview(await orderRequest(`/api/admin/cierres/preview?${params}`)); }
    catch (error) { selectedShiftClosure = null; container.textContent = error.message; }
}
async function shiftClosureAction(url, confirmacion, question) {
    const pin = document.getElementById('shift-close-pin');
    if (!pin.value) return alert('Ingrese el PIN de mantenimiento.');
    if (!confirm(question)) return;
    const buttons = document.querySelectorAll('.shift-close-actions button'); buttons.forEach(button => { button.disabled = true; });
    try { await orderRequest(url, 'POST', { ...shiftCloseScope(), pin: pin.value, confirmacion, clave: newOrderId() }); await loadShiftClosurePreview(); }
    catch (error) { alert(error.message); }
    finally { pin.value = ''; }
}
function closeSelectedShift() {
    return shiftClosureAction('/api/admin/cierres', 'CERRAR TURNO', 'El turno quedará cerrado y sus datos se archivarán. ¿Continuar?');
}
function reopenSelectedShift() {
    if (!selectedShiftClosure) return;
    return shiftClosureAction(`/api/admin/cierres/${selectedShiftClosure.id}/reabrir`, 'REABRIR TURNO', '¿Reabrir este turno y retirar su archivo pendiente?');
}
function purgeSelectedShift() {
    if (!selectedShiftClosure) return;
    return shiftClosureAction(`/api/admin/cierres/${selectedShiftClosure.id}/purgar`, 'PURGAR DATOS', 'La retención venció. Se borrarán los auxiliares ya archivados. ¿Continuar?');
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const target = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', target);
    localStorage.setItem('theme', target);
    updateIcon(target);
}
function updateIcon(theme) {
    const icon = document.getElementById('theme-icon');
    if (icon) icon.className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
}
function closeModal(id) { document.getElementById(id).style.display = "none"; }

function toTitleCase(str) {
    return str.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

// ==========================================
//  MÓDULO: PRODUCTOS ALMACÉN (CRUD)
// ==========================================
async function cargarListasProductos() {
    /*
    if (document.getElementById('p-linea').options.length > 1) return;
    try {
        const res = await fetch('/api/productos/listas');
        const data = await res.json();
        llenarSelect('p-linea', data.lineas, 'CodLinea', 'Descripcion');
        llenarSelect('p-proveedor', data.proveedores, 'CodProv', 'Razon');
        llenarSelect('p-unimed', data.unidades, 'n_numero', 'c_describe');
        llenarSelect('p-tipo', data.tipos, 'id', 'nombre');
    } catch (e) { console.error(e); }*/
    try {
        const res = await fetch('/api/productos/listas');
        const data = await res.json();

        // Llenar selects
        llenarSelect('p-linea', data.lineas, 'CodLinea', 'Descripcion');
        llenarSelect('p-proveedor', data.proveedores, 'CodProv', 'Razon');
        llenarSelect('p-unimed', data.unidades, 'n_numero', 'c_describe');
        llenarSelect('p-tipo', data.tipos, 'id', 'nombre');

        // --- NUEVO: LEER VALORES DE TABLA ---
        if (data.valores) {
            const valIgv = data.valores.find(v => v.c_valor.trim() === 'Igv');
            const valIgvv = data.valores.find(v => v.c_valor.trim() === 'Igvv');

            if (valIgv) GLOBAL_IGV_PCT = valIgv.n_valor;
            if (valIgvv) GLOBAL_IGVV_PCT = valIgvv.n_valor;

            console.log("Valores cargados:", GLOBAL_IGV_PCT, GLOBAL_IGVV_PCT);
        }

    } catch (e) { console.error(e); }
}

function llenarSelect(id, lista, valKey, textKey) {
    const sel = document.getElementById(id);
    sel.innerHTML = '<option value="" disabled selected>Seleccione</option>';
    lista.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item[valKey]; opt.innerText = item[textKey];
        sel.appendChild(opt);
    });
}
async function cargarClases(codLinea, selectedClase = null) {
    const sel = document.getElementById('p-clase');
    sel.innerHTML = '<option>Cargando...</option>';
    try {
        const res = await fetch(`/api/productos/clases/${codLinea}`);
        const data = await res.json();
        sel.innerHTML = '<option value="" disabled selected>Seleccione</option>';
        data.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.CodClase; opt.innerText = item.Descripcion;
            sel.appendChild(opt);
        });
        if (selectedClase) sel.value = selectedClase;
    } catch (e) { console.error(e); }
}
async function generarCodigoProducto() {
    const empresa = document.getElementById('p-empresa-gen').value;
    if (!empresa) return;
    if (document.getElementById('p-codigo').readOnly && document.getElementById('p-codigo').value !== '') {
        if (document.getElementById('modal-producto-title').innerText.includes('Editar')) return;
    }
    try {
        const res = await fetch(`/api/productos/nuevo-codigo/${empresa}`);
        const data = await res.json();
        document.getElementById('p-codigo').value = data.codigo;
    } catch (e) { console.error(e); }
}
const IGV_FACTOR = 1.18;

function calcularPrecios() {
    /*
    const costo = parseFloat(document.getElementById('p-costo').value) || 0;
    const afecto = document.getElementById('p-afecto').checked;
    let costoReal = costo;
    if (afecto) costoReal = costo * IGV_FACTOR;
    document.getElementById('p-costoreal').value = costoReal.toFixed(2);*/

    // Ahora el usuario ingresa el COSTO REAL (Con IGV)
    const costoReal = parseFloat(document.getElementById('p-costoreal').value) || 0;
    const afecto = document.getElementById('p-afecto').checked;

    let costoSinIgv = costoReal;

    if (afecto) {
        // Fórmula: Base = Total / (1 + (Porcentaje/100))
        const factor = 1 + (GLOBAL_IGV_PCT / 100);
        costoSinIgv = costoReal / factor;
    }

    // Llenamos el input readonly P. Costo
    document.getElementById('p-costo').value = costoSinIgv.toFixed(2);
}

function calcularVenta() {
    // El usuario ingresa PRECIO FINAL
    const precioFinal = parseFloat(document.getElementById('p-preciofinal').value) || 0;
    const afecto = document.getElementById('p-afecto').checked;

    let valorVenta = precioFinal;

    // Regla: Siempre dividir entre 1.10 para hallar el valor de venta base
    // Usamos la constante 1.10 directamente o la variable global si prefieres
    // Como pediste explícitamente 1.10 (10%), usaremos esa lógica dura o la variable GLOBAL_IGVV_PCT.

    if (afecto) {
        // Usamos la variable global cargada de la BD (que debería ser 10)
        // Factor = 1 + (10 / 100) = 1.10
        const factor = 1 + (GLOBAL_IGVV_PCT / 100);
        valorVenta = precioFinal / factor;
    }

    document.getElementById('p-pventa').value = valorVenta.toFixed(2);
}

// 5. CRUD: Buscar y Listar (BLINDADO Y CORREGIDO PAGINACIÓN)
async function buscarProductos(resetPage = false) {
    // CORRECCIÓN: Usamos 'prodPage' en lugar de 'productPage'
    if (resetPage) prodPage = 1;

    const inputSearch = document.getElementById('prod-search');
    const selectEmpresa = document.getElementById('prod-filter-empresa');

    if (!selectEmpresa) return;

    let empresa = selectEmpresa.value;

    if (!empresa || empresa === "") {
        if (selectEmpresa.options.length > 0) {
            empresa = selectEmpresa.options[0].value;
            selectEmpresa.value = empresa;
        } else {
            empresa = "02";
        }
    }

    const q = inputSearch ? inputSearch.value.trim() : '';

    const tbody = document.querySelector('#productos-table tbody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">Cargando...</td></tr>';

    try {
        // CORRECCIÓN: Usamos 'prodPage' en la URL
        const url = `/api/productos/buscar?q=${encodeURIComponent(q)}&empresa=${encodeURIComponent(empresa)}&page=${prodPage}`;

        const res = await fetch(url);

        if (!res.ok) throw new Error('Error en petición');
        const data = await res.json();

        if (tbody) {
            tbody.innerHTML = '';
            if (data.length === 0) {
                tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">No se encontraron productos</td></tr>';
                return;
            }

            data.forEach(p => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${p.CodPro}</td>
                    <td>${p.Nombre}</td>
                    <td>${p.Linea || '-'}</td>
                    <td>${p.Stock}</td>
                    <td>${p.Costo.toFixed(2)}</td>
                    <td>${p.PventaMa ? p.PventaMa.toFixed(2) : '0.00'}</td>
                    <td>
                        <div class="action-buttons">
                            <button class="btn-update btn-sm" onclick='abrirModalProducto("${p.CodPro}")'><i class="fas fa-edit"></i></button>
                            <button class="btn-delete btn-sm" onclick="eliminarProducto('${p.CodPro}')"><i class="fas fa-trash"></i></button>
                        </div>
                    </td>`;
                tbody.appendChild(tr);
            });
        }

        // CORRECCIÓN: Usamos 'prodPage' para actualizar el texto
        const pageInfo = document.getElementById('prod-page-info');
        if (pageInfo) pageInfo.innerText = `Pág ${prodPage}`;

    } catch (e) {
        console.error(e);
        if (tbody) tbody.innerHTML = '<tr><td colspan="7" style="color:var(--red-status); text-align:center">Error de servidor</td></tr>';
    }
}

async function abrirModalProducto(codPro) {
    const modal = document.getElementById('modal-producto');
    const form = document.getElementById('form-producto');
    const title = document.querySelector('#modal-producto h2');
    if (!title.id) title.id = 'modal-producto-title';
    await cargarListasProductos();

    if (codPro) {
        document.getElementById('modal-producto-title').innerText = "Editar Producto";
        document.getElementById('p-empresa-gen').disabled = true;
        try {
            const res = await fetch(`/api/productos/${codPro}`);
            const p = await res.json();
            document.getElementById('p-codigo').value = p.CodPro;
            document.getElementById('p-codbar').value = p.CodBar || '';
            document.getElementById('p-nombre').value = p.Nombre;
            document.getElementById('p-linea').value = p.Clinea;
            await cargarClases(p.Clinea, p.Clase);
            document.getElementById('p-proveedor').value = p.CodProv;
            document.getElementById('p-peso').value = p.Peso;
            document.getElementById('p-stock').value = p.Stock;
            document.getElementById('p-afecto').checked = p.Afecto;
            document.getElementById('p-tipo').value = p.Tipo;
            document.getElementById('p-unimed').value = p.Unimed;
            document.getElementById('p-costo').value = p.Costo;
            document.getElementById('p-costoreal').value = p.CosReal ? p.CosReal.toFixed(2) : '0.00';
            // Lógica inversa: La BD tiene el Valor Venta Base (PventaMa)
            // Queremos mostrar el Precio Final (Base * 1.10)
            let baseVentaBD = p.PventaMa !== null && p.PventaMa !== undefined ? p.PventaMa : 0;
            let precioFinalCalc = baseVentaBD;

            if (p.Afecto) {
                // Si es afecto, multiplicamos por 1.10 para mostrar el precio final
                const factor = 1 + (GLOBAL_IGVV_PCT / 100);
                precioFinalCalc = baseVentaBD * factor;
            }

            document.getElementById('p-preciofinal').value = parseFloat(precioFinalCalc).toFixed(2);

            document.getElementById('p-tempmax').value = p.TemMax;
            document.getElementById('p-tempmin').value = p.TemMin;
            document.getElementById('p-comision').value = p.Comision || 0;
            lockComision(); // Siempre inicia bloqueado al abrir
            calcularPrecios(); calcularVenta();
        } catch (e) { alert("Error al cargar datos"); return; }
    } else {
        document.getElementById('p-comision').value = "0";
        lockComision(); // Función helper que se creo mas abajo
        document.getElementById('modal-producto-title').innerText = "Nuevo Producto";
        form.reset();
        document.getElementById('p-codigo').value = '';
        document.getElementById('p-empresa-gen').disabled = false;
        document.getElementById('p-empresa-gen').value = "";
        document.getElementById('p-clase').innerHTML = '';
    }
    modal.style.display = 'block';
}

if (document.getElementById('form-producto')) {
    document.getElementById('form-producto').onsubmit = async (e) => {
        e.preventDefault();
        if (!confirm("¿Está seguro de guardar este producto?")) return;
        const data = {
            isNew: !document.getElementById('p-empresa-gen').disabled,
            CodPro: document.getElementById('p-codigo').value,
            CodBar: document.getElementById('p-codbar').value,
            Nombre: document.getElementById('p-nombre').value,
            Clinea: document.getElementById('p-linea').value,
            Clase: document.getElementById('p-clase').value,
            CodProv: document.getElementById('p-proveedor').value,
            Peso: document.getElementById('p-peso').value,
            Stock: document.getElementById('p-stock').value,
            Afecto: document.getElementById('p-afecto').checked,
            Tipo: document.getElementById('p-tipo').value,
            Unimed: document.getElementById('p-unimed').value,
            Comision: document.getElementById('p-comision').value,
            Costo: document.getElementById('p-costo').value,
            PventaMa: document.getElementById('p-preciofinal').value,
            PventaMi: 0,
            TemMax: document.getElementById('p-tempmax').value,
            TemMin: document.getElementById('p-tempmin').value,
            CosReal: document.getElementById('p-costoreal').value
        };
        try {
            const res = await fetch('/api/productos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
            if (res.ok) { closeModal('modal-producto'); buscarProductos(); alert("Guardado"); } else alert("Error al guardar");
        } catch (e) { alert("Error de conexión"); }
    };
}

async function eliminarProducto(id) {
    if (!confirm("¿Eliminar este producto?")) return;
    try {
        // Importante: encodeURIComponent por si el código tiene caracteres raros
        const res = await fetch(`/api/productos/${encodeURIComponent(id)}`, { method: 'DELETE' });

        if (res.ok) {
            alert("Producto eliminado correctamente");
            buscarProductos(); // Recargar la tabla
        } else {
            const err = await res.json(); // Intentar leer mensaje del servidor
            alert("Error: " + (err.message || "No se pudo eliminar"));
        }
    } catch (e) {
        console.error(e);
        alert("Error de conexión");
    }
}

// NUEVA FUNCION: Control de botones Siguiente/Anterior (CORREGIDA)
function cambiarPaginaProducto(delta) {
    // CORRECCIÓN: Usamos 'prodPage' consistentemente
    const newPage = prodPage + delta;
    if (newPage >= 1) {
        prodPage = newPage;
        buscarProductos(false); // false para no resetear a la 1
    }
}

// =============================================
//  RESTO DE MODULOS (EQUIPOS, PRECIOS, NUBE...)
// =============================================

async function fetchData() {
    try { const response = await fetch('/api/structure'); if (!response.ok) return; const data = await response.json(); appData = data; renderDashboard(); } catch (error) { console.error(error); }
}
function renderDashboard() {
    const container = document.getElementById("dashboard"); if (!container || !appData) return; container.innerHTML = "";
    appData.areas.forEach((area) => {
        const areaCol = document.createElement("div"); areaCol.className = "area-column";
        const areaTitle = document.createElement("div"); areaTitle.className = "area-title"; areaTitle.innerText = area.name; areaCol.appendChild(areaTitle);
        area.locations.forEach((loc) => {
            const locCard = document.createElement("div"); locCard.className = "location-card";
            locCard.innerHTML = `<div class="location-header-top"><span class="location-name">${loc.name}</span><div class="sede-actions"><i class="fas fa-plus" onclick="openCompModal(${loc.id}, null)" title="Agregar PC"></i><i class="fas fa-cog" onclick="openSedeModal(${area.id}, ${loc.id}, '${loc.name}')" title="Configurar Sede"></i></div></div>`;
            const grid = document.createElement("div"); grid.className = "computer-grid";
            loc.computers.forEach((comp) => {
                const item = document.createElement("div"); item.className = "computer-item"; item.onclick = () => openCompModal(loc.id, comp);
                const iconClass = comp.type === 'server' ? 'fa-server' : 'fa-desktop'; const statusClass = comp.status ? 'status-true' : 'status-false';
                item.innerHTML = `<div class="icon-wrapper"><i class="fas ${iconClass}"></i></div><div class="status-indicator ${statusClass}"><span class="dot"></span></div><div class="comp-info"><span class="comp-name">${comp.name}</span><span class="comp-host">${comp.hostname}</span></div>`;
                grid.appendChild(item);
            });
            locCard.appendChild(grid); areaCol.appendChild(locCard);
        });
        const btnAddSede = document.createElement("button"); btnAddSede.innerText = "+ Nueva Sede"; btnAddSede.style.cssText = "background:transparent; border:2px dashed var(--border-color); color:var(--text-secondary); width:100%; padding:10px; cursor:pointer;";
        btnAddSede.onclick = () => openSedeModal(area.id, null, ''); areaCol.appendChild(btnAddSede); container.appendChild(areaCol);
    });
}

// --- MODALES Y LOGICA CRUD EQUIPOS ---
const modalComp = document.getElementById("modal-comp");
const modalSede = document.getElementById("modal-sede");

function openCompModal(sedeId, compObj) {
    modalComp.style.display = "block";
    currentSedeIdForComp = sedeId;

    // Referencia segura al título
    const titleEl = document.getElementById("modal-comp-title");
    const deleteBtn = document.getElementById("btn-delete-comp");

    if (compObj) {
        // MODO EDITAR
        currentCompId = compObj.id;

        // Si existe el elemento título, lo actualizamos. Si no, no pasa nada :)
        if (titleEl) titleEl.innerText = "Editar Equipo";

        // Llenado de datos (Con validación por si vienen vacíos)
        document.getElementById("comp-name").value = compObj.name || '';
        document.getElementById("comp-hostname").value = compObj.hostname || '';
        document.getElementById("comp-type").value = compObj.type || 'desktop';
        document.getElementById("comp-status").checked = compObj.status; // true/false

        if (deleteBtn) {
            deleteBtn.style.display = "block";
            deleteBtn.onclick = () => deleteComputer(currentCompId);
        }
    } else {
        // MODO NUEVO
        currentCompId = null;
        if (titleEl) titleEl.innerText = "Nuevo Equipo";

        document.getElementById("computer-form").reset();
        document.getElementById("comp-type").value = "desktop";
        document.getElementById("comp-status").checked = true;

        if (deleteBtn) deleteBtn.style.display = "none";
    }
}

if (document.getElementById("computer-form")) {
    document.getElementById("computer-form").onsubmit = async (e) => { e.preventDefault(); const data = { name: document.getElementById("comp-name").value, hostname: document.getElementById("comp-hostname").value, type: document.getElementById("comp-type").value, status: document.getElementById("comp-status").checked, sede_id: currentSedeIdForComp }; let url = '/api/equipos'; let method = 'POST'; if (currentCompId) { url = `/api/equipos/${currentCompId}`; method = 'PUT'; } await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); document.getElementById("modal-comp").style.display = "none"; fetchData(); };
}
async function deleteComputer(id) { if (confirm("¿Eliminar equipo?")) { await fetch(`/api/equipos/${id}`, { method: 'DELETE' }); document.getElementById("modal-comp").style.display = "none"; fetchData(); } }
function openSedeModal(areaId, sedeId, sedeName) {
    const modalSede = document.getElementById("modal-sede");
    modalSede.style.display = "block"; currentAreaIdForSede = areaId; currentSedeId = sedeId;
    const title = document.getElementById("modal-sede-title"); const nameInput = document.getElementById("sede-name"); const delBtn = document.getElementById("btn-delete-sede");
    if (sedeId) { title.innerText = "Editar Sede"; nameInput.value = sedeName; delBtn.style.display = "block"; delBtn.onclick = () => deleteSede(sedeId); } else { title.innerText = "Nueva Sede"; nameInput.value = ""; delBtn.style.display = "none"; }
}
if (document.getElementById("sede-form")) {
    document.getElementById("sede-form").onsubmit = async (e) => { e.preventDefault(); const name = document.getElementById("sede-name").value; let url = '/api/sedes'; let method = 'POST'; let body = { name: name, area_id: currentAreaIdForSede }; if (currentSedeId) { url = `/api/sedes/${currentSedeId}`; method = 'PUT'; body = { name: name }; } await fetch(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); document.getElementById("modal-sede").style.display = "none"; fetchData(); };
}
async function deleteSede(id) { if (confirm("¿Eliminar sede?")) { await fetch(`/api/sedes/${id}`, { method: 'DELETE' }); document.getElementById("modal-sede").style.display = "none"; fetchData(); } }

async function cargarProductosPrecios() {
    const empresa = document.getElementById('empresa-select').value; const tbody = document.querySelector('#precios-table tbody'); tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Cargando...</td></tr>';
    try { const res = await fetch(`/api/precios/${empresa}`); if (!res.ok) throw new Error('Error'); const productos = await res.json(); renderTablaPrecios(productos); } catch (error) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--red-status);">Error</td></tr>'; }
}
function renderTablaPrecios(lista) {
    const tbody = document.querySelector('#precios-table tbody'); tbody.innerHTML = ''; if (lista.length === 0) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">No se encontraron productos</td></tr>'; return; }
    lista.forEach(p => { const tr = document.createElement('tr'); const p1 = (p.PreTema1 || 0).toFixed(4); const p2 = (p.PreTema2 || 0).toFixed(4); const p3 = (p.PreTema3 || 0).toFixed(4); const p4 = (p.PreTema4 || 0).toFixed(4); const p5 = (p.PreTema5 || 0).toFixed(4); const p6 = (p.PreTema6 || 0).toFixed(4); tr.innerHTML = `<td><span style="font-weight:bold; font-size:0.85rem; color:var(--text-secondary)">${p.CodPro}</span><br>${p.Nombre}</td><td><input type="number" step="0.0001" class="price-input" id="p1-${p.CodPro}" value="${p1}"></td><td><input type="number" step="0.0001" class="price-input" id="p2-${p.CodPro}" value="${p2}"></td><td><input type="number" step="0.0001" class="price-input" id="p3-${p.CodPro}" value="${p3}"></td><td><input type="number" step="0.0001" class="price-input" id="p4-${p.CodPro}" value="${p4}"></td><td><input type="number" step="0.0001" class="price-input" id="p5-${p.CodPro}" value="${p5}"></td><td><input type="number" step="0.0001" class="price-input" id="p6-${p.CodPro}" value="${p6}"></td><td><button class="btn-update" onclick="guardarPrecio('${p.CodPro}')"><i class="fas fa-save"></i></button></td>`; tbody.appendChild(tr); });
}
function filtrarTablaPrecios() { const texto = document.getElementById('search-product').value.toLowerCase().trim(); const filas = document.querySelectorAll('#precios-table tbody tr'); filas.forEach(fila => { const celda = fila.cells[0]; if (celda) { const contenido = celda.textContent || celda.innerText; fila.style.display = contenido.toLowerCase().includes(texto) ? '' : 'none'; } }); }
async function guardarPrecio(codPro) { const p1 = document.getElementById(`p1-${codPro}`).value; const p2 = document.getElementById(`p2-${codPro}`).value; const p3 = document.getElementById(`p3-${codPro}`).value; const p4 = document.getElementById(`p4-${codPro}`).value; const p5 = document.getElementById(`p5-${codPro}`).value; const p6 = document.getElementById(`p6-${codPro}`).value; const btn = event.currentTarget; const icono = btn.querySelector('i'); icono.className = "fas fa-spinner fa-spin"; try { const res = await fetch(`/api/precios/${codPro}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p1, p2, p3, p4, p5, p6 }) }); if (res.ok) { icono.className = "fas fa-check"; btn.style.backgroundColor = "var(--green-status)"; setTimeout(() => { icono.className = "fas fa-save"; btn.style.backgroundColor = "var(--accent)"; }, 1500); } else { alert("Error"); icono.className = "fas fa-save"; } } catch (e) { alert("Error"); icono.className = "fas fa-save"; } }

async function consultarRevision() {
    const empresa = document.getElementById('rev-empresa').value; const turno = document.getElementById('rev-turno').value; const inicio = document.getElementById('rev-inicio').value; const fin = document.getElementById('rev-fin').value; const grid = document.getElementById('revision-grid'); grid.innerHTML = '<div style="width:100%; text-align:center;"><i class="fas fa-spinner fa-spin fa-3x"></i><br>Consultando...</div>';
    try { const res = await fetch('/api/revision-nube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ empresa, turno, fechaInicio: inicio, fechaFin: fin }) }); if (!res.ok) throw new Error('Error'); const data = await res.json(); renderRevisionCards(data); } catch (error) { grid.innerHTML = '<div style="color:var(--red-status); text-align:center;">Error</div>'; }
}
function renderRevisionCards(data) { const grid = document.getElementById('revision-grid'); grid.innerHTML = ''; const tables = [{ key: 'doccab', title: 'Doccab' }, { key: 'docdet', title: 'Docdet' }, { key: 'ticket_c', title: 'Ticket_C' }, { key: 'ticket_d', title: 'Ticket_D' }, { key: 'pagos', title: 'Pagos Tickets' }, { key: 'caja', title: 'Caja' }]; tables.forEach(t => { const info = data[t.key] || { Total: 0 }; const hasData = info.Total > 0; const card = document.createElement('div'); card.className = 'status-card'; let contentHTML = ''; if (hasData) { contentHTML = `<div class="card-data"><div class="data-row"><span>INICIO:</span> ${info.First}</div><div class="data-row"><span>FIN:</span> ${info.Last}</div><div class="total-row">REGISTROS: ${info.Total} FILAS</div></div>`; } else { contentHTML = `<div class="no-data-state"><i class="fas fa-exclamation-triangle"></i><span class="no-data-text">NO HAY REGISTROS</span><i class="fas fa-person-walking"></i></div>`; } card.innerHTML = `<div class="card-header"><span class="table-name">${t.title}</span><div class="traffic-light ${hasData ? 'light-green' : 'light-red'}"></div></div>${contentHTML}`; grid.appendChild(card); }); }

async function cargarReporte(page) { reportPage = page; const empresa = document.getElementById('rep-empresa').value; const year = document.getElementById('rep-anio').value; const month = document.getElementById('rep-mes').value; const tbody = document.querySelector('#report-table tbody'); tbody.innerHTML = '<tr><td colspan="9" style="text-align:center">Cargando...</td></tr>'; try { const res = await fetch('/api/reports/salida-insumos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ empresa, year, month, filters: reportFilters, page, pageSize: 50 }) }); if (!res.ok) throw new Error('Error'); const { data, totals } = await res.json(); document.getElementById('sum-registros').innerText = totals.TotalRegistros || 0; document.getElementById('sum-cantidad').innerText = totals.SumCantidad ? totals.SumCantidad.toFixed(2) : 0; document.getElementById('sum-costo').innerText = totals.SumCosto ? totals.SumCosto.toFixed(2) : 0; tbody.innerHTML = ''; if (data.length === 0) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center">No hay datos</td></tr>'; return; } data.forEach(row => { const tr = document.createElement('tr'); tr.innerHTML = `<td>${row.Linea}</td><td>${row.Documento}</td><td>${row.Fecha}</td><td>${row.Almacen}</td><td>${row.codpro}</td><td>${row.Nombre}</td><td>${row.Razon}</td><td>${row.Cantidad}</td><td>${row.Costo}</td>`; tbody.appendChild(tr); }); document.getElementById('page-info').innerText = `Pág ${page}`; } catch (error) { tbody.innerHTML = '<tr><td colspan="9" style="color:red; text-align:center">Error</td></tr>'; } }
function cambiarPagina(delta) { const newPage = reportPage + delta; if (newPage >= 1) cargarReporte(newPage); }
function limpiarFiltrosReporte() { reportFilters = {}; document.querySelectorAll('.col-filter').forEach(i => i.value = ''); cargarReporte(1); }
async function exportarExcel() { const empresa = document.getElementById('rep-empresa').value; const year = document.getElementById('rep-anio').value; const month = document.getElementById('rep-mes').value; const btn = event.currentTarget; const original = btn.innerHTML; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; btn.disabled = true; try { const res = await fetch('/api/reports/salida-insumos/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ empresa, year, month, filters: reportFilters }) }); if (res.ok) { const blob = await res.blob(); const url = window.URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `Reporte_${empresa}.xlsx`; document.body.appendChild(a); a.click(); a.remove(); } else { alert('Error'); } } catch (e) { alert('Error'); } finally { btn.innerHTML = original; btn.disabled = false; } }

// ==========================================
//  SEGURIDAD Y DESBLOQUEO (NUEVO)
// ==========================================
function abrirModalPassword(tipo) {
    const modal = document.getElementById('modal-password');
    const input = document.getElementById('pass-input');

    document.getElementById('pass-type').value = tipo;
    input.value = '';
    modal.style.display = 'block';

    // Enfocar input automáticamente
    setTimeout(() => input.focus(), 100);
}

// Validar contraseña
if (document.getElementById('form-validate-pass')) {
    document.getElementById('form-validate-pass').onsubmit = async (e) => {
        e.preventDefault();
        const tipo = document.getElementById('pass-type').value;
        const clave = document.getElementById('pass-input').value;

        try {
            const res = await fetch('/api/validate-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clave, tipo })
            });

            const data = await res.json();

            if (data.success) {
                closeModal('modal-password');

                // Acciones específicas según qué desbloqueamos
                if (tipo === 'COMISION') {
                    const inputCom = document.getElementById('p-comision');
                    inputCom.readOnly = false;
                    inputCom.style.background = 'var(--input-bg)'; // Color normal
                    inputCom.focus();
                    inputCom.select();
                }
            } else {
                alert(data.message || 'Clave incorrecta');
            }
        } catch (error) {
            console.error(error);
            alert('Error de conexión');
        }
    };
}

function lockComision() {
    const input = document.getElementById('p-comision');
    if (input) {
        input.readOnly = true;
        input.style.background = 'var(--input-readonly-bg)'; // Usamos la variable CSS que creamos antes
    }
}

// ==========================================
//  AUDITORIA: TICKETS NO PAGADOS
// ==========================================
async function consultarTicketsNoPagados() {
    const anio = document.getElementById('aud-anio').value;
    const tbody = document.querySelector('#aud-tickets-table tbody');

    // UI Loading
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center"><i class="fas fa-spinner fa-spin"></i> Procesando...</td></tr>';

    try {
        const res = await fetch(`/api/auditoria/tickets-no-pagados/${anio}`);
        if (!res.ok) throw new Error('Error en servidor');

        const data = await res.json();

        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">No se encontraron tickets pendientes de pago para este año.</td></tr>';
            return;
        }

        data.forEach(row => {
            const tr = document.createElement('tr');
            // Formatear fecha
            const fecha = row.Fecha ? new Date(row.Fecha).toLocaleString() : '---';

            tr.innerHTML = `
                <td>${fecha}</td>
                <td><span class="badge-code">${row.NroTicket}</span></td>
                <td>${row.numero || '---'}</td>
                <td>${row.Empresa || '---'}</td>
                <td>${row.turno || '---'}</td>
                <td style="font-weight:bold; color:var(--red-status)">${parseFloat(row.Total).toFixed(2)}</td>
                <td><span style="color:var(--red-status)"><i class="fas fa-clock"></i> Pendiente</span></td>
            `;
            tbody.appendChild(tr);
        });

    } catch (e) {
        console.error(e);
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--red-status)">Error al cargar la auditoría.</td></tr>';
    }
}

// Cargar empresas desde n_codtabla = 200
async function cargarEmpresasAuditoria() {
    const select = document.getElementById('aud-doc-empresa');
    if (!select) return;
    try {
        const res = await fetch('/api/reports/listas/empresas'); // Reutilizamos endpoint existente
        const data = await res.json();
        select.innerHTML = '';
        data.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item.n_numero;
            opt.innerText = item.c_describe;
            select.appendChild(opt);
        });
    } catch (e) { console.error("Error cargando empresas auditoria", e); }
}

async function consultarDocSinDetalle() {
    const emp = document.getElementById('aud-doc-empresa').value;
    const tur = document.getElementById('aud-doc-turno').value;
    const anio = document.getElementById('aud-doc-anio').value;
    const tbody = document.querySelector('#aud-doc-table tbody');
    const containerCorrige = document.getElementById('container-corrige');

    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center"><i class="fas fa-spinner fa-spin"></i> Consultando...</td></tr>';
    containerCorrige.style.display = 'none';

    try {
        const res = await fetch(`/api/auditoria/doc-sin-detalle?emp=${emp}&tur=${tur}&anio=${anio}`);
        const data = await res.json();

        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center">No se encontraron documentos sin detalle. Todo está correcto.</td></tr>';
        } else {
            data.forEach(row => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${row.Numero}</td>
                    <td>${new Date(row.Fecha).toLocaleDateString()}</td>
                    <td>${row.empresa}</td>
                    <td>${row.turno}</td>
                    <td>${row.NroPedido}</td>
                    <td>${parseFloat(row.total).toFixed(2)}</td>
                `;
                tbody.appendChild(tr);
            });
            // Si hay datos, mostramos el botón de corregir
            containerCorrige.style.display = 'block';
        }
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:red; text-align:center">Error en consulta</td></tr>';
    }
}

async function ejecutarCorrigeCarga() {
    const emp = document.getElementById('aud-doc-empresa').value;
    const tur = document.getElementById('aud-doc-turno').value;
    const anio = document.getElementById('aud-doc-anio').value;
    const btn = document.getElementById('btn-corregir-carga');

    if (!confirm("¿Está seguro de ejecutar la corrección? Esto insertará los detalles faltantes y cargará transacciones.")) return;

    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/auditoria/corregir-carga', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emp, tur, anio })
        });

        if (res.ok) {
            const data = await res.json();
            alert(data.message);
            // Volver a consultar para verificar que ya no hay errores
            consultarDocSinDetalle();
        } else {
            alert("Error durante el proceso de corrección.");
        }
    } catch (e) {
        alert("Error de conexión al servidor.");
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
}

// ==========================================
//  REPORTE: CARGOS DE CAJA
// ==========================================
async function cargarReporteCargos(page) {
    reportCargosPage = page;
    const empresa = document.getElementById('repc-empresa').value;
    const year = document.getElementById('repc-anio').value;
    const month = document.getElementById('repc-mes').value;
    const turno = document.getElementById('repc-turno').value;
    const tbody = document.querySelector('#report-cargos-table tbody');

    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">Cargando...</td></tr>';

    try {
        const res = await fetch('/api/reports/cargos-caja', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ empresa, year, month, turno, filters: reportCargosFilters, page, pageSize: 50 })
        });

        if (!res.ok) throw new Error('Error datos');
        const { data, totals } = await res.json();

        // Totales
        document.getElementById('sumc-registros').innerText = totals.TotalRegistros || 0;
        document.getElementById('sumc-monto').innerText = totals.SumMonto ? totals.SumMonto.toFixed(2) : '0.00';

        // Tabla
        tbody.innerHTML = '';
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center">No hay datos</td></tr>';
            return;
        }

        data.forEach(row => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${row.Razon}</td>
                <td>${row.Fecha}</td>
                <td>${row.Documento}</td>
                <td>${row.DetalleEmpresa}</td>
                <td>${row.Monto ? row.Monto.toFixed(2) : '0.00'}</td>
                <td>${row.Emp}</td>
                <td>${row.Turno}</td>
            `;
            tbody.appendChild(tr);
        });

        document.getElementById('page-info-cargos').innerText = `Pág ${page}`;

    } catch (error) {
        console.error(error);
        tbody.innerHTML = '<tr><td colspan="7" style="color:red; text-align:center">Error de servidor</td></tr>';
    }
}

function cambiarPaginaCargos(delta) {
    const newPage = reportCargosPage + delta;
    if (newPage >= 1) cargarReporteCargos(newPage);
}

function limpiarFiltrosCargos() {
    reportCargosFilters = {};
    document.querySelectorAll('.col-filter-cargos').forEach(i => i.value = '');
    cargarReporteCargos(1);
}

async function exportarExcelCargos() {
    const empresa = document.getElementById('repc-empresa').value;
    const year = document.getElementById('repc-anio').value;
    const month = document.getElementById('repc-mes').value;
    const turno = document.getElementById('repc-turno').value;

    const btn = event.currentTarget;
    const original = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; btn.disabled = true;

    try {
        const res = await fetch('/api/reports/cargos-caja/export', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ empresa, year, month, turno, filters: reportCargosFilters })
        });
        if (res.ok) {
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `Reporte_Cargos_${empresa}_${year}.xlsx`;
            document.body.appendChild(a); a.click(); a.remove();
        } else { alert('Error exportar'); }
    } catch (e) { alert('Error conexión'); }
    finally { btn.innerHTML = original; btn.disabled = false; }
}

async function cargarEmpresasReporte() {
    const select = document.getElementById('repc-empresa');
    if (!select) return;

    try {
        const res = await fetch('/api/reports/listas/empresas');
        if (res.ok) {
            const data = await res.json();
            select.innerHTML = ''; // Limpiar "Cargando..."

            data.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item.n_numero; // Esto enviará el ID (ej: 2, 4, 6)
                opt.innerText = item.c_describe; // Esto mostrará el Nombre
                select.appendChild(opt);
            });

            // Una vez cargado el combo, cargamos el reporte por primera vez
            // Seleccionamos el primero por defecto si hay datos
            if (data.length > 0) {
                select.value = data[0].n_numero;
                cargarReporteCargos(1);
            }
        }
    } catch (e) {
        console.error("Error cargando empresas", e);
        select.innerHTML = '<option value="">Error</option>';
    }
}

// ==========================================
//  MÓDULO: GESTIÓN RECETAS
// ==========================================

// 1. Buscar Producto Maestro (Tipo 3) - CON FILTRO EMPRESA
async function buscarProdReceta(texto) {
    const box = document.getElementById('rec-prod-suggestions');
    const empresa = document.getElementById('rec-filter-empresa').value; // Obtener empresa

    if (texto.length < 2) { box.style.display = 'none'; return; }

    clearTimeout(debounceReceta);
    debounceReceta = setTimeout(async () => {
        try {
            // Enviamos el parámetro empresa en la URL
            const res = await fetch(`/api/recetas/productos/buscar?q=${encodeURIComponent(texto)}&empresa=${empresa}`);
            const data = await res.json();

            box.innerHTML = '';
            if (data.length > 0) {
                box.style.display = 'block';
                data.forEach(p => {
                    const div = document.createElement('div');
                    div.className = 'suggestion-item';
                    div.innerText = `${p.CodPro} - ${p.Nombre}`;
                    div.onclick = () => seleccionarProductoReceta(p);
                    box.appendChild(div);
                });
            } else {
                box.style.display = 'none';
            }
        } catch (e) { console.error(e); }
    }, 300);
}

// Función auxiliar para limpiar si cambia el combo
function limpiarBusquedaReceta() {
    document.getElementById('rec-prod-search').value = '';
    document.getElementById('rec-prod-id').value = '';
    document.getElementById('rec-prod-suggestions').style.display = 'none';
    document.getElementById('btn-cargar-receta').disabled = true;
    document.getElementById('rec-prod-selected-name').style.display = 'none';
    document.getElementById('receta-workspace').style.display = 'none';
}

function seleccionarProductoReceta(p) {
    document.getElementById('rec-prod-search').value = `${p.CodPro} - ${p.Nombre}`;
    document.getElementById('rec-prod-id').value = p.CodPro;
    document.getElementById('rec-prod-suggestions').style.display = 'none';
    document.getElementById('btn-cargar-receta').disabled = false;

    // Resetear vista inferior si cambia producto
    document.getElementById('receta-workspace').style.display = 'none';
}

// 2. Cargar Receta Existente
async function cargarRecetaActual() {
    const codProd = document.getElementById('rec-prod-id').value;
    if (!codProd) return;

    // Mostrar workspace
    document.getElementById('receta-workspace').style.display = 'block';

    // Limpiar array local
    recetaItems = [];

    try {
        const res = await fetch(`/api/recetas/${codProd}`);
        const data = await res.json();

        // Mapear datos BD a nuestro array local
        data.forEach(row => {
            recetaItems.push({
                codInsumo: row.CodInsumo,
                nombreInsumo: row.InsumoNombre,
                unimed: row.unimed,
                nombreUnidad: row.UnidadNombre,
                cantidad: row.Cantidad
            });
        });

        renderTablaReceta();
    } catch (e) { console.error(e); alert('Error al cargar receta existente'); }
}

// 3. Buscar Insumo (Tipo 1)
// 3. Buscar Insumo (Tipo 1) - CON FILTRO EMPRESA
async function buscarInsumoReceta(texto) {
    const box = document.getElementById('rec-ins-suggestions');
    // Obtenemos la empresa seleccionada arriba
    const empresa = document.getElementById('rec-filter-empresa').value;

    if (texto.length < 2) { box.style.display = 'none'; return; }

    clearTimeout(debounceReceta);
    debounceReceta = setTimeout(async () => {
        try {
            // Enviamos el parámetro empresa
            const res = await fetch(`/api/recetas/insumos/buscar?q=${encodeURIComponent(texto)}&empresa=${empresa}`);
            const data = await res.json();

            box.innerHTML = '';
            if (data.length > 0) {
                box.style.display = 'block';
                data.forEach(ins => {
                    const div = document.createElement('div');
                    div.className = 'suggestion-item';
                    div.innerText = `${ins.CodPro} - ${ins.Nombre}`; // Muestro el código para que verifiques
                    div.onclick = () => seleccionarInsumoReceta(ins);
                    box.appendChild(div);
                });
            } else { box.style.display = 'none'; }
        } catch (e) { console.error(e); }
    }, 300);
}

function seleccionarInsumoReceta(ins) {
    document.getElementById('rec-ins-search').value = ins.Nombre;
    document.getElementById('rec-ins-id').value = ins.CodPro;
    document.getElementById('rec-ins-unimed-id').value = ins.Unimed;
    document.getElementById('rec-ins-unimed-name').value = ins.UnidadNombre || 'UND';
    document.getElementById('rec-ins-suggestions').style.display = 'none';
    document.getElementById('rec-ins-cant').focus();
}

// 4. Agregar Insumo a la Tabla Local
function agregarInsumoALista() {
    const id = document.getElementById('rec-ins-id').value;
    const nombre = document.getElementById('rec-ins-search').value;
    const unidId = document.getElementById('rec-ins-unimed-id').value;
    const unidName = document.getElementById('rec-ins-unimed-name').value;
    const cant = parseFloat(document.getElementById('rec-ins-cant').value);

    if (!id || !cant || cant <= 0) {
        alert("Seleccione un insumo y una cantidad válida");
        return;
    }

    // Verificar si ya existe para sumar cantidad o avisar
    const existente = recetaItems.find(i => i.codInsumo === id);
    if (existente) {
        if (confirm("El insumo ya está en la receta. ¿Desea actualizar la cantidad?")) {
            existente.cantidad = cant;
        }
    } else {
        recetaItems.push({
            codInsumo: id,
            nombreInsumo: nombre,
            unimed: parseInt(unidId),
            nombreUnidad: unidName,
            cantidad: cant
        });
    }

    renderTablaReceta();

    // Limpiar inputs detalle
    document.getElementById('rec-ins-search').value = '';
    document.getElementById('rec-ins-id').value = '';
    document.getElementById('rec-ins-unimed-name').value = '';
    document.getElementById('rec-ins-cant').value = '';
}

// 5. Renderizar Tabla
function renderTablaReceta() {
    const tbody = document.querySelector('#tabla-receta-detalle tbody');
    const msg = document.getElementById('receta-empty-msg');

    tbody.innerHTML = '';

    if (recetaItems.length === 0) {
        msg.style.display = 'block';
    } else {
        msg.style.display = 'none';

        recetaItems.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${item.codInsumo}</td>
                <td>${item.nombreInsumo}</td>
                <td>${item.nombreUnidad}</td>
                <td>${item.cantidad.toFixed(2)}</td>
                <td>
                    <button class="btn-delete btn-sm" onclick="eliminarInsumoReceta(${index})">
                        <i class="fas fa-trash"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }
}

function eliminarInsumoReceta(index) {
    recetaItems.splice(index, 1);
    renderTablaReceta();
}

// 6. Guardar Todo en BD
async function guardarRecetaDB() {
    const codProd = document.getElementById('rec-prod-id').value;

    if (!codProd) { alert("Error: No hay producto seleccionado"); return; }
    // Nota: Permitimos guardar receta vacía (sería como borrar la receta)

    if (!confirm("¿Guardar cambios en la receta? Se sobrescribirá la receta anterior.")) return;

    try {
        const res = await fetch('/api/recetas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                codProd: codProd,
                items: recetaItems
            })
        });

        if (res.ok) {
            alert("Receta guardada correctamente");
        } else {
            alert("Error al guardar");
        }
    } catch (e) {
        console.error(e);
        alert("Error de conexión");
    }
}
