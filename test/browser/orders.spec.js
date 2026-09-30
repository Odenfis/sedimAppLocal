const { test, expect } = require('@playwright/test');
const product = { CodPro: '02001', Nombre: 'Arroz con mariscos', PventaMa: 20, Afecto: 1, Linea: 'Platos' };
async function fixture(page, options = {}) {
    const state = { items: [], sent: new Map(), kitchenStates: new Map(), version: 0, sends: 0, saves: 0, deletes: 0, reprints: 0, reprintDestinations: [],
        conflict: false, delaySave: 0, ticket: null, requestOrder: [], kds: [], closure: null, closes: 0,
        tableLoads: 0, kitchenLoads: 0, sessionLoads: 0, eventConnections: 0, sessionActive: true,
        tableError: false, kitchenError: false, kitchenTransientFailures: 0, kitchenStaleResponses: 0,
        orderState: 1, orderLoadError: false, orderLoadDelay: 0, commercialConflict: false, deleteError: false,
        invalidCompanyError: false, orderLoads: 0, orderCompanies: [] };
    if (options.stubEventSource) {
        await page.addInitScript(() => {
            window.__sseTest = { created: 0, live: 0, maxLive: 0 };
            window.EventSource = class TestEventSource {
                constructor() {
                    this.closed = false;
                    window.__sseTest.created++;
                    window.__sseTest.live++;
                    window.__sseTest.maxLive = Math.max(window.__sseTest.maxLive, window.__sseTest.live);
                }
                close() {
                    if (this.closed) return;
                    this.closed = true;
                    window.__sseTest.live--;
                }
            };
        });
    }
    function data() {
        const pending = state.items.some(l => JSON.stringify(l) !== state.sent.get(l.lineaId)) || [...state.sent.keys()].some(id => !state.items.some(l => l.lineaId === id));
        const cancellations = [...state.sent.entries()].filter(([id]) => !state.items.some(l => l.lineaId === id)).map(([,line]) => JSON.parse(line));
        return { success: true, nroTicket: state.ticket, version: state.version,
            conciliacionComercial: { status: state.commercialConflict ? 'conflict' : 'ok',
                code: state.commercialConflict ? 'COMMERCIAL_CONFLICT' : null },
            pedido: state.ticket ? { NroTicket: state.ticket, Estado: state.orderState, Mozo: 1 } : null,
            items: state.items.map(l => ({ ...l, Codpro: l.codPro, Descripcion: l.nombre, Cantidad: l.cantidad, Precio: l.precio, Afecto: l.afecto,
                enviada: state.sent.has(l.lineaId) ? JSON.parse(state.sent.get(l.lineaId)) : null, pendienteEnvio: !state.sent.has(l.lineaId),
                estadoCocina: state.kitchenStates.get(l.lineaId) || null, pendienteId: null, anulada: false })),
            cocina: { pendientes: pending ? 1 : 0, ultimoEnvio: state.sends, estado: pending ? (state.sends ? 'Cambios pendientes' : 'Sin enviar') : (state.sends ? 'Enviado a cocina' : 'Sin enviar'), anulaciones: cancellations },
            impresion: state.sends ? { Estado: 'en_cola' } : null };
    }
    await page.route('**/api/**', async route => {
        const req = route.request(), url = new URL(req.url()), body = req.postDataJSON();
        const fulfill = (json, status = 200) => route.fulfill({ status, json });
        if (url.pathname === '/api/events') { state.eventConnections++; return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': test\n\n' }); }
        if (url.pathname === '/api/session') {
            state.sessionLoads++;
            return state.sessionActive
                ? fulfill({ user: { usuario: 'Mozo' }, ...(options.features ? { features: options.features } : {}) })
                : fulfill({ message: 'No autorizado' }, 401);
        }
        if (url.pathname === '/api/pos/config') return fulfill({ igvv: 10.5 });
        if (url.pathname === '/api/pos/tables') {
            state.tableLoads++;
            if (state.tableError) return fulfill({ success:false,message:'Fallo SQL de mesas',diagnosticId:'diag-tables-456',retryable:false },500);
            const delay = options.tableDelay?.(url.searchParams.get('empresa')) || 0;
            if (delay) await new Promise(resolve => setTimeout(resolve, delay));
            const tables = typeof options.tables === 'function'
                ? options.tables(url.searchParams.get('empresa'))
                : options.tables;
            return fulfill(tables || [{ Numero: 1, Empresa: 2, Ambiente: 1, Estado: 1 }]);
        }
        if (url.pathname === '/api/pos/mozos') return fulfill([{ Codemp: 1, Nombre: 'José' }]);
        if (url.pathname === '/api/pos/categories') return fulfill(['Platos']);
        if (url.pathname === '/api/pos/products') return fulfill([product]);
        if (url.pathname === '/api/pos/pedido' && req.method() === 'GET') {
            state.orderLoads++;
            state.orderCompanies.push(url.searchParams.get('empresa'));
            if (state.orderLoadDelay) await new Promise(resolve => setTimeout(resolve, state.orderLoadDelay));
            if (state.orderLoadError) return fulfill({ success:false,message:'No se pudo cargar el pedido',diagnosticId:'diag-order-load',retryable:false },500);
            return fulfill(data());
        }
        if (url.pathname === '/api/pos/pedido' && req.method() === 'POST') {
            state.requestOrder.push('save');
            state.orderCompanies.push(body.empresa);
            if (state.invalidCompanyError) return fulfill({ success:false,message:'Empresa inválida',errorCode:'INVALID_COMPANY',diagnosticId:'diag-company',retryable:false },400);
            if (state.delaySave) await new Promise(r => setTimeout(r, state.delaySave));
            if (state.conflict) return fulfill({ message: 'Pedido cambiado por otro dispositivo' }, 409);
            if (state.ticket && body.items.length === 0) {
                state.deletes++; state.version++; state.ticket = null; state.items = []; state.sent.clear();
                return fulfill({ success:true,pedidoEliminado:true });
            }
            state.saves++; state.version++; state.ticket = 'T001-000001'; state.items = body.items; return fulfill(data());
        }
        if (url.pathname.endsWith('/enviar-cocina')) {
            state.requestOrder.push('send'); state.sends++; state.version++;
            state.sent = new Map(state.items.map(l => [l.lineaId, JSON.stringify(l)]));
            state.items.forEach(l => { if (!state.kitchenStates.has(l.lineaId)) state.kitchenStates.set(l.lineaId,1); });
            return fulfill({ ...data(), envioId: '22222222-2222-4222-8222-222222222222' });
        }
        if (url.pathname.endsWith('/estados-cocina')) return fulfill({ success:true, version:state.version,
            estados:state.items.map(l=>({lineaId:l.lineaId,estadoCocina:state.kitchenStates.get(l.lineaId)||null,pendienteId:null,anulada:false})) });
        if (url.pathname === '/api/cocina/pedidos') state.kitchenLoads++;
        if (url.pathname === '/api/cocina/pedidos' && state.kitchenTransientFailures > 0) {
            state.kitchenTransientFailures--;
            return fulfill({ success:false,message:'Base temporalmente no disponible',diagnosticId:'diag-retry-503',retryable:true },503);
        }
        if (url.pathname === '/api/cocina/pedidos' && state.kitchenError) return fulfill({ success:false,message:'Fallo SQL controlado',diagnosticId:'diag-kds-123',retryable:false },500);
        if (url.pathname === '/api/cocina/pedidos') {
            const stale = state.kitchenStaleResponses > 0;
            if (stale) state.kitchenStaleResponses--;
            return fulfill({ success:true,pedidos:state.kds.map(l => ({ nroTicket:l.NroTicket,mesa:l.NroMesa,
                envioId:l.EnvioId || '22222222-2222-4222-8222-222222222222',numeroEnvio:1,mozo:'José',fechaEnvio:l.FechaTicket,
                minutosEspera:l.MinutosEspera,documento:l.Documento || 'COMANDA DE COCINA',impresion:l.Impresion || {estado:'enviado'},
                impresiones:l.Impresiones || [{...(l.Impresion || {estado:'enviado'}),destino:'cocina'}],
                lineas:[{ lineaId:l.LineaId,codPro:l.Codpro,cantidad:l.Cantidad,nombre:l.Descripcion,notasRapidas:l.notasRapidas,nota:l.nota,estado:l.EstadoCocina,Categoria:l.Categoria,correccionPendiente:l.pendiente }] })),
                sincronizacion: { desactualizado: stale, actualizadaEn: '2026-09-28T13:07:00.000Z', ...(stale ? { diagnosticId:'diag-stale-45' } : {}) } });
        }
        if (url.pathname.endsWith('/reconocer')) { const l=state.kds.find(l=>url.pathname.includes(l.LineaId)); l.nota=l.pendiente.nueva.nota; l.pendiente=null; return fulfill({success:true}); }
        if (url.pathname.endsWith('/reimprimir')) { state.reprints++; state.reprintDestinations.push(body.destino || 'cocina'); return fulfill({success:true,trabajoId:'33333333-3333-4333-8333-333333333333'}); }
        if (url.pathname.endsWith('/todo-listo')) { state.kitchenStates.forEach((_,id)=>state.kitchenStates.set(id,3)); return fulfill({success:true}); }
        if (url.pathname.endsWith('/entregado')) { state.kitchenStates.forEach((_,id)=>state.kitchenStates.set(id,4)); return fulfill({success:true}); }
        if (url.pathname === '/api/admin/cierres/preview') return fulfill({ success:true,totalTickets:1,elegible:true,registrosSinTurno:0,
            bloqueos:{pedidosActivos:0,cocinaPendiente:0,correccionesPendientes:0,impresionesActivas:0},cierre:state.closure });
        if (url.pathname === '/api/admin/cierres' && req.method() === 'POST') {
            state.closes++; state.closure={id:'44444444-4444-4444-8444-444444444444',estado:'cerrado',purgaProgramada:new Date(Date.now()+86400000).toISOString()};
            return fulfill({success:true,...state.closure});
        }
        if (req.method() === 'DELETE' && url.pathname.startsWith('/api/pos/comanda/')) {
            if (state.deleteError) return fulfill({ success:false,message:'No se pudo eliminar',diagnosticId:'diag-delete',retryable:false },500);
            state.deletes++; state.ticket=null; state.items=[]; state.sent.clear(); return fulfill({success:true,pedidoEliminado:true});
        }
        if (url.pathname.endsWith('/envios')) return fulfill({ envios: [] });
        return fulfill([]);
    });
    await page.goto('/dashboard.html');
    await page.selectOption('#pos-empresa-select', '02');
    await page.getByRole('button', { name: 'Mañana', exact: true }).click();
    if (options.openTable !== false) {
        await page.locator('.pos-table-card').first().click();
        await expect(page.locator('#pos-products-grid')).toContainText('Arroz');
    }
    return state;
}

test('normaliza la empresa textual de Mesas y guarda siempre el valor canónico', async ({ page }) => {
    const state = await fixture(page, { tables: [{ Numero: 1, Empresa: ' 02 ', Ambiente: 1, Estado: 1 }] });
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.saves).toBe(1);
    expect(state.orderCompanies).toEqual(['2', 2]);
});

test('una mesa de otra empresa se bloquea antes de consultar o modificar el pedido', async ({ page }) => {
    const state = await fixture(page, { tables: [{ Numero: 1, Empresa: 4, Ambiente: 1, Estado: 1 }], openTable: false });
    await page.locator('.pos-table-card').click();
    await expect(page.locator('#load-notice-tables')).toContainText('no corresponde a la empresa');
    expect(state.orderLoads).toBe(0);
    await expect(page.locator('#view-pos-tables')).toBeVisible();
});

test('INVALID_COMPANY conserva el carrito y pausa nuevos autoguardados', async ({ page }) => {
    const state = await fixture(page);
    state.invalidCompanyError = true;
    await page.locator('.pos-product-card').first().click();
    await expect(page.locator('#order-save-message')).toContainText('Empresa inválida');
    await expect(page.locator('.cart-item')).toHaveCount(1);
    const attempts = state.requestOrder.filter(value => value === 'save').length;
    await page.waitForTimeout(900);
    expect(state.requestOrder.filter(value => value === 'save')).toHaveLength(attempts);
    await expect(page.locator('#order-retry-load')).toBeVisible();
});

test('mapa filtra por agrupación y limita Desayunos a Cocinería', async ({ page }) => {
    const tablesFor = empresa => [
        { Numero: 80, Empresa: empresa, Ambiente: 1, Estado: 1 },
        { Numero: 81, Empresa: empresa, Ambiente: 2, Estado: 1 },
        { Numero: 120, Empresa: empresa, Ambiente: 3, Estado: 1 },
        { Numero: 121, Empresa: empresa, Ambiente: 1, Estado: 1 },
        { Numero: 201, Empresa: empresa, Ambiente: 1, Estado: 1 },
        { Numero: 202, Empresa: empresa, Ambiente: 1, Estado: 2 },
        { Numero: 203, Empresa: empresa, Ambiente: 2, Estado: 3 },
        { Numero: 204, Empresa: empresa, Ambiente: 2, Estado: 4 },
        { Numero: 205, Empresa: empresa, Ambiente: 3, Estado: 5 },
        { Numero: 206, Empresa: empresa, Ambiente: 3, Estado: 6 },
        { Numero: 210, Empresa: empresa, Ambiente: 2, Estado: 1 },
        { Numero: 220, Empresa: empresa, Ambiente: 3, Estado: 1 },
        { Numero: 231, Empresa: empresa, Ambiente: 3, Estado: 1 },
        { Numero: 236, Empresa: empresa, Ambiente: 2, Estado: 1 },
        { Numero: 300, Empresa: empresa, Ambiente: 3, Estado: 1 }
    ];
    await fixture(page, { tables: empresa => tablesFor(Number(empresa)), openTable: false });

    await expect(page.locator('#pos-ambiente-filters')).toHaveCount(0);
    await expect(page.locator('#pos-table-group-filters .table-group-btn')).toHaveText([
        'Todos', 'Atención normal', 'Desayunos', 'Delivery', 'Para llevar',
        'PedidosYa | Rappi', 'Descarte y obsequios', 'Varios'
    ]);
    await expect(page.locator('.pos-table-card')).toHaveCount(tablesFor(2).length);
    await expect(page.locator('[data-table-number="80"]')).toHaveAttribute('data-table-type', 'normal');
    await expect(page.locator('[data-table-number="81"]')).toHaveAttribute('data-table-type', 'breakfast');
    await expect(page.locator('[data-table-number="120"]')).toContainText('Desayunos');
    await expect(page.locator('[data-table-number="121"]')).toHaveAttribute('data-table-type', 'normal');
    await expect(page.locator('[data-table-number="201"]')).toContainText('Delivery');
    await expect(page.locator('[data-table-number="210"]')).toContainText('Para llevar');
    await expect(page.locator('[data-table-number="220"]')).toContainText('PedidosYa | Rappi');
    await expect(page.locator('[data-table-number="231"]')).toContainText('Descarte y obsequios');
    await expect(page.locator('[data-table-number="236"]')).toContainText('Varios');
    await expect(page.locator('[data-table-number="300"]')).toHaveAttribute('data-table-type', 'misc');
    await expect(page.locator('[data-table-number="220"] .pos-brand-logo')).toHaveCount(2);
    await expect.poll(() => page.locator('[data-table-number="220"] .pos-brand-logo img')
        .evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0))).toBe(true);
    await expect(page.locator('[data-table-number="220"] .pos-brand-logo.is-fallback')).toHaveCount(0);

    const stateBackgrounds = ['rgb(220, 252, 231)', 'rgb(219, 234, 254)', 'rgb(254, 249, 195)',
        'rgb(224, 231, 255)', 'rgb(252, 231, 243)', 'rgb(254, 226, 226)'];
    for (let index = 0; index < 6; index += 1) {
        const card = page.locator(`[data-table-number="${201 + index}"]`);
        expect(await card.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(stateBackgrounds[index]);
    }

    await page.getByRole('button', { name: 'Desayunos', exact: true }).click();
    await expect(page.locator('.pos-table-card')).toHaveCount(2);
    expect(await page.locator('.pos-table-card').evaluateAll(cards => cards.map(card => card.dataset.tableNumber))).toEqual(['81', '120']);

    await page.getByRole('button', { name: 'Varios', exact: true }).click();
    await expect(page.locator('.pos-table-card')).toHaveCount(2);
    expect(await page.locator('.pos-table-card').evaluateAll(cards => cards.map(card => card.dataset.tableNumber))).toEqual(['236', '300']);

    await page.getByRole('button', { name: 'Desayunos', exact: true }).click();
    await page.selectOption('#pos-empresa-select', '04');
    await expect(page.getByRole('button', { name: 'Desayunos', exact: true })).toHaveCount(0);
    await expect(page.locator('[data-table-group="all"]')).toHaveClass(/active/);
    await expect(page.locator('.pos-table-card')).toHaveCount(tablesFor(4).length);
    await expect(page.locator('[data-table-number="81"]')).toHaveAttribute('data-table-type', 'normal');
    await expect(page.locator('[data-table-number="120"]')).toHaveAttribute('data-table-type', 'normal');
    await expect(page.locator('[data-table-number="220"]')).toHaveAttribute('data-table-type', 'marketplaces');
});

test('agrupación compacta libera espacio y conserva la selección en móvil y tablet', async ({ page }) => {
    const tablesFor = empresa => [80, 81, 120, 121, 201, 210, 220, 231, 236]
        .map((Numero, index) => ({ Numero, Empresa: empresa, Ambiente: index % 3 + 1, Estado: index % 6 + 1 }));
    await page.setViewportSize({ width: 390, height: 844 });
    await fixture(page, { tables: empresa => tablesFor(Number(empresa)), openTable: false });

    const toggle = page.locator('#pos-table-group-toggle');
    const filters = page.locator('#pos-table-group-filters');
    const current = page.locator('#pos-table-group-current');

    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-controls', 'pos-table-group-filters');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(filters).toBeHidden();
    await expect(current).toHaveText('Todos');
    expect((await toggle.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await page.locator('.pos-table-card').evaluateAll(cards => cards.slice(0, 2)
        .every(card => card.getBoundingClientRect().bottom <= window.innerHeight))).toBe(true);

    await toggle.focus();
    await toggle.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(filters).toBeVisible();
    await page.getByRole('button', { name: 'Desayunos', exact: true }).click();
    await expect(current).toHaveText('Desayunos');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(filters).toBeHidden();
    await expect(page.locator('.pos-table-card')).toHaveCount(2);

    await page.locator('.pos-table-card').first().click();
    await expect(page.locator('#view-pos-order')).toBeVisible();
    await page.evaluate(() => showView('pos-tables'));
    await expect(current).toHaveText('Desayunos');
    await expect(filters).toBeHidden();

    await page.selectOption('#pos-empresa-select', '04');
    await expect(current).toHaveText('Todos');
    await expect(page.locator('[data-table-group="all"]')).toHaveClass(/active/);

    for (const viewport of [
        { width: 320, height: 700 }, { width: 440, height: 956 }, { width: 768, height: 1024 },
        { width: 1024, height: 1366 }, { width: 1194, height: 834 }
    ]) {
        await page.setViewportSize(viewport);
        await expect(toggle).toBeVisible();
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(filters).toBeHidden();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        if (viewport.width === 440) {
            expect(await page.locator('.pos-table-card').evaluateAll(cards => cards.slice(0, 2)
                .every(card => card.getBoundingClientRect().bottom <= window.innerHeight))).toBe(true);
        }
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(toggle).toBeHidden();
    await expect(filters).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
});

test('mapa de mesas especiales no desborda en móvil, tablet ni escritorio', async ({ page }) => {
    const tables = [81, 120, 201, 210, 220, 231, 236].map((Numero, index) => ({ Numero, Empresa: 2, Ambiente: index % 3 + 1, Estado: index % 6 + 1 }));
    await fixture(page, { tables, openTable: false });

    for (const viewport of [
        { width: 320, height: 700 }, { width: 390, height: 844 }, { width: 440, height: 956 },
        { width: 768, height: 1024 }, { width: 1024, height: 1366 }, { width: 1194, height: 834 },
        { width: 1280, height: 800 }
    ]) {
        await page.setViewportSize(viewport);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        expect(await page.locator('.content').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await page.locator('#pos-table-group-filters').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        expect(await page.locator('.pos-table-card').evaluateAll(cards => cards.every(card => {
            const grid = card.closest('.pos-tables-grid').getBoundingClientRect();
            const box = card.getBoundingClientRect();
            return box.left >= grid.left - .5 && box.right <= grid.right + .5;
        }))).toBe(true);
    }
});

test('reactivación reconcilia el mapa una sola vez y mantiene filtros y una sola conexión SSE', async ({ page }) => {
    let tableState = 1;
    const state = await fixture(page, {
        stubEventSource: true,
        openTable: false,
        tables: () => [{ Numero: 201, Empresa: 2, Ambiente: 1, Estado: tableState }]
    });
    await page.getByRole('button', { name: 'Delivery', exact: true }).click();
    await expect.poll(() => page.evaluate(() => !appResumeTimer && !appResumePromise)).toBe(true);
    const baseline = { tables: state.tableLoads, sessions: state.sessionLoads,
        sse: await page.evaluate(() => window.__sseTest.created) };

    tableState = 2;
    await page.evaluate(() => {
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
        window.dispatchEvent(new Event('online'));
        window.dispatchEvent(new Event('focus'));
    });

    await expect(page.locator('[data-table-number="201"]')).toContainText('Ocupada');
    expect(state.tableLoads).toBe(baseline.tables + 1);
    expect(state.sessionLoads).toBe(baseline.sessions + 1);
    expect(await page.evaluate(() => window.__sseTest.created)).toBe(baseline.sse + 1);
    expect(await page.evaluate(() => ({ live: window.__sseTest.live, maxLive: window.__sseTest.maxLive,
        retryPending: Boolean(sseRetryTimer) }))).toEqual({ live: 1, maxLive: 1, retryPending: false });
    await expect(page.locator('#pos-empresa-select')).toHaveValue('02');
    await expect(page.getByRole('button', { name: 'Mañana', exact: true })).toHaveClass(/active/);
    await expect(page.locator('#pos-table-group-current')).toHaveText('Delivery');
});

test('mapa descarta respuestas antiguas al cambiar empresa durante una recarga', async ({ page }) => {
    await fixture(page, {
        stubEventSource: true,
        openTable: false,
        tableDelay: empresa => Number(empresa) === 4 ? 350 : 0,
        tables: empresa => [{ Numero: 200 + Number(empresa), Empresa: Number(empresa), Ambiente: 1, Estado: 1 }]
    });

    await page.selectOption('#pos-empresa-select', '04');
    await page.selectOption('#pos-empresa-select', '06');
    await expect(page.locator('[data-table-number="206"]')).toBeVisible();
    await page.waitForTimeout(450);
    await expect(page.locator('[data-table-number="206"]')).toBeVisible();
    await expect(page.locator('[data-table-number="204"]')).toHaveCount(0);
});

test('reactivación actualiza pedidos limpios y conserva borradores ante una versión remota', async ({ page }) => {
    const state = await fixture(page, { stubEventSource: true });
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.saves).toBe(1);
    await expect.poll(() => page.evaluate(() => !appResumeTimer && !appResumePromise && !orderSavePromise)).toBe(true);

    state.items[0].cantidad = 3;
    state.version++;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => page.evaluate(() => posCart[0]?.cantidad)).toBe(3);

    await page.evaluate(() => {
        posCart[0].cantidad = 7;
        orderDirty = true;
        orderGeneration++;
        updateCartUI();
    });
    state.items[0].cantidad = 4;
    state.version++;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect.poll(() => page.evaluate(() => orderConflict)).toBe(true);
    expect(await page.evaluate(() => posCart[0].cantidad)).toBe(7);
    await expect(page.locator('#order-save-message')).toContainText('reposo');
});

test('reactivación refresca Cocina y redirige si la sesión expiró', async ({ page }) => {
    const state = await fixture(page, { stubEventSource: true, openTable: false });
    await page.evaluate(() => showView('cocina'));
    await page.selectOption('#cocina-empresa-select', '02');
    await expect.poll(() => page.evaluate(() => !appResumeTimer && !appResumePromise)).toBe(true);

    state.kds.push({
        NroTicket: 'T001-34', NroMesa: 34, EnvioId: '34343434-3434-4434-8434-343434343434',
        LineaId: '56565656-5656-4565-8565-565656565656', Codpro: '02001', Cantidad: 1,
        Descripcion: 'Arroz reactivado', EstadoCocina: 1, FechaTicket: new Date().toISOString(), MinutosEspera: 0
    });
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('#cocina-board')).toContainText('Arroz reactivado');

    await expect.poll(() => page.evaluate(() => !appResumeTimer && !appResumePromise)).toBe(true);
    state.sessionActive = false;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page).toHaveURL(/\/login\.html$/);
});

test('autoguardado no recarga el mapa oculto', async ({ page }) => {
    const state = await fixture(page);
    const baseline = state.tableLoads;
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.saves).toBe(1);
    expect(state.tableLoads).toBe(baseline);
});

test('Regresar funciona en una preventa de solo lectura', async ({ page }) => {
    const state = await fixture(page, { openTable: false });
    state.ticket = 'T001-000046';
    state.orderState = 2;
    state.items = [{ lineaId:'46464646-4646-4646-8646-464646464646',codPro:'02001',nombre:'Arroz con mariscos',
        cantidad:1,precio:20,afecto:1,notasRapidas:[],nota:'' }];
    state.sent.set(state.items[0].lineaId, JSON.stringify(state.items[0]));
    await page.locator('.pos-table-card').first().click();
    await expect(page.locator('#pos-preventa-badge')).toBeVisible();
    await page.locator('#pos-order-back').click();
    await expect(page.locator('#view-pos-tables')).toBeVisible();
    expect(await page.evaluate(() => ({ table:posCurrentTable,ticket:posCurrentNroTicket,readOnly:posIsReadOnly })))
        .toEqual({ table:null,ticket:null,readOnly:false });
});

test('un error al cargar pedido permite reintentar o regresar sin crear conflicto', async ({ page }) => {
    const state = await fixture(page, { openTable: false });
    state.orderLoadError = true;
    await page.locator('.pos-table-card').first().click();
    await expect(page.locator('#order-save-message')).toContainText('diag-order-load');
    await expect(page.locator('#order-retry-load')).toBeVisible();
    expect(await page.evaluate(() => orderConflict)).toBe(false);

    state.orderLoadError = false;
    await page.locator('#order-retry-load').click();
    await expect(page.locator('#order-retry-load')).toBeHidden();
    state.orderLoadError = true;
    await page.evaluate(() => retryPOSOrderLoad());
    await expect(page.locator('#order-retry-load')).toBeVisible();
    await page.locator('#pos-order-back').click();
    await expect(page.locator('#view-pos-tables')).toBeVisible();
});

test('Regresar invalida una carga tardía del pedido', async ({ page }) => {
    const state = await fixture(page, { openTable: false });
    state.ticket = 'T001-000047';
    state.orderLoadDelay = 700;
    await page.locator('.pos-table-card').first().click();
    await expect(page.locator('#view-pos-order')).toBeVisible();
    await page.locator('#pos-order-back').click();
    await expect(page.locator('#view-pos-tables')).toBeVisible();
    await page.waitForTimeout(850);
    expect(await page.evaluate(() => ({ ticket:posCurrentNroTicket,orderVisible:isViewVisible('view-pos-order') })))
        .toEqual({ ticket:null,orderVisible:false });
});

test('Regresar confirma el descarte de un conflicto real y espera guardados normales', async ({ page }) => {
    const state = await fixture(page);
    await page.evaluate(() => { orderBusy = true; renderOrderStatus(); });
    await page.locator('#pos-order-back').click();
    await expect(page.locator('#view-pos-order')).toBeVisible();
    await expect(page.locator('#order-save-message')).toContainText('Espere a que termine');
    await page.evaluate(() => { orderBusy = false; renderOrderStatus(); });
    await page.evaluate(() => { orderDirty = true; orderConflict = true; updateCartUI(); });
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#pos-order-back').click();
    await expect(page.locator('#view-pos-tables')).toBeVisible();

    await page.locator('.pos-table-card').first().click();
    state.delaySave = 350;
    await page.locator('.pos-product-card').first().click();
    await page.locator('#pos-order-back').click();
    await expect.poll(() => state.saves).toBeGreaterThan(0);
    await expect(page.locator('#view-pos-tables')).toBeVisible();
});

test('Cocina conserva datos y muestra referencia al fallar sin alert modal', async ({ page }) => {
    const state = await fixture(page, { openTable: false });
    state.kds.push({ NroTicket:'T001-000010',NroMesa:10,LineaId:'10101010-1010-4010-8010-101010101010',Codpro:'02001',
        EstadoCocina:1,Cantidad:1,Descripcion:'Plato persistente',Categoria:'Platos',FechaTicket:new Date().toISOString(),MinutosEspera:1 });
    await page.evaluate(() => showView('cocina'));
    await page.selectOption('#cocina-empresa-select','02');
    await expect(page.locator('#cocina-board')).toContainText('Plato persistente');
    state.kitchenError = true;
    await page.evaluate(() => loadCocinaPedidos());
    await expect(page.locator('#load-notice-kitchen')).toContainText('diag-kds-123');
    await expect(page.locator('#cocina-board')).toContainText('Plato persistente');
});

test('Cocina avisa una vez por envío, incluso al actualizar el mismo ticket', async ({ page }) => {
    const state = await fixture(page, { openTable: false });
    state.kds.push({ NroTicket:'T001-000010', NroMesa:10, LineaId:'10101010-1010-4010-8010-101010101010',
        EnvioId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', Codpro:'02001', EstadoCocina:1, Cantidad:1,
        Descripcion:'Plato', Categoria:'Platos', FechaTicket:new Date().toISOString(), MinutosEspera:0 });
    await page.evaluate(() => {
        window.__kitchenAlarms = 0;
        playCocinaBeep = () => { window.__kitchenAlarms++; };
        showView('cocina');
    });
    await page.selectOption('#cocina-empresa-select', '02');
    await expect(page.locator('#cocina-board')).toContainText('Plato');
    expect(await page.evaluate(() => window.__kitchenAlarms)).toBe(0);

    state.kds[0].EnvioId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await page.evaluate(() => loadCocinaPedidos());
    expect(await page.evaluate(() => window.__kitchenAlarms)).toBe(1);
    await page.evaluate(() => loadCocinaPedidos());
    expect(await page.evaluate(() => window.__kitchenAlarms)).toBe(1);

    state.kds[0].EnvioId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    state.kitchenStaleResponses = 1;
    await page.evaluate(() => loadCocinaPedidos());
    expect(await page.evaluate(() => window.__kitchenAlarms)).toBe(1);
    await page.evaluate(() => loadCocinaPedidos());
    expect(await page.evaluate(() => window.__kitchenAlarms)).toBe(2);
});

test('Cocina carga el MP3 local y Probar sonido usa el nivel elegido', async ({ page }) => {
    await fixture(page, { openTable: false });
    await page.evaluate(() => showView('cocina'));
    const response = await page.request.get('/sounds/universe_bell.mp3');
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('audio/mpeg');

    await page.locator('#cocina-volume').fill('35');
    await page.locator('#cocina-sound-test').click();
    await expect(page.locator('#cocina-sound-btn')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => cocinaBellBuffer?.duration || 0)).toBeGreaterThan(1);
    expect(await page.evaluate(() => cocinaBellFailed)).toBe(false);
    expect(await page.evaluate(() => cocinaBellSources.size)).toBe(1);
    expect(await page.locator('#cocina-volume').inputValue()).toBe('35');
});

test('Cocina informa el fallo del MP3 y conserva la alarma de respaldo', async ({ page }) => {
    await fixture(page, { openTable: false });
    await page.route('**/sounds/universe_bell.mp3', route => route.fulfill({ status: 404, body: '' }));
    await page.evaluate(() => showView('cocina'));
    await page.locator('#cocina-sound-test').click();
    await expect(page.locator('#cocina-sound-status')).toContainText('alarma de respaldo');
    expect(await page.evaluate(() => cocinaBellFailed)).toBe(true);
    await expect(page.locator('#cocina-sound-btn')).toHaveAttribute('aria-pressed', 'true');
});

test('Cocina identifica una instantánea desactualizada y se recupera automáticamente', async ({ page }) => {
    const state = await fixture(page, { openTable: false });
    state.kds.push({ NroTicket:'T001-000045',NroMesa:45,LineaId:'45454545-4545-4545-8545-454545454545',Codpro:'02001',
        EstadoCocina:1,Cantidad:1,Descripcion:'Plato resiliente',Categoria:'Platos',FechaTicket:new Date().toISOString(),MinutosEspera:1 });
    await page.evaluate(() => showView('cocina'));
    await page.selectOption('#cocina-empresa-select','02');
    await expect(page.locator('#cocina-board')).toContainText('Plato resiliente');

    state.kitchenStaleResponses = 1;
    const before = state.kitchenLoads;
    await page.evaluate(() => loadCocinaPedidos());
    await expect(page.locator('#load-notice-kitchen')).toContainText('Última actualización');
    await expect(page.locator('#load-notice-kitchen')).toContainText('diag-stale-45');
    await expect(page.locator('#cocina-board')).toContainText('Plato resiliente');
    await expect.poll(() => state.kitchenLoads, { timeout: 5000 }).toBeGreaterThan(before + 1);
    await expect(page.locator('#load-notice-kitchen')).toHaveCount(0);
});

test('Cocina pausa la recuperación automática al abandonar la vista', async ({ page }) => {
    const state = await fixture(page, { openTable: false });
    await page.evaluate(() => showView('cocina'));
    await page.selectOption('#cocina-empresa-select','02');
    state.kitchenStaleResponses = 10;
    await page.evaluate(() => loadCocinaPedidos());
    await expect(page.locator('#load-notice-kitchen')).toContainText('Reintentando automáticamente');
    await page.evaluate(() => showView('pos-tables'));
    const afterLeaving = state.kitchenLoads;
    await page.waitForTimeout(2300);
    expect(state.kitchenLoads).toBe(afterLeaving);
});

test('avisos de Mesas y Cocina permanecen dentro de su propia vista', async ({ page }) => {
    const state = await fixture(page, { openTable: false });
    state.tableError = true;
    await page.evaluate(() => loadPOSTables());
    await expect(page.locator('#load-notice-tables')).toContainText('diag-tables-456');
    await expect(page.locator('#view-pos-tables #load-notice-tables')).toHaveCount(1);

    state.kitchenError = true;
    await page.evaluate(() => showView('cocina'));
    await page.selectOption('#cocina-empresa-select', '02');
    await expect(page.locator('#load-notice-kitchen')).toContainText('diag-kds-123');
    await expect(page.locator('#view-cocina #load-notice-kitchen')).toHaveCount(1);
    await expect(page.locator('#load-notice-tables')).toBeHidden();

    await page.evaluate(() => showView('pos-tables'));
    await expect(page.locator('#load-notice-kitchen')).toBeHidden();
});

test('Cocina reintenta una sola vez una lectura transitoria', async ({ page }) => {
    const state = await fixture(page, { openTable: false });
    state.kitchenTransientFailures = 1;
    const before = state.kitchenLoads;
    await page.evaluate(() => showView('cocina'));
    await page.selectOption('#cocina-empresa-select', '02');
    await expect.poll(() => state.kitchenLoads - before).toBe(2);
    await expect(page.locator('#load-notice-kitchen')).toHaveCount(0);
});

test('v1 oculta impresión y cierre cuando no están habilitados', async ({ page }) => {
    await fixture(page, { features: { printerEnabled: false, closuresEnabled: false } });
    await expect(page.locator('[data-module="cierres"]')).toBeHidden();
    await expect(page.locator('#cocina-ticket-print')).toBeHidden();
});
test('manifest, iconos y Font Awesome se sirven localmente', async ({ page }) => {
    await fixture(page);
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
    await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
    const manifest = await page.request.get('/manifest.webmanifest');
    expect(manifest.ok()).toBeTruthy();
    expect((await manifest.json()).display).toBe('standalone');
    expect((await page.request.get('/icons/icon-512.png')).ok()).toBeTruthy();
    expect((await page.request.get('/icons/order-channels/pedidosya.svg')).ok()).toBeTruthy();
    expect((await page.request.get('/icons/order-channels/rappi.svg')).ok()).toBeTruthy();
    expect((await page.request.get('/vendor/fontawesome/css/all.min.css')).ok()).toBeTruthy();
});
test('login móvil respeta viewport y no desborda', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route('**/api/users', route => route.fulfill({ status: 200, json: [] }));
    await page.goto('/login.html');
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/);
    await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/apple-touch-icon.png');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
test('notas por línea, split, cancelar, guardar y envío explícito sin doble clic', async ({ page }) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const state = await fixture(page);
    await page.locator('.pos-product-card').first().click();
    await page.locator('.pos-product-card').first().click();
    await page.locator('[data-action="notes"]').click();
    await expect(page.locator('#order-quick-notes button')).toHaveCount(12);
    await expect(page.getByRole('button', { name: '+ Helada', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Sin Helar', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '+ Sin cebolla', exact: true }).click();
    await page.locator('#order-note-text').fill('Alérgico: consultar al mozo');
    await page.locator('#order-notes-dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.locator('.order-line-notes').first()).toHaveText('');
    page.once('dialog', d => d.accept('1'));
    await page.getByRole('button', { name: 'Separar', exact: true }).click();
    await page.getByRole('button', { name: '+ Sin cebolla', exact: true }).click();
    await page.getByRole('button', { name: '+ Helada', exact: true }).click();
    await page.getByRole('button', { name: '+ Sin Helar', exact: true }).click();
    await page.locator('#order-note-text').fill('Sin sal');
    await page.locator('#order-notes-dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.locator('.cart-item')).toHaveCount(2);
    await expect.poll(() => state.items.length).toBe(2);
    expect(state.sends).toBe(0);
    expect(state.items[0].cantidad + state.items[1].cantidad).toBe(2);
    expect(state.items[1].notasRapidas).toEqual(['Sin cebolla', 'Helada', 'Sin Helar']);
    await expect(page.locator('.btn-pay-now')).toBeDisabled();
    await page.locator('#btn-enviar-cocina').dblclick();
    await expect(page.locator('#order-kitchen-status')).toHaveText('Enviado a cocina');
    await expect(page.locator('#order-save-message')).toHaveText('Envío registrado en Cocina · 22222222.');
    expect(state.sends).toBe(1);
    await expect(page.locator('#btn-enviar-cocina')).toBeDisabled();
    await expect(page.locator('.btn-pay-now')).toBeEnabled();
    await page.locator('.pos-product-card').first().click();
    await expect(page.locator('.cart-item')).toHaveCount(2);
    await expect(page.locator('.cart-item').first().locator('.cart-item-controls')).toContainText('2');
    await expect(page.locator('.order-quantity-pending')).toHaveText('+1 pendiente de enviar');
    await expect(page.locator('#order-kitchen-status')).toHaveText('Cambios pendientes');
    expect(errors).toEqual([]);
});

test('Detalle Pedido muestra Listo, Entregado y desglose de estados agrupados', async ({ page }) => {
    const state = await fixture(page);
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.items.length).toBe(1);
    await page.locator('#btn-enviar-cocina').click();
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.items.length).toBe(2);
    await page.locator('#btn-enviar-cocina').click();
    const [first, second] = state.items;
    state.kitchenStates.set(first.lineaId,2); state.kitchenStates.set(second.lineaId,3);
    await page.evaluate(() => syncPOSKitchenStatuses());
    await expect(page.locator('.order-kitchen-line-status')).toHaveText('1 en preparación · 1 listo');
    state.kitchenStates.set(first.lineaId,3);
    await page.evaluate(() => syncPOSKitchenStatuses());
    await expect(page.locator('.order-kitchen-line-status')).toHaveText('Listo en Cocina');
    await expect(page.locator('#order-kitchen-status')).toHaveText('Listo en Cocina');
    state.kitchenStates.set(first.lineaId,4); state.kitchenStates.set(second.lineaId,4);
    await page.evaluate(() => syncPOSKitchenStatuses());
    await expect(page.locator('.order-kitchen-line-status')).toHaveText('Producto Entregado');
    await expect(page.locator('#order-kitchen-status')).toHaveText('Producto Entregado');
});

test('pantalla de cierre valida alcance y exige PIN antes de archivar', async ({ page }) => {
    const state = await fixture(page);
    await page.locator('.sidebar li[data-module="cierres"]').click();
    await expect(page.locator('#view-cierres')).toBeVisible();
    await expect(page.locator('#shift-close-preview')).toContainText('Tickets identificados');
    await expect(page.locator('#shift-close-submit')).toBeEnabled();
    await page.locator('#shift-close-pin').fill('2468');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#shift-close-submit').click();
    await expect.poll(() => state.closes).toBe(1);
    await expect(page.locator('#shift-close-preview')).toContainText('Cierre: cerrado');
    await expect(page.locator('#shift-close-pin')).toHaveValue('');
});

test('vaciar el último producto elimina el ticket y vuelve al mapa con la mesa libre', async ({ page }) => {
    const state = await fixture(page);
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.items.length).toBe(1);
    await page.locator('[data-action="del"]').click();
    await expect.poll(() => state.deletes).toBe(1);
    await expect(page.locator('#view-pos-tables')).toBeVisible();
    expect(state.ticket).toBeNull();
});

test('Limpiar y Borrar Comanda comparten el borrado definitivo', async ({ page }) => {
    const state = await fixture(page);
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.items.length).toBe(1);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.btn-clear').click();
    await expect.poll(() => state.deletes).toBe(1);

    await page.locator('.pos-table-card').first().click();
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.items.length).toBe(1);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#btn-borrar-comanda').click();
    await expect.poll(() => state.deletes).toBe(2);
    await expect(page.locator('#view-pos-tables')).toBeVisible();
});

test('un fallo al Limpiar conserva el carrito y permite reintentar la eliminación', async ({ page }) => {
    const state = await fixture(page);
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.items.length).toBe(1);
    state.deleteError = true;
    page.once('dialog', dialog => dialog.accept());
    await page.locator('.btn-clear').click();
    await expect(page.locator('#order-save-message')).toContainText('diag-delete');
    await expect(page.locator('#view-pos-order')).toBeVisible();
    await expect(page.locator('.cart-item')).toHaveCount(1);
    expect(state.ticket).not.toBeNull();
    await expect(page.locator('#order-retry-save')).toHaveText('Reintentar eliminación');

    state.deleteError = false;
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#order-retry-save').click();
    await expect(page.locator('#view-pos-tables')).toBeVisible();
    expect(state.ticket).toBeNull();
});

test('un conflicto comercial carga el pedido en solo lectura pero permite eliminarlo', async ({ page }) => {
    const state = await fixture(page);
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.items.length).toBe(1);
    state.commercialConflict = true;
    await page.evaluate(() => openPOSOrder(1, 2));
    await expect(page.locator('#order-save-message')).toContainText('difiere del pedido web');
    await expect(page.locator('#pos-products-grid')).toBeHidden();
    await expect(page.locator('.btn-clear')).toBeEnabled();
    await expect(page.locator('#btn-borrar-comanda')).toBeEnabled();
    const acceptDialogs = dialog => dialog.accept();
    page.on('dialog', acceptDialogs);
    await page.locator('.btn-clear').click();
    await expect(page.locator('#view-pos-tables')).toBeVisible();
    page.off('dialog', acceptDialogs);
});

test('sidebar colapsado oculta el nombre y conserva el usuario accesible', async ({ page }) => {
    await fixture(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator('.toggle-btn').click();
    await expect(page.locator('#sidebar')).toHaveClass(/collapsed/);
    await expect(page.locator('#sidebar-user-name')).toBeHidden();
    await expect(page.locator('.sidebar-footer .user-info')).toHaveAttribute('aria-label', 'Usuario: Mozo');
});

test('ticket largo de Cocina desplaza el contenido y encola una sola reimpresión', async ({ page }) => {
    const state = await fixture(page);
    const longDocument = Array.from({length:100},(_,i)=>`${i + 1} x Producto ${i + 1}`).join('\n');
    state.kds=[{NroTicket:'T001-000001',NroMesa:1,LineaId:'11111111-1111-4111-8111-111111111111',Codpro:'02001',EstadoCocina:1,
        Cantidad:1,Descripcion:'Arroz',notasRapidas:[],nota:'',Categoria:'Platos',FechaTicket:new Date().toISOString(),MinutosEspera:1,Documento:longDocument}];
    await page.locator('.sidebar li[data-module="cocina"]').click();
    await page.selectOption('#cocina-empresa-select','02');
    await page.getByRole('button',{name:'Ver ticket',exact:true}).click();
    await expect(page.locator('#cocina-ticket-documento')).toContainText('Producto 100');
    const dialogBox = await page.locator('#cocina-ticket-dialog').boundingBox();
    expect(dialogBox.height).toBeLessThanOrEqual(800 * .91);
    await page.locator('#cocina-ticket-print-cocina').dblclick();
    await expect(page.locator('#cocina-ticket-print-status')).toHaveText('Reimpresión de Cocina en cola.');
    expect(state.reprints).toBe(1);
    expect(state.reprintDestinations).toEqual(['cocina']);
});

test('ticket mixto muestra y encola Cocina, Bebidas y Barra de forma independiente', async ({ page }) => {
    const state = await fixture(page, { features: { printerEnabled:true, barPrinterEnabled:true, closuresEnabled:true } });
    state.kds=[{NroTicket:'T001-000001',NroMesa:1,LineaId:'11111111-1111-4111-8111-111111111111',Codpro:'02001',EstadoCocina:1,
        Cantidad:1,Descripcion:'Arroz',notasRapidas:[],nota:'',Categoria:'Platos',FechaTicket:new Date().toISOString(),MinutosEspera:1,
        Documento:'COMANDA COMPLETA',Impresion:{estado:'enviado'},Impresiones:[{estado:'enviado',destino:'cocina'},{estado:'enviado',destino:'bebidas'},{estado:'enviado',destino:'barra'}]}];
    await page.locator('.sidebar li[data-module="cocina"]').click();
    await page.selectOption('#cocina-empresa-select','02');
    await page.getByRole('button',{name:'Ver ticket',exact:true}).click();
    await page.locator('#cocina-ticket-print-bebidas').click();
    await expect(page.locator('#cocina-ticket-print-status')).toHaveText('Reimpresión de Bebidas en cola.');
    await page.locator('#cocina-ticket-print-barra').click();
    await expect(page.locator('#cocina-ticket-print-status')).toHaveText('Reimpresión de Barra en cola.');
    expect(state.reprintDestinations).toEqual(['bebidas','barra']);
});
test('espera el autoguardado en curso antes de enviar', async ({ page }) => {
    const state = await fixture(page); state.delaySave = 350;
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.requestOrder.length).toBe(1);
    await page.locator('#btn-enviar-cocina').click();
    await expect(page.locator('#order-kitchen-status')).toHaveText('Enviado a cocina');
    expect(state.requestOrder).toEqual(['save','send']); expect(state.sends).toBe(1);
});
test('vaciar una línea enviada elimina el pedido sin esperar reconocimiento de Cocina', async ({ page }) => {
    const state = await fixture(page);
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.items.length).toBe(1);
    await page.locator('#btn-enviar-cocina').click();
    await expect(page.locator('#order-kitchen-status')).toHaveText('Enviado a cocina');
    await page.locator('[data-action="del"]').click();
    await expect.poll(() => state.deletes).toBe(1);
    await expect(page.locator('#view-pos-tables')).toBeVisible();
    expect(state.ticket).toBeNull();
});
test('409 conserva el borrador y ofrece comparación sin sobrescribir', async ({ page }) => {
    const state = await fixture(page); state.conflict = true;
    await page.locator('.pos-product-card').first().click();
    await expect(page.locator('#order-review-conflict')).toBeVisible();
    await expect(page.locator('.cart-item')).toHaveCount(1);
    await expect(page.locator('#btn-enviar-cocina')).toBeDisabled();
    await page.locator('#order-review-conflict').click();
    await expect(page.locator('#order-conflict-local')).toContainText('Arroz');
    expect(state.saves).toBe(0); expect(state.sends).toBe(0);
});
test('modal en móvil: texto literal, notas borrables y ancho sin desbordamiento', async ({ page }) => {
    await page.setViewportSize({ width: 440, height: 956 }); await fixture(page);
    await page.locator('.pos-product-card').first().click();
    await page.locator('#pos-cart-fab').click();
    await page.locator('[data-action="notes"]').click();
    await page.locator('#order-note-text').fill('<img src=x onerror=alert(1)> ñ');
    await page.locator('#order-notes-dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.locator('.order-line-notes').first()).toContainText('<img');
    await expect(page.locator('.order-line-notes img')).toHaveCount(0);
    await page.locator('[data-action="notes"]').click();
    const box = await page.locator('#order-notes-dialog').boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.width).toBeLessThanOrEqual(440);
    await page.screenshot({ path: 'test-results/notas-mobile.png' });
    await page.locator('#order-notes-dialog').getByRole('button', { name: 'Borrar nota', exact: true }).click();
    await expect(page.locator('.order-line-notes').first()).toHaveText('');
});

test('detalle móvil usa casi toda la pantalla, prioriza la lista y conserva el foco', async ({ page }) => {
    await page.setViewportSize({ width: 440, height: 956 });
    await fixture(page);
    await page.locator('#pos-cart-fab').click();
    await expect(page.locator('#pos-cart-fab')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#pos-order-sidebar')).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('#pos-cart-close')).toBeFocused();
    await expect(page.locator('#pos-cart-empty')).toBeVisible();
    await expect(page.locator('#pos-subtotal')).toBeHidden();
    await page.locator('#pos-totals-details summary').click();
    await expect(page.locator('#pos-subtotal')).toBeVisible();
    await page.locator('#pos-totals-details summary').click();
    await page.evaluate(() => {
        posCart = Array.from({ length: 12 }, (_, index) => ({
            lineaId: newOrderId(), codPro: `02${String(index).padStart(3, '0')}`,
            nombre: `Producto con nombre extenso número ${index + 1}`, precio: 20,
            precioBase: 20, cantidad: 1, descuento: 0, afecto: true,
            notasRapidas: ['Sin cebolla'], nota: 'Preparación especial para esta mesa', enviada: null
        }));
        updateCartUI();
    });

    const sheet = await page.locator('#pos-order-sidebar').boundingBox();
    const list = await page.locator('.pos-cart-scroll-region').boundingBox();
    expect(sheet.height).toBeGreaterThanOrEqual(945);
    expect(list.height).toBeGreaterThanOrEqual(956 * .45);
    await expect(page.locator('#pos-total')).toBeVisible();
    await expect(page.locator('#btn-enviar-cocina')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator('#pos-order-sidebar')).not.toHaveClass(/open/);
    await expect(page.locator('#pos-cart-fab')).toBeFocused();
    await page.locator('#pos-cart-fab').click();
    await page.locator('#cart-sheet-backdrop').click({ position: { x: 10, y: 5 } });
    await expect(page.locator('#pos-cart-fab')).toHaveAttribute('aria-expanded', 'false');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#pos-cart-fab').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator('.pos-cart-totals')).toBeVisible();
});

test('búsqueda móvil compacta aprovecha el viewport y conserva consulta y foco al agregar', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fixture(page);
    const search = page.locator('#pos-product-search');
    const orderView = page.locator('#view-pos-order');

    await search.fill('Arroz');
    await expect(orderView).toHaveClass(/pos-mobile-search-mode/);
    await expect(page.locator('.pos-order-header')).toBeHidden();
    await expect(page.locator('#pos-categories-container')).toBeHidden();
    await expect(page.locator('#pos-cart-fab')).toBeHidden();
    await expect(page.locator('#pos-search-done')).toBeVisible();
    await expect(page.locator('#pos-search-clear')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 520 });
    const searchBox = await page.locator('#pos-search-container').boundingBox();
    const productsBox = await page.locator('#pos-products-grid').boundingBox();
    expect(searchBox.y).toBeGreaterThanOrEqual(0);
    expect(productsBox.height).toBeGreaterThanOrEqual(300);
    expect(productsBox.y + productsBox.height).toBeLessThanOrEqual(520);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.locator('.pos-product-card').first().click();
    await expect(search).toHaveValue('Arroz');
    await expect(search).toBeFocused();
    await expect(orderView).toHaveClass(/pos-mobile-search-mode/);

    await page.locator('#pos-search-clear').click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(page.locator('#pos-search-clear')).toBeHidden();

    await search.fill('Arroz');
    await page.locator('#pos-search-done').click();
    await expect(orderView).not.toHaveClass(/pos-mobile-search-mode/);
    await expect(search).toHaveValue('Arroz');

    await search.focus();
    await search.press('Enter');
    await expect(orderView).not.toHaveClass(/pos-mobile-search-mode/);
    await expect(page.locator('.pos-order-header')).toBeVisible();
});

test('@android abrir la búsqueda no transfiere el toque a un producto', async ({ page }) => {
    await fixture(page);
    const search = page.locator('#pos-product-search');
    const card = page.locator('.pos-product-card').first();
    const orderView = page.locator('#view-pos-order');

    await search.dispatchEvent('pointerdown', { pointerId: 41, pointerType: 'touch', isPrimary: true, bubbles: true });
    await search.evaluate(element => element.focus());
    await expect(orderView).not.toHaveClass(/pos-mobile-search-mode/);
    await card.dispatchEvent('pointerup', { pointerId: 41, pointerType: 'touch', isPrimary: true, bubbles: true });
    await card.dispatchEvent('click', { detail: 1, pointerId: 41, pointerType: 'touch', bubbles: true });
    await expect(orderView).toHaveClass(/pos-mobile-search-mode/);
    await expect(page.locator('#pos-cart-fab-count')).toHaveText('0');

    await page.waitForTimeout(180);
    await card.tap();
    await expect(page.locator('#pos-cart-fab-count')).toHaveText('1');
    await expect(search).toBeFocused();
});

test('tarjeta de producto conserva activación por teclado', async ({ page }) => {
    await fixture(page);
    const card = page.locator('.pos-product-card').first();
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#pos-cart-fab-count')).toHaveText('1');
    await page.keyboard.press('Space');
    await expect(page.locator('#pos-cart-fab-count')).toHaveText('2');
});

test('agregar producto confirma tarjeta, aviso y contador sin acumular mensajes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fixture(page);
    const card = page.locator('.pos-product-card').first();
    const feedback = page.locator('#pos-add-feedback');
    const cart = page.locator('#pos-cart-fab');

    await card.click();
    await expect(card).toHaveClass(/is-added/);
    await expect(feedback).toBeVisible();
    await expect(feedback).toHaveText('Agregado al pedido: Arroz con mariscos · Cantidad 1');
    await expect(cart).toHaveClass(/is-bumping/);
    await expect(page.locator('#pos-cart-fab-count')).toHaveText('1');

    await card.click();
    await expect(feedback).toHaveText('Agregado al pedido: Arroz con mariscos · Cantidad 2');
    await expect(page.locator('#pos-cart-fab-count')).toHaveText('2');
    await expect(page.locator('#pos-add-feedback')).toHaveCount(1);

    await page.waitForTimeout(1450);
    await expect(feedback).toBeHidden();

    const search = page.locator('#pos-product-search');
    await search.fill('Arroz');
    await card.click();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('Arroz');
    await expect(cart).toBeHidden();
    await expect(feedback).toContainText('Cantidad 3');
});

test('cabecera móvil plegable gana espacio y conserva resumen, acciones y preventa', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fixture(page);
    const header = page.locator('.pos-order-header');
    const toggle = page.locator('#pos-header-toggle');
    const actions = page.locator('#pos-header-actions-region');
    const grid = page.locator('#pos-products-grid');

    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(actions).toBeHidden();
    await expect(page.locator('.pos-title-mobile')).toBeVisible();
    await expect(page.locator('#pos-order-timer')).toBeVisible();
    await expect(page.locator('#pos-mojo-name')).toBeVisible();
    await expect(page.locator('#pos-guests')).toBeVisible();
    const collapsedHeight = (await grid.boundingBox()).height;

    await toggle.click();
    await expect(header).toHaveClass(/mobile-expanded/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(actions).toBeVisible();
    const expandedHeight = (await grid.boundingBox()).height;
    expect(collapsedHeight - expandedHeight).toBeGreaterThanOrEqual(48);
    expect((await toggle.boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect((await page.locator('.cat-btn').first().boundingBox()).height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.evaluate(() => {
        posIsReadOnly = true;
        updatePOSViewMode();
    });
    await expect(header).toHaveClass(/mobile-expanded/);
    await expect(toggle).toBeHidden();
    await expect(actions).toBeVisible();

    await page.evaluate(() => {
        posIsReadOnly = false;
        updatePOSViewMode();
    });
    await expect(header).not.toHaveClass(/mobile-expanded/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await page.evaluate(() => showView('pos-tables'));
    await expect(header).not.toHaveClass(/mobile-expanded/);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.evaluate(() => showView('pos-order'));
    await expect(toggle).toBeHidden();
    await expect(actions).toBeVisible();
});

test('confirmación conserva información con movimientos reducidos', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 440, height: 956 });
    await fixture(page);
    const card = page.locator('.pos-product-card').first();
    await card.click();
    await expect(page.locator('#pos-add-feedback')).toContainText('Agregado al pedido');
    await expect(card).toHaveClass(/is-added/);
    expect(await card.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
    expect(await page.locator('#pos-add-feedback').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
});

test('búsqueda móvil se limpia al rotar, navegar o entrar en preventa', async ({ page }) => {
    await page.setViewportSize({ width: 440, height: 956 });
    await fixture(page);
    const search = page.locator('#pos-product-search');
    const orderView = page.locator('#view-pos-order');

    await search.focus();
    await expect(orderView).toHaveClass(/pos-mobile-search-mode/);
    await page.setViewportSize({ width: 956, height: 440 });
    await expect(orderView).not.toHaveClass(/pos-mobile-search-mode/);

    await page.setViewportSize({ width: 440, height: 956 });
    await search.focus();
    await page.evaluate(() => showView('pos-tables'));
    await expect(orderView).not.toHaveClass(/pos-mobile-search-mode/);

    await page.evaluate(() => {
        showView('pos-order');
        posIsReadOnly = false;
    });
    await search.focus();
    await page.evaluate(() => {
        posIsReadOnly = true;
        updatePOSViewMode();
    });
    await expect(orderView).not.toHaveClass(/pos-mobile-search-mode/);
});

test('filtros Empresa y Turno no desbordan con nombres largos en móvil', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await fixture(page);
    await page.evaluate(() => showView('pos-tables'));
    await page.selectOption('#pos-empresa-select', '06');

    const fitsInside = async selector => page.locator(selector).evaluate(element => {
        const parent = element.closest('.pos-area-filters').getBoundingClientRect();
        const box = element.getBoundingClientRect();
        return box.left >= parent.left && box.right <= parent.right + .5 && element.scrollWidth <= element.clientWidth + .5;
    });
    expect(await fitsInside('#view-pos-tables .pos-empresa-group')).toBe(true);
    expect(await fitsInside('#view-pos-tables .pos-turno-group')).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('tablet usa drawer lateral y desktop conserva el detalle en dos columnas', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await fixture(page);
    const main = await page.locator('.pos-order-main').boundingBox();
    const layout = await page.locator('.pos-order-layout').boundingBox();
    expect(main.width).toBeGreaterThan(layout.width * .95);
    await page.locator('#pos-cart-fab').click();
    let sheet = await page.locator('#pos-order-sidebar').boundingBox();
    expect(sheet.width).toBeGreaterThanOrEqual(480);
    expect(sheet.width).toBeLessThanOrEqual(560);
    expect(sheet.x).toBeGreaterThan(0);
    await page.locator('#pos-cart-close').click();

    await page.setViewportSize({ width: 1024, height: 1366 });
    await page.locator('#pos-cart-fab').click();
    sheet = await page.locator('#pos-order-sidebar').boundingBox();
    expect(sheet.width).toBeCloseTo(560, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.setViewportSize({ width: 1194, height: 834 });
    await expect(page.locator('#pos-order-sidebar')).not.toHaveClass(/open/);
    await expect(page.locator('.mobile-menu-btn')).toBeVisible();
    let sidebar = await page.locator('#sidebar').boundingBox();
    expect(sidebar.x).toBeLessThan(0);
    const ipadMain = await page.locator('.pos-order-main').boundingBox();
    const ipadLayout = await page.locator('.pos-order-layout').boundingBox();
    expect(ipadMain.width).toBeGreaterThan(ipadLayout.width * .95);

    await page.locator('.mobile-menu-btn').click();
    await expect(page.locator('#sidebar')).toHaveClass(/open/);
    await expect.poll(async () => (await page.locator('#sidebar').boundingBox()).x).toBeGreaterThanOrEqual(0);
    await page.locator('#mobile-overlay').click({ position: { x: 500, y: 100 } });
    await page.locator('#pos-cart-fab').click();
    sheet = await page.locator('#pos-order-sidebar').boundingBox();
    expect(sheet.width).toBeCloseTo(560, 1);
    expect(sheet.x).toBeGreaterThan(600);

    await page.setViewportSize({ width: 834, height: 1194 });
    await expect(page.locator('#pos-order-sidebar')).not.toHaveClass(/open/);
    await expect(page.locator('#sidebar')).not.toHaveClass(/open/);
    await expect(page.locator('#cart-sheet-backdrop')).not.toHaveClass(/active/);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('#pos-cart-fab')).toBeHidden();
    await expect(page.locator('#pos-order-sidebar')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('#pos-subtotal')).toBeVisible();
    sheet = await page.locator('#pos-order-sidebar').boundingBox();
    expect(sheet.width).toBeGreaterThanOrEqual(360);
    expect(sheet.width).toBeLessThanOrEqual(460);
});

test('cocina presenta antes/después y permite reconocer conservando preparación', async ({ page }) => {
    const state = await fixture(page);
    const id='11111111-1111-4111-8111-111111111111';
    state.kds=[{NroTicket:'T001-000001',NroMesa:1,LineaId:id,Codpro:'02001',EstadoCocina:2,Cantidad:1,Descripcion:'Arroz con mariscos',
        notasRapidas:[],nota:'Sin sal',Categoria:'Platos',FechaTicket:new Date().toISOString(),MinutosEspera:2,
        pendiente:{tipo:'CORRECCIÓN',anterior:{nombre:'Arroz con mariscos',cantidad:1,nota:'Sin sal'},nueva:{nombre:'Arroz con mariscos',cantidad:1,nota:'Sin azúcar'}}}];
    await page.locator('.sidebar li[data-module="cocina"]').click();
    await page.selectOption('#cocina-empresa-select','02');
    await expect(page.locator('.kitchen-correction')).toContainText('ANTES:');
    await expect(page.locator('.kitchen-correction')).toContainText('Sin azúcar');
    await page.getByRole('button',{name:'Reconocer cambio',exact:true}).click();
    await expect(page.locator('.kitchen-correction')).toHaveCount(0);
    await expect(page.locator('.cocina-item.estado-2')).toContainText('Sin azúcar');
});
