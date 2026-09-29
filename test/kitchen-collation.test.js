'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('las tablas temporales de Cocina heredan la intercalación de la base sin fijar una regional', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'orders.js'), 'utf8');
    const start = source.indexOf('async function loadKitchenBoard');
    const end = source.indexOf('const [lineRows', start);
    const kitchenSql = source.slice(start, end);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    assert.equal((kitchenSql.match(/NroTicket VARCHAR\(20\) COLLATE DATABASE_DEFAULT/g) || []).length, 2);
    assert.match(kitchenSql, /Codpro CHAR\(10\) COLLATE DATABASE_DEFAULT NOT NULL/);
    assert.match(kitchenSql, /Operativa NVARCHAR\(MAX\) COLLATE DATABASE_DEFAULT NOT NULL/);
    assert.match(kitchenSql, /SELECT TOP 1 ce\.Id,ce\.Numero,ce\.Documento,ce\.Fecha,ce\.Cabecera/);
    assert.match(kitchenSql, /JSON_VALUE\(e\.Cabecera,'\$\.mesa'\)/);
    assert.doesNotMatch(kitchenSql, /Modern_Spanish|SQL_Latin1/i);
    assert.match(source, /JOIN Pedido_control pc ON pc\.NroTicket COLLATE DATABASE_DEFAULT=t\.NroTicket COLLATE DATABASE_DEFAULT/);
    assert.match(source, /LEFT JOIN Ticket_c t ON t\.NroTicket COLLATE DATABASE_DEFAULT=pc\.NroTicket COLLATE DATABASE_DEFAULT/);
});

test('el actualizador exige una comprobación funcional de Cocina antes de declarar éxito', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'actualizar.bat'), 'utf8');
    const verification = source.indexOf('npm run diagnose:kitchen -- --empresa=2');
    const success = source.indexOf(':success');
    assert.ok(verification > 0);
    assert.ok(success > verification);
    assert.match(source, /if errorlevel 1 goto :error_kitchen/i);
    assert.match(source, /:error_kitchen[\s\S]*type "!KITCHEN_LOG!"[\s\S]*logs --tail 80 app/i);
});
