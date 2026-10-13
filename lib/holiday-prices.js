'use strict';
const { getConnection, sql } = require('../db');
const { normalizeCompany } = require('./company-context');
const { fail } = require('./order-domain');
const requestContext = require('./request-context');
async function query(db, source, values = {}) {
    const request = new sql.Request(db);
    for (const [key, value] of Object.entries(values)) request.input(key, value);
    return requestContext.measureSql(() => request.query(source));
}
async function readConfig(db, empresa, locked = false) {
    const company = normalizeCompany(empresa);
    const row = (await query(db, `SELECT Activo,Tarifa,Version,Usuario,Fecha FROM Precios_feriado_config ${locked ? 'WITH(HOLDLOCK)' : ''} WHERE Empresa=@empresa`, { empresa: company.empresa })).recordset[0];
    if (!row) fail('Configuración de precios no disponible. Revise las migraciones.', 503, 'HOLIDAY_CONFIG_UNAVAILABLE');
    return { empresa: company.codigo, activo: Boolean(row.Activo), tarifa: row.Tarifa, version: row.Version, usuario: row.Usuario, fecha: row.Fecha };
}
async function priceSchema(db) {
    const cols = ['Codpro', ...Array.from({ length: 6 }, (_, i) => `PreTema${i + 1}`)];
    const row = (await query(db, `SELECT CASE WHEN OBJECT_ID('dbo.Precios','U') IS NOT NULL AND ${cols.map(c => `COL_LENGTH('dbo.Precios','${c}') IS NOT NULL`).join(' AND ')} THEN 1 ELSE 0 END Disponible`)).recordset[0];
    return Boolean(row.Disponible);
}
function priceProjection(config, available) {
    // Tarifa is validated before interpolation; commercial columns are never supplied by callers.
    if (!Number.isInteger(config.tarifa) || config.tarifa < 1 || config.tarifa > 6) fail('Tarifa inválida');
    return available ? `R.PreTema${config.tarifa} PrecioTarifa` : 'CAST(NULL AS MONEY) PrecioTarifa';
}
function priceJoin(available) {
    return available ? 'LEFT JOIN Precios R ON R.Codpro COLLATE DATABASE_DEFAULT=P.CodPro COLLATE DATABASE_DEFAULT' : '';
}
function resolvePrice(product, config) {
    const special = config.activo && Number.isFinite(Number(product.PrecioTarifa)) && Number(product.PrecioTarifa) > 0;
    return { PrecioBaseEfectivo: Number(special ? product.PrecioTarifa : product.PventaMa),
        precioOrigen: { tipo: special ? 'feriado' : 'normal', tarifa: special ? config.tarifa : null }, precioVersion: config.version };
}
function preserveLinePrice(line, source) {
    line.precio = source.precio;
    if (source.precioOrigen) line.precioOrigen = source.precioOrigen;
    if (source.precioVersion !== undefined) line.precioVersion = source.precioVersion;
    delete line.precioDerivadaDe;
}
function assertPriceVersion(line, config) {
    // Legacy clients may create normal lines only before this company's first configuration change.
    if ((line.precioVersion ?? 0) !== config.version)
        fail('La tarifa cambió. Revise los precios de las líneas nuevas antes de reintentar.', 409, 'PRICE_CONFIG_CHANGED');
}
async function details(db, config, available = undefined) {
    available = available ?? await priceSchema(db);
    const rows = (await query(db, `SELECT RTRIM(P.CodPro) CodPro,RTRIM(P.Nombre) Nombre,${priceProjection(config, available)}
        FROM Productos P ${priceJoin(available)} WHERE P.Eliminado=0 AND P.Tipo=3 AND P.CodPro LIKE @empresa+'%' ORDER BY P.Nombre`, { empresa: config.empresa })).recordset;
    const normales = rows.filter(r => !(Number(r.PrecioTarifa) > 0)).map(({ CodPro, Nombre }) => ({ CodPro, Nombre }));
    return { ...config, disponible: available, cobertura: { total: rows.length, conTarifa: rows.length - normales.length, precioNormal: normales.length, productosPrecioNormal: normales } };
}
async function updateConfig(db, empresa, body, usuario) {
    normalizeCompany(empresa);
    if (typeof body?.activo !== 'boolean' || !Number.isInteger(body.tarifa) || body.tarifa < 1 || body.tarifa > 6
        || !Number.isInteger(body.version) || body.version < 0) fail('Configuración de precios inválida', 400, 'INVALID_PRICE_CONFIG');
    // Same row lock order as order saves. No order or commercial tables are written here.
    const company = normalizeCompany(empresa);
    const beforeRow = (await query(db, 'SELECT Activo,Tarifa,Version FROM Precios_feriado_config WITH(UPDLOCK,HOLDLOCK) WHERE Empresa=@empresa', { empresa: company.empresa })).recordset[0];
    if (!beforeRow) fail('Configuración de precios no disponible', 503, 'HOLIDAY_CONFIG_UNAVAILABLE');
    if (beforeRow.Version !== body.version) fail('La configuración cambió en otro dispositivo. Recargue y vuelva a intentarlo.', 409, 'PRICE_CONFIG_CONFLICT');
    const available = await priceSchema(db);
    if (body.activo && !available) fail('No está disponible la tabla Precios o alguna de sus columnas. No se puede activar Precios Feriado.', 409, 'HOLIDAY_PRICES_UNAVAILABLE');
    if (Boolean(beforeRow.Activo) !== body.activo || beforeRow.Tarifa !== body.tarifa) {
        await query(db, `UPDATE Precios_feriado_config SET Activo=@activo,Tarifa=@tarifa,Version=Version+1,Usuario=@usuario,Fecha=SYSUTCDATETIME() WHERE Empresa=@empresa;
            INSERT Precios_feriado_historial(Empresa,ActivoAnterior,TarifaAnterior,Activo,Tarifa,Version,Usuario)
            VALUES(@empresa,@anterior,@tarifaAnterior,@activo,@tarifa,@version,@usuario)`,
        { empresa: company.empresa, activo: body.activo, tarifa: body.tarifa, usuario, anterior: beforeRow.Activo, tarifaAnterior: beforeRow.Tarifa, version: body.version + 1 });
    }
    return details(db, await readConfig(db, empresa), available);
}
function install(app, auth, broadcast) {
    const route = (method, path, fn) => app[method](path, auth, async (req, res) => {
        let tx;
        try {
            const pool = await getConnection();
            if (method === 'put') { tx = new sql.Transaction(pool); await tx.begin(); }
            const result = await fn(tx || pool, req);
            if (tx) { await tx.commit(); broadcast({ type: 'precios_feriado_updated', empresa: Number(result.empresa), version: result.version }); }
            res.set?.('Cache-Control', 'no-store'); res.json(result);
        } catch (e) {
            if (tx) { try { await tx.rollback(); } catch {} }
            if (e.status) return res.status(e.status).json({ success: false, message: e.message, errorCode: e.errorCode });
            const { classification, body } = requestContext.errorPayload(res, e);
            console.error(JSON.stringify({ type: 'holiday_prices_error', error: requestContext.safeError(e) }));
            res.status(classification.status).json(body);
        }
    });
    route('get', '/api/configuraciones/precios-feriado', async (db, req) => details(db, await readConfig(db, req.query.empresa)));
    route('put', '/api/configuraciones/precios-feriado/:empresa', (db, req) => updateConfig(db, req.params.empresa, req.body, req.session.user.usuario));
}
module.exports = { install, readConfig, priceSchema, priceProjection, priceJoin, resolvePrice, preserveLinePrice, assertPriceVersion, details, updateConfig };
