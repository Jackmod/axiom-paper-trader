import { describe, it, expect, vi } from 'vitest'
import { refreshAllPositions } from './refresh.js'

describe('refreshAllPositions', () => {
  it('updates lastPriceUsd/priceSource/lastPriceUpdatedAt for every open position', async () => {
    const startedAt = Date.now()
    const state = {
      balanceSol: 1,
      positions: {
        M: { qty: 2, avgEntryUsd: 10, lastPriceUsd: 10, priceSource: null, lastPriceUpdatedAt: 0, stale: false },
      },
      portfolioSnapshots: [],
    }
    const resolvePrice = vi.fn().mockResolvedValue({ priceUsd: 12, source: 'jupiter' })
    const nextState = await refreshAllPositions(state, resolvePrice)
    expect(nextState.positions.M.lastPriceUsd).toBe(12)
    expect(nextState.positions.M.priceSource).toBe('jupiter')
    expect(nextState.positions.M.stale).toBe(false)
    expect(nextState.positions.M.lastPriceUpdatedAt).toBeGreaterThanOrEqual(startedAt)
    expect(resolvePrice).toHaveBeenCalledTimes(1)
    expect(resolvePrice).toHaveBeenCalledWith('M')
  })

  it('appends a snapshot valued at the POST-refresh prices, keeping prior snapshots', async () => {
    const olderSnapshot = { timestamp: 1, balanceSol: 1, totalPositionValueSol: 20, totalPnlSol: 0 }
    const state = {
      balanceSol: 1,
      positions: { M: { qty: 2, avgEntryUsd: 10, lastPriceUsd: 10, priceSource: 'jupiter', stale: false } },
      portfolioSnapshots: [olderSnapshot],
    }
    const resolvePrice = vi.fn().mockResolvedValue({ priceUsd: 12, source: 'jupiter' })
    const nextState = await refreshAllPositions(state, resolvePrice)
    expect(nextState.portfolioSnapshots).toHaveLength(2)
    expect(nextState.portfolioSnapshots[0]).toEqual(olderSnapshot)
    // 2 qty at the NEW price of 12, not the pre-refresh 10
    expect(nextState.portfolioSnapshots[1].totalPositionValueSol).toBe(24)
    expect(nextState.portfolioSnapshots[1].totalPnlSol).toBe(4)
    expect(nextState.portfolioSnapshots[1].balanceSol).toBe(1)
  })

  it('marks a position stale instead of overwriting its price when the resolver returns null', async () => {
    const state = {
      balanceSol: 1,
      positions: {
        M: {
          qty: 1,
          avgEntryUsd: 10,
          lastPriceUsd: 10,
          priceSource: 'jupiter',
          lastPriceUpdatedAt: 12345,
          stale: false,
        },
      },
      portfolioSnapshots: [],
    }
    const resolvePrice = vi.fn().mockResolvedValue(null)
    const nextState = await refreshAllPositions(state, resolvePrice)
    expect(nextState.positions.M.lastPriceUsd).toBe(10) // unchanged
    expect(nextState.positions.M.priceSource).toBe('jupiter') // unchanged
    expect(nextState.positions.M.lastPriceUpdatedAt).toBe(12345) // not bumped by a failed refresh
    expect(nextState.positions.M.stale).toBe(true)
  })

  it('clears stale once a previously failing position resolves again', async () => {
    const state = {
      balanceSol: 1,
      positions: {
        M: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 10, priceSource: 'jupiter', lastPriceUpdatedAt: 1, stale: true },
      },
      portfolioSnapshots: [],
    }
    const resolvePrice = vi.fn().mockResolvedValue({ priceUsd: 11, source: 'dexscreener' })
    const nextState = await refreshAllPositions(state, resolvePrice)
    expect(nextState.positions.M.stale).toBe(false)
    expect(nextState.positions.M.lastPriceUsd).toBe(11)
    expect(nextState.positions.M.priceSource).toBe('dexscreener')
  })

  it('handles a mixed batch: one position refreshes fine while another goes stale, independently', async () => {
    const state = {
      balanceSol: 1,
      positions: {
        A: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 10, priceSource: 'jupiter', stale: true },
        B: { qty: 1, avgEntryUsd: 5, lastPriceUsd: 5, priceSource: 'jupiter', stale: false },
      },
      portfolioSnapshots: [],
    }
    const resolvePrice = vi.fn((mint) => Promise.resolve(mint === 'A' ? { priceUsd: 12, source: 'jupiter' } : null))
    const nextState = await refreshAllPositions(state, resolvePrice)
    expect(nextState.positions.A).toMatchObject({ lastPriceUsd: 12, stale: false })
    expect(nextState.positions.B).toMatchObject({ lastPriceUsd: 5, stale: true })
    expect(resolvePrice).toHaveBeenCalledTimes(2)
    expect(resolvePrice.mock.calls.map(([mint]) => mint).sort()).toEqual(['A', 'B'])
  })

  it('still captures a snapshot when there are zero open positions', async () => {
    const state = { balanceSol: 1, positions: {}, portfolioSnapshots: [] }
    const nextState = await refreshAllPositions(state, vi.fn())
    expect(nextState.portfolioSnapshots).toHaveLength(1)
    expect(nextState.portfolioSnapshots[0].totalPositionValueSol).toBe(0)
  })

  it('does not mutate the state it is given', async () => {
    const state = {
      schemaVersion: 1,
      balanceSol: 1,
      positions: { M: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 10, priceSource: 'jupiter', stale: false } },
      portfolioSnapshots: [{ timestamp: 1, balanceSol: 1, totalPositionValueSol: 10, totalPnlSol: 0 }],
      tradeHistory: [],
    }
    const before = structuredClone(state)
    const nextState = await refreshAllPositions(state, vi.fn().mockResolvedValue({ priceUsd: 12, source: 'jupiter' }))
    expect(state).toEqual(before)
    // and unrelated top-level state survives the refresh
    expect(nextState.schemaVersion).toBe(1)
    expect(nextState.tradeHistory).toEqual([])
  })
})

// Token identity comes from the price APIs, not the page: this runs for every position
// the user holds, including ones not currently on screen.
describe('refreshAllPositions — token identity backfill', () => {
  const nameless = () => ({
    balanceSol: 1,
    positions: { M: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 10, name: '', symbol: '', imageUrl: '', stale: false } },
    portfolioSnapshots: [],
  })
  const priced = vi.fn().mockResolvedValue({ priceUsd: 12, source: 'jupiter' })

  it('fills in name, symbol and image for a position that has none', async () => {
    const meta = vi.fn().mockResolvedValue({ name: 'Morko', symbol: 'MORKO', imageUrl: 'https://img/x.png' })

    const next = await refreshAllPositions(nameless(), priced, meta)

    expect(next.positions.M).toMatchObject({ name: 'Morko', symbol: 'MORKO', imageUrl: 'https://img/x.png' })
  })

  it('does not re-fetch identity for a position that already has it', async () => {
    const meta = vi.fn()
    const state = {
      balanceSol: 1,
      positions: { M: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 10, name: 'N', symbol: 'S', imageUrl: 'u' } },
      portfolioSnapshots: [],
    }

    await refreshAllPositions(state, priced, meta)

    expect(meta).not.toHaveBeenCalled()
  })

  it('still refreshes the price when identity lookup fails, and retries next tick', async () => {
    const meta = vi.fn().mockRejectedValue(new Error('offline'))

    const next = await refreshAllPositions(nameless(), priced, meta)

    expect(next.positions.M.lastPriceUsd).toBe(12) // price landed regardless
    expect(next.positions.M.name).toBe('') // still nameless, so it will be asked for again
  })

  it('keeps identity it already has rather than overwriting with a partial answer', async () => {
    const meta = vi.fn().mockResolvedValue({ name: 'Other', symbol: 'OTHER', imageUrl: 'https://img/y.png' })
    const state = {
      balanceSol: 1,
      positions: { M: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 10, name: 'Kept', symbol: '', imageUrl: '' } },
      portfolioSnapshots: [],
    }

    const next = await refreshAllPositions(state, priced, meta)

    expect(next.positions.M.name).toBe('Kept')
    expect(next.positions.M.symbol).toBe('OTHER') // the gap is filled
  })
})
