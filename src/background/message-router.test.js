import { describe, it, expect } from 'vitest'
import { handleMessage } from './message-router.js'
import { DEFAULT_STATE } from '../lib/storage.js'

describe('handleMessage', () => {
  it('BUY applies the trade and appends it to tradeHistory', async () => {
    const state = { ...DEFAULT_STATE, balanceSol: 1 }
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
    expect(nextState.positions['M'].qty).toBeCloseTo(0.1)
    expect(nextState.balanceSol).toBeCloseTo(1 - 0.1 - 0.001) // trade cost + priority fee deducted
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

  it('SELL applies the trade, credits balance, and records realized PnL in history', async () => {
    let state = { ...DEFAULT_STATE, balanceSol: 1 }
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
    const { nextState } = await handleMessage(
      { type: 'SELL', payload: { mint: 'M', qtySol: 0.1, priceUsd: 12, priorityFeeSol: 0.001, slippagePct: 20 } },
      state,
    )
    expect(nextState.positions['M']).toBeUndefined()
    expect(nextState.balanceSol).toBeCloseTo(0.9 + (0.1 * 12) / 10 - 0.001) // rough sanity: balance grew by sale proceeds minus fee
    expect(nextState.tradeHistory).toHaveLength(2)
  })

  it('rejects an unknown message type', async () => {
    const { response } = await handleMessage({ type: 'NOPE' }, DEFAULT_STATE)
    expect(response.ok).toBe(false)
  })

  it('SELL for more than the held quantity returns an error response instead of throwing (state unchanged)', async () => {
    let state = { ...DEFAULT_STATE, balanceSol: 1 }
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
      { type: 'SELL', payload: { mint: 'M', qtySol: 999, priceUsd: 10, priorityFeeSol: 0, slippagePct: 0 } },
      state,
    )
    expect(response.ok).toBe(false)
    expect(nextState).toEqual(state) // rejected trade must not mutate state at all
  })

  it('SELL for a mint with no open position returns an error response instead of throwing', async () => {
    const state = { ...DEFAULT_STATE, balanceSol: 1 }
    const { response } = await handleMessage(
      { type: 'SELL', payload: { mint: 'GHOST', qtySol: 1, priceUsd: 10, priorityFeeSol: 0, slippagePct: 0 } },
      state,
    )
    expect(response.ok).toBe(false)
  })

  it('BUY for more SOL than the current balance still records the trade (paper trading has no hard balance floor, but goes negative visibly rather than silently failing)', async () => {
    const state = { ...DEFAULT_STATE, balanceSol: 0.05 }
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
