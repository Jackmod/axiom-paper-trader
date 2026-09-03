import { describe, it, expect } from 'vitest'
import {
  getTotalUnrealizedPnlUsd,
  getTotalUnrealizedPnlSol,
  getTotalPositionValueSol,
  getWinRate,
  getRealizedPnlSol,
  getPortfolioStats,
} from './portfolio-stats.js'

// Fixtures use power-of-two prices (0.125 / 0.25 / 0.5) and a SOL/USD rate of 200 so
// every expected figure below is exact in binary floating point and can be checked with
// toBe/toEqual rather than a tolerance that could hide a real error.

let nextId = 0

function buyTrade(mint, { solAmount = 1, tokenAmount = 800, priceUsd = 0.25, solUsdPrice = 200 } = {}) {
  return {
    id: `t${nextId++}`,
    mint,
    symbol: mint,
    side: 'buy',
    solAmount,
    tokenAmount,
    priceUsd,
    solUsdPrice,
    priorityFeeSol: 0,
    slippagePct: 0,
    timestamp: 0,
  }
}

/**
 * A sell as the router records it: the realised PnL is stamped on the trade at the moment
 * it happened, so `realizedPnlSol` is the field under test, not the prices around it.
 */
function sellTrade(mint, realizedPnlSol, { fraction = 1, solAmount = 1, tokenAmount = 800, priceUsd = 0.25, solUsdPrice = 200 } = {}) {
  return {
    id: `t${nextId++}`,
    mint,
    symbol: mint,
    side: 'sell',
    solAmount,
    tokenAmount,
    fraction,
    priceUsd,
    solUsdPrice,
    realizedPnlSol,
    priorityFeeSol: 0,
    slippagePct: 0,
    timestamp: 0,
  }
}

// Two positions with deliberately different sign in each currency, so a sum that mixed up
// currencies or cost bases could not accidentally match.
//   A: 1000 tokens, entry $0.25 → now $0.50. +$250, worth 2.5 SOL against 1.25 SOL paid.
//   B:  800 tokens, entry $0.50 → now $0.25. −$200, worth 1.0 SOL against 2.00 SOL paid.
const POSITIONS = {
  A: { qty: 1000, avgEntryUsd: 0.25, solInvested: 1.25, lastPriceUsd: 0.5 },
  B: { qty: 800, avgEntryUsd: 0.5, solInvested: 2, lastPriceUsd: 0.25 },
}
const SOL_USD = 200

describe('getTotalUnrealizedPnlUsd', () => {
  it('is zero for a fresh install with no positions object at all', () => {
    expect(getTotalUnrealizedPnlUsd(undefined)).toBe(0)
    expect(getTotalUnrealizedPnlUsd({})).toBe(0)
  })

  // Deliberately not a fixture that cancels to zero, and deliberately not one whose
  // USD total equals its percentage total: A is +2.00 USD / +20%, B is -1.00 USD /
  // -10%, so summing pnlPct instead of pnlUsd gives +10, not +1. (qty is TOKENS held.)
  it('sums the USD PnL of every position, not the percentages', () => {
    const total = getTotalUnrealizedPnlUsd({
      A: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 12, solInvested: 0.05 },
      B: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 9, solInvested: 0.05 },
    })
    expect(total).toBeCloseTo(1, 10)
  })

  it('goes negative when losses outweigh gains', () => {
    const total = getTotalUnrealizedPnlUsd({
      A: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 11, solInvested: 0.05 },
      B: { qty: 2, avgEntryUsd: 10, lastPriceUsd: 8, solInvested: 0.1 },
    })
    expect(total).toBeCloseTo(-3, 10)
  })

  // USD PnL never needs the SOL/USD rate, so it must still be reported when no rate is
  // known — that is the whole reason it takes no rate argument.
  it('needs no SOL/USD rate to report a figure', () => {
    expect(getTotalUnrealizedPnlUsd(POSITIONS)).toBe(50)
  })
})

describe('getTotalUnrealizedPnlSol', () => {
  // A made-up rate would be worse than an honest "—", so the absence of a rate has to be
  // distinguishable from a genuine zero PnL.
  it('is null when no SOL/USD rate is known yet', () => {
    expect(getTotalUnrealizedPnlSol(POSITIONS, 0)).toBeNull()
    expect(getTotalUnrealizedPnlSol(POSITIONS, undefined)).toBeNull()
    expect(getTotalUnrealizedPnlSol(POSITIONS, -5)).toBeNull()
  })

  it('is zero, not null, when the rate is known but nothing is held', () => {
    expect(getTotalUnrealizedPnlSol(undefined, SOL_USD)).toBe(0)
    expect(getTotalUnrealizedPnlSol({}, SOL_USD)).toBe(0)
  })

  // A is +1.25 SOL (2.5 worth against 1.25 paid), B is −1.00 SOL (1.0 against 2.0):
  // +0.25 SOL in total, while the same book is +50 USD. A sum that returned the USD
  // figure, or that divided the USD total by the rate (+0.25 by coincidence would be
  // 0.25 — so B's cost basis is set to make those differ), cannot pass both this and
  // the case below.
  it('sums each position value in SOL against what was actually paid for it', () => {
    expect(getTotalUnrealizedPnlSol(POSITIONS, SOL_USD)).toBe(0.25)
  })

  // The point of storing solInvested: the position below is flat in USD (entry price ==
  // last price, so pnlUsd is 0) yet up 0.25 SOL, because the SOL paid for it was worth
  // twice as much then as it is now. Deriving SOL PnL from USD PnL would report 0.
  it('measures SOL PnL against solInvested, not against the USD PnL converted at today rate', () => {
    const boughtWhenSolWasExpensive = {
      C: { qty: 400, avgEntryUsd: 0.25, solInvested: 0.25, lastPriceUsd: 0.25 },
    }
    expect(getTotalUnrealizedPnlUsd(boughtWhenSolWasExpensive)).toBe(0)
    expect(getTotalUnrealizedPnlSol(boughtWhenSolWasExpensive, SOL_USD)).toBe(0.25)
  })
})

describe('getTotalPositionValueSol', () => {
  // Value is what the holdings would fetch today, so a missing rate means there is
  // nothing to add to the balance — zero, not null, because this figure is summed into
  // the header's total account value.
  it('is zero when no SOL/USD rate is known yet', () => {
    expect(getTotalPositionValueSol(POSITIONS, 0)).toBe(0)
    expect(getTotalPositionValueSol(POSITIONS, undefined)).toBe(0)
  })

  it('is zero for a fresh install with no positions object at all', () => {
    expect(getTotalPositionValueSol(undefined, SOL_USD)).toBe(0)
    expect(getTotalPositionValueSol({}, SOL_USD)).toBe(0)
  })

  // 2.5 SOL of A plus 1.0 SOL of B. This is market value, not cost: the same book cost
  // 3.25 SOL (1.25 + 2.00), so summing solInvested instead would give 3.25.
  it('sums todays market value of every holding, not what it cost', () => {
    expect(getTotalPositionValueSol(POSITIONS, SOL_USD)).toBe(3.5)
  })
})

describe('getWinRate', () => {
  it('is null when nothing has been closed yet', () => {
    expect(getWinRate(undefined)).toBeNull()
    expect(getWinRate([])).toBeNull()
    expect(getWinRate([buyTrade('A')])).toBeNull() // open positions are not closed trades
  })

  it('counts the share of sells that realized a profit', () => {
    const history = [buyTrade('A'), sellTrade('A', 0.5), buyTrade('B'), sellTrade('B', -0.25)]
    expect(getWinRate(history)).toBe(0.5)
  })

  it('is 1 when every close is profitable and 0 when none is', () => {
    expect(getWinRate([buyTrade('A'), sellTrade('A', 0.5)])).toBe(1)
    expect(getWinRate([buyTrade('A'), sellTrade('A', -0.5)])).toBe(0)
  })

  // Breaking even is not winning: it still counts in the denominator, so a single flat
  // close is 0%, not null and not 100%.
  it('does not count a flat close as a win', () => {
    expect(getWinRate([buyTrade('A'), sellTrade('A', 0)])).toBe(0)
  })

  // The recorded figure is the authority, not the prices lying around it. This sell went
  // out at $0.16 — BELOW the most recent buy at $0.20, but above the token-weighted
  // average entry of $0.15 — so the engine booked it as a win. Anything that re-derived
  // the outcome by comparing the sell price to the last buy price would call it a loss.
  it('trusts the PnL recorded on the sell rather than re-deriving it from log prices', () => {
    const history = [
      buyTrade('A', { priceUsd: 0.1 }),
      buyTrade('A', { priceUsd: 0.2 }),
      sellTrade('A', 0.25, { priceUsd: 0.16 }),
    ]
    expect(getWinRate(history)).toBe(1)
  })

  it('counts a partial close and the remainder separately', () => {
    const history = [buyTrade('A'), sellTrade('A', 0.4, { fraction: 0.5 }), sellTrade('A', -0.2, { fraction: 1 })]
    expect(getWinRate(history)).toBe(0.5)
  })

  // Trades written by a build that predates realizedPnlSol carry no outcome at all. They
  // must be skipped rather than counted as losses (which would understate the win rate)
  // or discard the whole stat: here the one sell we can read is a win, so 1, not 0.5.
  it('skips a sell with no recorded PnL instead of booking it as a loss', () => {
    const legacySell = { ...sellTrade('Z', 0), realizedPnlSol: undefined }
    expect(getWinRate([legacySell, buyTrade('A'), sellTrade('A', 0.5)])).toBe(1)
    expect(getWinRate([{ ...sellTrade('Z', 0), realizedPnlSol: null }, sellTrade('A', 0.5)])).toBe(1)
    expect(getWinRate([{ ...sellTrade('Z', 0), realizedPnlSol: NaN }, sellTrade('A', 0.5)])).toBe(1)
  })

  it('is null when no sell carries a usable PnL at all', () => {
    expect(getWinRate([buyTrade('A'), { ...sellTrade('A', 0), realizedPnlSol: undefined }])).toBeNull()
  })
})

describe('getRealizedPnlSol', () => {
  it('is zero for a fresh install with no trade history at all', () => {
    expect(getRealizedPnlSol(undefined)).toBe(0)
    expect(getRealizedPnlSol([])).toBe(0)
    expect(getRealizedPnlSol([buyTrade('A')])).toBe(0)
  })

  // Sums the recorded PnL of each close. The buys in this log carry solAmount 1 and 4;
  // a sum that added trade amounts instead of realised PnL would be nowhere near 0.5.
  it('sums the realized PnL of every close, netting wins against losses', () => {
    const history = [
      buyTrade('A', { solAmount: 1 }),
      sellTrade('A', 1.25),
      buyTrade('B', { solAmount: 4 }),
      sellTrade('B', -0.75),
    ]
    expect(getRealizedPnlSol(history)).toBe(0.5)
  })

  it('goes negative when the losses outweigh the wins', () => {
    expect(getRealizedPnlSol([sellTrade('A', 0.25), sellTrade('B', -1.5)])).toBe(-1.25)
  })

  it('ignores a sell with no recorded PnL rather than poisoning the total with NaN', () => {
    const history = [{ ...sellTrade('Z', 0), realizedPnlSol: undefined }, sellTrade('A', 0.5)]
    expect(getRealizedPnlSol(history)).toBe(0.5)
  })
})

describe('getPortfolioStats', () => {
  it('reports balance, position value, both PnL figures, win rate and open count together', () => {
    const stats = getPortfolioStats({
      balanceSol: 2.5,
      solUsdPrice: SOL_USD,
      positions: POSITIONS,
      tradeHistory: [buyTrade('C'), sellTrade('C', 0.5), buyTrade('D'), sellTrade('D', -0.25)],
    })
    expect(stats).toEqual({
      balanceSol: 2.5,
      positionValueSol: 3.5, // 2.5 of A + 1.0 of B, at today's price
      unrealizedPnlSol: 0.25, // +1.25 on A, −1.00 on B, against SOL actually paid
      realizedPnlSol: 0.25, // +0.5 then −0.25, as recorded on the sells
      totalPnlUsd: 50, // +250 on A, −200 on B
      winRate: 0.5, // one of the two closes was profitable
      openPositions: 2,
    })
  })

  it('survives a fresh install where no key has ever been written', () => {
    const empty = {
      balanceSol: 0,
      positionValueSol: 0,
      unrealizedPnlSol: null, // DEFAULT_STATE has solUsdPrice 0, so SOL PnL is unknowable
      realizedPnlSol: 0,
      totalPnlUsd: 0,
      winRate: null,
      openPositions: 0,
    }
    expect(getPortfolioStats({})).toEqual(empty)
    expect(getPortfolioStats(undefined)).toEqual(empty)
  })

  // Before the first SOL/USD fetch lands, the USD-denominated view is still exact while
  // the SOL-denominated one is not knowable — the header must show one and dash the
  // other rather than pretending the account is flat.
  it('still reports USD PnL and open positions while the SOL/USD rate is missing', () => {
    const stats = getPortfolioStats({ balanceSol: 1, positions: POSITIONS, tradeHistory: [sellTrade('C', 0.5)] })
    expect(stats).toEqual({
      balanceSol: 1,
      positionValueSol: 0,
      unrealizedPnlSol: null,
      realizedPnlSol: 0.5, // realised PnL was recorded in SOL at the time; no rate needed now
      totalPnlUsd: 50,
      winRate: 1,
      openPositions: 2,
    })
  })
})
