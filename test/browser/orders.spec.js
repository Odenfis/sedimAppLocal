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
    function eligibleEmployees(empresa, mesa) {
        const special = [2, 4, 6].includes(Number(empresa)) && Number(mesa) >= 231 && Number(mesa) <= 235;
        const marketplace = Number(empresa) === 2 && Number(mesa) >= 220 && Number(mesa) <= 230;
        return (options.employeeCatalog || []).filter(item => special || (Number(item.Empresa) === Number(empresa) && !item.FecCese
            && (marketplace ? [195, 203].includes(Number(item.Codemp)) : Number(item.Tipo) === 3 && ![195, 203].includes(Number(item.Codemp)))))
            .sort((a, b) => a.Nombre.localeCompare(b.Nombre) || a.Codemp - b.Codemp).map(({ Codemp, Nombre }) => ({ Codemp, Nombre }));
    }
    function data() {
        const kitchenSnapshot = l => JSON.stringify(require('../../lib/order-domain').snapshot(l));
        const pending = state.items.some(l => kitchenSnapshot(l) !== (state.sent.has(l.lineaId) ? kitchenSnapshot(JSON.parse(state.sent.get(l.lineaId))) : null)) || [...state.sent.keys()].some(id => !state.items.some(l => l.lineaId === id));
        const cancellations = [...state.sent.entries()].filter(([id]) => !state.items.some(l => l.lineaId === id)).map(([,line]) => JSON.parse(line));
        return { success: true, nroTicket: state.ticket, version: state.version,
            conciliacionComercial: { status: state.commercialConflict ? 'conflict' : 'ok',
                code: state.commercialConflict ? 'COMMERCIAL_CONFLICT' : null },
            pedido: state.ticket ? { NroTicket: state.ticket, Estado: state.orderState, Mozo: state.mozo ?? 1, CodigoPedido: state.codigoPedido || null } : null,
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
        if (url.pathname === '/api/pos/mozos') {
            if (options.employeeCatalog) return fulfill(eligibleEmployees(url.searchParams.get('empresa'), url.searchParams.get('mesa')));
            if (options.employeeScope && Number(url.searchParams.get('empresa')) === 2 && Number(url.searchParams.get('mesa')) >= 220 && Number(url.searchParams.get('mesa')) <= 230) {
                return fulfill([{ Codemp: 195, Nombre: 'PEDIDOS YA' }, { Codemp: 203, Nombre: 'RAPPI' }]);
            }
            if (options.employeeDelay) await new Promise(resolve => setTimeout(resolve, options.employeeDelay));
            return fulfill(options.employees || [{ Codemp: 1, Nombre: 'José' }]);
        }
        if (url.pathname === '/api/pos/categories') return fulfill(['Platos']);
        if (url.pathname === '/api/pos/products') return fulfill(options.products || [product]);
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
            if (options.employeeCatalog && !eligibleEmployees(body.empresa, body.mesa).some(item => Number(item.Codemp) === Number(body.mozo)))
                return fulfill({ success: false, message: 'Seleccione un empleado existente' }, 400);
            if (options.employeeScope) {
                const marketplace = Number(body.empresa) === 2 && Number(body.mesa) >= 220 && Number(body.mesa) <= 230;
                const allowed = marketplace ? [195, 203].includes(Number(body.mozo)) : Number(body.mozo) === 1;
                if (!allowed) return fulfill({ success:false, message:marketplace ? 'Seleccione PEDIDOS YA o RAPPI para esta mesa' : 'Seleccione un mozo activo de esta empresa' }, 400);
            }
            if (state.invalidCompanyError) return fulfill({ success:false,message:'Empresa inválida',errorCode:'INVALID_COMPANY',diagnosticId:'diag-company',retryable:false },400);
            if (state.delaySave) await new Promise(r => setTimeout(r, state.delaySave));
            if (state.conflict) return fulfill({ message: 'Pedido cambiado por otro dispositivo' }, 409);
            if (state.ticket && body.items.length === 0) {
                state.deletes++; state.version++; state.ticket = null; state.items = []; state.sent.clear();
                return fulfill({ success:true,pedidoEliminado:true });
            }
            state.mozo = Number(body.mozo); state.codigoPedido = body.codigoPedido; state.saves++; state.version++; state.ticket = 'T001-000001'; state.items = body.items; return fulfill(data());
        }
        if (url.pathname.endsWith('/pagar')) { state.orderState = 2; state.version++; return fulfill(data()); }
        if (url.pathname.endsWith('/reabrir')) { state.orderState = 1; state.version++; return fulfill(data()); }
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

test('mesas 220 y 230 de Empresa 2 exigen elegir PEDIDOS YA o RAPPI', async ({ page }) => {
    for (const [mesa, employee] of [[220, 195], [230, 203]]) {
        const state = await fixture(page, { openTable: false, employeeScope: true,
            tables: [{ Numero: mesa, Empresa: 2, Ambiente: 1, Estado: 1 }] });
        await page.locator(`[data-table-number="${mesa}"]`).click();
        await expect(page.locator('#pos-mojo-name')).toHaveText('Seleccione plataforma');
        expect(await page.locator('#pos-mojo-select').inputValue()).toBe('');
        await page.locator('.pos-product-card').first().click();
        await expect(page.locator('#order-save-message')).toContainText('Seleccione PEDIDOS YA o RAPPI');
        expect(state.saves).toBe(0);
        await page.locator('.pos-mojo-badge').click();
        await expect(page.locator('#mozo-list .mozo-option')).toHaveText(['PEDIDOS YA', 'RAPPI']);
        await page.locator(`#mozo-list .mozo-option:has-text("${employee === 195 ? 'PEDIDOS YA' : 'RAPPI'}")`).click();
        await expect.poll(() => state.saves).toBe(1);
        expect(await page.locator('#pos-mojo-select').inputValue()).toBe(String(employee));
    }
});

test('plataformas no heredan mozos y mesas vecinas conservan mozos Tipo 3', async ({ page }) => {
    await fixture(page, { openTable: false, employeeScope: true,
        tables: empresa => [219, 220, 236].map(Numero => ({ Numero, Empresa: Number(empresa), Ambiente: 1, Estado: 1 })) });
    await page.locator('[data-table-number="219"]').click();
    await expect(page.locator('#pos-mojo-name')).toHaveText('José');
    await page.evaluate(() => openPOSOrder(220, 2));
    await expect(page.locator('#pos-mojo-name')).toHaveText('Seleccione plataforma');
    expect(await page.locator('#pos-mojo-select').inputValue()).toBe('');
    await page.evaluate(() => openPOSOrder(236, 2));
    await expect(page.locator('#pos-mojo-name')).toHaveText('José');
    await page.evaluate(() => showView('pos-tables'));
    await page.selectOption('#pos-empresa-select', '04');
    await page.locator('[data-table-number="220"]').click();
    await expect(page.locator('#pos-mojo-name')).toHaveText('José');
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
    await page.locator('#order-remove-confirm').click();
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
    await page.locator('#order-remove-confirm').click();
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
    expect(sheet.width).toBeLessThanOrEqual(680);
    expect(sheet.x).toBeGreaterThan(0);
    await page.locator('#pos-cart-close').click();

    await page.setViewportSize({ width: 1024, height: 1366 });
    await page.locator('#pos-cart-fab').click();
    sheet = await page.locator('#pos-order-sidebar').boundingBox();
    expect(sheet.width).toBeCloseTo(680, 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.setViewportSize({ width: 1194, height: 834 });
    await expect(page.locator('#pos-order-sidebar')).toHaveClass(/open/);
    await page.locator('#pos-cart-close').click();
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
    expect(sheet.width).toBeCloseTo(680, 1);
    expect(sheet.x).toBeGreaterThan(500);

    await page.setViewportSize({ width: 834, height: 1194 });
    await expect(page.locator('#pos-order-sidebar')).toHaveClass(/open/);
    await page.locator('#pos-cart-close').click();
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

test('tablet conserva foco y texto al cambiar solo la altura del teclado', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 1340 });
    const state = await fixture(page);
    const search = page.locator('#pos-product-search');
    await search.fill('Arroz');
    for (const height of [700, 620, 1340]) {
        await page.setViewportSize({ width: 800, height });
        await expect(search).toBeFocused();
        await expect(search).toHaveValue('Arroz');
    }
    await search.press('End');
    await search.pressSequentially(' con');
    await expect(search).toHaveValue('Arroz con');
    expect(state.saves).toBe(0);
    await page.setViewportSize({ width: 1340, height: 800 });
    await expect(search).not.toBeFocused();
});

test('@android tablet táctil de 1340px usa detalle amplio y menú bajo demanda', async ({ page }) => {
    await page.setViewportSize({ width: 1340, height: 800 });
    const state = await fixture(page);
    expect(await page.locator('#sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(1);
    const search = page.locator('#pos-product-search');
    await search.fill('Arroz');
    await page.setViewportSize({ width: 1340, height: 470 });
    await expect(search).toBeFocused();
    await expect(search).toHaveValue('Arroz');
    await page.setViewportSize({ width: 1340, height: 800 });
    await page.locator('.pos-product-card').first().tap();
    await expect.poll(() => state.saves).toBe(1);
    await page.locator('#pos-cart-fab').tap();
    const detail = page.locator('#pos-order-sidebar');
    await expect(detail).toHaveClass(/open/);
    const box = await detail.boundingBox();
    await expect(page.locator('#pos-cart-close')).toBeFocused();
    await page.screenshot({ path: '/tmp/sedim-tablet-detail.png' });
    expect(box.width).toBeGreaterThanOrEqual(640);
    expect(await page.locator('.pos-cart-scroll-region').evaluate(element => element.clientHeight)).toBeGreaterThan(400);
    await expect(page.locator('#pos-totals-details')).not.toHaveAttribute('open', '');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('confirmación: cancelar, Escape y cerrar conservan cantidad y foco', async ({ page }) => {
    const state = await fixture(page);
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.items.length).toBe(1);
    const saves = state.saves;
    for (const action of ['cancel', 'escape', 'close']) {
        await page.locator('[data-action="dec"]').click();
        await expect(page.locator('#order-remove-cancel')).toBeFocused();
        await expect(page.locator('#order-remove-product')).toContainText(product.Nombre);
        if (action === 'cancel') await page.locator('#order-remove-cancel').click();
        else if (action === 'escape') await page.keyboard.press('Escape');
        else await page.locator('#order-remove-dialog [aria-label="Cerrar confirmación"]').click();
        await expect(page.locator('#order-remove-dialog')).not.toBeVisible();
        await expect(page.locator('[data-action="dec"]')).toBeFocused();
        expect(state.items[0].cantidad).toBe(1);
        expect(state.saves).toBe(saves);
        expect(state.deletes).toBe(0);
    }
});

test('confirmación agrupada, reducción inmediata y fallo del último producto', async ({ page }) => {
    const state = await fixture(page);
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.items.length).toBe(1);
    await page.locator('[data-action="inc"]').click();
    await expect.poll(() => state.items[0].cantidad).toBe(2);
    await page.locator('[data-action="del"]').click();
    await expect(page.locator('#order-remove-description')).toContainText('2 unidades');
    await page.locator('#order-remove-cancel').click();
    await page.locator('[data-action="dec"]').click();
    await expect(page.locator('#order-remove-dialog')).not.toBeVisible();
    await expect.poll(() => state.items[0].cantidad).toBe(1);
    state.deleteError = true;
    await page.locator('[data-action="dec"]').click();
    await page.locator('#order-remove-confirm').click();
    await expect(page.locator('#order-retry-save')).toBeVisible();
    await expect(page.locator('.cart-item')).toHaveCount(1);
    expect(state.items[0].cantidad).toBe(1);
    state.deleteError = false;
    await page.locator('#order-retry-save').click();
    await expect(page.locator('#view-pos-tables')).toBeVisible();
});

test('confirmación invalida selección modificada y elimina solo líneas elegidas', async ({ page }) => {
    const state = await fixture(page);
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.items.length).toBe(1);
    await page.locator('[data-action="del"]').click();
    await page.evaluate(() => { posCart[0].cantidad = 0.5; });
    await page.locator('#order-remove-confirm').click();
    expect(state.deletes).toBe(0);
    await expect(page.locator('#order-save-message')).toContainText('Vuelva a seleccionar');
    await page.evaluate(() => {
        posCart.push({ ...posCart[0], lineaId: newOrderId(), nota: 'Otra nota', cantidad: 2 });
        updateCartUI(); scheduleAutoSave();
    });
    await expect.poll(() => state.items.length).toBe(2);
    await page.locator('[data-action="dec"]').first().click();
    await expect(page.locator('#order-remove-description')).toContainText('0.5 unidades');
    await page.locator('#order-remove-confirm').click();
    await expect.poll(() => state.items.length).toBe(1);
    expect(state.items[0].nota).toBe('Otra nota');
});

for (const viewport of [{ width: 390, height: 844 }, { width: 1340, height: 800 }, { width: 1280, height: 720 }]) {
    test(`confirmación adaptable ${viewport.width}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await fixture(page);
        await page.locator('.pos-product-card').first().click();
        await page.evaluate(() => {
            posCart[0].nombre = '<Producto> ' + 'Nombre largo '.repeat(30);
            updateCartUI();
            requestProductRemoval([posCart[0].lineaId]);
        });
        const dialog = page.locator('#order-remove-dialog');
        await expect(dialog).toBeVisible();
        expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        const box = await dialog.boundingBox();
        expect(box.width).toBeLessThanOrEqual(440);
        expect(box.x).toBeGreaterThanOrEqual(0);
        await expect(page.locator('#order-remove-product')).toContainText('<Producto>');
        const button = await page.locator('#order-remove-confirm').boundingBox();
        expect(button.height).toBeGreaterThanOrEqual(44);
    });
}

test('X elimina grupo enviado y nuevo, conserva otra nota y no duplica guardado', async ({ page }) => {
    const state = await fixture(page);
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.items.length).toBe(1);
    await page.locator('#btn-enviar-cocina').click();
    await expect(page.locator('#order-kitchen-status')).toHaveText('Enviado a cocina');
    await page.locator('[data-action="inc"]').click();
    await page.evaluate(() => {
        posCart.push({ ...posCart[1], lineaId: newOrderId(), nota: 'Sin sal', cantidad: 1 });
        updateCartUI(); scheduleAutoSave();
    });
    await expect.poll(() => state.items.length).toBe(3);
    await page.locator('[data-action="del"]').first().click();
    await expect(page.locator('#order-remove-sent')).toBeVisible();
    const saves = state.saves;
    await page.evaluate(() => { confirmProductRemoval(); confirmProductRemoval(); });
    await expect.poll(() => state.items.length).toBe(1);
    expect(state.items[0].nota).toBe('Sin sal');
    expect(state.saves).toBe(saves + 1);
    expect(state.deletes).toBe(0);
});

test('confirmación rechaza cambio de mesa y solo lectura', async ({ page }) => {
    const state = await fixture(page);
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.items.length).toBe(1);
    for (const change of ['table', 'readonly']) {
        await page.locator('[data-action="del"]').click();
        await page.evaluate(change => {
            if (change === 'table') posCurrentTable = 999;
            else posIsReadOnly = true;
        }, change);
        await page.locator('#order-remove-confirm').click();
        expect(state.deletes).toBe(0);
        await expect(page.locator('.cart-item')).toHaveCount(1);
        await page.evaluate(() => { posCurrentTable = 1; posIsReadOnly = false; });
    }
    await page.locator('[data-action="del"]').click();
    await page.evaluate(() => orderReset());
    await expect(page.locator('#order-remove-dialog')).not.toBeVisible();
});

for (const width of [390, 768, 1280]) {
    test(`código de pedido persiste y exige envío a ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const state = await fixture(page, { openTable: false, tables: [{ Numero: 201, Empresa: 2, Estado: 1 }] });
        await page.evaluate(() => openPOSOrder(201, 2));
        const input = page.locator('#order-code');
        await expect(input).toBeVisible();
        await input.fill('ab-001_X');
        await page.waitForTimeout(850);
        expect(state.ticket).toBeNull();
        await page.locator('.pos-product-card').first().click();
        await expect.poll(() => state.codigoPedido).toBe('ab-001_X');
        await input.fill('');
        await page.evaluate(() => sendOrderKitchen());
        await expect(page.locator('#order-code-error')).toContainText('Ingrese');
        expect(state.sends).toBe(0);
        await input.fill('ab-002_X');
        await page.evaluate(() => sendOrderKitchen());
        await expect.poll(() => state.sends).toBe(1);
        await page.evaluate(() => openPOSOrder(201, 2));
        await expect(input).toHaveValue('ab-002_X');
        await input.fill('nuevo-003');
        await expect.poll(() => state.codigoPedido).toBe('nuevo-003');
        expect(state.sends).toBe(1);
        expect(await input.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.evaluate(() => openPOSOrder(231, 2));
        await expect(input).toBeHidden();
    });
}

test('código conserva edición durante guardado, valida formato y respeta Preventa', async ({ page }) => {
    const state = await fixture(page, { openTable:false, tables:[{Numero:210,Empresa:2,Estado:1}] });
    await page.evaluate(() => openPOSOrder(210,2));
    const input = page.locator('#order-code');
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.saves).toBe(1);
    state.delaySave = 500;
    await input.fill('primero-001');
    const request = page.waitForRequest(req => req.url().includes('/api/pos/pedido') && req.method() === 'POST');
    const saving = page.evaluate(() => orderFlush());
    await request;
    await input.fill('segundo_002');
    await saving;
    await expect(input).toHaveValue('segundo_002');
    await expect.poll(() => state.codigoPedido).toBe('segundo_002');
    await input.fill('mal codigo');
    await expect(page.locator('#order-code-error')).toContainText('Use hasta');
    const saves = state.saves;
    await page.waitForTimeout(850);
    expect(state.saves).toBe(saves);
    await input.fill('correcto-003');
    await page.evaluate(() => orderFlush());
    state.orderState = 2;
    await page.evaluate(() => openPOSOrder(210,2));
    await expect(input).toHaveAttribute('readonly','');
    await expect(input).toHaveValue('correcto-003');
    state.orderState = 1;
    await page.evaluate(() => openPOSOrder(210,2));
    await expect(input).not.toHaveAttribute('readonly','');
    await page.setViewportSize({width:768,height:500});
    await input.focus();
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('correcto-003');
    await page.setViewportSize({width:768,height:900});
    await expect(input).toHaveValue('correcto-003');
});

test('conflicto de código mantiene el borrador y pausa autoguardado', async ({ page }) => {
    const state = await fixture(page, { openTable:false, tables:[{Numero:219,Empresa:2,Estado:1}] });
    await page.evaluate(() => openPOSOrder(219,2));
    await page.locator('.pos-product-card').first().click();
    await expect.poll(() => state.saves).toBe(1);
    state.conflict = true;
    await page.locator('#order-code').fill('borrador-001');
    await expect(page.locator('#order-save-message')).toContainText('Pedido cambiado');
    await expect(page.locator('#order-code')).toHaveValue('borrador-001');
    await expect(page.locator('#order-code')).toHaveAttribute('readonly','');
    expect(state.codigoPedido).toBeNull();
});

test('precio unitario visible permanece estable al aumentar cantidad y recargar', async ({ page }) => {
    const state = await fixture(page);
    await page.locator('.pos-product-card').first().click();
    await expect(page.locator('#pos-total')).toHaveText('S/ 22.10');
    await expect.poll(() => state.saves).toBe(1);
    for (const cantidad of [2,3]) {
        await page.locator('.cart-item [data-action="inc"]').click();
        await expect(page.locator('#pos-total')).toHaveText(`S/ ${(22.1 * cantidad).toFixed(2)}`);
        await expect(page.locator('.cart-item')).toContainText(`S/ 22.10 x ${cantidad}`);
        await page.evaluate(() => orderFlush());
        expect(state.items[0].precio).toBe(20);
    }
    await page.evaluate(() => openPOSOrder(1,2));
    await expect(page.locator('#pos-total')).toHaveText('S/ 66.30');
    await expect(page.locator('.cart-item')).toContainText('S/ 22.10 x 3');
});

for (const size of [100, 500, 1000]) {
    test(`Fase 56 rendimiento catálogo ${size}`, async ({ page }) => {
        await page.setViewportSize({ width: 768, height: 1024 });
        const products = Array.from({ length: size }, (_, i) => ({ ...product, CodPro: `02${String(i).padStart(5, '0')}`, Nombre: `Arroz ${i}` }));
        const state = await fixture(page, { products });
        const metrics = await page.evaluate(async () => {
            const timed = fn => { const start = performance.now(); fn(); return performance.now() - start; };
            const filtering = timed(() => posProducts.filter(p => p.Nombre.toLowerCase().includes('arroz')));
            const rendering = timed(() => renderPOSProducts(posProducts));
            const cart = [], feedback = [], interaction = [];
            const originalCart = updateCartUI, originalFeedback = showPOSAddFeedback;
            updateCartUI = (...args) => { const start = performance.now(); originalCart(...args); cart.push(performance.now() - start); };
            showPOSAddFeedback = (...args) => { const start = performance.now(); originalFeedback(...args); feedback.push(performance.now() - start); };
            for (let i = 0; i < 20; i++) {
                const start = performance.now();
                document.querySelectorAll('.pos-product-card')[i].click();
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                interaction.push(performance.now() - start);
            }
            updateCartUI = originalCart; showPOSAddFeedback = originalFeedback;
            return { filtering, rendering, cart, feedback, interaction, quantity: posCart.reduce((sum, line) => sum + line.cantidad, 0) };
        });
        const median = samples => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
        console.log('POS_BENCHMARK', JSON.stringify({ size, filtering: metrics.filtering, rendering: metrics.rendering,
            cartMedian: median(metrics.cart), feedbackMedian: median(metrics.feedback),
            interactionP95: [...metrics.interaction].sort((a, b) => a - b)[18], under100: metrics.interaction.filter(ms => ms < 100).length }));
        expect(metrics.quantity).toBe(20);
        expect(metrics.interaction.filter(ms => ms < 100).length).toBeGreaterThanOrEqual(19);
        await expect.poll(() => state.items.reduce((sum, line) => sum + line.cantidad, 0)).toBe(20);
        await expect(page.locator('#pos-total')).toHaveText('S/ 442.00');
    });
}

test('Fase 56 mesero guardado se resuelve una sola vez tras carga lenta', async ({ page }) => {
    const state = await fixture(page, { openTable: false, employees: [{ Codemp: 1, Nombre: 'José' }, { Codemp: 2, Nombre: 'Ana' }] });
    state.ticket = 'T001-1'; state.mozo = 2; state.orderLoadDelay = 400;
    await page.evaluate(() => {
        window.waiterLabels = [];
        new MutationObserver(() => window.waiterLabels.push(document.getElementById('pos-mojo-name').textContent))
            .observe(document.getElementById('pos-mojo-name'), { childList: true, subtree: true, characterData: true });
    });
    await page.locator('.pos-table-card').first().click();
    await expect(page.locator('#pos-mojo-name')).toHaveText('Cargando mesero…');
    await expect(page.locator('.pos-mojo-badge')).toHaveAttribute('aria-disabled', 'true');
    // Dispatch during loading; normal Playwright clicks wait until aria-disabled becomes false.
    await page.locator('.pos-mojo-badge').dispatchEvent('click');
    await expect(page.locator('#modal-mozo')).not.toBeVisible();
    await expect(page.locator('#pos-mojo-name')).toHaveText('Ana');
    expect(await page.locator('#pos-mojo-select').inputValue()).toBe('2');
    expect(await page.evaluate(() => window.waiterLabels)).not.toContain('José');
    await page.locator('.pos-product-card').click();
    await expect.poll(() => state.saves).toBe(1);
    expect(state.mozo).toBe(2);
});

test('Fase 56 mesero no disponible conserva asignación hasta selección válida', async ({ page }) => {
    const state = await fixture(page, { openTable: false });
    state.ticket = 'T001-1'; state.mozo = 99;
    await page.locator('.pos-table-card').click();
    await expect(page.locator('#pos-mojo-name')).toContainText('no disponible');
    await page.locator('.pos-product-card').click();
    await expect(page.locator('#order-save-message')).toContainText('Seleccione un mesero válido');
    await page.waitForTimeout(850);
    expect(state.saves).toBe(0); expect(state.mozo).toBe(99);
    await page.locator('.pos-mojo-badge').click();
    await page.locator('.mozo-option').click();
    await expect.poll(() => state.saves).toBe(1);
    expect(state.mozo).toBe(1);
    await expect(page.locator('.cart-item')).toHaveCount(1);
});

test('Fase 56 respuesta tardía de empleados no cruza mesas', async ({ page }) => {
    await fixture(page, { openTable: false });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/pos/mozos?**', async route => {
        const mesa = new URL(route.request().url()).searchParams.get('mesa');
        if (mesa === '1') await gate;
        await route.fulfill({ json: [{ Codemp: Number(mesa), Nombre: `Mesero ${mesa}` }] });
    });
    await page.evaluate(() => { window.firstOpen = openPOSOrder(1, 2); });
    await expect(page.locator('#pos-mojo-name')).toHaveText('Cargando mesero…');
    await page.evaluate(() => openPOSOrder(2, 2));
    release();
    await page.evaluate(() => window.firstOpen);
    await expect(page.locator('#pos-mojo-name')).toHaveText('Mesero 2');
    expect(await page.locator('#pos-mojo-select').inputValue()).toBe('2');
});

for (const width of [390, 800]) {
    for (const clear of ['manual', 'X']) {
        test(`Fase 56 detalle conserva apertura tras búsqueda ${clear} a ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 1000 });
            await fixture(page);
            const trace = [];
            page.on('console', message => { if (message.text().startsWith('POS_TRACE')) trace.push(message.text()); });
            await page.evaluate(() => {
                for (const type of ['resize', 'focusin', 'focusout']) window.addEventListener(type, () => console.log('POS_TRACE', type, innerWidth, innerHeight, document.activeElement?.id));
                new MutationObserver(() => console.log('POS_TRACE detail', document.getElementById('pos-order-sidebar').className))
                    .observe(document.getElementById('pos-order-sidebar'), { attributes: true, attributeFilter: ['class'] });
            });
            const search = page.locator('#pos-product-search');
            await search.fill('Arroz');
            if (clear === 'X') await page.locator('#pos-search-clear').click();
            else await search.fill('');
            await page.evaluate(() => toggleCartSheet(true));
            await expect(page.locator('#pos-order-sidebar')).toHaveClass(/open/);
            for (const size of [{ width, height: 600 }, { width: width + 1, height: 1000 }, { width: 1000, height: width }]) {
                await page.setViewportSize(size);
                await expect(page.locator('#pos-order-sidebar')).toHaveClass(/open/);
                await expect(page.locator('#pos-cart-fab')).toHaveAttribute('aria-expanded', 'true');
            }
            await page.waitForTimeout(400);
            await expect(page.locator('#pos-order-sidebar')).toHaveClass(/open/);
            console.log('POS_TRACE_RESULT', JSON.stringify(trace));
            await page.locator('#pos-cart-close').click();
            await expect(page.locator('#pos-order-sidebar')).not.toHaveClass(/open/);
        });
    }
}

test('Fase 56 SSE conserva detalle, búsqueda, categoría, foco y desplazamiento', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 1000 });
    const products = Array.from({ length: 30 }, (_, i) => ({ ...product, CodPro: `0200${i}`, Nombre: `Arroz ${i}` }));
    const state = await fixture(page, { products, stubEventSource: true });
    for (let i = 0; i < 20; i++) await page.evaluate(i => addToCart(posProducts[i]), i);
    await expect.poll(() => state.items.length).toBe(20);
    await page.locator('.cat-btn').filter({ hasText: /^Platos$/ }).click();
    await page.locator('#pos-product-search').fill('Arroz 1');
    await page.evaluate(() => toggleCartSheet(true));
    await page.waitForTimeout(350);
    await page.locator('#pos-cart-close').focus();
    let scroll = await page.evaluate(() => {
        const container = document.getElementById('pos-cart-items'); container.scrollTop = 150;
        document.getElementById('pos-products-grid').scrollTop = 100;
        return container.scrollTop;
    });
    state.orderLoadDelay = 400;
    const loads = state.orderLoads;
    await page.evaluate(() => handleSSEEvent({ type: 'mesa_updated', empresa: 2, numero: 1, version: orderVersion + 1, operacionId: 'external' }));
    await expect.poll(() => state.orderLoads).toBe(loads + 1);
    scroll = await page.locator('#pos-cart-items').evaluate(el => { el.scrollTop = 220; return el.scrollTop; });
    await expect(page.locator('#pos-mojo-name')).toHaveText('José');
    await expect(page.locator('#pos-order-sidebar')).toHaveClass(/open/);
    await expect(page.locator('#pos-product-search')).toHaveValue('Arroz 1');
    await expect(page.locator('.cat-btn.active')).toHaveText('Platos');
    await expect(page.locator('#pos-cart-close')).toBeFocused();
    expect(await page.locator('#pos-cart-items').evaluate(el => el.scrollTop)).toBe(scroll);
    expect(await page.evaluate(() => posCurrentCategory)).toBe('Platos');
});

test('Fase 56 catálogo reutiliza tarjetas y conserva activación por teclado', async ({ page }) => {
    await fixture(page, { products: [product, { ...product, CodPro: '02002', Nombre: 'Bebida', Linea: 'Bebidas' }] });
    await page.evaluate(() => { window.originalCard = document.querySelector('.pos-product-card'); });
    await page.locator('#pos-product-search').fill('Bebida');
    await page.locator('#pos-product-search').fill('');
    expect(await page.evaluate(() => window.originalCard === document.querySelector('.pos-product-card'))).toBe(true);
    await page.locator('.pos-product-card').first().focus();
    await page.keyboard.press('Enter'); await page.keyboard.press('Space');
    await expect(page.locator('.cart-item-details')).toHaveText('S/ 22.10 x 2');
    await page.evaluate(() => {
        const card = document.querySelector('.pos-product-card');
        card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        card.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
        card.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    });
    await expect(page.locator('.cart-item-details')).toHaveText('S/ 22.10 x 2');
});

test('Fase 56 reintentar empleados conserva borrador y mesero guardado', async ({ page }) => {
    const state = await fixture(page, { openTable: false });
    state.ticket = 'T001-1'; state.mozo = 2;
    let available = false;
    await page.route('**/api/pos/mozos?**', route => available
        ? route.fulfill({ json: [{ Codemp: 1, Nombre: 'José' }, { Codemp: 2, Nombre: 'Ana' }] })
        : route.fulfill({ status: 503, json: { message: 'No disponible' } }));
    await page.locator('.pos-table-card').click();
    await expect(page.locator('#pos-mojo-name')).toContainText('Empleados no disponibles');
    await page.locator('.pos-product-card').click();
    await expect(page.locator('#order-retry-load')).toBeVisible();
    available = true;
    await page.locator('#order-retry-load').click();
    await expect(page.locator('#pos-mojo-name')).toHaveText('Ana');
    await expect.poll(() => state.saves).toBe(1);
    expect(state.mozo).toBe(2); expect(state.items[0].cantidad).toBe(1);
});

test('@android Fase 56 detalle estable y selección táctil tras limpiar búsqueda', async ({ page }) => {
    const state = await fixture(page, { products: [product, { ...product, CodPro: '02002', Nombre: 'Bebida' }] });
    await page.locator('#pos-product-search').fill('Arroz');
    await page.locator('#pos-search-clear').tap();
    await page.locator('.pos-product-card').first().tap();
    await page.locator('.pos-product-card').first().tap();
    await page.locator('#pos-search-done').tap();
    await page.locator('#pos-cart-fab').tap();
    await page.setViewportSize({ width: 394, height: 520 });
    await page.waitForTimeout(400);
    await expect(page.locator('#pos-order-sidebar')).toHaveClass(/open/);
    await expect(page.locator('.cart-item-details')).toHaveText('S/ 22.10 x 2');
    await expect.poll(() => state.items[0]?.cantidad).toBe(2);
    await page.locator('#pos-cart-close').tap();
    await expect(page.locator('#pos-order-sidebar')).not.toHaveClass(/open/);
});

test('Fase 56 SSE durante carga de catálogo conserva la respuesta vigente', async ({ page }) => {
    await fixture(page, { openTable: false, stubEventSource: true });
    let calls = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/pos/products?**', async route => {
        const first = ++calls === 1;
        if (first) await gate;
        await route.fulfill({ json: [{ ...product, Nombre: first ? 'Arroz obsoleto' : 'Arroz vigente' }] });
    });
    await page.evaluate(() => { window.initialOpen = openPOSOrder(1, 2); });
    await expect.poll(() => calls).toBe(1);
    await page.evaluate(() => handleSSEEvent({ type: 'mesa_updated', empresa: 2, numero: 1, operacionId: 'external' }));
    await expect(page.locator('.pos-product-card')).toHaveCount(1);
    await expect(page.locator('.pos-product-name')).toHaveText('Arroz vigente');
    release();
    await page.evaluate(() => window.initialOpen);
    await expect(page.locator('.pos-product-name')).toHaveText('Arroz vigente');
    expect(calls).toBe(2);
});

const phase57Employees = [
    { Codemp: 11, Nombre: 'José Pérez', Empresa: 2, Tipo: 1 },
    { Codemp: 111, Nombre: 'José Pérez', Empresa: 2, Tipo: 2 },
    { Codemp: 32, Nombre: 'María Ramos', Empresa: 2, Tipo: 4 },
    { Codemp: 44, Nombre: '<Empleado & especial>', Empresa: 2, Tipo: 1 },
    { Codemp: 55, Nombre: 'Empleado cesado', Empresa: 2, Tipo: 1, FecCese: '2026-01-01' },
    { Codemp: 66, Nombre: 'Empleado otra empresa', Empresa: 4, Tipo: 1 },
    { Codemp: 68, Nombre: 'Empleado sin empresa', Empresa: null, Tipo: 2 },
    { Codemp: 67, Nombre: 'Empleado Abruzzo', Empresa: 6, Tipo: 2 },
    { Codemp: 1, Nombre: 'Mozo normal', Empresa: 2, Tipo: 3 },
    { Codemp: 2, Nombre: 'Mozo normal 4', Empresa: 4, Tipo: 3 },
    { Codemp: 3, Nombre: 'Mozo normal 6', Empresa: 6, Tipo: 3 },
    { Codemp: 195, Nombre: 'PEDIDOS YA', Empresa: 2, Tipo: 3 },
    { Codemp: 203, Nombre: 'RAPPI', Empresa: 2, Tipo: 3 }
];
async function phase57Fixture(page, options = {}) {
    return fixture(page, { openTable: false, employeeCatalog: phase57Employees,
        tables: empresa => [230, 231, 235, 236].map(Numero => ({ Numero, Empresa: Number(empresa), Ambiente: 1, Estado: 1 })), ...options });
}

test('Fase 57 selección obligatoria busca códigos y nombres, distingue repetidos y conserva borrador', async ({ page }) => {
    const state = await phase57Fixture(page);
    await page.locator('[data-table-number="231"]').click();
    await expect(page.locator('#pos-mojo-name')).toHaveText('Seleccione empleado');
    expect(await page.locator('#pos-mojo-select').inputValue()).toBe('');
    await expect(page.locator('.pos-product-card')).toHaveCount(1);
    await page.locator('.pos-product-card').click();
    await expect(page.locator('#order-save-message')).toContainText('Seleccione un empleado');
    await page.waitForTimeout(850);
    expect(state.saves).toBe(0); expect(state.ticket).toBeNull();
    await page.locator('.pos-mojo-badge').click();
    const search = page.locator('#employee-search-input');
    await expect(search).toBeFocused();
    await expect(page.locator('#employee-search-results')).toContainText('cesado');
    await expect(page.locator('#employee-search-results')).toContainText('otra empresa');
    await search.fill('jOsE');
    await expect(page.locator('.employee-search-result')).toHaveCount(2);
    await search.fill('11');
    await expect(page.locator('.employee-search-result')).toHaveCount(2);
    await expect(page.locator('.employee-search-result').first()).toContainText('11');
    expect(await page.locator('.employee-search-result').first().getAttribute('data-employee-code')).toBe('11');
    await search.fill('no existe');
    await expect(page.locator('#employee-search-status')).toHaveText('No se encontraron empleados.');
    await page.locator('#employee-search-clear').click();
    await expect(search).toHaveValue(''); await expect(search).toBeFocused();
    await search.fill('MARIA');
    await search.press('Enter');
    await expect(page.locator('#employee-search-dialog')).not.toBeVisible();
    await expect(page.locator('.pos-mojo-badge')).toBeFocused();
    await expect(page.locator('#pos-mojo-name')).toHaveText('María Ramos');
    await expect.poll(() => state.saves).toBe(1);
    expect(state.mozo).toBe(32); expect(state.items[0].cantidad).toBe(1);
    await page.evaluate(() => openPOSOrder(231, 2));
    await expect(page.locator('#pos-mojo-name')).toHaveText('María Ramos');
    expect(await page.locator('#pos-mojo-select').inputValue()).toBe('32');
});

test('Fase 57 seleccionar sin productos no crea ticket, cancelar y Escape conservan empleado', async ({ page }) => {
    const state = await phase57Fixture(page);
    await page.locator('[data-table-number="231"]').click();
    await expect(page.locator('#pos-mojo-name')).toHaveText('Seleccione empleado');
    await page.locator('.pos-mojo-badge').focus(); await page.keyboard.press('Enter');
    await page.locator('#employee-search-input').fill('11');
    await page.locator('[data-employee-code="11"]').click();
    await expect(page.locator('#pos-mojo-name')).toHaveText('José Pérez');
    await expect(page.locator('#order-save-message')).not.toContainText('Seleccione un empleado');
    await page.waitForTimeout(800); expect(state.saves).toBe(0); expect(state.ticket).toBeNull();
    for (const action of ['cancel', 'Escape', 'close']) {
        await page.locator('.pos-mojo-badge').click();
        await page.locator('#employee-search-input').fill('María');
        if (action === 'cancel') await page.locator('#employee-search-dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
        else if (action === 'Escape') await page.keyboard.press('Escape');
        else await page.getByRole('button', { name: 'Cerrar buscador de empleados' }).click();
        await expect(page.locator('#employee-search-dialog')).not.toBeVisible();
        await expect(page.locator('.pos-mojo-badge')).toBeFocused();
        expect(await page.locator('#pos-mojo-select').inputValue()).toBe('11');
    }
});

test('Fase 57 límites 231–235 aplican en las tres empresas y preservan reglas vecinas', async ({ page }) => {
    await phase57Fixture(page);
    for (const [empresa, code] of [['02', 11], ['04', 66], ['06', 67]]) {
        await page.selectOption('#pos-empresa-select', empresa);
        for (const mesa of [231, 235]) {
            await page.evaluate(({ mesa, empresa }) => openPOSOrder(mesa, empresa), { mesa, empresa });
            await expect(page.locator('#pos-mojo-name')).toHaveText('Seleccione empleado');
            await page.locator('.pos-mojo-badge').click();
            await expect(page.locator(`[data-employee-code="${code}"]`)).toBeVisible();
            await page.keyboard.press('Escape');
        }
        await page.evaluate(empresa => openPOSOrder(236, empresa), empresa);
        await expect(page.locator('#pos-mojo-name')).toContainText('Mozo normal');
        await page.locator('.pos-mojo-badge').click();
        await expect(page.locator('#modal-mozo')).toBeVisible();
        await page.evaluate(() => closeModal('modal-mozo'));
        await page.evaluate(() => showView('pos-tables'));
    }
    await page.selectOption('#pos-empresa-select', '02');
    await page.evaluate(() => openPOSOrder(230, 2));
    await expect(page.locator('#pos-mojo-name')).toHaveText('Seleccione plataforma');
    await page.locator('.pos-mojo-badge').click();
    await expect(page.locator('.mozo-option')).toHaveCount(2);
    await expect(page.locator('#employee-search-dialog')).not.toBeVisible();
});

for (const width of [390, 800, 1280]) {
    test(`Fase 57 buscador adaptable y teclado a ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await phase57Fixture(page, { employeeCatalog: [...phase57Employees, ...Array.from({ length: 60 }, (_, i) => ({ Codemp: 1000 + i, Nombre: `Empleado ${i}`, Empresa: 2, Tipo: 1 }))] });
        await page.locator('[data-table-number="231"]').click();
        await expect(page.locator('#pos-mojo-name')).toHaveText('Seleccione empleado');
        await page.locator('.pos-mojo-badge').click();
        const dialog = page.locator('#employee-search-dialog');
        const box = await dialog.boundingBox();
        expect(box.width).toBeLessThanOrEqual(Math.min(560, width * .96) + 1);
        const search = page.locator('#employee-search-input');
        await search.fill('Empleado');
        await page.setViewportSize({ width, height: 420 });
        await expect(search).toBeFocused(); await expect(search).toHaveValue('Empleado');
        await expect(dialog).toBeVisible();
        const inputBox = await search.boundingBox();
        expect(inputBox.y).toBeGreaterThanOrEqual(0); expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(420);
        expect(inputBox.height).toBeGreaterThanOrEqual(44);
        expect(await page.locator('#employee-search-results').evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
        for (let i = 0; i < 8; i++) {
            await page.keyboard.press('Tab');
            expect(await page.evaluate(() => document.getElementById('employee-search-dialog').contains(document.activeElement))).toBe(true);
        }
        await search.fill('especial');
        await expect(page.locator('.employee-search-result')).toHaveText('44<Empleado & especial>');
        expect(await page.locator('.employee-search-result img, .employee-search-result script').count()).toBe(0);
        await page.screenshot({ path: `/private/tmp/pos57-${width}.png` });
        await page.keyboard.press('Escape');
        await expect(page.locator('.pos-mojo-badge')).toBeFocused();
    });
}

test('Fase 57 empleado ausente, fallo y reintento conservan borrador y asignación', async ({ page }) => {
    const employeeCatalog = phase57Employees.map(item => ({ ...item }));
    const state = await phase57Fixture(page, { employeeCatalog });
    state.ticket = 'T001-57'; state.mozo = 99999;
    await page.locator('[data-table-number="231"]').click();
    await expect(page.locator('#order-save-message')).toContainText('Empleado asignado no disponible');
    await page.locator('.pos-mojo-badge').click();
    await expect(page.locator('[data-employee-code="99999"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    let available = false;
    await page.route('**/api/pos/mozos?**', route => available
        ? route.fulfill({ json: [{ Codemp: 55, Nombre: 'Empleado reincorporado' }] })
        : route.fulfill({ status: 503, json: { message: 'No disponible' } }));
    await page.evaluate(() => openPOSOrder(231, 2));
    await expect(page.locator('#order-save-message')).toContainText('Empleados no disponibles');
    await page.locator('.pos-product-card').click();
    await page.locator('.pos-mojo-badge').click();
    await expect(page.locator('#employee-search-status')).toContainText('Empleados no disponibles');
    available = true;
    await page.locator('#employee-search-retry').click();
    await expect(page.locator('#employee-search-results button')).toHaveCount(1);
    await page.locator('[data-employee-code="55"]').click();
    await expect(page.locator('#pos-mojo-name')).toHaveText('Empleado reincorporado');
    await expect.poll(() => state.saves).toBe(1);
    expect(state.mozo).toBe(55); expect(state.items[0].cantidad).toBe(1);
    await page.keyboard.press('Escape');
});

test('Fase 57 cambiar contexto o entrar en Preventa invalida la selección del diálogo', async ({ page }) => {
    page.on('dialog', dialog => dialog.accept());
    const state = await phase57Fixture(page);
    await page.locator('[data-table-number="231"]').click();
    await expect(page.locator('#pos-mojo-name')).toHaveText('Seleccione empleado');
    await page.locator('.pos-mojo-badge').click();
    await page.evaluate(() => { window.staleResult = document.querySelector('[data-employee-code="11"]'); });
    await page.evaluate(() => openPOSOrder(236, 2));
    await expect(page.locator('#employee-search-dialog')).not.toBeVisible();
    await page.evaluate(() => window.staleResult.click());
    await expect(page.locator('#pos-mojo-name')).toHaveText('Mozo normal');
    state.ticket = 'T001-57'; state.mozo = 32; state.orderState = 2;
    state.items = [{ lineaId: '77777777-7777-4777-8777-777777777777', codPro: product.CodPro, nombre: product.Nombre, precio: 20, afecto: 1, cantidad: 1, notasRapidas: [], nota: '' }];
    await page.evaluate(() => openPOSOrder(231, 2));
    await expect(page.locator('#pos-mojo-name')).toHaveText('María Ramos');
    await page.evaluate(() => openMozoModal());
    await expect(page.locator('#employee-search-dialog')).not.toBeVisible();
    await page.getByRole('button', { name: /Reabrir Pedido/i }).click();
    await page.locator('.pos-mojo-badge').click();
    await expect(page.locator('#employee-search-dialog')).toBeVisible();
    await page.locator('[data-employee-code="11"]').click();
    await expect.poll(() => state.saves).toBe(1);
    expect(state.mozo).toBe(11);
});

test('@android Fase 57 teclado táctil conserva búsqueda y aplica el empleado', async ({ page }) => {
    await phase57Fixture(page);
    await page.locator('[data-table-number="231"]').tap();
    await expect(page.locator('#pos-mojo-name')).toHaveText('Seleccione empleado');
    await page.locator('.pos-mojo-badge').tap();
    const search = page.locator('#employee-search-input');
    await search.fill('maria');
    await page.setViewportSize({ width: 393, height: 430 });
    await expect(search).toBeFocused(); await expect(search).toHaveValue('maria');
    await page.locator('[data-employee-code="32"]').tap();
    await expect(page.locator('#pos-mojo-name')).toHaveText('María Ramos');
    await expect(page.locator('#employee-search-dialog')).not.toBeVisible();
});

test('Fase 57 lista vacía, cierre por fondo y reintento tardío no cruzan mesas', async ({ page }) => {
    const state = await phase57Fixture(page, { employeeCatalog: [] });
    await page.locator('[data-table-number="231"]').click();
    await expect(page.locator('#order-save-message')).toContainText('No hay empleados');
    await page.locator('.pos-mojo-badge').click();
    await expect(page.locator('#employee-search-status')).toContainText('No hay empleados');
    await expect(page.locator('.employee-search-result')).toHaveCount(0);
    await page.mouse.click(10, 10);
    await expect(page.locator('#employee-search-dialog')).not.toBeVisible();
    expect(state.saves).toBe(0);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/api/pos/mozos?**', async route => {
        const mesa = new URL(route.request().url()).searchParams.get('mesa');
        if (mesa === '231') await gate;
        await route.fulfill({ json: [{ Codemp: mesa === '231' ? 11 : 32, Nombre: mesa === '231' ? 'José Pérez' : 'María Ramos' }] });
    });
    await page.locator('.pos-mojo-badge').click();
    await page.locator('#employee-search-retry').click();
    await expect(page.locator('#employee-search-status')).toHaveText('Cargando empleados…');
    await expect(page.locator('#employee-search-input')).toBeDisabled();
    await page.evaluate(() => openPOSOrder(235, 2));
    await expect(page.locator('#employee-search-dialog')).not.toBeVisible();
    release();
    await expect(page.locator('#pos-mojo-name')).toHaveText('Seleccione empleado');
    await page.locator('.pos-mojo-badge').click();
    await expect(page.locator('[data-employee-code="32"]')).toBeVisible();
    await expect(page.locator('[data-employee-code="11"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    expect(state.saves).toBe(0);
});

test('Fase 57 buscador respeta el tema oscuro y mantiene legible la selección', async ({ page }) => {
    await phase57Fixture(page);
    await page.locator('[data-table-number="231"]').click();
    await expect(page.locator('#pos-mojo-name')).toHaveText('Seleccione empleado');
    await page.locator('.pos-mojo-badge').click();
    await page.locator('[data-employee-code="11"]').click();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await page.locator('.pos-mojo-badge').click();
    const colors = await page.evaluate(() => {
        const style = id => { const s = getComputedStyle(document.querySelector(id)); return { color: s.color, background: s.backgroundColor }; };
        return { dialog: style('#employee-search-dialog'), input: style('#employee-search-input'), selected: style('[data-employee-code="11"]') };
    });
    expect(colors.dialog.color).toBe('rgb(249, 250, 251)');
    expect(colors.dialog.background).toBe('rgb(31, 41, 55)');
    expect(colors.input.color).toBe(colors.dialog.color);
    expect(colors.selected.background).toBe('rgb(55, 65, 81)');
    expect(colors.selected.color).toBe(colors.dialog.color);
    await page.screenshot({ path: '/private/tmp/pos57-dark.png' });
    await page.keyboard.press('Escape');
});

for (const empresa of [2, 4, 6]) {
    test(`Fase 58 todos los empleados se guardan y recargan en empresa ${empresa}`, async ({ page }) => {
        const employeeCatalog = phase57Employees.map(item => ({ ...item }));
        const state = await phase57Fixture(page, { employeeCatalog, products: [{ ...product, CodPro: `${String(empresa).padStart(2, '0')}001` }] });
        await page.selectOption('#pos-empresa-select', String(empresa).padStart(2, '0'));
        await page.locator('[data-table-number="235"]').click();
        await expect(page.locator('#pos-mojo-name')).toHaveText('Seleccione empleado');
        let saves = 0;
        for (const code of [55, 66, 68]) {
            await page.locator('.pos-mojo-badge').click();
            await expect(page.locator('.employee-search-result')).toHaveCount(employeeCatalog.length);
            await page.locator('#employee-search-input').fill(String(code));
            await page.locator(`[data-employee-code="${code}"]`).click();
            if (!saves) await page.locator('.pos-product-card').click();
            await expect.poll(() => state.saves).toBe(++saves);
            expect(state.mozo).toBe(code);
            expect(state.items[0].codPro.startsWith(String(empresa).padStart(2, '0'))).toBe(true);
            await page.evaluate(empresa => openPOSOrder(235, empresa), empresa);
            expect(await page.locator('#pos-mojo-select').inputValue()).toBe(String(code));
            await expect(page.locator('#pos-mojo-name')).toHaveText(employeeCatalog.find(item => item.Codemp === code).Nombre);
            await expect(page.locator('#order-save-message')).not.toContainText('no disponible');
        }
        employeeCatalog.find(item => item.Codemp === 68).Empresa = 4;
        employeeCatalog.find(item => item.Codemp === 68).FecCese = '2026-10-01';
        await page.evaluate(empresa => openPOSOrder(235, empresa), empresa);
        expect(await page.locator('#pos-mojo-select').inputValue()).toBe('68');
        await expect(page.locator('#pos-mojo-name')).toHaveText('Empleado sin empresa');
        expect(state.orderCompanies.filter(value => typeof value === 'number')).toEqual([empresa, empresa, empresa]);
        expect(await page.evaluate(() => posCurrentTableEmpresa)).toBe(empresa);
        expect(state.items[0].cantidad).toBe(1);
    });
}


test('manual price validates, cancels, persists and separates catalog selections', async ({ page }) => {
    const state=await fixture(page,{tables:[{Numero:201,Empresa:2,Estado:1}]});
    await page.locator('.pos-product-card').first().click();
    await expect.poll(()=>state.saves).toBe(1);
    const price=page.getByRole('button',{name:'Precio',exact:true}).first();
    await price.click();
    await page.locator('#order-price-input').fill('15,00');
    await page.getByRole('button',{name:'Cancelar',exact:true}).click();
    expect(state.saves).toBe(1);
    await expect(price).toBeFocused();
    await price.click();
    for(const value of ['', '-1', '15.001', '1000000000']) {
        await page.locator('#order-price-input').fill(value);
        await page.getByRole('button',{name:'Aplicar',exact:true}).click();
        await expect(page.locator('#order-price-input')).toHaveAttribute('aria-invalid','true');
    }
    await page.locator('#order-price-input').fill('15,00');
    await page.getByRole('button',{name:'Aplicar',exact:true}).click();
    await expect.poll(()=>state.items[0]?.precioManualFinal).toBe(15);
    await expect(page.getByRole('button',{name:'Precio',exact:true})).toBeFocused();
    await expect(page.locator('.cart-item-details')).toHaveText('S/ 15.00 x 1');
    await page.locator('.cart-item button[data-action="inc"]').click();
    await expect.poll(()=>state.items[0]?.cantidad).toBe(2);
    await expect(page.locator('#pos-total')).toContainText('30.00');
    await page.locator('.pos-product-card').first().click();
    await expect(page.locator('.cart-item')).toHaveCount(2);
    await expect.poll(()=>state.items.length).toBe(2);
    await page.evaluate(()=>openPOSOrder(201,2));
    await expect(page.locator('.cart-item-details').first()).toHaveText('S/ 15.00 x 2');
});

test('manual price preserves newer edits during slow saves and does not send kitchen changes', async ({ page }) => {
    const state=await fixture(page,{tables:[{Numero:201,Empresa:2,Estado:1}]});
    await page.locator('.pos-product-card').first().click();
    await expect.poll(()=>state.saves).toBe(1);
    await page.locator('#order-code').fill('REF');
    await page.evaluate(()=>sendOrderKitchen());
    expect(state.sends).toBe(1);
    state.delaySave=600;
    async function edit(value) {
        await page.getByRole('button',{name:'Precio',exact:true}).click();
        await page.locator('#order-price-input').fill(value);
        await page.getByRole('button',{name:'Aplicar',exact:true}).click();
    }
    await edit('15');
    await expect.poll(()=>state.requestOrder.filter(v=>v==='save').length).toBe(3);
    await edit('17');
    await expect.poll(()=>state.items[0]?.precioManualFinal).toBe(17);
    await expect(page.locator('.cart-item-details')).toHaveText('S/ 17.00 x 1');
    expect(state.sends).toBe(1);
    await page.evaluate(()=>orderPay());
    await expect(page.getByRole('button',{name:'Precio',exact:true})).toHaveCount(0);
});

test('manual price unavailable on normal and discard tables; zero and stale selection are safe', async ({ page }) => {
    const state=await fixture(page);
    await page.locator('.pos-product-card').first().click();
    await expect.poll(()=>state.saves).toBe(1);
    await expect(page.getByRole('button',{name:'Precio',exact:true})).toHaveCount(0);
    await page.evaluate(()=>{posCurrentTable=231;updateCartUI();});
    await expect(page.getByRole('button',{name:'Precio',exact:true})).toHaveCount(0);
    await page.evaluate(()=>{posCurrentTable=201;updateCartUI();});
    await page.getByRole('button',{name:'Precio',exact:true}).click();
    await page.locator('#order-price-input').fill('0');
    await page.getByRole('button',{name:'Aplicar',exact:true}).click();
    await expect.poll(()=>state.items[0]?.precioManualFinal).toBe(0);
    await page.getByRole('button',{name:'Precio',exact:true}).click();
    await page.evaluate(()=>{posCart[0].cantidad++;});
    await page.locator('#order-price-input').fill('10');
    await page.getByRole('button',{name:'Aplicar',exact:true}).click();
    await expect(page.locator('#order-price-dialog')).not.toBeVisible();
    expect(state.items[0].precioManualFinal).toBe(0);
});

for (const width of [390,768,1280]) test(`manual price dialog fits ${width}px and restores focus on Escape`,async({page})=>{
    await page.setViewportSize({width,height:900});
    await fixture(page,{tables:[{Numero:210,Empresa:2,Estado:1}]});
    await page.locator('.pos-product-card').first().click();
    if(width<=1200) await page.locator('#pos-cart-fab').click();
    const trigger=page.getByRole('button',{name:'Precio',exact:true});
    await trigger.click();
    await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));
    const dialog=page.locator('#order-price-dialog');
    const box=await dialog.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
    for(const control of await dialog.locator('button,input').all()) expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.screenshot({path:`test-results/phase59-price-${width}.png`});
    await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();
});

test('manual price updates grouped sent/new lines only and survives split, conflict and reopen',async({page})=>{
    const state=await fixture(page,{tables:[{Numero:220,Empresa:2,Estado:1}]});
    await page.locator('.pos-product-card').first().click();await expect.poll(()=>state.saves).toBe(1);
    // Use independent note variants and a group mixing sent and new units.
    await page.evaluate(()=>{
        const line=posCart[0];line.enviada={lineaId:line.lineaId,codPro:line.codPro,nombre:line.nombre,cantidad:1,notasRapidas:[],nota:''};
        posCart.push({...line,lineaId:newOrderId(),enviada:null});
        posCart.push({...line,lineaId:newOrderId(),enviada:null,nota:'Otra nota'});
        updateCartUI();
    });
    await page.getByRole('button',{name:'Precio',exact:true}).first().click();
    await page.locator('#order-price-input').fill('15');await page.getByRole('button',{name:'Aplicar',exact:true}).click();
    await expect.poll(()=>state.items.length).toBe(3);
    expect(state.items.map(l=>l.precioManualFinal)).toEqual([15,15,null]);
    await page.evaluate(()=>{posCart[0].pendienteId=newOrderId();updateCartUI();});
    await page.getByRole('button',{name:'Precio',exact:true}).first().click();
    await page.locator('#order-price-input').fill('16');await page.getByRole('button',{name:'Aplicar',exact:true}).click();
    await expect.poll(()=>state.items[0].precioManualFinal).toBe(16);
    state.conflict=true;
    await page.getByRole('button',{name:'Precio',exact:true}).first().click();
    await page.locator('#order-price-input').fill('17');await page.getByRole('button',{name:'Aplicar',exact:true}).click();
    await expect(page.locator('#order-save-message')).toContainText('Pedido cambiado');
    expect(await page.evaluate(()=>posCart[0].precioManualFinal)).toBe(17);
    await expect(page.getByRole('button',{name:'Precio',exact:true}).first()).toBeDisabled();
    state.conflict=false;await page.evaluate(()=>{orderConflict=false;return orderFlush();});
    await expect.poll(()=>state.items[0].precioManualFinal).toBe(17);
    state.orderState=2;await page.evaluate(()=>openPOSOrder(220,2));
    await expect(page.getByRole('button',{name:'Precio',exact:true})).toHaveCount(0);
    page.once('dialog',dialog=>dialog.accept());await page.evaluate(()=>reabrirPedido());
    await expect(page.getByRole('button',{name:'Precio',exact:true}).first()).toBeVisible();
    // Split a single unsent manual line using the existing notes workflow.
    await page.evaluate(()=>{posCart=[{...posCart[2],cantidad:3,precioManualFinal:12,precio:12,nota:''}];updateCartUI();});
    page.once('dialog',dialog=>dialog.accept('1'));
    await page.evaluate(()=>splitOrderLine(0));
    expect(await page.evaluate(()=>posCart.map(l=>l.precioManualFinal))).toEqual([12,12]);
});

test('manual price preserves draft after save failure and retries without kitchen sends',async({page})=>{
    const state=await fixture(page,{tables:[{Numero:201,Empresa:2,Estado:1}]});
    await page.locator('.pos-product-card').first().click();await expect.poll(()=>state.saves).toBe(1);
    await page.route('**/api/pos/pedido',route=>route.request().method()==='POST'
        ? route.fulfill({status:500,json:{message:'Fallo de guardado'}}) : route.fallback());
    await page.getByRole('button',{name:'Precio',exact:true}).click();
    await page.locator('#order-price-input').fill('15');await page.getByRole('button',{name:'Aplicar',exact:true}).click();
    await expect(page.locator('#order-save-message')).toContainText('Fallo de guardado');
    await expect(page.locator('.cart-item-details')).toHaveText('S/ 15.00 x 1');
    expect(state.items[0].precioManualFinal).toBeNull();
    await page.unroute('**/api/pos/pedido');await page.evaluate(()=>orderFlush());
    expect(state.items[0].precioManualFinal).toBe(15);expect(state.sends).toBe(0);
});
