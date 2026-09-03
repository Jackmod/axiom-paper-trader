import { describe, it, expect } from 'vitest'
import { captureSnapshot, appendSnapshot } from './snapshots.js'

describe('captureSnapshot', () => {
  it('sums position value and total PnL against the balance', () => {
    const state = {
      balanceSol: 2,
      positions: {
        A: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 12 },
        B: { qty: 2, avgEntryUsd: 5, lastPriceUsd: 4 },
      },
    }
    const snap = captureSnapshot(state)
    expect(snap.balanceSol).toBe(2)
    expect(snap.totalPositionValueSol).toBeCloseTo(1 * 12 + 2 * 4)
    expect(snap.totalPnlSol).toBeCloseTo((12 - 10) * 1 + (4 - 5) * 2)
    expect(snap.timestamp).toEqual(expect.any(Number))
  })

  it('returns zero value/PnL for an empty portfolio instead of NaN', () => {
    const snap = captureSnapshot({ balanceSol: 3, positions: {} })
    expect(snap.totalPositionValueSol).toBe(0)
    expect(snap.totalPnlSol).toBe(0)
    expect(Number.isNaN(snap.totalPnlSol)).toBe(false)
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
