/* POS server reachability and local work count. This never submits orders. */
const posConnectivity = (() => {
    const PROBE_INTERVAL_MS = 15000;
    const FRESH_MS = 30000;
    const TIMEOUT_MS = 5000;
    let state = 'checking', lastSuccessAt = 0, lastObservationAt = 0;
    let probePromise = null, pendingRefresh = null, refreshAgain = false, started = false;
    let onSessionVerified = null;

    function effectiveState() {
        if (navigator.onLine === false) return 'offline';
        if (state === 'connected' && Date.now() - lastSuccessAt > FRESH_MS) return 'checking';
        return state;
    }

    function render() {
        const current = effectiveState();
        const labels = {
            checking: 'Verificando conexión', connected: 'Conectado con el servidor',
            offline: 'Sin comunicación con el servidor', unavailable: 'Sin comunicación con el servidor',
            server: 'Servidor con problemas'
        };
        for (const element of document.querySelectorAll('[data-connectivity-indicator]')) {
            element.dataset.state = current;
            element.querySelector('.pos-connectivity-state').textContent = labels[current];
            element.title = current === 'connected'
                ? `Última respuesta del servidor: ${new Date(lastSuccessAt).toLocaleTimeString('es-PE')}`
                : current === 'offline' ? 'El dispositivo informa que no tiene red' : '';
        }
    }

    function observe(response, startedAt = Date.now()) {
        if (startedAt < lastObservationAt || navigator.onLine === false) return;
        if (response.status === 401) {
            lastObservationAt = startedAt;
            if (typeof redirectExpiredSession === 'function') redirectExpiredSession();
            return;
        }
        if (response.ok) {
            lastObservationAt = startedAt;
            lastSuccessAt = Date.now();
            state = 'connected';
        } else if (response.status >= 500) {
            lastObservationAt = startedAt;
            state = 'server';
        }
        render();
    }

    function failure(startedAt = Date.now()) {
        if (startedAt < lastObservationAt) return;
        lastObservationAt = startedAt;
        state = navigator.onLine === false ? 'offline' : 'unavailable';
        render();
    }

    function checking() { state = 'checking'; render(); }

    function check() {
        if (navigator.onLine === false) { failure(); return Promise.resolve(null); }
        if (probePromise) return probePromise;
        const startedAt = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
        probePromise = fetch('/api/session', { cache: 'no-store', signal: controller.signal })
            .then(async response => {
                observe(response, startedAt);
                if (!response.ok) return null;
                const session = await response.json();
                if (onSessionVerified) onSessionVerified(session);
                return session;
            })
            .catch(() => { failure(startedAt); return null; })
            .finally(() => { clearTimeout(timeout); probePromise = null; });
        return probePromise;
    }

    function refreshPending() {
        if (!offlineOrders.userName()) {
            document.querySelectorAll('.pos-connectivity-pending').forEach(node => {
                node.textContent = 'Pendientes: sesión sin verificar';
            });
            return Promise.resolve();
        }
        if (pendingRefresh) { refreshAgain = true; return pendingRefresh; }
        pendingRefresh = offlineOrders.list().then(drafts => {
            const pending = new Set(drafts.filter(d => d.dirty || d.send || d.pending)
                .map(d => `${d.empresa}:${d.mesa}`));
            const label = `Mesas pendientes: ${pending.size}`;
            document.querySelectorAll('.pos-connectivity-pending').forEach(node => { node.textContent = label; });
        }).catch(() => {
            document.querySelectorAll('.pos-connectivity-pending').forEach(node => {
                node.textContent = 'Pendientes: almacenamiento local no disponible';
            });
        }).finally(() => {
            pendingRefresh = null;
            if (refreshAgain) { refreshAgain = false; refreshPending(); }
        });
        return pendingRefresh;
    }

    function start(onVerified) {
        if (started) return;
        started = true;
        onSessionVerified = onVerified || null;
        render();
        refreshPending();
        window.addEventListener('offline-orders-changed', refreshPending);
        window.addEventListener('offline', () => { state = 'offline'; render(); });
        window.addEventListener('online', checking);
        window.addEventListener('focus', () => { checking(); refreshPending(); });
        window.addEventListener('pageshow', event => { if (event.persisted) { checking(); refreshPending(); } });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') { checking(); refreshPending(); }
        });
        setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            render();
            if (!probePromise && (effectiveState() !== 'connected' || Date.now() - lastSuccessAt >= PROBE_INTERVAL_MS)) check();
        }, PROBE_INTERVAL_MS);
    }

    return { start, check, observe, failure, checking, refreshPending };
})();
