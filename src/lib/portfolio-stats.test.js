import { describe, it, expect } from 'vitest'
import { getTotalUnrealizedPnlUsd, getWinRate, getPortfolioStats } from './portfolio-stats.js'

function buy(mint, qtySol, priceUsd) {
  return { mint, symbol: mint, side: 'buy', qtySol, priceUsd, timestamp: 0 }
}

function sell(mint, qtySol, priceUsd) {
  return { mint, symbol: mint, side: 'sell', qtySol, priceUsd, timestamp: 0 }
}

describe('getTotalUnrealizedPnlUsd', () => {
  it('is zero for a fresh install with no positions object at all', () => {
    expect(getTotalUnrealizedPnlUsd(undefined)).toBe(0)
    expect(getTotalUnrealizedPnlUsd({})).toBe(0)
  })

  // Deliberately not a fixture that cancels to zero, and deliberately not one whose
  // USD total equals its percentage total: A is +2.00 USD / +20%, B is -1.00 USD /
  // -10%, so summing pnlPct instead of pnlUsd gives +10, not +1.
  it('sums the USD PnL of every position, not the percentages', () => {
    const total = getTotalUnrealizedPnlUsd({
      A: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 12 },
      B: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 9 },
    })
    expect(total).toBeCloseTo(1, 10)
  })

  it('goes negative when losses outweigh gains', () => {
    const total = getTotalUnrealizedPnlUsd({
      A: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 11 },
      B: { qty: 2, avgEntryUsd: 10, lastPriceUsd: 8 },
    })
    expect(total).toBeCloseTo(-3, 10)
  })
})

describe('getWinRate', () => {
  it('is null when nothing has been closed yet', () => {
    expect(getWinRate(undefined)).toBeNull()
    expect(getWinRate([])).toBeNull()
    expect(getWinRate([buy('A', 1, 10)])).toBeNull() // open positions are not closed trades
  })

  it('counts the share of sells that realized a profit', () => {
    const history = [buy('A', 1, 10), sell('A', 1, 12), buy('B', 1, 10), sell('B', 1, 8)]
    expect(getWinRate(history)).toBe(0.5)
  })

  it('is 1 when every close is profitable and 0 when none is', () => {
    expect(getWinRate([buy('A', 1, 10), sell('A', 1, 12)])).toBe(1)
    expect(getWinRate([buy('A', 1, 10), sell('A', 1, 8)])).toBe(0)
  })

  it('does not count a flat close as a win', () => {
    expect(getWinRate([buy('A', 1, 10), sell('A', 1, 10)])).toBe(0)
  })

  // The whole reason for replaying the log: the sell price (16) is BELOW the most
  // recent buy price (20) but ABOVE the weighted-average entry (15), so this is a
  // win only if the replay merges the two buys the way the engine does.
  it('measures a sell against the weighted-average entry, not the last buy price', () => {
    const history = [buy('A', 1, 10), buy('A', 1, 20), sell('A', 2, 16)]
    expect(getWinRate(history)).toBe(1)
  })

  it('counts a partial close and the remainder separately', () => {
    const history = [buy('A', 2, 10), sell('A', 1, 12), sell('A', 1, 9)]
    expect(getWinRate(history)).toBe(0.5)
  })

  // The replay has to draw the position down, not just read it: 3 were bought and
  // 2 sold, so a stale 2-unit sell can no longer be covered and must be skipped
  // rather than booked as a second, losing close.
  it('draws a position down as it replays sells', () => {
    expect(getWinRate([buy('A', 3, 10), sell('A', 2, 12), sell('A', 2, 9)])).toBe(1)
  })

  it('skips a trade it cannot replay instead of discarding the whole stat', () => {
    // The opening buy for Z predates this (truncated) log, so its sell throws.
    const history = [sell('Z', 5, 10), buy('A', 1, 10), sell('A', 1, 12)]
    expect(getWinRate(history)).toBe(1)
  })
})

describe('getPortfolioStats', () => {
  it('reports balance, total PnL, and win rate together', () => {
    const stats = getPortfolioStats({
      balanceSol: 2.5,
      positions: { A: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 12 } },
      tradeHistory: [buy('B', 1, 10), sell('B', 1, 12), buy('C', 1, 10), sell('C', 1, 8)],
    })
    expect(stats).toEqual({ balanceSol: 2.5, totalPnlUsd: 2, winRate: 0.5 })
  })

  it('survives a fresh install where no key has ever been written', () => {
    expect(getPortfolioStats({})).toEqual({ balanceSol: 0, totalPnlUsd: 0, winRate: null })
    expect(getPortfolioStats(undefined)).toEqual({ balanceSol: 0, totalPnlUsd: 0, winRate: null })
  })
})
