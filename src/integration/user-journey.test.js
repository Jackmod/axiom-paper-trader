import { describe, it, expect, vi } from 'vitest'
import { handleMessage } from '../background/message-router.js'
import { refreshAllPositions } from '../background/refresh.js'
import { getUnrealizedPnl } from '../lib/position-engine.js'
import { getPortfolioStats } from '../lib/portfolio-stats.js'
import { DEFAULT_STATE } from '../lib/storage.js'

// End-to-end through the REAL modules — real message router, real position engine, real
// refresh loop, real portfolio stats. Nothing is stubbed except the network (price and
// metadata lookups), because that is the only part that isn't ours.
//
// The unit tests prove each piece in isolation. This proves they compose: that a user
// can fund an account, trade several coins, walk away, come back, and see numbers that
// add up. Every scenario here maps to something the product was built to fix.

const A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const B = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

function buy(mint, qtySol, priceUsd, extra = {}) {
  return {
    type: 'BUY',
    payload: { mint, symbol: '', name: '', imageUrl: '', qtySol, priceUsd, priorityFeeSol: 0, slippagePct: 0, ...extra },
  }
}

function sell(mint, qtySol, priceUsd) {
  return { type: 'SELL', payload: { mint, qtySol, priceUsd, priorityFeeSol: 0, slippagePct: 0 } }
}

async function apply(state, message) {
  const { nextState, response } = await handleMessage(message, state)
  expect(response.ok).toBe(true) // a rejected step would make later assertions meaningless
  return nextState
}

// Prices the "market" reports while the user is away.
const marketAt = (prices) => vi.fn(async (mint) => (prices[mint] ? { priceUsd: prices[mint], source: 'jupiter' } : null))

describe('user journey: fund, trade several coins, walk away, come back', () => {
  it('runs the whole flow with the numbers adding up at every step', async () => {
    // 1. Onboarding: start with 10 virtual SOL.
    let state = await apply({ ...DEFAULT_STATE }, { type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 10 } })
    expect(state.balanceSol).toBe(10)

    // 2. Buy coin A twice at different prices. THE core requirement: this must become one
    //    position with a weighted-average entry — not two rows, which is the bug in the
    //    extension this replaces.
    state = await apply(state, buy(A, 1, 10))
    state = await apply(state, buy(A, 1, 20))

    expect(Object.keys(state.positions)).toEqual([A])
    expect(state.positions[A].qty).toBeCloseTo(2)
    expect(state.positions[A].avgEntryUsd).toBeCloseTo(15) // (1×10 + 1×20) / 2
    expect(state.balanceSol).toBeCloseTo(8) // 10 − 1 − 1

    // 3. Buy a second coin. Multi-coin: A must be untouched by B.
    state = await apply(state, buy(B, 2, 5))

    expect(Object.keys(state.positions).sort()).toEqual([A, B].sort())
    expect(state.positions[A].avgEntryUsd).toBeCloseTo(15)
    expect(state.positions[B].qty).toBeCloseTo(2)
    expect(state.balanceSol).toBeCloseTo(6)

    // 4. The user closes the tab. The background keeps pricing BOTH coins — this is the
    //    "leave it running and it still tracks" requirement.
    state = await refreshAllPositions(state, marketAt({ [A]: 30, [B]: 4 }), async () => null)

    expect(state.positions[A].lastPriceUsd).toBe(30)
    expect(state.positions[B].lastPriceUsd).toBe(4)

    // 5. Unrealised PnL, per coin: A is up, B is down.
    expect(getUnrealizedPnl(state.positions[A]).pnlUsd).toBeCloseTo((30 - 15) * 2) // +30
    expect(getUnrealizedPnl(state.positions[A]).pnlPct).toBeCloseTo(100)
    expect(getUnrealizedPnl(state.positions[B]).pnlUsd).toBeCloseTo((4 - 5) * 2) // −2

    // 6. Portfolio totals across both coins.
    expect(getPortfolioStats(state).totalPnlUsd).toBeCloseTo(28) // +30 − 2

    // 7. Sell half of A. The remainder keeps its average entry; the position stays open.
    state = await apply(state, sell(A, 1, 30))

    expect(state.positions[A].qty).toBeCloseTo(1)
    expect(state.positions[A].avgEntryUsd).toBeCloseTo(15) // unchanged for what's left
    expect(state.tradeHistory.filter((t) => t.side === 'sell')).toHaveLength(1)

    // 8. Close A entirely. It disappears; B is untouched and still tracking.
    state = await apply(state, sell(A, state.positions[A].qty, 30))

    expect(state.positions[A]).toBeUndefined()
    expect(state.positions[B].qty).toBeCloseTo(2)

    // 9. History records every leg: 3 buys, 2 sells.
    expect(state.tradeHistory.filter((t) => t.side === 'buy')).toHaveLength(3)
    expect(state.tradeHistory.filter((t) => t.side === 'sell')).toHaveLength(2)

    // 10. Coming back later, B keeps updating on its own.
    state = await refreshAllPositions(state, marketAt({ [B]: 9 }), async () => null)
    expect(getUnrealizedPnl(state.positions[B]).pnlUsd).toBeCloseTo((9 - 5) * 2)
  })

  it('keeps ten coins independent, with one bad price not touching the others', async () => {
    let state = await apply({ ...DEFAULT_STATE }, { type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 100 } })

    const mints = Array.from({ length: 10 }, (_, i) => `MINT_${i}`.padEnd(40, 'x'))
    for (const [i, mint] of mints.entries()) state = await apply(state, buy(mint, 1, 10 + i))

    expect(Object.keys(state.positions)).toHaveLength(10)

    // Every coin prices except one, which the market can't answer for.
    const prices = Object.fromEntries(mints.slice(1).map((m, i) => [m, 20 + i]))
    state = await refreshAllPositions(state, marketAt(prices), async () => null)

    expect(state.positions[mints[0]].stale).toBe(true)
    expect(state.positions[mints[0]].lastPriceUsd).toBe(10) // last known price kept, not zeroed
    for (const mint of mints.slice(1)) expect(state.positions[mint].stale).toBe(false)
  })

  it('records priority fees against the balance, so PnL reflects real trading cost', async () => {
    let state = await apply({ ...DEFAULT_STATE }, { type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 5 } })

    state = await apply(state, buy(A, 1, 10, { priorityFeeSol: 0.001 }))

    expect(state.balanceSol).toBeCloseTo(5 - 1 - 0.001)
    expect(state.tradeHistory[0].priorityFeeSol).toBe(0.001)
  })

  it('backfills token identity for every held coin while the user is away', async () => {
    let state = await apply({ ...DEFAULT_STATE }, { type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 10 } })
    state = await apply(state, buy(A, 1, 10))
    state = await apply(state, buy(B, 1, 10))

    const metadata = vi.fn(async (mint) => ({
      name: mint === A ? 'Alpha' : 'Beta',
      symbol: mint === A ? 'ALP' : 'BET',
      imageUrl: 'https://img/x.png',
    }))
    state = await refreshAllPositions(state, marketAt({ [A]: 11, [B]: 12 }), metadata)

    expect(state.positions[A].name).toBe('Alpha')
    expect(state.positions[B].symbol).toBe('BET')
    // Named once, not re-fetched on every tick.
    state = await refreshAllPositions(state, marketAt({ [A]: 11, [B]: 12 }), metadata)
    expect(metadata).toHaveBeenCalledTimes(2)
  })

  it('refuses to sell more than is held, leaving the account exactly as it was', async () => {
    let state = await apply({ ...DEFAULT_STATE }, { type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 10 } })
    state = await apply(state, buy(A, 1, 10))
    const before = JSON.parse(JSON.stringify(state))

    const { nextState, response } = await handleMessage(sell(A, 999, 10), state)

    expect(response.ok).toBe(false)
    expect(nextState).toEqual(before) // no partial mutation
  })
})
