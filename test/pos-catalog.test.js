'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPOSCategoriesQuery, buildPOSProductsQuery } = require('../server');

test('el catálogo POS conserva únicamente productos activos Tipo 3', () => {
    const query = buildPOSProductsQuery({ empresa: '02' });
    assert.match(query, /P\.Eliminado\s*=\s*0\s+AND\s+P\.Tipo\s*=\s*3/i);
    assert.match(query, /P\.CodPro\s+LIKE\s+@empresa/i);
    assert.match(query, /ORDER BY P\.Nombre ASC/i);
});

test('el filtro por línea se aplica sobre el catálogo Tipo 3', () => {
    const query = buildPOSProductsQuery({ empresa: '02', linea: 'Platos' });
    assert.match(query, /P\.Tipo\s*=\s*3/i);
    assert.match(query, /L\.Descripcion\s*=\s*@linea/i);
});

test('las categorías proceden solamente de productos activos Tipo 3 de la empresa', () => {
    const query = buildPOSCategoriesQuery({ empresa: '02' });
    assert.match(query, /P\.Eliminado\s*=\s*0\s+AND\s+P\.Tipo\s*=\s*3/i);
    assert.match(query, /P\.CodPro\s+LIKE\s+@empresa/i);
});
