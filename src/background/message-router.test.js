import { describe, it, expect } from 'vitest'
import { handleMessage } from './message-router.js'
import { DEFAULT_STATE } from '../lib/storage.js'

// Every number below is hand-computed from the units contract in position-engine.js:
//   tokens bought = (solSpent * solUsdPrice) / priceUsd
//   proceedsSol   = (tokensSold * priceUsd) / solUsdPrice
//   realizedPnlSol = proceedsSol - solInvested * fraction
// SOL/USD is pinned to 200 and prices to round fractions of a cent so the expectations are
// exact decimals rather than whatever the implementation happens to emit.
const SOL_USD = 200

// DEFAULT_STATE is a shared module-level object whose `positions`/`tradeHistory` references would
// otherwise be shared by every test in this file; clone so no test can leak into another.
// DEFAULT_STATE.solUsdPrice is 0, so any test that expects a trade to succeed must supply a rate —
// either in state (as the every-tick refresh does) or on the payload.
function freshState(overrides) {
  return { ...structuredClone(DEFAULT_STATE), ...overrides }
}

function buyMsg(payload) {
  return { type: 'BUY', payload: { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', ...payload } }
}

describe('handleMessage', () => {
  it('BUY converts SOL spent into TOKENS held and appends the trade to tradeHistory', async () => {
    const state = freshState({ balanceSol: 1, solUsdPrice: SOL_USD })
    const { nextState, response } = await handleMessage(
      buyMsg({ solSpent: 0.1, priceUsd: 0.002, priorityFeeSol: 0.001, slippagePct: 20 }),
      state,
    )

    // 0.1 SOL * $200 = $20 of tokens at $0.002 each = 10,000 TOKENS. Under the old (broken)
    // model qty was the 0.1 SOL spent, so this assertion is what pins the units down.
    const position = nextState.positions['M']
    expect(position.qty).toBeCloseTo(10_000, 6)
    expect(position.avgEntryUsd).toBeCloseTo(0.002, 12)
    expect(position.solInvested).toBeCloseTo(0.1, 12) // SOL actually spent on tokens, fee excluded
    expect(position.lastPriceUsd).toBeCloseTo(0.002, 12)
    expect(position.symbol).toBe('M')
    expect(position.stale).toBe(false)

    // precision 5: the whole priority fee is 0.001, so the default precision of 2 (tolerance 0.005)
    // would pass even if the fee were never deducted at all.
    expect(nextState.balanceSol).toBeCloseTo(1 - 0.1 - 0.001, 5) // trade cost + priority fee deducted
    // The fee is a cost, not part of the cost basis: it leaves the balance but never enters solInvested.
    expect(position.solInvested).not.toBeCloseTo(0.101, 5)

    expect(nextState.tradeHistory).toHaveLength(1)
    expect(nextState.tradeHistory[0]).toMatchObject({
      mint: 'M',
      symbol: 'M',
      side: 'buy',
      solAmount: 0.1,
      priceUsd: 0.002,
      solUsdPrice: SOL_USD,
      priorityFeeSol: 0.001,
      slippagePct: 20,
    })
    // tokenAmount is the new field the old schema could not express: SOL spent and tokens received
    // are different numbers, and the history has to record both.
    expect(nextState.tradeHistory[0].tokenAmount).toBeCloseTo(10_000, 6)
    expect(typeof nextState.tradeHistory[0].id).toBe('string')
    expect(nextState.tradeHistory[0].timestamp).toBeGreaterThan(0)
    // A buy carries no realizedPnlSol — getWinRate counts recorded sell PnL, so a buy that
    // smuggled the field in would corrupt the win rate.
    expect('realizedPnlSol' in nextState.tradeHistory[0]).toBe(false)

    expect(response.ok).toBe(true)
    expect(response.tokensBought).toBeCloseTo(10_000, 6)
  })

  it('BUY of the same mint at a different price merges into ONE position with a token-weighted average entry', async () => {
    let state = freshState({ balanceSol: 1, solUsdPrice: SOL_USD })
    state = (await handleMessage(buyMsg({ solSpent: 0.1, priceUsd: 0.002 }), state)).nextState

    // 0.3 SOL * $200 = $60 at $0.004 = 15,000 more tokens (vs 10,000 from the first buy).
    const { nextState, response } = await handleMessage(buyMsg({ solSpent: 0.3, priceUsd: 0.004 }), state)

    // Never a second row for the same mint — that duplicate-position defect is what this
    // product exists to fix.
    expect(Object.keys(nextState.positions)).toEqual(['M'])
    const position = nextState.positions['M']
    expect(position.qty).toBeCloseTo(25_000, 6)
    // Weighted by TOKENS: (10,000*$0.002 + 15,000*$0.004) / 25,000 = $80/25,000 = $0.0032.
    // A naive average of the two prices would be $0.003, and a SOL-weighted one $0.0035.
    expect(position.avgEntryUsd).toBeCloseTo(0.0032, 12)
    expect(position.solInvested).toBeCloseTo(0.4, 12) // both buys, accumulated
    expect(response.tokensBought).toBeCloseTo(15_000, 6) // just this buy, not the running total
    expect(nextState.tradeHistory).toHaveLength(2)
  })

  it('SELL takes a FRACTION of the holding, credits proceeds, and returns PnL in both currencies', async () => {
    let state = freshState({ balanceSol: 1, solUsdPrice: SOL_USD })
    state = (await handleMessage(buyMsg({ solSpent: 0.1, priceUsd: 0.002 }), state)).nextState
    expect(state.balanceSol).toBeCloseTo(0.9, 12)

    // fraction 1 = Axiom's 100% preset. 10,000 tokens at $0.0024 = $24 = 0.12 SOL of proceeds.
    const { nextState, response } = await handleMessage(
      { type: 'SELL', payload: { mint: 'M', fraction: 1, priceUsd: 0.0024, priorityFeeSol: 0.001, slippagePct: 20 } },
      state,
    )

    expect(nextState.positions['M']).toBeUndefined() // fully closed
    // precision 5 for the same reason as the BUY case: the 0.001 fee is smaller than the default tolerance.
    expect(nextState.balanceSol).toBeCloseTo(0.9 + 0.12 - 0.001, 5) // sale proceeds minus fee

    // PnL in SOL is measured against solInvested — what was actually paid — so it never depends
    // on reconstructing a historical rate: 0.12 SOL out vs 0.1 SOL in = +0.02 SOL.
    expect(response.ok).toBe(true)
    expect(response.realizedPnlSol).toBeCloseTo(0.02, 10)
    // PnL in USD is per-token: ($0.0024 - $0.002) * 10,000 tokens = $4.
    expect(response.realizedPnlUsd).toBeCloseTo(4, 10)

    // Sells record their realized SOL PnL and the fraction closed; getWinRate reads the former
    // rather than replaying the log, so it has to be on the row.
    expect(nextState.tradeHistory).toHaveLength(2)
    const sell = nextState.tradeHistory[1]
    expect(sell).toMatchObject({
      mint: 'M',
      symbol: 'M',
      side: 'sell',
      fraction: 1,
      priceUsd: 0.0024,
      solUsdPrice: SOL_USD,
      priorityFeeSol: 0.001,
      slippagePct: 20,
    })
    expect(sell.solAmount).toBeCloseTo(0.12, 10) // proceeds in SOL, gross of the fee
    expect(sell.tokenAmount).toBeCloseTo(10_000, 6)
    expect(sell.realizedPnlSol).toBeCloseTo(0.02, 10)
  })

  it('a partial SELL leaves the average entry alone and reduces solInvested proportionally', async () => {
    let state = freshState({ balanceSol: 1, solUsdPrice: SOL_USD })
    state = (await handleMessage(buyMsg({ solSpent: 0.1, priceUsd: 0.002 }), state)).nextState

    // 25% preset: 2,500 of 10,000 tokens at $0.0024 = $6 = 0.03 SOL, against 0.025 SOL of basis.
    const { nextState, response } = await handleMessage(
      { type: 'SELL', payload: { mint: 'M', fraction: 0.25, priceUsd: 0.0024 } },
      state,
    )

    const position = nextState.positions['M']
    expect(position.qty).toBeCloseTo(7_500, 6)
    // Selling part of a position does not change what the rest cost.
    expect(position.avgEntryUsd).toBeCloseTo(0.002, 12)
    expect(position.solInvested).toBeCloseTo(0.075, 12)
    expect(response.realizedPnlSol).toBeCloseTo(0.005, 10)
    expect(response.realizedPnlUsd).toBeCloseTo(1, 10)
    expect(nextState.balanceSol).toBeCloseTo(0.9 + 0.03, 10)
  })

  it('a payload solUsdPrice overrides the rate carried in state (the trade just fetched a fresher one)', async () => {
    const state = freshState({ balanceSol: 1, solUsdPrice: 100 })
    const { nextState, response } = await handleMessage(
      buyMsg({ solSpent: 0.1, priceUsd: 0.002, solUsdPrice: 200 }),
      state,
    )

    // At the payload's $200 the 0.1 SOL buys 10,000 tokens; at the stale $100 in state it would
    // buy only 5,000, so this fails loudly if the override is ignored.
    expect(response.tokensBought).toBeCloseTo(10_000, 6)
    expect(nextState.positions['M'].qty).toBeCloseTo(10_000, 6)
    // The rate actually used is what gets recorded, not the stale one.
    expect(nextState.tradeHistory[0].solUsdPrice).toBe(200)
  })

  it('falls back to the rate in state when the payload carries none', async () => {
    const state = freshState({ balanceSol: 1, solUsdPrice: 50 })
    const { nextState, response } = await handleMessage(buyMsg({ solSpent: 0.1, priceUsd: 0.002 }), state)

    // 0.1 SOL * $50 = $5 at $0.002 = 2,500 tokens.
    expect(response.tokensBought).toBeCloseTo(2_500, 6)
    expect(nextState.tradeHistory[0].solUsdPrice).toBe(50)
  })

  it('BUY with no SOL/USD rate anywhere is rejected as { ok: false } and leaves state byte-identical', async () => {
    // DEFAULT_STATE.solUsdPrice is 0 until the first refresh lands. Guessing a rate would invent
    // a token quantity out of nothing, so the router refuses instead.
    const state = freshState({ balanceSol: 1 })
    expect(state.solUsdPrice).toBe(0) // guard: this is the condition under test
    const snapshot = structuredClone(state)

    const { nextState, response } = await handleMessage(buyMsg({ solSpent: 0.1, priceUsd: 0.002 }), state)

    expect(response.ok).toBe(false)
    expect(response.error).toBeTruthy()
    expect(nextState.positions).toEqual({}) // no position invented at a guessed rate
    expect(nextState.tradeHistory).toEqual([]) // no history row
    expect(nextState.balanceSol).toBe(1) // not even the priority fee is charged
    expect(JSON.stringify(nextState)).toBe(JSON.stringify(snapshot))
  })

  it('SELL with no SOL/USD rate anywhere is rejected as { ok: false } and leaves state byte-identical', async () => {
    let state = freshState({ balanceSol: 1, solUsdPrice: SOL_USD })
    state = (await handleMessage(buyMsg({ solSpent: 0.1, priceUsd: 0.002 }), state)).nextState
    // Simulate the rate going missing (a failed refresh) while a position is open.
    state = { ...state, solUsdPrice: 0 }
    // snapshot BEFORE the call: the router returns the same object reference on the error path, so
    // comparing nextState against the live `state` object would compare it with itself and could
    // never catch an in-place mutation.
    const snapshot = structuredClone(state)

    const { nextState, response } = await handleMessage(
      { type: 'SELL', payload: { mint: 'M', fraction: 1, priceUsd: 0.0024, priorityFeeSol: 0.001 } },
      state,
    )

    expect(response.ok).toBe(false)
    expect(response.error).toBeTruthy()
    expect(JSON.stringify(nextState)).toBe(JSON.stringify(snapshot)) // position and balance untouched
  })

  it('rejects an unknown message type', async () => {
    const { response } = await handleMessage({ type: 'NOPE' }, freshState({}))
    expect(response.ok).toBe(false)
  })

  it('BUY with a non-positive solSpent returns an error response instead of throwing (state unchanged)', async () => {
    const state = freshState({ balanceSol: 1, solUsdPrice: SOL_USD })
    const snapshot = structuredClone(state)
    const { nextState, response } = await handleMessage(
      buyMsg({ solSpent: 0, priceUsd: 0.002, priorityFeeSol: 0.001 }),
      state,
    )
    expect(response.ok).toBe(false)
    expect(JSON.stringify(nextState)).toBe(JSON.stringify(snapshot)) // no position, no history row, no fee charged
  })

  it('BUY with a non-positive priceUsd returns an error response instead of throwing (state unchanged)', async () => {
    // priceUsd is the divisor in the token conversion; a zero here would mint Infinity tokens.
    const state = freshState({ balanceSol: 1, solUsdPrice: SOL_USD })
    const snapshot = structuredClone(state)
    const { nextState, response } = await handleMessage(
      buyMsg({ solSpent: 0.1, priceUsd: 0, priorityFeeSol: 0.001 }),
      state,
    )
    expect(response.ok).toBe(false)
    expect(JSON.stringify(nextState)).toBe(JSON.stringify(snapshot))
  })

  it('SELL with a fraction above 1 returns an error response instead of throwing (state unchanged)', async () => {
    // The old model took an absolute qtySol and could oversell; the fraction model's equivalent
    // is a fraction greater than the whole position, which must be refused just as firmly.
    let state = freshState({ balanceSol: 1, solUsdPrice: SOL_USD })
    state = (await handleMessage(buyMsg({ solSpent: 0.1, priceUsd: 0.002 }), state)).nextState
    // snapshot BEFORE the call: the router returns the same object reference on the error path, so
    // comparing nextState against the live `state` object would compare it with itself and could
    // never catch an in-place mutation.
    const snapshot = structuredClone(state)

    const { nextState, response } = await handleMessage(
      { type: 'SELL', payload: { mint: 'M', fraction: 1.5, priceUsd: 0.002, priorityFeeSol: 0.001 } },
      state,
    )
    expect(response.ok).toBe(false)
    expect(JSON.stringify(nextState)).toBe(JSON.stringify(snapshot)) // rejected trade must not mutate state at all
  })

  it('SELL with a non-positive fraction returns an error response instead of throwing', async () => {
    let state = freshState({ balanceSol: 1, solUsdPrice: SOL_USD })
    state = (await handleMessage(buyMsg({ solSpent: 0.1, priceUsd: 0.002 }), state)).nextState
    const snapshot = structuredClone(state)

    const { nextState, response } = await handleMessage(
      { type: 'SELL', payload: { mint: 'M', fraction: 0, priceUsd: 0.002 } },
      state,
    )
    expect(response.ok).toBe(false)
    expect(JSON.stringify(nextState)).toBe(JSON.stringify(snapshot))
  })

  it('SELL for a mint with no open position returns an error response instead of throwing', async () => {
    const state = freshState({ balanceSol: 1, solUsdPrice: SOL_USD })
    const { response } = await handleMessage(
      { type: 'SELL', payload: { mint: 'GHOST', fraction: 1, priceUsd: 0.002 } },
      state,
    )
    expect(response.ok).toBe(false)
  })

  // This used to assert the opposite — that an overdraw was RECORDED and the balance went
  // negative — on the reasoning that rejecting it would silently drop a trade the user
  // believed had gone through. The reasoning was sound while a rejection only reached
  // console.warn; the widget now shows it, so the account can hold its floor. See the
  // 'BUY balance floor' block below.
  it('BUY for more SOL than the current balance never drives the account negative', async () => {
    const state = freshState({ balanceSol: 0.05, solUsdPrice: SOL_USD })
    const { nextState, response } = await handleMessage(buyMsg({ solSpent: 1, priceUsd: 0.002 }), state)
    expect(response.ok).toBe(false)
    expect(nextState.balanceSol).toBe(0.05)
  })
})

describe('SYNC_NOW', () => {
  it('is accepted as a valid message type (the router lets the caller trigger a refresh)', async () => {
    const { response } = await handleMessage({ type: 'SYNC_NOW' }, DEFAULT_STATE)
    expect(response.ok).toBe(true)
  })
})

describe('balance messages', () => {
  it('TOP_UP, WITHDRAW, RESET_ACCOUNT route through to balance-actions', async () => {
    let state = freshState({ balanceSol: 1 })
    state = (await handleMessage({ type: 'TOP_UP', payload: { solAmount: 2 } }, state)).nextState
    expect(state.balanceSol).toBe(3)
    state = (await handleMessage({ type: 'WITHDRAW', payload: { solAmount: 1 } }, state)).nextState
    expect(state.balanceSol).toBe(2)
    state = (await handleMessage({ type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 10 } }, state)).nextState
    expect(state.balanceSol).toBe(10)
  })

  it('RESET_ACCOUNT clears positions, history, and snapshots through the router', async () => {
    let state = freshState({ balanceSol: 1, solUsdPrice: SOL_USD })
    state = (await handleMessage(buyMsg({ solSpent: 0.1, priceUsd: 0.002 }), state)).nextState
    state = { ...state, portfolioSnapshots: [{ timestamp: 1, totalValueUsd: 1 }] }
    expect(Object.keys(state.positions)).toHaveLength(1) // guard: the reset below must have something to clear

    const { nextState, response } = await handleMessage(
      { type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 10 } },
      state,
    )
    expect(response).toEqual({ ok: true })
    expect(nextState.positions).toEqual({})
    expect(nextState.tradeHistory).toEqual([])
    expect(nextState.portfolioSnapshots).toEqual([])
  })

  it('WITHDRAW for more than the balance returns an error response instead of throwing (state unchanged)', async () => {
    const state = freshState({ balanceSol: 1 })
    // snapshot BEFORE the call: the router returns the same object reference on the error path, so
    // comparing nextState against the live `state` object could never catch an in-place mutation.
    const snapshot = structuredClone(state)
    const { nextState, response } = await handleMessage({ type: 'WITHDRAW', payload: { solAmount: 5 } }, state)
    expect(response.ok).toBe(false)
    expect(response.error).toBeTruthy()
    expect(nextState).toEqual(snapshot)
  })

  it('TOP_UP with an invalid amount returns an error response instead of throwing (state unchanged)', async () => {
    const state = freshState({ balanceSol: 1 })
    const snapshot = structuredClone(state)
    for (const solAmount of [0, -1, NaN]) {
      const { nextState, response } = await handleMessage({ type: 'TOP_UP', payload: { solAmount } }, state)
      expect(response.ok).toBe(false)
      expect(response.error).toBeTruthy()
      expect(nextState).toEqual(snapshot)
    }
  })

  it('RESET_ACCOUNT with an invalid starting balance returns an error response instead of throwing', async () => {
    const state = freshState({ balanceSol: 1 })
    const snapshot = structuredClone(state)
    const { nextState, response } = await handleMessage(
      { type: 'RESET_ACCOUNT', payload: { startingBalanceSol: NaN } },
      state,
    )
    expect(response.ok).toBe(false)
    expect(nextState).toEqual(snapshot)
  })
})

// A paper account that can spend SOL it does not have is not simulating risk — it is
// simulating a cheat code. The whole point of the product is to make a bad trade cost
// something, and an unbounded balance means the user can never actually blow up.
//
// This was a deliberate omission once: the balance was allowed to go negative "rather than
// silently dropping a trade the user believes went through", and at the time that was the
// honest trade-off, because a rejected buy only reached console.warn. The widget now shows
// the rejection, so the reason for allowing it is gone.
describe('handleMessage BUY balance floor', () => {
  it('refuses a buy larger than the balance and leaves the account untouched', async () => {
    const state = freshState({ balanceSol: 0.3, solUsdPrice: SOL_USD })
    const { nextState, response } = await handleMessage(buyMsg({ solSpent: 0.5, priceUsd: 0.002 }), state)

    expect(response.ok).toBe(false)
    expect(response.error).toMatch(/0\.3000 SOL/) // says what is actually available
    expect(nextState).toEqual(state) // no position, no history entry, no balance change
  })

  // The fee is part of the cost. A buy that fits only by ignoring it would still overdraw.
  it('counts the priority fee against the balance', async () => {
    const state = freshState({ balanceSol: 0.5, solUsdPrice: SOL_USD })
    const { nextState, response } = await handleMessage(
      buyMsg({ solSpent: 0.5, priceUsd: 0.002, priorityFeeSol: 0.01 }),
      state,
    )

    expect(response.ok).toBe(false)
    expect(nextState).toEqual(state)
  })

  // An empty account is not a shortfall, it is an un-funded one, and the fix is somewhere
  // else entirely. "You have 0.0000 SOL" states the problem; it does not tell a first-run
  // user that the starting balance lives in the side panel.
  it('tells a first-run user where to fund the account instead of quoting a zero balance', async () => {
    const state = freshState({ balanceSol: 0, solUsdPrice: SOL_USD })
    const { response } = await handleMessage(buyMsg({ solSpent: 0.25, priceUsd: 0.002 }), state)

    expect(response.ok).toBe(false)
    expect(response.error).toMatch(/side panel/i)
    expect(response.error).not.toMatch(/0\.0000 SOL/)
  })

  // Spending the balance exactly to the last lamport is a legitimate all-in, not an
  // overdraw, and floating-point noise must not turn it into one.
  it('allows a buy that spends the balance exactly', async () => {
    const state = freshState({ balanceSol: 0.5, solUsdPrice: SOL_USD })
    const { nextState, response } = await handleMessage(buyMsg({ solSpent: 0.5, priceUsd: 0.002 }), state)

    expect(response.ok).toBe(true)
    expect(nextState.balanceSol).toBeCloseTo(0, 12)
  })
})
