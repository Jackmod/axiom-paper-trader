import { getUnrealizedPnl } from './position-engine.js'

// Portfolio-level figures for the Side Panel header and the popup (spec §11).
//
// These are SOL-first, because SOL is the currency the user funds the account in and
// thinks in. USD is carried alongside for the price-denominated views.

export function getTotalUnrealizedPnlUsd(positions) {
  return Object.values(positions ?? {}).reduce((sum, p) => sum + getUnrealizedPnl(p).pnlUsd, 0)
}

/**
 * Unrealised PnL across all open positions, in SOL — what the holdings are worth today
 * minus what was actually paid for them. Null when no SOL/USD rate is known yet, because
 * a made-up rate would be worse than an honest "—".
 */
export function getTotalUnrealizedPnlSol(positions, solUsdPrice) {
  if (!(solUsdPrice > 0)) return null
  return Object.values(positions ?? {}).reduce((sum, p) => sum + (getUnrealizedPnl(p, solUsdPrice).pnlSol ?? 0), 0)
}

export function getTotalPositionValueSol(positions, solUsdPrice) {
  if (!(solUsdPrice > 0)) return 0
  return Object.values(positions ?? {}).reduce((sum, p) => sum + (getUnrealizedPnl(p, solUsdPrice).valueSol ?? 0), 0)
}

/**
 * Win rate (spec §11): the share of closed slices that realised a profit.
 *
 * Each sell now records its own `realizedPnlSol` at the moment it happened, computed
 * against the cost basis the position actually had. An earlier version replayed the
 * whole trade log through the engine to reconstruct this; reading the recorded figure is
 * both simpler and more accurate, since it cannot drift from what the user was told at
 * the time. A flat close is not a win.
 */
export function getWinRate(tradeHistory) {
  const sells = (tradeHistory ?? []).filter((t) => t.side === 'sell' && Number.isFinite(t.realizedPnlSol))
  if (sells.length === 0) return null
  return sells.filter((t) => t.realizedPnlSol > 0).length / sells.length
}

export function getRealizedPnlSol(tradeHistory) {
  return (tradeHistory ?? [])
    .filter((t) => t.side === 'sell' && Number.isFinite(t.realizedPnlSol))
    .reduce((sum, t) => sum + t.realizedPnlSol, 0)
}

export function getPortfolioStats(state) {
  const positions = state?.positions ?? {}
  const solUsdPrice = state?.solUsdPrice ?? 0

  return {
    balanceSol: state?.balanceSol ?? 0,
    positionValueSol: getTotalPositionValueSol(positions, solUsdPrice),
    unrealizedPnlSol: getTotalUnrealizedPnlSol(positions, solUsdPrice),
    realizedPnlSol: getRealizedPnlSol(state?.tradeHistory),
    totalPnlUsd: getTotalUnrealizedPnlUsd(positions),
    winRate: getWinRate(state?.tradeHistory),
    openPositions: Object.keys(positions).length,
  }
}
