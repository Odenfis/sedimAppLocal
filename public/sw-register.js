/* Fase 82: el service worker solo existe en contexto seguro (HTTPS o localhost). En HTTP no se registra. */
(() => {
    if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(error => console.warn('Service worker no registrado:', error.message));
    });
})();
