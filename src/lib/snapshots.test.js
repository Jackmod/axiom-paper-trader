import { describe, it, expect } from 'vitest'
import { captureSnapshot, appendSnapshot } from './snapshots.js'

// A snapshot is the raw material for the trend graph and the calendar, so a unit error
// here is invisible at capture time and permanent afterwards. Every expectation below is
// derived by hand from the engine contract:
//   valueSol = qty * lastPriceUsd / solUsdPrice
//   pnlSol   = valueSol - solInvested      (measured against the SOL actually paid)
// and both are unknowable — null from the engine — when no SOL/USD rate is available.

/**
 * Two positions priced at SOL/USD = 200.
 *
 *   BONK  1000 tokens @ 0.02 USD entry, 0.1 SOL paid (1000 * 0.02 = $20; $20/200 = 0.1)
 *         now 0.03 USD  -> $30  -> 0.150 SOL  -> pnl +0.050 SOL
 *   WIF    500 tokens @ 0.08 USD entry, 0.2 SOL paid ( 500 * 0.08 = $40; $40/200 = 0.2)
 *         now 0.05 USD  -> $25  -> 0.125 SOL  -> pnl -0.075 SOL
 *
 *   totals: value 0.275 SOL, PnL -0.025 SOL
 *   the USD figures, for contrast: value $55, PnL -$5
 */
function twoPositionState(overrides = {}) {
  return {
    balanceSol: 2,
    solUsdPrice: 200,
    positions: {
      BONK: { qty: 1000, avgEntryUsd: 0.02, solInvested: 0.1, lastPriceUsd: 0.03 },
      WIF: { qty: 500, avgEntryUsd: 0.08, solInvested: 0.2, lastPriceUsd: 0.05 },
    },
    ...overrides,
  }
}

describe('captureSnapshot', () => {
  it('converts every position to genuine SOL using state.solUsdPrice and sums them', () => {
    const snap = captureSnapshot(twoPositionState())

    // 0.150 + 0.125
    expect(snap.totalPositionValueSol).toBeCloseTo(0.275, 10)
    // +0.050 + (-0.075)
    expect(snap.totalPnlSol).toBeCloseTo(-0.025, 10)
  })

  it('does not sum USD into the fields named ...Sol', () => {
    const snap = captureSnapshot(twoPositionState())

    // The pre-fix bug summed qty * lastPriceUsd (a USD figure) into totalPositionValueSol
    // and (lastPriceUsd - avgEntryUsd) * qty into totalPnlSol. Those are $55 and -$5 for
    // this fixture; at SOL/USD = 200 the honest answers are 200x smaller.
    expect(snap.totalPositionValueSol).not.toBeCloseTo(55, 3)
    expect(snap.totalPnlSol).not.toBeCloseTo(-5, 3)
    expect(snap.totalPositionValueSol).toBeCloseTo(55 / 200, 10)
  })

  it('measures PnL against the SOL actually paid, not a cost re-derived at today rate', () => {
    // Bought 1000 tokens at 0.02 USD when SOL was $100, so 0.2 SOL left the wallet.
    // SOL has since doubled to $200 while the token price has not moved at all.
    // In USD this position is flat; in SOL the user is down half of what they paid:
    //   valueSol = 1000 * 0.02 / 200 = 0.1   ->   pnlSol = 0.1 - 0.2 = -0.1
    const snap = captureSnapshot({
      balanceSol: 1,
      solUsdPrice: 200,
      positions: {
        BONK: { qty: 1000, avgEntryUsd: 0.02, solInvested: 0.2, lastPriceUsd: 0.02 },
      },
    })

    expect(snap.totalPositionValueSol).toBeCloseTo(0.1, 10)
    expect(snap.totalPnlSol).toBeCloseTo(-0.1, 10)
    // A snapshot that reconstructed the cost basis from the current rate would call this
    // position flat and lose the real loss.
    expect(snap.totalPnlSol).not.toBeCloseTo(0, 3)
  })

  it.each([
    ['missing', undefined],
    ['zero', 0],
    ['null', null],
  ])('reports zero SOL totals when the SOL/USD rate is %s, rather than leaking USD', (_label, solUsdPrice) => {
    // There is real USD here to leak — $55 of value and -$5 of PnL — so a zero result is
    // meaningful, not vacuous. Recording those USD numbers under a ...Sol name would
    // corrupt the stored history with mixed units forever; zero is the honest reading.
    const snap = captureSnapshot(twoPositionState({ solUsdPrice }))

    expect(snap.totalPositionValueSol).toBe(0)
    expect(snap.totalPnlSol).toBe(0)
    expect(Number.isNaN(snap.totalPositionValueSol)).toBe(false)
    expect(Number.isNaN(snap.totalPnlSol)).toBe(false)
  })

  it('carries the cash balance through untouched and keeps it out of position value', () => {
    const snap = captureSnapshot(twoPositionState())

    expect(snap.balanceSol).toBe(2)
    // Position value is the holdings alone; the trend view adds the balance itself.
    expect(snap.totalPositionValueSol).toBeCloseTo(0.275, 10)
  })

  it('returns zero value/PnL for an empty portfolio instead of NaN', () => {
    const snap = captureSnapshot({ balanceSol: 3, solUsdPrice: 200, positions: {} })
    expect(snap.totalPositionValueSol).toBe(0)
    expect(snap.totalPnlSol).toBe(0)
    expect(Number.isNaN(snap.totalPnlSol)).toBe(false)
  })

  it('tolerates a state with no positions key at all', () => {
    const snap = captureSnapshot({ balanceSol: 3, solUsdPrice: 200 })
    expect(snap.totalPositionValueSol).toBe(0)
    expect(snap.totalPnlSol).toBe(0)
    expect(snap.balanceSol).toBe(3)
  })

  it('stamps the capture with a current timestamp', () => {
    const before = Date.now()
    const snap = captureSnapshot(twoPositionState())
    const after = Date.now()

    expect(typeof snap.timestamp).toBe('number')
    expect(snap.timestamp).toBeGreaterThanOrEqual(before)
    expect(snap.timestamp).toBeLessThanOrEqual(after)
  })
})

describe('appendSnapshot', () => {
  it('appends and prunes to maxEntries, dropping the oldest first', () => {
    const existing = [{ timestamp: 1 }, { timestamp: 2 }]
    const result = appendSnapshot(existing, { timestamp: 3 }, 2)
    expect(result).toEqual([{ timestamp: 2 }, { timestamp: 3 }])
  })

  it('does not prune when under the cap', () => {
    const result = appendSnapshot([{ timestamp: 1 }], { timestamp: 2 }, 10)
    expect(result).toEqual([{ timestamp: 1 }, { timestamp: 2 }])
  })

  it('preserves chronological order after pruning', () => {
    const existing = [{ timestamp: 1 }, { timestamp: 2 }, { timestamp: 3 }]
    const result = appendSnapshot(existing, { timestamp: 4 }, 2)
    expect(result.map((s) => s.timestamp)).toEqual([3, 4])
  })

  it('does not mutate the input array (pure function contract)', () => {
    const existing = [{ timestamp: 1 }]
    appendSnapshot(existing, { timestamp: 2 }, 10)
    expect(existing).toEqual([{ timestamp: 1 }])
  })
})
