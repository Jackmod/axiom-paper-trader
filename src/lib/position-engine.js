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

const CLOSE_EPSILON = 1e-9 // floats built up from several buys rarely land on an exact 0 remainder

export function applySell(positions, { mint, qtySol, priceUsd }) {
  if (qtySol <= 0) throw new Error(`qtySol must be positive, got ${qtySol}`)

  const existing = positions[mint]
  if (!existing || qtySol > existing.qty + CLOSE_EPSILON) {
    throw new Error(`Cannot sell ${qtySol} of ${mint}: only ${existing?.qty ?? 0} held`)
  }

  const realizedPnlUsd = (priceUsd - existing.avgEntryUsd) * qtySol
  const remainingQty = existing.qty - qtySol

  if (remainingQty <= CLOSE_EPSILON) {
    const { [mint]: _removed, ...rest } = positions
    return { positions: rest, realizedPnlUsd }
  }

  return {
    positions: {
      ...positions,
      [mint]: { ...existing, qty: remainingQty, lastPriceUsd: priceUsd, lastPriceUpdatedAt: Date.now(), stale: false },
    },
    realizedPnlUsd,
  }
}

export function getUnrealizedPnl(position) {
  const pnlUsd = (position.lastPriceUsd - position.avgEntryUsd) * position.qty
  const pnlPct = ((position.lastPriceUsd - position.avgEntryUsd) / position.avgEntryUsd) * 100
  return { pnlUsd, pnlPct }
}
