const { test, expect } = require('@playwright/test');
const product = { CodPro: '02001', Nombre: 'Arroz con mariscos', PventaMa: 20, Afecto: 1, Linea: 'Platos' };
async function fixture(page) {
    const state = { items: [], sent: new Map(), kitchenStates: new Map(), version: 0, sends: 0, saves: 0, deletes: 0, reprints: 0,
        conflict: false, delaySave: 0, ticket: null, requestOrder: [], kds: [], closure: null, closes: 0 };
    function data() {
        const pending = state.items.some(l => JSON.stringify(l) !== state.sent.get(l.lineaId)) || [...state.sent.keys()].some(id => !state.items.some(l => l.lineaId === id));
        const cancellations = [...state.sent.entries()].filter(([id]) => !state.items.some(l => l.lineaId === id)).map(([,line]) => JSON.parse(line));
        return { success: true, nroTicket: state.ticket, version: state.version,
            pedido: state.ticket ? { NroTicket: state.ticket, Estado: 1, Mozo: 1 } : null,
            items: state.items.map(l => ({ ...l, Codpro: l.codPro, Descripcion: l.nombre, Cantidad: l.cantidad, Precio: l.precio, Afecto: l.afecto,
                enviada: state.sent.has(l.lineaId) ? JSON.parse(state.sent.get(l.lineaId)) : null, pendienteEnvio: !state.sent.has(l.lineaId),
                estadoCocina: state.kitchenStates.get(l.lineaId) || null, pendienteId: null, anulada: false })),
            cocina: { pendientes: pending ? 1 : 0, ultimoEnvio: state.sends, estado: pending ? (state.sends ? 'Cambios pendientes' : 'Sin enviar') : (state.sends ? 'Enviado a cocina' : 'Sin enviar'), anulaciones: cancellations },
            impresion: state.sends ? { Estado: 'en_cola' } : null };
    }
    await page.route('**/api/**', async route => {
        const req = route.request(), url = new URL(req.url()), body = req.postDataJSON();
        const fulfill = (json, status = 200) => route.fulfill({ status, json });
        if (url.pathname === '/api/events') return route.fulfill({ status: 200, contentType: 'text/event-stream', body: ': test\n\n' });
        if (url.pathname === '/api/session') return fulfill({ user: { usuario: 'Mozo' } });
        if (url.pathname === '/api/pos/config') return fulfill({ igvv: 10.5 });
        if (url.pathname === '/api/pos/tables') return fulfill([{ Numero: 1, Empresa: 2, Ambiente: 1, Estado: 1 }]);
        if (url.pathname === '/api/pos/mozos') return fulfill([{ Codemp: 1, Nombre: 'José' }]);
        if (url.pathname === '/api/pos/categories') return fulfill(['Platos']);
        if (url.pathname === '/api/pos/products') return fulfill([product]);
        if (url.pathname === '/api/pos/pedido' && req.method() === 'GET') return fulfill(data());
        if (url.pathname === '/api/pos/pedido' && req.method() === 'POST') {
            state.requestOrder.push('save');
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
            state.items.forEach(l => { if (!state.kitchenStates.has(l.lineaId)) state.kitchenStates.set(l.lineaId,1); }); return fulfill(data());
        }
        if (url.pathname.endsWith('/estados-cocina')) return fulfill({ success:true, version:state.version,
            estados:state.items.map(l=>({lineaId:l.lineaId,estadoCocina:state.kitchenStates.get(l.lineaId)||null,pendienteId:null,anulada:false})) });
        if (url.pathname === '/api/cocina/pedidos') return fulfill({ success:true,pedidos:state.kds.map(l => ({ nroTicket:l.NroTicket,mesa:l.NroMesa,
            envioId:l.EnvioId || '22222222-2222-4222-8222-222222222222',numeroEnvio:1,mozo:'José',fechaEnvio:l.FechaTicket,
            minutosEspera:l.MinutosEspera,documento:l.Documento || 'COMANDA DE COCINA',impresion:l.Impresion || {estado:'enviado'},
            lineas:[{ lineaId:l.LineaId,codPro:l.Codpro,cantidad:l.Cantidad,nombre:l.Descripcion,notasRapidas:l.notasRapidas,nota:l.nota,estado:l.EstadoCocina,Categoria:l.Categoria,correccionPendiente:l.pendiente }] })) });
        if (url.pathname.endsWith('/reconocer')) { const l=state.kds.find(l=>url.pathname.includes(l.LineaId)); l.nota=l.pendiente.nueva.nota; l.pendiente=null; return fulfill({success:true}); }
        if (url.pathname.endsWith('/reimprimir')) { state.reprints++; return fulfill({success:true,trabajoId:'33333333-3333-4333-8333-333333333333'}); }
        if (url.pathname.endsWith('/todo-listo')) { state.kitchenStates.forEach((_,id)=>state.kitchenStates.set(id,3)); return fulfill({success:true}); }
        if (url.pathname.endsWith('/entregado')) { state.kitchenStates.forEach((_,id)=>state.kitchenStates.set(id,4)); return fulfill({success:true}); }
        if (url.pathname === '/api/admin/cierres/preview') return fulfill({ success:true,totalTickets:1,elegible:true,registrosSinTurno:0,
            bloqueos:{pedidosActivos:0,cocinaPendiente:0,correccionesPendientes:0,impresionesActivas:0},cierre:state.closure });
        if (url.pathname === '/api/admin/cierres' && req.method() === 'POST') {
            state.closes++; state.closure={id:'44444444-4444-4444-8444-444444444444',estado:'cerrado',purgaProgramada:new Date(Date.now()+86400000).toISOString()};
            return fulfill({success:true,...state.closure});
        }
        if (req.method() === 'DELETE' && url.pathname.startsWith('/api/pos/comanda/')) {
            state.deletes++; state.ticket=null; state.items=[]; state.sent.clear(); return fulfill({success:true,pedidoEliminado:true});
        }
        if (url.pathname.endsWith('/envios')) return fulfill({ envios: [] });
        return fulfill([]);
    });
    await page.goto('/dashboard.html');
    await page.selectOption('#pos-empresa-select', '02');
    await page.getByRole('button', { name: 'Mañana', exact: true }).click();
    await page.locator('.pos-table-card').first().click();
    await expect(page.locator('#pos-products-grid')).toContainText('Arroz');
    return state;
}
test('notas por línea, split, cancelar, guardar y envío explícito sin doble clic', async ({ page }) => {
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const state = await fixture(page);
    await page.locator('.pos-product-card').first().click();
    await page.locator('.pos-product-card').first().click();
    await page.locator('[data-action="notes"]').click();
    await page.getByRole('button', { name: '+ Sin cebolla', exact: true }).click();
    await page.locator('#order-note-text').fill('Alérgico: consultar al mozo');
    await page.locator('#order-notes-dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.locator('.order-line-notes').first()).toHaveText('');
    page.once('dialog', d => d.accept('1'));
    await page.getByRole('button', { name: 'Separar', exact: true }).click();
    await page.getByRole('button', { name: '+ Sin cebolla', exact: true }).click();
    await page.locator('#order-note-text').fill('Sin sal');
    await page.locator('#order-notes-dialog').getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.locator('.cart-item')).toHaveCount(2);
    await expect.poll(() => state.items.length).toBe(2);
    expect(state.sends).toBe(0);
    expect(state.items[0].cantidad + state.items[1].cantidad).toBe(2);
    expect(state.items[1].notasRapidas).toEqual(['Sin cebolla']);
    await expect(page.locator('.btn-pay-now')).toBeDisabled();
    await page.locator('#btn-enviar-cocina').dblclick();
    await expect(page.locator('#order-kitchen-status')).toHaveText('Enviado a cocina');
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
    await page.locator('#cocina-ticket-print').dblclick();
    await expect(page.locator('#cocina-ticket-print-status')).toHaveText('Reimpresión en cola.');
    expect(state.reprints).toBe(1);
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
