'use strict';

class KitchenSnapshotStore {
    constructor({ ttlMs = 2000, now = () => Date.now(), logger = () => {}, classifyError = () => ({ retryable: false, kind: 'unexpected' }) } = {}) {
        this.ttlMs = ttlMs;
        this.now = now;
        this.logger = logger;
        this.classifyError = classifyError;
        this.entries = new Map();
    }

    entry(company) {
        if (!this.entries.has(company)) {
            this.entries.set(company, { generation: 0, freshGeneration: -1, payload: null, updatedAt: 0, flights: new Map() });
        }
        return this.entries.get(company);
    }

    response(payload, updatedAt, { stale = false, diagnosticId = null } = {}) {
        return {
            ...payload,
            sincronizacion: {
                desactualizado: stale,
                actualizadaEn: new Date(updatedAt).toISOString(),
                ...(stale && diagnosticId ? { diagnosticId } : {})
            }
        };
    }

    metric(company, source, entry, diagnosticId, extra = {}) {
        this.logger({
            type: 'kitchen_snapshot',
            company,
            source,
            generation: entry.generation,
            ageMs: entry.updatedAt ? Math.max(0, this.now() - entry.updatedAt) : null,
            ...(diagnosticId ? { requestId: diagnosticId } : {}),
            ...extra
        }, source === 'stale' ? 'warn' : 'log');
    }

    invalidate(company) {
        const entry = this.entry(Number(company));
        entry.generation++;
        entry.freshGeneration = -1;
        this.metric(Number(company), 'invalidated', entry, null);
    }

    async read(company, loader, diagnosticId = null) {
        company = Number(company);
        const entry = this.entry(company);

        for (;;) {
            const now = this.now();
            if (entry.payload && entry.freshGeneration === entry.generation && now - entry.updatedAt <= this.ttlMs) {
                this.metric(company, 'cache', entry, diagnosticId);
                return this.response(entry.payload, entry.updatedAt);
            }

            const generation = entry.generation;
            let flight = entry.flights.get(generation);
            const shared = Boolean(flight);
            if (!flight) {
                flight = Promise.resolve().then(loader).then(payload => {
                    const updatedAt = this.now();
                    if (entry.generation === generation) {
                        entry.payload = payload;
                        entry.updatedAt = updatedAt;
                        entry.freshGeneration = generation;
                    }
                    return { payload, updatedAt };
                }).finally(() => {
                    if (entry.flights.get(generation) === flight) entry.flights.delete(generation);
                });
                entry.flights.set(generation, flight);
            }

            try {
                const loaded = await flight;
                // Una escritura confirmó datos nuevos mientras esta lectura estaba en curso.
                // La respuesta antigua no se publica ni se almacena como vigente.
                if (entry.generation !== generation) continue;
                this.metric(company, shared ? 'shared' : 'sql', entry, diagnosticId);
                return this.response(loaded.payload, loaded.updatedAt);
            } catch (error) {
                const classification = this.classifyError(error);
                if (!classification.retryable || !entry.payload) throw error;
                this.metric(company, 'stale', entry, diagnosticId, { classification: classification.kind });
                return this.response(entry.payload, entry.updatedAt, { stale: true, diagnosticId });
            }
        }
    }
}

module.exports = KitchenSnapshotStore;
