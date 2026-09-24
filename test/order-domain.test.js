const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { QUICK_NOTES, normalizeItems, snapshot, changes, validateEdits, printText } = require('../lib/order-domain');
const { classifyFailure, printerSettings } = require('../lib/print-worker');
const { buildEscPosFrame, createEscPosTcpTransport } = require('../lib/escpos-tcp');
const { orderKitchenStatus, orderKitchenHeadline } = require('../public/orders-ui');
const item = extra => ({ lineaId: randomUUID(), codPro: '02001', nombre: 'Arroz con mariscos', cantidad: 1, precio: 20, afecto: 1, ...extra });

test('mismo producto conserva instrucciones y IDs independientes', () => {
    const ls = normalizeItems([item({ notasRapidas: ['Sin cebolla','Sin cebolla'] }), item({ nota: 'Poco picante' })]);
    assert.equal(ls.length, 2); assert.notEqual(ls[0].lineaId, ls[1].lineaId);
    assert.deepEqual(ls[0].notasRapidas, ['Sin cebolla']); assert.equal(ls[1].nota, 'Poco picante');
});
test('límites, precisión, IDs duplicados y controles de impresora', () => {
    const line = item();
    for (const data of [[line,line], [item({ cantidad: -1 })], [item({ cantidad: 1.001 })], [item({ nota: 'x'.repeat(501) })],
        [item({ nota: '\x1b@' })], [item({ notasRapidas: ['no permitido'] })], [item({ precio: NaN })]]) assert.throws(() => normalizeItems(data));
    assert.equal(normalizeItems([item({ nota: 'ñ'.repeat(500), cantidad: .5 })])[0].nota.length, 500);
});
test('notas se guardan como texto, sin interpretar HTML', () => {
    assert.equal(normalizeItems([item({ nota: '<script>alert(1)</script>' })])[0].nota, '<script>alert(1)</script>');
});
test('Helada y Sin Helar son notas rápidas válidas, ordenadas e imprimibles', () => {
    assert.equal(QUICK_NOTES.length, 12);
    const line = normalizeItems([item({ notasRapidas: ['Sin Helar', 'Helada'] })])[0];
    assert.deepEqual(line.notasRapidas, ['Helada', 'Sin Helar']);
    const doc = printText({ empresa: 2, numero: 1, nroTicket: 'T001-000001', mesa: 1, mozo: 'José', fecha: '10/09/2026 12:30' },
        [{ tipo: 'ADICIÓN', nueva: snapshot(line) }]);
    assert.match(doc, /NOTA: Helada/);
    assert.match(doc, /NOTA: Sin Helar/);
});
test('cada envío contiene solo altas, correcciones y bajas pendientes', () => {
    const a = normalizeItems([item()])[0];
    assert.equal(changes([a])[0].tipo, 'ADICIÓN');
    a.enviada = snapshot(a); assert.equal(changes([a]).length, 0);
    a.nota = 'Sin sal'; assert.equal(changes([a])[0].tipo, 'CORRECCIÓN');
    a.enviada = snapshot(a); assert.equal(changes([a]).length, 0);
    a.baja = true; assert.equal(changes([a])[0].tipo, 'ANULACIÓN');
    a.enviada = null; assert.equal(changes([a]).length, 0);
});
test('migración normaliza GUID sin crear novedades falsas', () => {
    const a = normalizeItems([item()])[0]; a.enviada = snapshot({ ...a, lineaId: a.lineaId.toUpperCase() });
    assert.equal(changes([a]).length, 0);
});
test('reconocimiento pendiente bloquea cambios y eliminación; otras líneas se pueden editar', () => {
    const old = normalizeItems([item()])[0]; old.enviada = snapshot(old); old.pendienteId = randomUUID();
    assert.throws(() => validateEdits([old], [{ ...old, nota: 'Cambio' }]), { status: 409 });
    assert.throws(() => validateEdits([old], []), { status: 409 });
    assert.doesNotThrow(() => validateEdits([old], [old, ...normalizeItems([item()])]));
});
test('adiciones a platos enviados deben ser líneas nuevas', () => {
    const old = normalizeItems([item()])[0]; old.enviada = snapshot(old);
    assert.throws(() => validateEdits([old], [{ ...old, cantidad: 2 }]));
    assert.doesNotThrow(() => validateEdits([old], [old, ...normalizeItems([item()])]));
});
test('ticket muestra corrección y notas sin precios ni bytes de control; ancho acotado', () => {
    const line = normalizeItems([item({ nota: 'Término medio, sin azúcar. ' + 'x'.repeat(90) })])[0];
    const old = snapshot(line); line.cantidad = 2;
    const doc = printText({ empresa: 2, numero: 2, nroTicket: 'T001-000001', mesa: 4, mozo: 'José', fecha: '10/09/2026 12:30' },
        [{ tipo: 'CORRECCIÓN', anterior: old, nueva: snapshot(line) }], true);
    assert.match(doc, /REIMPRESIÓN/); assert.match(doc, /ANTES:/); assert.match(doc, /AHORA:/); assert.match(doc, /Término/);
    assert.doesNotMatch(doc, /Precio|IGV|\x1b/); assert.ok(doc.split('\n').every(l => l.length <= 42));
});
test('el generador produce una COMANDA DE BARRA con el mismo encabezado y contenido filtrado', () => {
    const line = normalizeItems([item({ nombre: 'Pisco sour' })])[0];
    const doc = printText({ empresa: 2, numero: 3, nroTicket: 'T001-000001', mesa: 4, mozo: 'José', fecha: '10/09/2026 12:30' },
        [{ tipo: 'ADICIÓN', nueva: snapshot(line) }], false, 'COMANDA DE BARRA');
    assert.match(doc, /COMANDA DE BARRA/);
    assert.match(doc, /Ticket T001-000001/);
    assert.match(doc, /Pisco sour/);
    assert.doesNotMatch(doc, /COMANDA DE COCINA/);
});
test('solo reintenta fallos explícitamente anteriores a transmisión, máximo 3', () => {
    assert.equal(classifyFailure({ beforeTransmission: true }, 1), 'en_cola');
    assert.equal(classifyFailure({ beforeTransmission: true }, 3), 'error');
    assert.equal(classifyFailure(new Error('connection reset'), 1), 'incierto');
    assert.equal(classifyFailure({ beforeTransmission: false }, 2), 'incierto');
});
test('cada trabajador toma exclusivamente la configuración de su destino', () => {
    const before = Object.fromEntries(['PRINTER_HOST','BAR_PRINTER_HOST','BAR_PRINTER_PORT'].map(key => [key,process.env[key]]));
    try {
        process.env.PRINTER_HOST = '192.168.1.50'; process.env.BAR_PRINTER_HOST = '192.168.1.180'; process.env.BAR_PRINTER_PORT = '9100';
        assert.equal(printerSettings('cocina').host,'192.168.1.50');
        assert.equal(printerSettings('barra').host,'192.168.1.180'); assert.equal(printerSettings('barra').port,9100);
    } finally {
        for (const [key,value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key] = value;
    }
});

test('RPT004 recibe trama ESC/POS CP850 con avance y corte configurables', async () => {
    const spanish = 'áéíóú ÁÉÍÓÚ ñÑ üÜ ¿¡';
    const frame = buildEscPosFrame(`COMANDA\n${spanish}`, { codepage: 'cp850', cut: true });
    assert.deepEqual([...frame.subarray(0, 7)], [0x1b, 0x40, 0x1c, 0x2e, 0x1b, 0x74, 0x02]);
    assert.ok(frame.includes(Buffer.from([
        0xa0, 0x82, 0xa1, 0xa2, 0xa3, 0x20,
        0xb5, 0x90, 0xd6, 0xe0, 0xe9, 0x20,
        0xa4, 0xa5, 0x20, 0x81, 0x9a, 0x20, 0xa8, 0xad
    ])));
    assert.deepEqual([...frame.subarray(-3)], [0x1d, 0x56, 0x00]);
    const withoutCut = buildEscPosFrame('uno', { codepage: 'cp850', cut: false });
    assert.notDeepEqual([...withoutCut.subarray(-3)], [0x1d, 0x56, 0x00]);
    await assert.rejects(createEscPosTcpTransport().send('x', {}), error => error.beforeTransmission === true && /PRINTER_HOST/.test(error.message));
});

test('separar cantidades fraccionarias conserva el total comercial y nunca asigna importes negativos', () => {
    const { amounts } = require('../public/order-math');
    const a = { codPro:'02001',precio:3.33,afecto:0,cantidad:.02 };
    assert.deepEqual(amounts([a],0),[.07]);
    assert.equal(amounts([{...a,cantidad:.01},{...a,cantidad:.01}],0).reduce((s,n)=>s+n,0),.07);
    const tiny = amounts(Array.from({length:10},()=>({...a,precio:.5,cantidad:.01})),0);
    assert.ok(tiny.every(n=>n>=0)); assert.equal(tiny.reduce((s,n)=>s+n,0),.05);
});

test('detalle POS resume estados de cocina homogéneos y mixtos por cantidad', () => {
    const sent = state => ({ enviada: {}, anulada: false, cantidad: 1, estadoCocina: state });
    assert.equal(orderKitchenStatus([{ cantidad: 1 }]), 'Sin enviar');
    assert.equal(orderKitchenStatus([sent(1)]), 'Enviado a Cocina');
    assert.equal(orderKitchenStatus([sent(3), { ...sent(3), cantidad: 2 }]), 'Listo en Cocina');
    assert.equal(orderKitchenStatus([sent(2), sent(3), { ...sent(4), cantidad: 2 }]), '1 en preparación · 1 listo · 2 entregados');
    assert.equal(orderKitchenStatus([{ ...sent(4), anulada: true }]), 'Sin enviar');
    assert.equal(orderKitchenHeadline([sent(2), sent(3)]), 'En preparación');
    assert.equal(orderKitchenHeadline([sent(3), sent(3)]), 'Listo en Cocina');
    assert.equal(orderKitchenHeadline([sent(4), sent(4)]), 'Producto Entregado');
});
