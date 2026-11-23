#!/usr/bin/env node
'use strict';
// Fase 81: genera (o reutiliza) la CA local y emite el certificado HTTPS del servidor para su IP de la LAN.
// Uso: node scripts/generate-local-certs.js --ip 192.168.1.50 [--ip otra] [--dns nombre] [--out certs] [--days 825]
// La CA se reutiliza si ya existe: renovar el certificado o cambiar la IP no obliga a reinstalarla en las tablets.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const DNS = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

function parseArgs(argv) {
    const options = { ips: [], dns: [], out: path.join(__dirname, '..', 'certs'), days: 825 };
    for (let i = 0; i < argv.length; i++) {
        const [flag, inline] = argv[i].split('=');
        const value = inline ?? argv[++i];
        if (flag === '--ip') options.ips.push(...String(value || '').split(',').map(v => v.trim()).filter(Boolean));
        else if (flag === '--dns') options.dns.push(...String(value || '').split(',').map(v => v.trim()).filter(Boolean));
        else if (flag === '--out') options.out = path.resolve(value);
        else if (flag === '--days') options.days = Number(value);
        else throw new Error(`Opción desconocida: ${flag}`);
    }
    if (!options.ips.length) throw new Error('Indique la IP fija del servidor: --ip 192.168.1.50');
    const badIp = options.ips.find(ip => !IPV4.test(ip));
    if (badIp) throw new Error(`IP no válida: ${badIp}`);
    const badDns = options.dns.find(name => !DNS.test(name));
    if (badDns) throw new Error(`Nombre no válido: ${badDns}`);
    if (!Number.isInteger(options.days) || options.days < 1 || options.days > 825) throw new Error('--days debe estar entre 1 y 825');
    return options;
}

function openssl(args, cwd) { return execFileSync('openssl', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString(); }

function generate(options) {
    try { openssl(['version']); } catch { throw new Error('No se encontró openssl. En el servidor ejecute generar-certificado.bat (usa el contenedor).'); }
    const out = options.out;
    fs.mkdirSync(out, { recursive: true });
    const file = name => path.join(out, name);
    let createdCa = false;
    if (!fs.existsSync(file('ca.key')) || !fs.existsSync(file('ca.crt'))) {
        const label = `SedimApp CA local ${os.hostname().slice(0, 20)} ${new Date().toISOString().slice(0, 10)}`;
        openssl(['req', '-x509', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650',
            '-keyout', 'ca.key', '-out', 'ca.crt', '-subj', `/O=SedimApp/CN=${label}`,
            '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
            '-addext', 'keyUsage=critical,keyCertSign,cRLSign'], out);
        fs.chmodSync(file('ca.key'), 0o600);
        createdCa = true;
    }
    const names = [...options.ips.map(ip => `IP:${ip}`), 'IP:127.0.0.1', 'DNS:localhost', ...options.dns.map(name => `DNS:${name}`)];
    fs.writeFileSync(file('server.ext'), ['basicConstraints=CA:FALSE', 'keyUsage=critical,digitalSignature,keyEncipherment',
        'extendedKeyUsage=serverAuth', `subjectAltName=${[...new Set(names)].join(',')}`].join('\n'));
    try {
        openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'server.key.tmp', '-out', 'server.csr',
            '-subj', `/O=SedimApp/CN=${options.ips[0]}`], out);
        openssl(['x509', '-req', '-in', 'server.csr', '-CA', 'ca.crt', '-CAkey', 'ca.key', '-CAcreateserial',
            '-out', 'server.crt.tmp', '-days', String(options.days), '-sha256', '-extfile', 'server.ext'], out);
        openssl(['verify', '-CAfile', 'ca.crt', 'server.crt.tmp'], out);
        fs.renameSync(file('server.key.tmp'), file('server.key'));
        fs.renameSync(file('server.crt.tmp'), file('server.crt'));
        fs.chmodSync(file('server.key'), 0o600);
    } finally {
        for (const name of ['server.csr', 'server.ext', 'server.key.tmp', 'server.crt.tmp']) fs.rmSync(file(name), { force: true });
    }
    const fingerprint = openssl(['x509', '-in', 'ca.crt', '-noout', '-fingerprint', '-sha256'], out).trim().split('=').pop();
    return { out, createdCa, names, fingerprint };
}

if (require.main === module) {
    try {
        const result = generate(parseArgs(process.argv.slice(2)));
        console.log(result.createdCa ? '[OK] CA local creada.' : '[OK] CA local existente reutilizada (no hace falta reinstalarla en las tablets).');
        console.log(`[OK] Certificado del servidor emitido para: ${result.names.join(', ')}`);
        console.log(`Huella SHA-256 de la CA: ${result.fingerprint}`);
        console.log(`Archivos en ${result.out}. Nunca comparta ca.key ni server.key; a las tablets solo se entrega ca.crt.`);
    } catch (error) {
        console.error(`[ERROR] ${error.message}`);
        process.exitCode = 1;
    }
}

module.exports = { parseArgs, generate };
