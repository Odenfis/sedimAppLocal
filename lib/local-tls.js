'use strict';
// Fase 81: HTTPS opcional en la LAN con una CA local. HTTP sigue disponible durante la transición.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DIR = path.join(__dirname, '..', 'certs');
const PUBLIC_PATHS = /^\/(?:api\/|healthz$|ca\.crt$|tls-info$|instalar-certificado(?:\.html)?$)/;
const HOST = /^(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)$/i;

function enabled(value) { return String(value).toLowerCase() === 'true'; }

function tlsConfig(env = process.env) {
    const dir = env.TLS_DIR || DEFAULT_DIR;
    const caFile = env.TLS_CA_FILE || path.join(dir, 'ca.crt');
    if (!enabled(env.HTTPS_ENABLED)) return { enabled: false, caFile };
    const port = Number(env.HTTPS_PORT || 3443);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HTTPS_PORT debe ser un puerto entre 1 y 65535');
    if (String(port) === String(env.PORT || 3000)) throw new Error('HTTPS_PORT debe ser distinto de PORT');
    return {
        enabled: true, port, caFile, redirect: enabled(env.HTTPS_REDIRECT),
        certFile: env.TLS_CERT_FILE || path.join(dir, 'server.crt'),
        keyFile: env.TLS_KEY_FILE || path.join(dir, 'server.key')
    };
}

function loadCredentials(config) {
    const missing = [config.certFile, config.keyFile].filter(file => !fs.existsSync(file));
    if (missing.length) throw new Error(`Faltan archivos TLS: ${missing.join(', ')}. Genere los certificados con generar-certificado.bat`);
    return { cert: fs.readFileSync(config.certFile), key: fs.readFileSync(config.keyFile) };
}

function hostWithoutPort(header) {
    const value = String(header || '').trim();
    const host = value.startsWith('[') ? value.slice(0, value.indexOf(']') + 1) : value.replace(/:\d+$/, '');
    return HOST.test(host) ? host : null;
}

// Solo redirige navegación (GET/HEAD) de páginas: las API, el certificado y el estado siguen por HTTP
// para no romper pestañas abiertas ni la instalación de la CA.
function redirectMiddleware(config) {
    return (req, res, next) => {
        if (!config.enabled || !config.redirect || req.secure) return next();
        if (!['GET', 'HEAD'].includes(req.method) || PUBLIC_PATHS.test(req.path)) return next();
        const host = hostWithoutPort(req.headers.host);
        if (!host) return next();
        return res.redirect(302, `https://${host}:${config.port}${req.originalUrl}`);
    };
}

function caAvailable(config) { return Boolean(config.caFile && fs.existsSync(config.caFile)); }

function caFingerprint(config) {
    try { return caAvailable(config) ? new (require('node:crypto').X509Certificate)(fs.readFileSync(config.caFile)).fingerprint256 : null; }
    catch { return null; }
}

module.exports = { tlsConfig, loadCredentials, redirectMiddleware, hostWithoutPort, caAvailable, caFingerprint };
