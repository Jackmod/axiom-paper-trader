import { applyBuy, applySell, getUnrealizedPnl } from './position-engine.js'

// Total unrealized PnL across every open position, in USD.
export function getTotalUnrealizedPnlUsd(positions) {
  return Object.values(positions ?? {}).reduce((sum, p) => sum + getUnrealizedPnl(p).pnlUsd, 0)
}

// Win rate (spec §11) is the share of closed slices that realized a profit.
// `tradeHistory` (spec §12) stores no realized PnL, so the log is replayed through
// the same position engine the background uses: each sell's realizedPnlUsd falls
// out of the weighted-average entry the replay has built up to that point, which is
// the only way to get this right when one mint was bought at several prices.
// A flat close (exactly zero realized) is not a win.
export function getWinRate(tradeHistory) {
  let positions = {}
  let wins = 0
  let closed = 0

  for (const trade of tradeHistory ?? []) {
    try {
      if (trade.side === 'buy') {
        positions = applyBuy(positions, {
          mint: trade.mint,
          symbol: trade.symbol,
          name: trade.symbol,
          imageUrl: '',
          qtySol: trade.qtySol,
          priceUsd: trade.priceUsd,
        })
      } else if (trade.side === 'sell') {
        const result = applySell(positions, { mint: trade.mint, qtySol: trade.qtySol, priceUsd: trade.priceUsd })
        positions = result.positions
        closed += 1
        if (result.realizedPnlUsd > 0) wins += 1
      }
    } catch {
      // A trade that cannot be replayed (history truncated by an account reset, a
      // sell whose buy predates the log) is skipped rather than poisoning the stat.
    }
  }

  return closed === 0 ? null : wins / closed
}

// The Side Panel's portfolio-level stats header (spec §11): balance, total PnL,
// win rate. `winRate` is null when nothing has been closed yet — the caller
// renders a placeholder rather than a misleading 0%.
export function getPortfolioStats(state) {
  return {
    balanceSol: state?.balanceSol ?? 0,
    totalPnlUsd: getTotalUnrealizedPnlUsd(state?.positions),
    winRate: getWinRate(state?.tradeHistory),
  }
}
