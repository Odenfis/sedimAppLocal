/* Persistent POS drafts. No service worker is required on the HTTP LAN. */
const offlineOrders = (() => {
    let user = null, syncPromise = null;
    const database = new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('Almacenamiento local no disponible'));
        const request = indexedDB.open('sedim-offline-orders', 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            db.createObjectStore('drafts', { keyPath: 'key' });
            db.createObjectStore('prepared', { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
    database.catch(() => {});
    function store(name, mode, callback) {
        return database.then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(name, mode), request = callback(tx.objectStore(name));
            tx.oncomplete = () => resolve(request.result);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        }));
    }
    const key = (empresa, mesa) => `${user}:${Number(empresa)}:${Number(mesa)}`;
    const prepKey = empresa => `${user}:${Number(empresa)}`;
    async function get(empresa, mesa) { return user ? store('drafts', 'readonly', s => s.get(key(empresa, mesa))) : null; }
    async function put(draft) { if (!user) throw new Error('Sesión no identificada'); draft.key = key(draft.empresa, draft.mesa); await store('drafts', 'readwrite', s => s.put(draft)); window.dispatchEvent(new Event('offline-orders-changed')); return draft; }
    async function remove(empresa, mesa) { if (user) { await store('drafts', 'readwrite', s => s.delete(key(empresa, mesa))); window.dispatchEvent(new Event('offline-orders-changed')); } }
    async function list() { return user ? (await store('drafts', 'readonly', s => s.getAll())).filter(d => d.key.startsWith(`${user}:`)) : []; }
    async function prepared(empresa) { return user ? store('prepared', 'readonly', s => s.get(prepKey(empresa))) : null; }
    async function prepare(empresa, tables) {
        if (!user || !navigator.onLine || !tables?.length) return;
        const request = async path => { const response = await fetch(path, { cache: 'no-store' }); if (!response.ok) throw new Error('Preparación incompleta'); return response.json(); };
        const [products, categories, normal, marketplace, special] = await Promise.all([
            request(`/api/pos/products?empresa=${empresa}`), request(`/api/pos/categories?empresa=${empresa}`),
            request(`/api/pos/mozos?empresa=${empresa}&mesa=1`), request(`/api/pos/mozos?empresa=${empresa}&mesa=220`),
            request(`/api/pos/mozos?empresa=${empresa}&mesa=231`)
        ]);
        await store('prepared', 'readwrite', s => s.put({ key: prepKey(empresa), empresa: Number(empresa),
            at: Date.now(), tables, products, categories, mozos: { normal, marketplace, special } }));
        return prepared(empresa);
    }
    function mozos(data, empresa, mesa) { return Number(mesa) >= 231 && Number(mesa) <= 235 ? data.mozos.special
        : Number(empresa) === 2 && Number(mesa) >= 220 && Number(mesa) <= 230 ? data.mozos.marketplace : data.mozos.normal; }
    function setUser(value) { user = value ? String(value) : null; window.dispatchEvent(new Event('offline-orders-changed')); }
    function userName() { return user; }
    function syncing() { return syncPromise; }
    function setSyncing(value) { syncPromise = value; }
    return { setUser, userName, get, put, remove, list, prepared, prepare, mozos, syncing, setSyncing };
})();
