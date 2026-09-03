import { describe, it, expect } from 'vitest'
import { handleMessage } from './message-router.js'
import { DEFAULT_STATE } from '../lib/storage.js'

// DEFAULT_STATE is a shared module-level object whose `positions`/`tradeHistory` references would
// otherwise be shared by every test in this file; clone so no test can leak into another.
function freshState(overrides) {
  return { ...structuredClone(DEFAULT_STATE), ...overrides }
}

describe('handleMessage', () => {
  it('BUY applies the trade and appends it to tradeHistory', async () => {
    const state = freshState({ balanceSol: 1 })
    const { nextState, response } = await handleMessage(
      {
        type: 'BUY',
        payload: {
          mint: 'M',
          symbol: 'M',
          name: 'M',
          imageUrl: '',
          qtySol: 0.1,
          priceUsd: 10,
          priorityFeeSol: 0.001,
          slippagePct: 20,
        },
      },
      state,
    )
    expect(nextState.positions['M'].qty).toBeCloseTo(0.1, 10)
    // precision 5: the whole priority fee is 0.001, so the default precision of 2 (tolerance 0.005)
    // would pass even if the fee were never deducted at all.
    expect(nextState.balanceSol).toBeCloseTo(1 - 0.1 - 0.001, 5) // trade cost + priority fee deducted
    expect(nextState.tradeHistory).toHaveLength(1)
    expect(nextState.tradeHistory[0]).toMatchObject({
      mint: 'M',
      side: 'buy',
      qtySol: 0.1,
      priceUsd: 10,
      priorityFeeSol: 0.001,
      slippagePct: 20,
    })
    expect(response).toEqual({ ok: true })
  })

  it('SELL applies the trade, credits balance, and returns realized PnL', async () => {
    let state = freshState({ balanceSol: 1 })
    state = (
      await handleMessage(
        {
          type: 'BUY',
          payload: {
            mint: 'M',
            symbol: 'M',
            name: 'M',
            imageUrl: '',
            qtySol: 0.1,
            priceUsd: 10,
            priorityFeeSol: 0,
            slippagePct: 0,
          },
        },
        state,
      )
    ).nextState
    const { nextState, response } = await handleMessage(
      { type: 'SELL', payload: { mint: 'M', qtySol: 0.1, priceUsd: 12, priorityFeeSol: 0.001, slippagePct: 20 } },
      state,
    )
    expect(nextState.positions['M']).toBeUndefined()
    // precision 5 for the same reason as the BUY case: the 0.001 fee is smaller than the default tolerance.
    expect(nextState.balanceSol).toBeCloseTo(0.9 + (0.1 * 12) / 10 - 0.001, 5) // sale proceeds minus fee
    expect(nextState.tradeHistory).toHaveLength(2)
    // realized PnL rides on the response, not on the history record (spec §12's trade schema has no
    // realizedPnl field); bought 0.1 @ $10, sold @ $12 => (12 - 10) * 0.1.
    expect(response.ok).toBe(true)
    expect(response.realizedPnlUsd).toBeCloseTo(0.2, 5)
  })

  it('rejects an unknown message type', async () => {
    const { response } = await handleMessage({ type: 'NOPE' }, freshState({}))
    expect(response.ok).toBe(false)
  })

  it('BUY with a non-positive qtySol returns an error response instead of throwing (state unchanged)', async () => {
    const state = freshState({ balanceSol: 1 })
    const snapshot = structuredClone(state)
    const { nextState, response } = await handleMessage(
      {
        type: 'BUY',
        payload: {
          mint: 'M',
          symbol: 'M',
          name: 'M',
          imageUrl: '',
          qtySol: 0,
          priceUsd: 10,
          priorityFeeSol: 0.001,
          slippagePct: 0,
        },
      },
      state,
    )
    expect(response.ok).toBe(false)
    expect(nextState).toEqual(snapshot) // no position, no history row, no fee charged
  })

  it('BUY with a non-positive priceUsd returns an error response instead of throwing (state unchanged)', async () => {
    const state = freshState({ balanceSol: 1 })
    const snapshot = structuredClone(state)
    const { nextState, response } = await handleMessage(
      {
        type: 'BUY',
        payload: {
          mint: 'M',
          symbol: 'M',
          name: 'M',
          imageUrl: '',
          qtySol: 0.1,
          priceUsd: 0,
          priorityFeeSol: 0.001,
          slippagePct: 0,
        },
      },
      state,
    )
    expect(response.ok).toBe(false)
    expect(nextState).toEqual(snapshot)
  })

  it('SELL for more than the held quantity returns an error response instead of throwing (state unchanged)', async () => {
    let state = freshState({ balanceSol: 1 })
    state = (
      await handleMessage(
        {
          type: 'BUY',
          payload: {
            mint: 'M',
            symbol: 'M',
            name: 'M',
            imageUrl: '',
            qtySol: 0.1,
            priceUsd: 10,
            priorityFeeSol: 0,
            slippagePct: 0,
          },
        },
        state,
      )
    ).nextState
    // snapshot BEFORE the call: the router returns the same object reference on the error path, so
    // comparing nextState against the live `state` object would compare it with itself and could
    // never catch an in-place mutation.
    const snapshot = structuredClone(state)
    const { nextState, response } = await handleMessage(
      { type: 'SELL', payload: { mint: 'M', qtySol: 999, priceUsd: 10, priorityFeeSol: 0, slippagePct: 0 } },
      state,
    )
    expect(response.ok).toBe(false)
    expect(nextState).toEqual(snapshot) // rejected trade must not mutate state at all
  })

  it('SELL for a mint with no open position returns an error response instead of throwing', async () => {
    const state = freshState({ balanceSol: 1 })
    const { response } = await handleMessage(
      { type: 'SELL', payload: { mint: 'GHOST', qtySol: 1, priceUsd: 10, priorityFeeSol: 0, slippagePct: 0 } },
      state,
    )
    expect(response.ok).toBe(false)
  })

  it('BUY for more SOL than the current balance still records the trade (paper trading has no hard balance floor, but goes negative visibly rather than silently failing)', async () => {
    const state = freshState({ balanceSol: 0.05 })
    const { nextState, response } = await handleMessage(
      {
        type: 'BUY',
        payload: {
          mint: 'M',
          symbol: 'M',
          name: 'M',
          imageUrl: '',
          qtySol: 1,
          priceUsd: 10,
          priorityFeeSol: 0,
          slippagePct: 0,
        },
      },
      state,
    )
    expect(response.ok).toBe(true)
    expect(nextState.balanceSol).toBeLessThan(0)
  })
})
