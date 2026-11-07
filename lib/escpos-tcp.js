'use strict';

const net = require('node:net');
const iconv = require('iconv-lite');

const CODE_PAGES = Object.freeze({ cp850: 2 });
const CUT_MARGIN_LINES = 5;
const STYLE = Object.freeze({
    boldOn: Buffer.from([0x1b, 0x45, 0x01]),
    boldOff: Buffer.from([0x1b, 0x45, 0x00]),
    doubleHeight: Buffer.from([0x1d, 0x21, 0x01]),
    normalSize: Buffer.from([0x1d, 0x21, 0x00]),
    spacedCharacters: Buffer.from([0x1b, 0x20, 0x01]),
    normalSpacing: Buffer.from([0x1b, 0x20, 0x00])
});

let rasterFont;
function strikeProductLine(line) {
    const image = require('pureimage');
    if (!rasterFont) {
        const font = image.registerFont(require.resolve('dejavu-fonts-ttf/ttf/DejaVuSansMono-Bold.ttf'), 'SedimKitchen');
        font.loadSync(); rasterFont = font;
    }
    const bitmap = image.make(576, 36), ctx = bitmap.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, bitmap.width, bitmap.height);
    ctx.fillStyle = '#000000'; ctx.font = '22px SedimKitchen'; ctx.fillText(line, 0, 27);
    const prefix = /^(\d+(?:[.,]\d+)?\s+x\s+)/i.exec(line)?.[1] || '';
    const start = Math.max(0, Math.round(ctx.measureText(prefix).width));
    const end = Math.min(bitmap.width, Math.ceil(ctx.measureText(line).width));
    if (end > start) ctx.fillRect(start, 17, end - start, 2);
    // Duplicate each raster row: the printer already handles normal raster mode,
    // and the doubled height matches the other product lines without widening them.
    const bytesPerRow = bitmap.width / 8, outputHeight = bitmap.height * 2;
    const bytes = Buffer.alloc(bytesPerRow * outputHeight);
    for (let y = 0; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) {
        const offset = (y * bitmap.width + x) * 4;
        if (bitmap.data[offset] < 160) {
            const pixel = 0x80 >> (x & 7), column = x >> 3;
            bytes[(y * 2) * bytesPerRow + column] |= pixel;
            bytes[(y * 2 + 1) * bytesPerRow + column] |= pixel;
        }
    }
    return Buffer.concat([Buffer.from([0x1d,0x76,0x30,0x00,bytesPerRow,0,outputHeight,0]), bytes]);
}
function renderEscPosDocument(document, codepage, config = {}) {
    const text = String(document ?? '').replace(/\r\n?/g, '\n');
    const trailingNewline = text.endsWith('\n');
    const lines = text.split('\n');
    if (trailingNewline) lines.pop();

    const parts = [];
    let detailStyle = 'normal';
    let expectingProduct = false;
    let inHeader = true;
    let orderDocument = false, movementType = '', previousDetail = false;
    const encode = value => iconv.encode(value, codepage);
    const styled = (line, style) => {
        if (style === 'bold') parts.push(STYLE.boldOn, encode(line), STYLE.boldOff);
        else if (style === 'bold-double-height') parts.push(STYLE.boldOn, STYLE.doubleHeight, encode(line), STYLE.normalSize, STYLE.boldOff);
        else if (style === 'bold-double-height-spaced') parts.push(STYLE.boldOn, STYLE.doubleHeight, STYLE.spacedCharacters, encode(line), STYLE.normalSpacing, STYLE.normalSize, STYLE.boldOff);
        else if (style === 'spaced') parts.push(STYLE.spacedCharacters, encode(line), STYLE.normalSpacing);
        else parts.push(encode(line));
    };
    const partialBold = (normal, bold) => {
        parts.push(encode(normal), STYLE.boldOn, encode(bold), STYLE.boldOff);
    };
    const boldThenNormal = (bold, normal) => {
        parts.push(STYLE.boldOn, encode(bold), STYLE.boldOff, encode(normal));
    };
    const ticketThenHighlightedSend = (ticket, separator, send, rest) => {
        parts.push(STYLE.boldOn, encode(ticket), STYLE.boldOff, encode(separator),
            STYLE.boldOn, STYLE.doubleHeight, encode(send), STYLE.normalSize, STYLE.boldOff, encode(rest));
    };
    const printProduct = line => {
        if (config.strikethrough && orderDocument && previousDetail) {
            try { parts.push((config.strikeRenderer || strikeProductLine)(line)); return true; }
            catch (error) { console.warn('No se pudo generar el tachado de la comanda; se usará el formato normal.', error?.name || 'Error'); }
        }
        styled(line, 'bold-double-height-spaced'); return false;
    };

    lines.forEach((line, index) => {
        let rasterLine = false;
        const movement = /^(ADICIÓN|CORRECCIÓN|ANULACIÓN)$/.test(line);
        const detailLabel = /^(ANTES:|AHORA:)$/.test(line);
        const divider = /^-{20,}$/.test(line);
        const title = /^(COMANDA DE (COCINA|BEBIDAS|BARRA)|CAMBIO DE MESA)$/.test(line);
        const ticketWithSend = /^(Ticket\s+\S+)(\s+\/\s+)(Env[ií]o\s+\S+)(.*)$/.exec(line);
        const ticket = /^(Ticket\s+\S+)(.*)$/.exec(line);
        const tableWaiter = /^(Mesa\s+.*?)\s+\/\s+(Mozo\s+.*)$/.exec(line);
        const table = /^(Mesa\s+.*)$/.exec(line);
        const waiter = /^(Mozo\s+.*)$/.exec(line);

        if (inHeader && title) { orderDocument = /^COMANDA DE (COCINA|BEBIDAS|BARRA)$/.test(line); styled(line, 'bold'); }
        else if (inHeader && ticketWithSend) ticketThenHighlightedSend(ticketWithSend[1], ticketWithSend[2], ticketWithSend[3], ticketWithSend[4]);
        else if (inHeader && ticket) boldThenNormal(ticket[1], ticket[2]);
        else if (inHeader && tableWaiter) {
            styled(tableWaiter[1], 'bold-double-height');
            parts.push(Buffer.from('\n', 'ascii'));
            styled(tableWaiter[2], 'bold');
        } else if (inHeader && table) styled(table[1], 'bold-double-height');
        else if (inHeader && /^Código: /.test(line)) styled(line, 'bold');
        else if (inHeader && waiter) partialBold('', waiter[1]);
        else if (movement) {
            movementType = line; previousDetail = false;
            styled(line, 'normal');
            expectingProduct = true;
            detailStyle = 'normal';
        } else if (detailLabel) {
            previousDetail = line === 'ANTES:' && (movementType === 'ANULACIÓN' || movementType === 'CORRECCIÓN');
            styled(line, 'normal');
            expectingProduct = true;
            detailStyle = 'normal';
        } else if (divider) {
            previousDetail = false; movementType = '';
            styled(line, 'normal');
            expectingProduct = false;
            detailStyle = 'normal';
            inHeader = false;
        } else if (expectingProduct) {
            rasterLine = printProduct(line);
            expectingProduct = false;
            detailStyle = 'product';
        } else if (/^NOTA:\s*/.test(line)) {
            styled(line, 'spaced');
            detailStyle = 'note';
        } else if (detailStyle === 'product') {
            rasterLine = printProduct(line);
        }
        else if (detailStyle === 'note') styled(line, 'spaced');
        else styled(line, 'normal');

        if (!rasterLine && (index < lines.length - 1 || trailingNewline)) parts.push(Buffer.from('\n', 'ascii'));
    });

    // Always leave the printer in its normal state before feeding/cutting.
    parts.push(STYLE.boldOff, STYLE.normalSize, STYLE.normalSpacing);
    return Buffer.concat(parts);
}

function buildEscPosFrame(document, config = {}) {
    const codepage = String(config.codepage || 'cp850').toLowerCase();
    if (!(codepage in CODE_PAGES) || !iconv.encodingExists(codepage)) {
        throw new Error(`Página de códigos ESC/POS no compatible: ${codepage}`);
    }
    const parts = [
        Buffer.from([0x1b, 0x40]),
        // Some 3nStar firmware starts in Kanji/two-byte mode. Force single-byte
        // processing before selecting the configured ESC/POS code page.
        Buffer.from([0x1c, 0x2e]),
        Buffer.from([0x1b, 0x74, CODE_PAGES[codepage]]),
        renderEscPosDocument(document, codepage, config),
        Buffer.from('\n'.repeat(CUT_MARGIN_LINES), 'ascii')
    ];
    if (config.cut !== false) parts.push(Buffer.from([0x1d, 0x56, 0x00]));
    return Buffer.concat(parts);
}

function beforeTransmission(error, started) {
    error.beforeTransmission = !started;
    return error;
}

function createEscPosTcpTransport() {
    return {
        send(document, config = {}) {
            const host = String(config.host || '').trim();
            const port = Number(config.port || 9100);
            const timeoutMs = Number(config.timeoutMs || 5000);
            if (!host) return Promise.reject(beforeTransmission(new Error('PRINTER_HOST no configurado'), false));
            if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.reject(beforeTransmission(new Error('PRINTER_PORT inválido'), false));

            let frame;
            try { frame = buildEscPosFrame(document, config); }
            catch (error) { return Promise.reject(beforeTransmission(error, false)); }

            return new Promise((resolve, reject) => {
                const socket = new net.Socket();
                let started = false, completed = false, settled = false;
                const finish = (error) => {
                    if (settled) return;
                    settled = true;
                    socket.destroy();
                    error ? reject(beforeTransmission(error, started)) : resolve({ transmitted: true });
                };
                socket.setTimeout(timeoutMs);
                socket.once('timeout', () => finish(new Error(`Timeout al conectar/transmitir a ${host}:${port}`)));
                socket.once('error', finish);
                socket.once('close', hadError => {
                    if (!settled) finish(hadError || !completed ? new Error('La conexión de impresión se cerró antes de completar la transmisión') : null);
                });
                socket.connect(port, host, () => {
                    started = true;
                    socket.end(frame, () => { completed = true; });
                });
            });
        }
    };
}

module.exports = { CODE_PAGES, buildEscPosFrame, createEscPosTcpTransport };
