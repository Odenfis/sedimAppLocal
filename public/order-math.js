/* Allocate commercial cents across note variants without changing the product total. */
(function(root) {
    function amounts(items, taxPercent) {
        const result = items.map(() => 0), groups = new Map();
        items.forEach((l, index) => {
            const price = Number(l.precioBase ?? l.precio), affected = l.afecto === 1 || l.afecto === true;
            const key = `${l.codPro}:${price}:${affected}`;
            if (!groups.has(key)) groups.set(key, { unitCents: Math.round((price * (affected ? 1 + taxPercent / 100 : 1) + Number.EPSILON) * 100), entries: [] });
            groups.get(key).entries.push({ index, quantity: Number(l.cantidad) });
        });
        for (const group of groups.values()) {
            const target = Math.round(group.unitCents * group.entries.reduce((sum, e) => sum + e.quantity, 0));
            const parts = group.entries.map(e => ({ ...e, cents: Math.floor(group.unitCents * e.quantity), fraction: group.unitCents * e.quantity % 1 }));
            let remaining = target - parts.reduce((sum, p) => sum + p.cents, 0);
            const sorted = [...parts].sort((a,b) => b.fraction - a.fraction || a.index - b.index);
            for (const p of sorted) if (remaining-- > 0) p.cents++;
            for (const p of parts) result[p.index] = p.cents / 100;
        }
        return result;
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { amounts };
    else root.orderAmounts = amounts;
})(typeof globalThis !== 'undefined' ? globalThis : this);
