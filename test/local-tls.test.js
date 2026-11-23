'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const localTls = require('../lib/local-tls');
const certs = require('../scripts/generate-local-certs');

const hasOpenssl = (() => { try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

function run(middleware, { method = 'GET', url = '/dashboard.html', host = '192.168.1.50:3000', secure = false } = {}) {
    const req = { method, originalUrl: url, path: url.split('?')[0], headers: { host }, secure };
    let redirected = null, nexted = false;
    middleware(req, { redirect: (status, location) => { redirected = { status, location }; } }, () => { nexted = true; });
    return { redirected, nexted };
}

test('HTTPS queda deshabilitado salvo activación explícita y valida el puerto', () => {
    assert.equal(localTls.tlsConfig({}).enabled, false);
    const config = localTls.tlsConfig({ HTTPS_ENABLED: 'true', TLS_DIR: '/certs' });
    assert.equal(config.port, 3443); assert.equal(config.redirect, false);
    assert.equal(config.certFile, path.join('/certs', 'server.crt'));
    assert.throws(() => localTls.tlsConfig({ HTTPS_ENABLED: 'true', HTTPS_PORT: '70000' }), /HTTPS_PORT/);
    assert.throws(() => localTls.tlsConfig({ HTTPS_ENABLED: 'true', HTTPS_PORT: '3000', PORT: '3000' }), /distinto de PORT/);
});

test('la redirección solo mueve navegación de páginas y respeta API, certificado y estado', () => {
    const middleware = localTls.redirectMiddleware(localTls.tlsConfig({ HTTPS_ENABLED: 'true', HTTPS_REDIRECT: 'true' }));
    assert.deepEqual(run(middleware).redirected, { status: 302, location: 'https://192.168.1.50:3443/dashboard.html' });
    assert.equal(run(middleware, { url: '/login.html?x=1' }).redirected.location, 'https://192.168.1.50:3443/login.html?x=1');
    for (const url of ['/api/pos/pedido', '/healthz', '/ca.crt', '/tls-info', '/instalar-certificado', '/instalar-certificado.html'])
        assert.equal(run(middleware, { url }).nexted, true, url);
    assert.equal(run(middleware, { method: 'POST' }).nexted, true);
    assert.equal(run(middleware, { secure: true }).nexted, true);
    assert.equal(run(middleware, { host: 'evil.com/<x>' }).nexted, true);
    const off = localTls.redirectMiddleware(localTls.tlsConfig({ HTTPS_ENABLED: 'true' }));
    assert.equal(run(off).nexted, true);
});

test('argumentos del generador rechazan IP, nombres y vigencias inválidas', () => {
    assert.throws(() => certs.parseArgs([]), /IP fija/);
    assert.throws(() => certs.parseArgs(['--ip', '999.1.1.1']), /IP no válida/);
    assert.throws(() => certs.parseArgs(['--ip', '10.0.0.1', '--dns', 'bad_name']), /Nombre no válido/);
    assert.throws(() => certs.parseArgs(['--ip', '10.0.0.1', '--days', '2000']), /825/);
    assert.deepEqual(certs.parseArgs(['--ip=10.0.0.1,10.0.0.2']).ips, ['10.0.0.1', '10.0.0.2']);
});

test('genera CA y certificado del servidor, y reutiliza la CA al cambiar la IP', { skip: !hasOpenssl && 'openssl no disponible' }, () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sedim-certs-'));
    try {
        const first = certs.generate({ ips: ['192.168.1.50'], dns: [], out, days: 825 });
        assert.equal(first.createdCa, true);
        const ca = new crypto.X509Certificate(fs.readFileSync(path.join(out, 'ca.crt')));
        const server = new crypto.X509Certificate(fs.readFileSync(path.join(out, 'server.crt')));
        assert.equal(ca.ca, true); assert.equal(server.ca, false);
        assert.ok(server.verify(ca.publicKey)); assert.ok(server.checkIP('192.168.1.50'));
        assert.equal(fs.statSync(path.join(out, 'ca.key')).mode & 0o077, 0);
        const caBefore = fs.readFileSync(path.join(out, 'ca.crt'), 'utf8');
        const second = certs.generate({ ips: ['192.168.1.60'], dns: [], out, days: 825 });
        assert.equal(second.createdCa, false);
        assert.equal(fs.readFileSync(path.join(out, 'ca.crt'), 'utf8'), caBefore);
        const renewed = new crypto.X509Certificate(fs.readFileSync(path.join(out, 'server.crt')));
        assert.ok(renewed.checkIP('192.168.1.60')); assert.equal(renewed.checkIP('192.168.1.50'), undefined);
        assert.deepEqual(fs.readdirSync(out).sort(), ['ca.crt', 'ca.key', 'ca.srl', 'server.crt', 'server.key']);
        assert.equal(localTls.caFingerprint({ caFile: path.join(out, 'ca.crt') }), ca.fingerprint256);
    } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('un servidor HTTPS con los certificados generados atiende a un cliente que confía en la CA', { skip: !hasOpenssl && 'openssl no disponible' }, async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sedim-certs-'));
    const https = require('node:https');
    try {
        certs.generate({ ips: ['127.0.0.1'], dns: [], out, days: 30 });
        const credentials = localTls.loadCredentials(localTls.tlsConfig({ HTTPS_ENABLED: 'true', TLS_DIR: out }));
        const server = https.createServer(credentials, (req, res) => res.end('ok')).listen(0, '127.0.0.1');
        await new Promise(resolve => server.once('listening', resolve));
        const get = ca => new Promise((resolve, reject) => https.get({ host: '127.0.0.1', port: server.address().port, path: '/', ca }, res => {
            let body = ''; res.on('data', chunk => { body += chunk; }); res.on('end', () => resolve(body));
        }).on('error', reject));
        try {
            assert.equal(await get(fs.readFileSync(path.join(out, 'ca.crt'))), 'ok');
            await assert.rejects(get(undefined), /self[- ]signed|unable to get local issuer|certificate/i);
        } finally { server.close(); }
        assert.throws(() => localTls.loadCredentials(localTls.tlsConfig({ HTTPS_ENABLED: 'true', TLS_DIR: path.join(out, 'nada') })), /generar-certificado/);
    } finally { fs.rmSync(out, { recursive: true, force: true }); }
});
