/* Fase 82: la app abre sin red. Solo guarda la interfaz; los pedidos nunca pasan por esta caché.
   - Páginas: red primero (máx. 4 s) y copia guardada si el servidor no responde.
   - Archivos versionados (?v=) y /vendor: caché primero; el resto: copia guardada mientras se actualiza.
   - /api, certificado y estado: siempre red, sin intervenir. */
const SHELL_CACHE = 'sedim-shell-v1';
const PAGES = ['/dashboard.html', '/login.html'];
const NAVIGATION_TIMEOUT_MS = 4000;
const BYPASS = /^\/(?:api\/|healthz$|tls-info$|ca\.crt$|instalar-certificado(?:\.html)?$|sw\.js$)/;

function assetReferences(text, base) {
    const urls = new Set();
    for (const match of text.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) urls.add(new URL(match[1], base).href);
    for (const match of text.matchAll(/url\(\s*['"]?([^'")]+\.woff2)(?:[?#][^'")]*)?['"]?\s*\)/g)) urls.add(new URL(match[1], base).href);
    return [...urls].filter(url => new URL(url).origin === self.location.origin && !BYPASS.test(new URL(url).pathname)
        && !PAGES.includes(new URL(url).pathname) && new URL(url).pathname !== '/');
}

async function storeAssets(cache, urls) {
    for (const url of urls) {
        if (await cache.match(url)) continue;
        try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (!response.ok) continue;
            await cache.put(url, response.clone());
            if (/\.css(?:$|\?)/.test(new URL(url).pathname + new URL(url).search)) await storeAssets(cache, assetReferences(await response.text(), url));
        } catch { /* se reintenta en la próxima carga con red */ }
    }
}

// Guarda lo que referencia la página nueva y elimina versiones anteriores de esos mismos archivos.
async function refreshShell(page, html) {
    const cache = await caches.open(SHELL_CACHE);
    const urls = assetReferences(html, new URL(page, self.location.origin).href);
    await storeAssets(cache, urls);
    const current = new Set(urls), currentPaths = new Set(urls.map(url => new URL(url).pathname));
    for (const request of await cache.keys()) {
        const url = new URL(request.url);
        if (url.search && currentPaths.has(url.pathname) && !current.has(url.href)) await cache.delete(request);
    }
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        for (const page of PAGES) {
            try {
                const response = await fetch(page, { cache: 'no-cache' });
                if (!response.ok || response.redirected) continue;
                await cache.put(page, response.clone());
                await refreshShell(page, await response.text());
            } catch { /* instalación parcial: se completa con la navegación */ }
        }
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        for (const name of await caches.keys()) if (name.startsWith('sedim-') && name !== SHELL_CACHE) await caches.delete(name);
        await self.clients.claim();
    })());
});

function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), ms);
        promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
}

async function navigation(event, url) {
    const cache = await caches.open(SHELL_CACHE);
    const network = fetch(event.request);
    try {
        const response = await withTimeout(network, NAVIGATION_TIMEOUT_MS);
        const finalPath = new URL(response.url || url.href).pathname;
        if (response.ok && PAGES.includes(finalPath)) {
            const copy = response.clone();
            event.waitUntil((async () => { await cache.put(finalPath, copy.clone()); await refreshShell(finalPath, await copy.text()); })());
        }
        return response;
    } catch {
        // '/' y cualquier otra ruta sin copia abren el panel: allí se usan los datos guardados del último usuario.
        const fallback = await cache.match(PAGES.includes(url.pathname) ? url.pathname : '/dashboard.html')
            || await cache.match('/dashboard.html');
        if (fallback) return fallback;
        return network; // sin copia: el navegador muestra su propio error
    }
}

async function asset(event, url) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(event.request);
    const versioned = url.search.includes('v=') || url.pathname.startsWith('/vendor/');
    if (cached && versioned) return cached;
    const update = fetch(event.request).then(response => {
        if (response.ok && response.type === 'basic') cache.put(event.request, response.clone());
        return response;
    });
    if (cached) { event.waitUntil(update.catch(() => {})); return cached; }
    return update;
}

self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (url.origin !== self.location.origin || BYPASS.test(url.pathname)) return;
    if (request.mode === 'navigate') { event.respondWith(navigation(event, url)); return; }
    if (request.headers.get('accept')?.includes('text/event-stream')) return;
    event.respondWith(asset(event, url));
});
