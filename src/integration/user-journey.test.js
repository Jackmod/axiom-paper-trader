import { describe, it, expect, vi } from 'vitest'
import { handleMessage } from '../background/message-router.js'
import { refreshAllPositions } from '../background/refresh.js'
import { getUnrealizedPnl } from '../lib/position-engine.js'
import { getPortfolioStats } from '../lib/portfolio-stats.js'
import { DEFAULT_STATE } from '../lib/storage.js'

// End-to-end through the REAL modules — real message router, real position engine, real
// refresh loop, real portfolio stats. Nothing is stubbed except the network (price,
// metadata and SOL/USD lookups), because that is the only part that isn't ours.
//
// The unit tests prove each piece in isolation. This proves they compose: that a user
// can fund an account, trade several coins, walk away, come back, and see numbers that
// add up. Every scenario here maps to something the product was built to fix.
//
// UNITS ARE THE POINT. A position holds `qty` TOKENS bought at `avgEntryUsd` USD per
// token, having cost `solInvested` SOL. The old model stored SOL in `qty` and then
// subtracted USD-per-token figures from each other and multiplied by it, which is how a
// small position came to report −21 SOL and −95%. Every expected number below is derived
// from the contract by hand, so a regression to a dimensionally-incoherent formula fails
// here rather than shipping.

const A = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
const B = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

// A round rate keeps the hand arithmetic checkable: 1 SOL buys $100 of tokens.
const SOL_USD = 100

const funded = (overrides = {}) => ({ ...DEFAULT_STATE, solUsdPrice: SOL_USD, ...overrides })

function buy(mint, solSpent, priceUsd, extra = {}) {
  return {
    type: 'BUY',
    payload: { mint, symbol: '', name: '', imageUrl: '', solSpent, priceUsd, priorityFeeSol: 0, slippagePct: 0, ...extra },
  }
}

// Sells are a FRACTION of the holding (Axiom's 25/50/100% presets), never an absolute
// quantity — the user picks a proportion and the engine owns the token math.
function sell(mint, fraction, priceUsd, extra = {}) {
  return { type: 'SELL', payload: { mint, fraction, priceUsd, priorityFeeSol: 0, slippagePct: 0, ...extra } }
}

async function send(state, message) {
  const { nextState, response } = await handleMessage(message, state)
  expect(response.ok).toBe(true) // a rejected step would make later assertions meaningless
  return { state: nextState, response }
}

async function apply(state, message) {
  return (await send(state, message)).state
}

// Prices the "market" reports while the user is away.
const marketAt = (prices) => vi.fn(async (mint) => (prices[mint] ? { priceUsd: prices[mint], source: 'jupiter' } : null))

// refreshAllPositions takes the SOL/USD resolver as its 4th argument and writes the rate
// into state; tests MUST stub it or the real one would hit the network.
const solUsdAt = (rate) => vi.fn(async () => rate)

describe('user journey: fund, trade several coins, walk away, come back', () => {
  it('runs the whole flow with the numbers adding up at every step', async () => {
    // 1. Onboarding: start with 10 virtual SOL, with a known SOL/USD rate on hand.
    let state = await apply(funded(), { type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 10 } })
    expect(state.balanceSol).toBe(10)

    // 2. Buy coin A twice at different token prices. THE core requirement: this must
    //    become ONE position with a TOKEN-weighted average entry — not two rows, which is
    //    the bug in the extension this replaces.
    //    1 SOL at $10/token buys (1 × 100) / 10 = 10 tokens.
    //    1 SOL at $20/token buys (1 × 100) / 20 = 5 tokens — half as many, because they
    //    cost twice as much.
    const first = await send(state, buy(A, 1, 10))
    expect(first.response.tokensBought).toBeCloseTo(10, 9)
    state = first.state

    const second = await send(state, buy(A, 1, 20))
    expect(second.response.tokensBought).toBeCloseTo(5, 9)
    state = second.state

    expect(Object.keys(state.positions)).toEqual([A]) // one row, always
    expect(state.positions[A].qty).toBeCloseTo(15, 9) // 10 + 5 tokens
    // Weighted by TOKENS: (10 × 10 + 5 × 20) / 15 = 13.33…, NOT the naive price average
    // of 15. $200 spent on 15 tokens really is $13.33 a token.
    expect(state.positions[A].avgEntryUsd).toBeCloseTo((10 * 10 + 5 * 20) / 15, 9)
    expect(state.positions[A].solInvested).toBeCloseTo(2, 9) // SOL actually spent
    expect(state.balanceSol).toBeCloseTo(8, 9) // 10 − 1 − 1

    // 3. Buy a second coin. Multi-coin: A must be untouched by B.
    //    2 SOL at $5/token buys (2 × 100) / 5 = 40 tokens.
    state = await apply(state, buy(B, 2, 5))

    expect(Object.keys(state.positions).sort()).toEqual([A, B].sort())
    expect(state.positions[A].qty).toBeCloseTo(15, 9)
    expect(state.positions[A].avgEntryUsd).toBeCloseTo((10 * 10 + 5 * 20) / 15, 9)
    expect(state.positions[B].qty).toBeCloseTo(40, 9)
    expect(state.positions[B].avgEntryUsd).toBeCloseTo(5, 9)
    expect(state.positions[B].solInvested).toBeCloseTo(2, 9)
    expect(state.balanceSol).toBeCloseTo(6, 9)

    // 4. The user closes the tab. The background keeps pricing BOTH coins and keeps the
    //    SOL/USD rate current — this is the "leave it running and it still tracks"
    //    requirement.
    state = await refreshAllPositions(state, marketAt({ [A]: 30, [B]: 4 }), async () => null, solUsdAt(SOL_USD))

    expect(state.positions[A].lastPriceUsd).toBe(30)
    expect(state.positions[B].lastPriceUsd).toBe(4)
    expect(state.solUsdPrice).toBe(SOL_USD) // the refresh owns the rate trades depend on

    // 5. Unrealised PnL, per coin, in both currencies: A is up, B is down.
    //    A: 15 tokens now worth $450 against $200 paid → +$250, +125%. In SOL that is
    //    450/100 = 4.5 SOL of value against the 2 SOL actually invested → +2.5 SOL.
    const pnlA = getUnrealizedPnl(state.positions[A], SOL_USD)
    expect(pnlA.pnlUsd).toBeCloseTo(250, 9)
    expect(pnlA.pnlPct).toBeCloseTo(125, 9)
    expect(pnlA.valueUsd).toBeCloseTo(450, 9)
    expect(pnlA.valueSol).toBeCloseTo(4.5, 9)
    expect(pnlA.pnlSol).toBeCloseTo(2.5, 9) // 4.5 − solInvested 2

    //    B: 40 tokens now worth $160 against $200 paid → −$40, −20%, and 1.6 SOL of value
    //    against 2 SOL invested → −0.4 SOL. Nothing here is a 20-SOL loss on a 2-SOL bet.
    const pnlB = getUnrealizedPnl(state.positions[B], SOL_USD)
    expect(pnlB.pnlUsd).toBeCloseTo(-40, 9)
    expect(pnlB.pnlPct).toBeCloseTo(-20, 9)
    expect(pnlB.valueSol).toBeCloseTo(1.6, 9)
    expect(pnlB.pnlSol).toBeCloseTo(-0.4, 9)

    // 6. Portfolio totals across both coins.
    let stats = getPortfolioStats(state)
    expect(stats.openPositions).toBe(2)
    expect(stats.balanceSol).toBeCloseTo(6, 9)
    expect(stats.positionValueSol).toBeCloseTo(6.1, 9) // 4.5 + 1.6
    expect(stats.unrealizedPnlSol).toBeCloseTo(2.1, 9) // +2.5 − 0.4
    expect(stats.totalPnlUsd).toBeCloseTo(210, 9) // +250 − 40
    expect(stats.realizedPnlSol).toBe(0) // nothing closed yet
    expect(stats.winRate).toBeNull() // no closed slices to judge
    // The whole account still balances: 6 SOL cash + 6.1 SOL of coins = 12.1, which is
    // the 10 funded plus the 2.1 unrealised.
    expect(stats.balanceSol + stats.positionValueSol).toBeCloseTo(10 + stats.unrealizedPnlSol, 9)

    // 7. Sell half of A. The remainder keeps its average entry, and its cost basis shrinks
    //    by exactly the fraction sold; the position stays open.
    //    7.5 tokens at $30 = $225 = 2.25 SOL of proceeds against 1 SOL of basis → +1.25 SOL.
    const half = await send(state, sell(A, 0.5, 30))
    expect(half.response.realizedPnlSol).toBeCloseTo(1.25, 9)
    expect(half.response.realizedPnlUsd).toBeCloseTo((30 - (10 * 10 + 5 * 20) / 15) * 7.5, 9) // +125
    state = half.state

    expect(state.positions[A].qty).toBeCloseTo(7.5, 9)
    expect(state.positions[A].avgEntryUsd).toBeCloseTo((10 * 10 + 5 * 20) / 15, 9) // unchanged for what's left
    expect(state.positions[A].solInvested).toBeCloseTo(1, 9) // half the basis went with the sold half
    expect(state.balanceSol).toBeCloseTo(8.25, 9) // 6 + 2.25 proceeds
    expect(state.tradeHistory.filter((t) => t.side === 'sell')).toHaveLength(1)

    // 8. Close A entirely with the 100% preset. It disappears; B is untouched and still
    //    tracking. Selling the rest realises the same +1.25 SOL as the first half did.
    const closed = await send(state, sell(A, 1, 30))
    expect(closed.response.realizedPnlSol).toBeCloseTo(1.25, 9)
    state = closed.state

    expect(state.positions[A]).toBeUndefined()
    expect(state.positions[B].qty).toBeCloseTo(40, 9)
    expect(state.balanceSol).toBeCloseTo(10.5, 9) // 8.25 + 2.25
    // A cost 2 SOL and returned 4.5 SOL, so the realised total is exactly +2.5 SOL —
    // measured against what was paid, never against a reconstructed historical rate.
    stats = getPortfolioStats(state)
    expect(stats.realizedPnlSol).toBeCloseTo(2.5, 9)
    expect(stats.winRate).toBe(1) // both closed slices were profitable
    expect(stats.openPositions).toBe(1)

    // 9. History records every leg with both currencies and the rate used: 3 buys, 2 sells.
    const buys = state.tradeHistory.filter((t) => t.side === 'buy')
    const sells = state.tradeHistory.filter((t) => t.side === 'sell')
    expect(buys).toHaveLength(3)
    expect(sells).toHaveLength(2)
    expect(buys.map((t) => t.solAmount)).toEqual([1, 1, 2]) // SOL spent
    expect(buys.map((t) => t.tokenAmount)).toEqual([10, 5, 40]) // tokens received
    expect(buys.every((t) => t.solUsdPrice === SOL_USD)).toBe(true)
    expect(sells.map((t) => t.fraction)).toEqual([0.5, 1])
    expect(sells.map((t) => t.tokenAmount)).toEqual([7.5, 7.5])
    expect(sells.map((t) => t.solAmount)).toEqual([2.25, 2.25]) // proceeds in SOL
    sells.forEach((t) => expect(t.realizedPnlSol).toBeCloseTo(1.25, 9))
    expect(state.tradeHistory.every((t) => typeof t.id === 'string' && t.id.length > 0)).toBe(true)

    // 10. Coming back later, B keeps updating on its own.
    state = await refreshAllPositions(state, marketAt({ [B]: 9 }), async () => null, solUsdAt(SOL_USD))
    const laterB = getUnrealizedPnl(state.positions[B], SOL_USD)
    expect(laterB.pnlUsd).toBeCloseTo((9 - 5) * 40, 9) // +160
    expect(laterB.pnlSol).toBeCloseTo(3.6 - 2, 9) // 360/100 of value against 2 SOL paid
    expect(getPortfolioStats(state).unrealizedPnlSol).toBeCloseTo(1.6, 9)
  })

  it('measures SOL PnL against SOL actually invested, not against a re-derived rate', async () => {
    // The case the old model could not express at all, and the reason `solInvested` is
    // stored: the SOL/USD rate moves BETWEEN the two buys. A position can be exactly flat
    // in USD while being down in SOL, because SOL itself got more expensive. Deriving the
    // SOL figure from the USD one (pnlUsd / rate) would report a comfortable 0 here.
    let state = await apply(funded(), { type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 10 } })

    state = await apply(state, buy(A, 1, 10, { solUsdPrice: 100 })) // 1 SOL → $100 → 10 tokens
    state = await apply(state, buy(A, 1, 10, { solUsdPrice: 200 })) // 1 SOL → $200 → 20 tokens

    expect(Object.keys(state.positions)).toEqual([A]) // still one row across a rate change
    expect(state.positions[A].qty).toBeCloseTo(30, 9)
    expect(state.positions[A].avgEntryUsd).toBeCloseTo(10, 9) // both buys were $10/token
    expect(state.positions[A].solInvested).toBeCloseTo(2, 9)

    // Price never moved, so USD PnL is genuinely zero...
    const pnl = getUnrealizedPnl(state.positions[A], 200)
    expect(pnl.pnlUsd).toBeCloseTo(0, 9)
    expect(pnl.pnlPct).toBeCloseTo(0, 9)
    // ...but 30 tokens at $10 is $300 = 1.5 SOL, against 2 SOL paid: a real 0.5 SOL loss.
    expect(pnl.valueSol).toBeCloseTo(1.5, 9)
    expect(pnl.pnlSol).toBeCloseTo(-0.5, 9)

    // Closing it realises that same loss, and the win rate reads the recorded SOL figure —
    // so a USD-flat, SOL-negative close counts as a loss, not a win.
    const closed = await send(state, sell(A, 1, 10, { solUsdPrice: 200 }))
    expect(closed.response.realizedPnlSol).toBeCloseTo(-0.5, 9)
    expect(closed.response.realizedPnlUsd).toBeCloseTo(0, 9)
    state = closed.state

    expect(state.balanceSol).toBeCloseTo(8 + 1.5, 9) // 10 − 2 spent + 1.5 back
    const stats = getPortfolioStats(state)
    expect(stats.realizedPnlSol).toBeCloseTo(-0.5, 9)
    expect(stats.winRate).toBe(0)
  })

  it('reports SOL figures as unknown until a SOL/USD rate is known', async () => {
    // An honest "—" beats a number invented from a made-up rate.
    expect(DEFAULT_STATE.solUsdPrice).toBe(0)

    let state = await apply(funded(), { type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 10 } })
    state = await apply(state, buy(A, 1, 10))

    const rateless = { ...state, solUsdPrice: 0 }
    expect(getUnrealizedPnl(rateless.positions[A], 0).pnlSol).toBeNull()
    expect(getUnrealizedPnl(rateless.positions[A], 0).valueSol).toBeNull()
    expect(getUnrealizedPnl(rateless.positions[A], 0).pnlUsd).toBeCloseTo(0, 9) // USD still works

    const stats = getPortfolioStats(rateless)
    expect(stats.unrealizedPnlSol).toBeNull()
    expect(stats.positionValueSol).toBe(0)

    // And a refresh is what fixes it: it resolves the rate and writes it into state.
    const refreshed = await refreshAllPositions(rateless, marketAt({ [A]: 20 }), async () => null, solUsdAt(50))
    expect(refreshed.solUsdPrice).toBe(50)
    // 10 tokens at $20 = $200 = 4 SOL at the new rate, against 1 SOL paid.
    expect(getPortfolioStats(refreshed).unrealizedPnlSol).toBeCloseTo(3, 9)
  })

  it('refuses a trade when no SOL/USD rate is available, leaving the account untouched', async () => {
    // Without a rate the engine cannot say how many tokens the SOL buys, and inventing a
    // quantity would corrupt every later number. The router must answer { ok: false }
    // rather than throw, because the service worker's caller would otherwise hang.
    const state = await apply({ ...DEFAULT_STATE }, { type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 10 } })
    expect(state.solUsdPrice).toBe(0)

    const { nextState, response } = await handleMessage(buy(A, 1, 10), state)

    expect(response.ok).toBe(false)
    expect(response.error).toMatch(/SOL\/USD/i)
    expect(nextState.positions).toEqual({})
    expect(nextState.balanceSol).toBe(10)
    expect(nextState.tradeHistory).toEqual([])
  })

  it('prefers a fresher SOL/USD rate carried on the trade over the one in state', async () => {
    // A trade fired right after a price fetch knows a newer rate than the last tick did,
    // and the token count must be computed at the rate the user actually traded at.
    let state = await apply(funded(), { type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 10 } })

    const { state: next, response } = await send(state, buy(A, 1, 10, { solUsdPrice: 200 }))
    expect(response.tokensBought).toBeCloseTo(20, 9) // (1 × 200) / 10, not the stale (1 × 100) / 10
    state = next

    expect(state.positions[A].qty).toBeCloseTo(20, 9)
    expect(state.tradeHistory[0].solUsdPrice).toBe(200) // the rate is recorded with the trade
  })

  it('keeps ten coins independent, with one bad price not touching the others', async () => {
    let state = await apply(funded(), { type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 100 } })

    const mints = Array.from({ length: 10 }, (_, i) => `MINT_${i}`.padEnd(40, 'x'))
    // 1 SOL each at $(10 + i)/token → (1 × 100) / (10 + i) tokens each.
    for (const [i, mint] of mints.entries()) state = await apply(state, buy(mint, 1, 10 + i))

    expect(Object.keys(state.positions)).toHaveLength(10)
    for (const [i, mint] of mints.entries()) {
      expect(state.positions[mint].qty).toBeCloseTo(100 / (10 + i), 9)
      expect(state.positions[mint].solInvested).toBeCloseTo(1, 9)
    }
    expect(state.balanceSol).toBeCloseTo(90, 9)

    // Every coin prices except the first, which the market can't answer for.
    const prices = Object.fromEntries(mints.slice(1).map((m, i) => [m, 20 + i]))
    state = await refreshAllPositions(state, marketAt(prices), async () => null, solUsdAt(SOL_USD))

    expect(state.positions[mints[0]].stale).toBe(true)
    expect(state.positions[mints[0]].lastPriceUsd).toBe(10) // last known price kept, not zeroed
    expect(state.positions[mints[0]].qty).toBeCloseTo(10, 9) // and the holding is not disturbed
    // A stale row still reports coherent numbers off its last known price rather than a
    // wild loss: 10 tokens at $10 is the $100 it cost, so it is flat in both currencies.
    const stalePnl = getUnrealizedPnl(state.positions[mints[0]], SOL_USD)
    expect(stalePnl.pnlUsd).toBeCloseTo(0, 9)
    expect(stalePnl.pnlSol).toBeCloseTo(0, 9)

    for (const mint of mints.slice(1)) expect(state.positions[mint].stale).toBe(false)
    // The second coin repriced from $11 to $20: 100/11 tokens × $9 of gain.
    expect(getUnrealizedPnl(state.positions[mints[1]], SOL_USD).pnlUsd).toBeCloseTo((20 - 11) * (100 / 11), 9)
    // Portfolio value counts all ten, the stale one at its last known price.
    expect(getPortfolioStats(state).openPositions).toBe(10)
  })

  it('records priority fees against the balance, so PnL reflects real trading cost', async () => {
    let state = await apply(funded(), { type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 5 } })

    state = await apply(state, buy(A, 1, 10, { priorityFeeSol: 0.001, slippagePct: 0.5 }))

    expect(state.balanceSol).toBeCloseTo(5 - 1 - 0.001, 9)
    expect(state.tradeHistory[0].priorityFeeSol).toBe(0.001)
    expect(state.tradeHistory[0].slippagePct).toBe(0.5)
    // The fee is a cost of transacting, not part of the position: the full 1 SOL bought
    // tokens, and the basis is that 1 SOL — otherwise entry price would drift with fees.
    expect(state.positions[A].qty).toBeCloseTo(10, 9)
    expect(state.positions[A].solInvested).toBeCloseTo(1, 9)

    // The fee is charged again on the way out, on top of the proceeds.
    state = await apply(state, sell(A, 1, 10, { priorityFeeSol: 0.002 }))
    expect(state.balanceSol).toBeCloseTo(5 - 1 - 0.001 + 1 - 0.002, 9) // round trip at a flat price
    expect(state.tradeHistory[1].priorityFeeSol).toBe(0.002)
  })

  it('backfills token identity for every held coin while the user is away', async () => {
    let state = await apply(funded(), { type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 10 } })
    state = await apply(state, buy(A, 1, 10))
    state = await apply(state, buy(B, 1, 10))

    const metadata = vi.fn(async (mint) => ({
      name: mint === A ? 'Alpha' : 'Beta',
      symbol: mint === A ? 'ALP' : 'BET',
      imageUrl: 'https://img/x.png',
    }))
    state = await refreshAllPositions(state, marketAt({ [A]: 11, [B]: 12 }), metadata, solUsdAt(SOL_USD))

    expect(state.positions[A].name).toBe('Alpha')
    expect(state.positions[B].symbol).toBe('BET')
    // Identity is cosmetic and must not disturb the accounting it rides along with.
    expect(state.positions[A].qty).toBeCloseTo(10, 9)
    expect(state.positions[A].solInvested).toBeCloseTo(1, 9)
    // Named once, not re-fetched on every tick.
    state = await refreshAllPositions(state, marketAt({ [A]: 11, [B]: 12 }), metadata, solUsdAt(SOL_USD))
    expect(metadata).toHaveBeenCalledTimes(2)
  })

  it('refuses to sell more than is held, leaving the account exactly as it was', async () => {
    // Sells are fractions, so "more than is held" is any fraction above 1 — the engine
    // must reject it rather than manufacture tokens or a negative holding.
    let state = await apply(funded(), { type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 10 } })
    state = await apply(state, buy(A, 1, 10))
    const before = JSON.parse(JSON.stringify(state))

    const oversized = await handleMessage(sell(A, 1.5, 10), state)
    expect(oversized.response.ok).toBe(false)
    expect(oversized.nextState).toEqual(before) // no partial mutation

    // A zero-size sell is equally meaningless, and an unknown mint has nothing to sell.
    const zero = await handleMessage(sell(A, 0, 10), state)
    expect(zero.response.ok).toBe(false)
    expect(zero.nextState).toEqual(before)

    const unheld = await handleMessage(sell(B, 1, 10), state)
    expect(unheld.response.ok).toBe(false)
    expect(unheld.nextState).toEqual(before)
  })
})
