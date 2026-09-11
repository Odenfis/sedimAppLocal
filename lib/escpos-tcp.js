'use strict';

const net = require('node:net');
const iconv = require('iconv-lite');

const CODE_PAGES = Object.freeze({ cp850: 2 });

function buildEscPosFrame(document, config = {}) {
    const codepage = String(config.codepage || 'cp850').toLowerCase();
    if (!(codepage in CODE_PAGES) || !iconv.encodingExists(codepage)) {
        throw new Error(`Página de códigos ESC/POS no compatible: ${codepage}`);
    }
    const text = String(document ?? '').replace(/\r\n?/g, '\n');
    const parts = [
        Buffer.from([0x1b, 0x40]),
        Buffer.from([0x1b, 0x74, CODE_PAGES[codepage]]),
        iconv.encode(text, codepage),
        Buffer.from('\n\n\n', 'ascii')
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
