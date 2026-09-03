import { describe, it, expect, vi } from 'vitest'
import { refreshAllPositions } from './refresh.js'

// The 4th argument defaults to a live SOL/USD fetch, so every call here stubs it — an
// unstubbed test would hit the network and, worse, would silently value its snapshots at
// whatever the real rate happened to be.
const solUsd = (rate) => vi.fn().mockResolvedValue(rate)
const solUsdFails = () => vi.fn().mockRejectedValue(new Error('offline'))

describe('refreshAllPositions', () => {
  it('updates lastPriceUsd/priceSource/lastPriceUpdatedAt for every open position', async () => {
    const startedAt = Date.now()
    const state = {
      balanceSol: 1,
      positions: {
        M: {
          qty: 2,
          avgEntryUsd: 10,
          solInvested: 0.125,
          lastPriceUsd: 10,
          priceSource: null,
          lastPriceUpdatedAt: 0,
          stale: false,
        },
      },
      portfolioSnapshots: [],
    }
    const resolvePrice = vi.fn().mockResolvedValue({ priceUsd: 12, source: 'jupiter' })
    const nextState = await refreshAllPositions(state, resolvePrice, vi.fn(), solUsd(100))
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
      // 2 tokens bought at $10 each ($20), paid for with 0.125 SOL (the rate was 160 then).
      positions: {
        M: { qty: 2, avgEntryUsd: 10, solInvested: 0.125, lastPriceUsd: 10, priceSource: 'jupiter', stale: false },
      },
      portfolioSnapshots: [olderSnapshot],
    }
    const resolvePrice = vi.fn().mockResolvedValue({ priceUsd: 12.5, source: 'jupiter' })
    const nextState = await refreshAllPositions(state, resolvePrice, vi.fn(), solUsd(100))
    expect(nextState.portfolioSnapshots).toHaveLength(2)
    expect(nextState.portfolioSnapshots[0]).toEqual(olderSnapshot)
    // 2 tokens at the NEW price of $12.50, not the pre-refresh $10: $25 of value, which
    // at 100 USD/SOL is 0.25 SOL — a real SOL figure, never a USD one wearing the name.
    expect(nextState.portfolioSnapshots[1].totalPositionValueSol).toBe(0.25)
    // Measured against the 0.125 SOL actually paid, not against a reconstructed rate.
    expect(nextState.portfolioSnapshots[1].totalPnlSol).toBe(0.125)
    expect(nextState.portfolioSnapshots[1].balanceSol).toBe(1)
  })

  it('marks a position stale instead of overwriting its price when the resolver returns null', async () => {
    const state = {
      balanceSol: 1,
      positions: {
        M: {
          qty: 1,
          avgEntryUsd: 10,
          solInvested: 0.0625,
          lastPriceUsd: 10,
          priceSource: 'jupiter',
          lastPriceUpdatedAt: 12345,
          stale: false,
        },
      },
      portfolioSnapshots: [],
    }
    const resolvePrice = vi.fn().mockResolvedValue(null)
    const nextState = await refreshAllPositions(state, resolvePrice, vi.fn(), solUsd(100))
    expect(nextState.positions.M.lastPriceUsd).toBe(10) // unchanged
    expect(nextState.positions.M.priceSource).toBe('jupiter') // unchanged
    expect(nextState.positions.M.lastPriceUpdatedAt).toBe(12345) // not bumped by a failed refresh
    expect(nextState.positions.M.stale).toBe(true)
  })

  it('clears stale once a previously failing position resolves again', async () => {
    const state = {
      balanceSol: 1,
      positions: {
        M: {
          qty: 1,
          avgEntryUsd: 10,
          solInvested: 0.0625,
          lastPriceUsd: 10,
          priceSource: 'jupiter',
          lastPriceUpdatedAt: 1,
          stale: true,
        },
      },
      portfolioSnapshots: [],
    }
    const resolvePrice = vi.fn().mockResolvedValue({ priceUsd: 11, source: 'dexscreener' })
    const nextState = await refreshAllPositions(state, resolvePrice, vi.fn(), solUsd(100))
    expect(nextState.positions.M.stale).toBe(false)
    expect(nextState.positions.M.lastPriceUsd).toBe(11)
    expect(nextState.positions.M.priceSource).toBe('dexscreener')
  })

  it('handles a mixed batch: one position refreshes fine while another goes stale, independently', async () => {
    const state = {
      balanceSol: 1,
      positions: {
        A: { qty: 1, avgEntryUsd: 10, solInvested: 0.0625, lastPriceUsd: 10, priceSource: 'jupiter', stale: true },
        B: { qty: 1, avgEntryUsd: 5, solInvested: 0.03125, lastPriceUsd: 5, priceSource: 'jupiter', stale: false },
      },
      portfolioSnapshots: [],
    }
    const resolvePrice = vi.fn((mint) => Promise.resolve(mint === 'A' ? { priceUsd: 12, source: 'jupiter' } : null))
    const nextState = await refreshAllPositions(state, resolvePrice, vi.fn(), solUsd(100))
    expect(nextState.positions.A).toMatchObject({ lastPriceUsd: 12, stale: false })
    expect(nextState.positions.B).toMatchObject({ lastPriceUsd: 5, stale: true })
    expect(resolvePrice).toHaveBeenCalledTimes(2)
    expect(resolvePrice.mock.calls.map(([mint]) => mint).sort()).toEqual(['A', 'B'])
  })

  it('still captures a snapshot when there are zero open positions', async () => {
    const state = { balanceSol: 1, positions: {}, portfolioSnapshots: [] }
    const nextState = await refreshAllPositions(state, vi.fn(), vi.fn(), solUsd(100))
    expect(nextState.portfolioSnapshots).toHaveLength(1)
    expect(nextState.portfolioSnapshots[0].totalPositionValueSol).toBe(0)
  })

  it('does not mutate the state it is given', async () => {
    const state = {
      schemaVersion: 1,
      balanceSol: 1,
      solUsdPrice: 100,
      positions: {
        M: { qty: 1, avgEntryUsd: 10, solInvested: 0.0625, lastPriceUsd: 10, priceSource: 'jupiter', stale: false },
      },
      portfolioSnapshots: [{ timestamp: 1, balanceSol: 1, totalPositionValueSol: 10, totalPnlSol: 0 }],
      tradeHistory: [],
    }
    const before = structuredClone(state)
    const nextState = await refreshAllPositions(
      state,
      vi.fn().mockResolvedValue({ priceUsd: 12, source: 'jupiter' }),
      vi.fn(),
      solUsd(200),
    )
    expect(state).toEqual(before)
    // and unrelated top-level state survives the refresh
    expect(nextState.schemaVersion).toBe(1)
    expect(nextState.tradeHistory).toEqual([])
  })
})

// The SOL/USD rate is kept fresh here so a trade never has to block on fetching it, and
// so snapshots can be recorded in real SOL. Everything downstream reads state.solUsdPrice,
// which makes this the one place the rate can go wrong for the whole app.
describe('refreshAllPositions — SOL/USD rate', () => {
  const onePosition = (extra = {}) => ({
    balanceSol: 1,
    // 2 tokens at $10 each, paid for with 0.125 SOL.
    positions: {
      M: { qty: 2, avgEntryUsd: 10, solInvested: 0.125, lastPriceUsd: 10, priceSource: 'jupiter', stale: false },
    },
    portfolioSnapshots: [],
    ...extra,
  })
  const priced = () => vi.fn().mockResolvedValue({ priceUsd: 12.5, source: 'jupiter' })

  it('writes the resolved rate to state.solUsdPrice', async () => {
    const resolveSolUsd = solUsd(212.5)

    const next = await refreshAllPositions(onePosition(), priced(), vi.fn(), resolveSolUsd)

    expect(next.solUsdPrice).toBe(212.5)
    expect(resolveSolUsd).toHaveBeenCalledTimes(1)
  })

  it('resolves the rate once per refresh, not once per position', async () => {
    const resolveSolUsd = solUsd(100)
    const state = {
      balanceSol: 1,
      positions: {
        A: { qty: 1, avgEntryUsd: 10, solInvested: 0.0625, lastPriceUsd: 10, stale: false },
        B: { qty: 1, avgEntryUsd: 10, solInvested: 0.0625, lastPriceUsd: 10, stale: false },
        C: { qty: 1, avgEntryUsd: 10, solInvested: 0.0625, lastPriceUsd: 10, stale: false },
      },
      portfolioSnapshots: [],
    }

    await refreshAllPositions(state, priced(), vi.fn(), resolveSolUsd)

    expect(resolveSolUsd).toHaveBeenCalledTimes(1)
  })

  it('values the snapshot at the freshly resolved rate, not the stale one already in state', async () => {
    // Same $25 of position value; only the rate differs, so the SOL figure must move.
    const next = await refreshAllPositions(
      onePosition({ solUsdPrice: 100 }),
      priced(),
      vi.fn(),
      solUsd(200),
    )

    expect(next.solUsdPrice).toBe(200)
    // $25 / 200 = 0.125 SOL — at the stale rate of 100 it would have been 0.25.
    expect(next.portfolioSnapshots[0].totalPositionValueSol).toBe(0.125)
    // Worth exactly what it cost, so no unrealised PnL.
    expect(next.portfolioSnapshots[0].totalPnlSol).toBe(0)
  })

  it('keeps the previous rate when the lookup rejects, rather than zeroing it', async () => {
    const next = await refreshAllPositions(
      onePosition({ solUsdPrice: 100 }),
      priced(),
      vi.fn(),
      solUsdFails(),
    )

    expect(next.solUsdPrice).toBe(100)
    // and the last known rate still buys us a real SOL valuation: $25 / 100.
    expect(next.portfolioSnapshots[0].totalPositionValueSol).toBe(0.25)
    expect(next.portfolioSnapshots[0].totalPnlSol).toBe(0.125)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['zero', 0],
    ['a non-numeric answer', 'n/a'],
  ])('keeps the previous rate when the lookup resolves to %s', async (_label, answer) => {
    const next = await refreshAllPositions(
      onePosition({ solUsdPrice: 100 }),
      priced(),
      vi.fn(),
      solUsd(answer),
    )

    expect(next.solUsdPrice).toBe(100)
    expect(next.portfolioSnapshots[0].totalPositionValueSol).toBe(0.25)
  })

  it('reports zero — never a USD figure — when no rate has ever been known', async () => {
    const next = await refreshAllPositions(onePosition(), priced(), vi.fn(), solUsdFails())

    expect(next.solUsdPrice).toBe(0)
    // The position really is worth $25, but without a rate its SOL value is unknowable.
    // Contributing 0 is honest; contributing 25 would corrupt the history with mixed units.
    expect(next.portfolioSnapshots[0].totalPositionValueSol).toBe(0)
    expect(next.portfolioSnapshots[0].totalPnlSol).toBe(0)
  })

  it('refreshes prices normally even when the rate lookup fails', async () => {
    const next = await refreshAllPositions(onePosition(), priced(), vi.fn(), solUsdFails())

    // A missing rate is not a price failure: the USD price landed and the row is not stale.
    expect(next.positions.M.lastPriceUsd).toBe(12.5)
    expect(next.positions.M.stale).toBe(false)
  })

  it('recovers a rate on a later refresh after an earlier lookup failed', async () => {
    const failed = await refreshAllPositions(onePosition(), priced(), vi.fn(), solUsdFails())
    expect(failed.solUsdPrice).toBe(0)

    const recovered = await refreshAllPositions(failed, priced(), vi.fn(), solUsd(200))

    expect(recovered.solUsdPrice).toBe(200)
    expect(recovered.portfolioSnapshots).toHaveLength(2)
    expect(recovered.portfolioSnapshots[1].totalPositionValueSol).toBe(0.125)
  })
})

// Token identity comes from the price APIs, not the page: this runs for every position
// the user holds, including ones not currently on screen.
describe('refreshAllPositions — token identity backfill', () => {
  const nameless = () => ({
    balanceSol: 1,
    solUsdPrice: 100,
    positions: {
      M: {
        qty: 1,
        avgEntryUsd: 10,
        solInvested: 0.0625,
        lastPriceUsd: 10,
        name: '',
        symbol: '',
        imageUrl: '',
        stale: false,
      },
    },
    portfolioSnapshots: [],
  })
  const priced = vi.fn().mockResolvedValue({ priceUsd: 12, source: 'jupiter' })
  const rate = () => solUsd(100)

  it('fills in name, symbol and image for a position that has none', async () => {
    const meta = vi.fn().mockResolvedValue({ name: 'Morko', symbol: 'MORKO', imageUrl: 'https://img/x.png' })

    const next = await refreshAllPositions(nameless(), priced, meta, rate())

    expect(next.positions.M).toMatchObject({ name: 'Morko', symbol: 'MORKO', imageUrl: 'https://img/x.png' })
  })

  it('does not re-fetch identity for a position that already has it', async () => {
    const meta = vi.fn()
    const state = {
      balanceSol: 1,
      solUsdPrice: 100,
      positions: {
        M: { qty: 1, avgEntryUsd: 10, solInvested: 0.0625, lastPriceUsd: 10, name: 'N', symbol: 'S', imageUrl: 'u' },
      },
      portfolioSnapshots: [],
    }

    await refreshAllPositions(state, priced, meta, rate())

    expect(meta).not.toHaveBeenCalled()
  })

  it('still refreshes the price when identity lookup fails, and retries next tick', async () => {
    const meta = vi.fn().mockRejectedValue(new Error('offline'))

    const next = await refreshAllPositions(nameless(), priced, meta, rate())

    expect(next.positions.M.lastPriceUsd).toBe(12) // price landed regardless
    expect(next.positions.M.name).toBe('') // still nameless, so it will be asked for again
  })

  it('keeps identity it already has rather than overwriting with a partial answer', async () => {
    const meta = vi.fn().mockResolvedValue({ name: 'Other', symbol: 'OTHER', imageUrl: 'https://img/y.png' })
    const state = {
      balanceSol: 1,
      solUsdPrice: 100,
      positions: {
        M: { qty: 1, avgEntryUsd: 10, solInvested: 0.0625, lastPriceUsd: 10, name: 'Kept', symbol: '', imageUrl: '' },
      },
      portfolioSnapshots: [],
    }

    const next = await refreshAllPositions(state, priced, meta, rate())

    expect(next.positions.M.name).toBe('Kept')
    expect(next.positions.M.symbol).toBe('OTHER') // the gap is filled
  })

  it('backfills identity even when the SOL/USD rate lookup fails', async () => {
    const meta = vi.fn().mockResolvedValue({ name: 'Morko', symbol: 'MORKO', imageUrl: 'https://img/x.png' })

    const next = await refreshAllPositions(nameless(), priced, meta, solUsdFails())

    expect(next.positions.M).toMatchObject({ name: 'Morko', symbol: 'MORKO', imageUrl: 'https://img/x.png' })
  })
})
