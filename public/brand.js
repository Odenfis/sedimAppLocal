// Fase 76: identidad visual por empresa. Solo presentación: no envía datos al servidor,
// no toca la sesión ni los selectores de empresa de Mesas/Cocina.
// Para agregar la identidad de otra empresa: completar su entrada en BRANDS,
// agregar su carpeta en /brands/<slug>/ y un bloque [data-brand="NN"] en style.css.
(function () {
    'use strict';

    var STORAGE_KEY = 'brand';
    var DEFAULT_BRAND = '02';

    // Identidad heredada (Sedimcorp) usada por las empresas que aún no tienen la suya.
    var LEGACY = { logo: '/logo_croma.png', mark: '/logo_croma.png', themeColor: '#30446d' };

    var BRANDS = Object.freeze({
        '02': Object.freeze({ code: '02', name: 'La Cocinería', option: 'Cocineria', logo: '/brands/cocineria/logo.png', mark: '/brands/cocineria/mark.png', themeColor: '#11554a' }),
        '04': Object.freeze({ code: '04', name: 'Mar Picante 1', option: 'Mar Picante 1', logo: LEGACY.logo, mark: LEGACY.mark, themeColor: LEGACY.themeColor }),
        '06': Object.freeze({ code: '06', name: 'Inversiones Abruzzo', option: 'Inversiones Abruzzo SAC', logo: LEGACY.logo, mark: LEGACY.mark, themeColor: LEGACY.themeColor })
    });

    function normalize(code) {
        var value = String(code == null ? '' : code).trim();
        if (/^\d$/.test(value)) value = '0' + value;
        return Object.prototype.hasOwnProperty.call(BRANDS, value) ? value : DEFAULT_BRAND;
    }

    function readStored() {
        try { return window.localStorage.getItem(STORAGE_KEY); } catch (error) { return null; }
    }

    function get() {
        return BRANDS[normalize(readStored())];
    }

    function apply(code) {
        var brand = BRANDS[normalize(code == null ? readStored() : code)];
        var root = document.documentElement;
        root.setAttribute('data-brand', brand.code);

        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', brand.themeColor);
        var appTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
        if (appTitle) appTitle.setAttribute('content', brand.name);

        var page = root.getAttribute('data-page-title');
        document.title = page ? page + ' · ' + brand.name : brand.name;

        document.querySelectorAll('img[data-brand-logo]').forEach(function (img) {
            if (img.getAttribute('src') !== brand.logo) img.setAttribute('src', brand.logo);
            img.setAttribute('alt', 'Logotipo de ' + brand.name);
        });
        document.querySelectorAll('img[data-brand-mark]').forEach(function (img) {
            if (img.getAttribute('src') !== brand.mark) img.setAttribute('src', brand.mark);
        });
        document.querySelectorAll('[data-brand-name]').forEach(function (el) {
            el.textContent = brand.name;
        });
        document.querySelectorAll('select[data-brand-select]').forEach(function (select) {
            select.value = brand.code;
        });
        return brand;
    }

    function set(code) {
        var value = normalize(code);
        try { window.localStorage.setItem(STORAGE_KEY, value); } catch (error) { /* preferencia solo en memoria */ }
        return apply(value);
    }

    window.SedimBrand = Object.freeze({ BRANDS: BRANDS, DEFAULT_BRAND: DEFAULT_BRAND, get: get, set: set, apply: apply, normalize: normalize });

    // Aplicar el atributo de inmediato (evita parpadeo de colores) y completar al tener el DOM.
    var initial = normalize(readStored());
    apply(initial);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { apply(initial); });
    }
})();
