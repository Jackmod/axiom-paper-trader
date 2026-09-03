// Position accounting.
//
// THE UNITS MATTER, and an earlier version got them wrong in a way that made every
// number on screen meaningless: it stored `qty` as the number of SOL *spent* while
// storing `avgEntryUsd` as USD *per token*, then computed PnL as
// (USD/token − USD/token) × SOL. That is dimensionally incoherent, and it is why a small
// position could report a loss of −21 SOL and −95%.
//
// The model now:
//   qty          tokens held
//   avgEntryUsd  USD per token, quantity-weighted across buys
//   solInvested  SOL actually spent on the tokens still held
//
// Keeping `solInvested` alongside the USD figures is what makes SOL-denominated PnL
// exact: it is measured against what the user really paid, so it never depends on
// reconstructing a historical SOL/USD rate.

const CLOSE_EPSILON = 1e-9 // floats built from several buys rarely land on an exact zero

/** Tokens received for `solSpent` SOL at `priceUsd` per token, given the SOL/USD rate. */
export function tokensFor({ solSpent, priceUsd, solUsdPrice }) {
  if (!(solSpent > 0)) throw new Error(`solSpent must be positive, got ${solSpent}`)
  if (!(priceUsd > 0)) throw new Error(`priceUsd must be positive, got ${priceUsd}`)
  if (!(solUsdPrice > 0)) throw new Error(`solUsdPrice must be positive, got ${solUsdPrice}`)
  return (solSpent * solUsdPrice) / priceUsd
}

export function applyBuy(positions, { mint, symbol, name, imageUrl, solSpent, priceUsd, solUsdPrice }) {
  const boughtTokens = tokensFor({ solSpent, priceUsd, solUsdPrice })
  const existing = positions[mint]

  if (!existing) {
    return {
      ...positions,
      [mint]: {
        symbol: symbol ?? '',
        name: name ?? '',
        imageUrl: imageUrl ?? '',
        qty: boughtTokens,
        avgEntryUsd: priceUsd,
        solInvested: solSpent,
        lastPriceUsd: priceUsd,
        lastPriceUpdatedAt: Date.now(),
        priceSource: null,
        stale: false,
      },
    }
  }

  const qty = existing.qty + boughtTokens
  // Weighted by TOKENS, which is what makes this an average entry price rather than an
  // average of two unrelated numbers. Buying the same mint again always merges here —
  // never a second row, which is the defect this whole product exists to fix.
  const avgEntryUsd = (existing.qty * existing.avgEntryUsd + boughtTokens * priceUsd) / qty

  return {
    ...positions,
    [mint]: {
      ...existing,
      qty,
      avgEntryUsd,
      solInvested: existing.solInvested + solSpent,
      lastPriceUsd: priceUsd,
      lastPriceUpdatedAt: Date.now(),
      stale: false,
    },
  }
}

/**
 * Sell a fraction of a position (0 < fraction <= 1) at `priceUsd` per token.
 * Returns the updated positions plus what the sale realised, in both currencies.
 */
export function applySell(positions, { mint, fraction, priceUsd, solUsdPrice }) {
  if (!(fraction > 0) || fraction > 1 + CLOSE_EPSILON) {
    throw new Error(`fraction must be within (0, 1], got ${fraction}`)
  }
  if (!(priceUsd > 0)) throw new Error(`priceUsd must be positive, got ${priceUsd}`)
  if (!(solUsdPrice > 0)) throw new Error(`solUsdPrice must be positive, got ${solUsdPrice}`)

  const existing = positions[mint]
  if (!existing) throw new Error(`No open position for ${mint}`)

  const soldTokens = existing.qty * fraction
  const proceedsUsd = soldTokens * priceUsd
  const proceedsSol = proceedsUsd / solUsdPrice

  // Cost basis of the slice being sold, in the currency the user actually spent.
  const costSol = existing.solInvested * fraction
  const realizedPnlSol = proceedsSol - costSol
  const realizedPnlUsd = (priceUsd - existing.avgEntryUsd) * soldTokens

  const remainingQty = existing.qty - soldTokens
  if (remainingQty <= CLOSE_EPSILON) {
    const { [mint]: _closed, ...rest } = positions
    return { positions: rest, proceedsSol, realizedPnlSol, realizedPnlUsd, soldTokens }
  }

  return {
    positions: {
      ...positions,
      [mint]: {
        ...existing,
        qty: remainingQty,
        // Average entry is unchanged for what remains — selling part of a position does
        // not change what the rest cost.
        solInvested: existing.solInvested - costSol,
        lastPriceUsd: priceUsd,
        lastPriceUpdatedAt: Date.now(),
        stale: false,
      },
    },
    proceedsSol,
    realizedPnlSol,
    realizedPnlUsd,
    soldTokens,
  }
}

/**
 * Unrealised PnL. The SOL figure is measured against what was actually paid, so it is
 * exact rather than a reconstruction; `solUsdPrice` is only needed to value the holding
 * today. Percent is the same in either currency.
 */
export function getUnrealizedPnl(position, solUsdPrice) {
  const pnlUsd = (position.lastPriceUsd - position.avgEntryUsd) * position.qty
  const pnlPct = position.avgEntryUsd > 0 ? ((position.lastPriceUsd - position.avgEntryUsd) / position.avgEntryUsd) * 100 : 0

  const valueUsd = position.qty * position.lastPriceUsd
  const valueSol = solUsdPrice > 0 ? valueUsd / solUsdPrice : null
  const pnlSol = valueSol === null ? null : valueSol - position.solInvested

  return { pnlUsd, pnlPct, pnlSol, valueUsd, valueSol }
}
