import { describe, it, expect, vi } from 'vitest'
import { refreshAllPositions } from './refresh.js'

describe('refreshAllPositions', () => {
  it('updates lastPriceUsd/priceSource for every open position and appends a snapshot', async () => {
    const state = {
      balanceSol: 1,
      positions: { M: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 10, priceSource: null, stale: false } },
      portfolioSnapshots: [],
    }
    const resolvePrice = vi.fn().mockResolvedValue({ priceUsd: 12, source: 'jupiter' })
    const nextState = await refreshAllPositions(state, resolvePrice)
    expect(nextState.positions.M.lastPriceUsd).toBe(12)
    expect(nextState.positions.M.priceSource).toBe('jupiter')
    expect(nextState.positions.M.stale).toBe(false)
    expect(nextState.portfolioSnapshots).toHaveLength(1)
  })

  it('marks a position stale instead of overwriting its price when the resolver returns null', async () => {
    const state = {
      balanceSol: 1,
      positions: { M: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 10, priceSource: 'jupiter', stale: false } },
      portfolioSnapshots: [],
    }
    const resolvePrice = vi.fn().mockResolvedValue(null)
    const nextState = await refreshAllPositions(state, resolvePrice)
    expect(nextState.positions.M.lastPriceUsd).toBe(10) // unchanged
    expect(nextState.positions.M.stale).toBe(true)
  })

  it('handles a mixed batch: one position refreshes fine while another goes stale, independently', async () => {
    const state = {
      balanceSol: 1,
      positions: {
        A: { qty: 1, avgEntryUsd: 10, lastPriceUsd: 10, priceSource: 'jupiter', stale: false },
        B: { qty: 1, avgEntryUsd: 5, lastPriceUsd: 5, priceSource: 'jupiter', stale: false },
      },
      portfolioSnapshots: [],
    }
    const resolvePrice = vi.fn((mint) => Promise.resolve(mint === 'A' ? { priceUsd: 12, source: 'jupiter' } : null))
    const nextState = await refreshAllPositions(state, resolvePrice)
    expect(nextState.positions.A).toMatchObject({ lastPriceUsd: 12, stale: false })
    expect(nextState.positions.B).toMatchObject({ lastPriceUsd: 5, stale: true })
  })

  it('still captures a snapshot when there are zero open positions', async () => {
    const state = { balanceSol: 1, positions: {}, portfolioSnapshots: [] }
    const nextState = await refreshAllPositions(state, vi.fn())
    expect(nextState.portfolioSnapshots).toHaveLength(1)
    expect(nextState.portfolioSnapshots[0].totalPositionValueSol).toBe(0)
  })
})
