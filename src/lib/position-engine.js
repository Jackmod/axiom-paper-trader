export function applyBuy(positions, { mint, symbol, name, imageUrl, qtySol, priceUsd }) {
  if (qtySol <= 0) throw new Error(`qtySol must be positive, got ${qtySol}`)
  if (priceUsd <= 0) throw new Error(`priceUsd must be positive, got ${priceUsd}`)

  const existing = positions[mint]
  if (!existing) {
    return {
      ...positions,
      [mint]: {
        symbol,
        name,
        imageUrl,
        qty: qtySol,
        avgEntryUsd: priceUsd,
        lastPriceUsd: priceUsd,
        lastPriceUpdatedAt: Date.now(),
        priceSource: null,
        stale: false,
      },
    }
  }

  const newQty = existing.qty + qtySol
  const avgEntryUsd = (existing.qty * existing.avgEntryUsd + qtySol * priceUsd) / newQty

  return {
    ...positions,
    [mint]: {
      ...existing,
      qty: newQty,
      avgEntryUsd,
      lastPriceUsd: priceUsd,
      lastPriceUpdatedAt: Date.now(),
      stale: false,
    },
  }
}
