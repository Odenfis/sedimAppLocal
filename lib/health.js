'use strict';

function createHealthHandler({ getConnection, assertOperationalSchema, logger = console.error, safeError = error => ({ message: error?.message }) }) {
    return async function healthHandler(req, res) {
        try {
            const pool = await getConnection();
            await assertOperationalSchema(pool);
            res.json({ status: 'ok' });
        } catch (error) {
            logger(JSON.stringify({ type: 'healthcheck_error', code: error.code || null, error: safeError(error) }));
            res.status(503).json({ status: 'unavailable' });
        }
    };
}

module.exports = { createHealthHandler };
