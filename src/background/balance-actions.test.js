import { describe, it, expect } from 'vitest'
import { topUp, withdraw, resetAccount } from './balance-actions.js'
import { DEFAULT_STATE } from '../lib/storage.js'

describe('balance actions', () => {
  it('topUp adds to balanceSol', () => {
    const next = topUp({ ...DEFAULT_STATE, balanceSol: 1 }, 2)
    expect(next.balanceSol).toBe(3)
  })

  it('withdraw subtracts from balanceSol', () => {
    const next = withdraw({ ...DEFAULT_STATE, balanceSol: 3 }, 1)
    expect(next.balanceSol).toBe(2)
  })

  it('withdraw throws rather than going negative', () => {
    expect(() => withdraw({ ...DEFAULT_STATE, balanceSol: 1 }, 5)).toThrow()
  })

  it('withdraw of exactly the full balance is allowed and leaves exactly zero', () => {
    const next = withdraw({ ...DEFAULT_STATE, balanceSol: 2 }, 2)
    expect(next.balanceSol).toBe(0)
  })

  it('topUp and withdraw both reject a non-positive amount', () => {
    expect(() => topUp({ ...DEFAULT_STATE, balanceSol: 1 }, 0)).toThrow()
    expect(() => topUp({ ...DEFAULT_STATE, balanceSol: 1 }, -1)).toThrow()
    expect(() => withdraw({ ...DEFAULT_STATE, balanceSol: 1 }, 0)).toThrow()
    expect(() => withdraw({ ...DEFAULT_STATE, balanceSol: 1 }, -1)).toThrow()
  })

  it('resetAccount clears positions/history/snapshots and sets a fresh balance', () => {
    const state = {
      ...DEFAULT_STATE,
      balanceSol: 0.4,
      positions: { M: {} },
      tradeHistory: [{ id: '1' }],
      portfolioSnapshots: [{ timestamp: 1 }],
    }
    const next = resetAccount(state, 5)
    expect(next.balanceSol).toBe(5)
    // NOT toMatchObject: its subset semantics make `positions: {}` vacuously true for ANY object, so
    // deleting the `positions: {}` clause from resetAccount would still pass. toEqual is exact.
    expect(next.positions).toEqual({})
    expect(next.tradeHistory).toEqual([])
    expect(next.portfolioSnapshots).toEqual([])
  })

  it('topUp and withdraw reject a non-finite amount rather than poisoning balanceSol with NaN', () => {
    expect(() => topUp({ ...DEFAULT_STATE, balanceSol: 1 }, NaN)).toThrow()
    expect(() => topUp({ ...DEFAULT_STATE, balanceSol: 1 }, Infinity)).toThrow()
    expect(() => withdraw({ ...DEFAULT_STATE, balanceSol: 1 }, NaN)).toThrow()
    expect(() => withdraw({ ...DEFAULT_STATE, balanceSol: 1 }, Infinity)).toThrow()
  })

  it('resetAccount rejects a non-finite or negative starting balance (but allows exactly zero)', () => {
    expect(() => resetAccount(DEFAULT_STATE, NaN)).toThrow()
    expect(() => resetAccount(DEFAULT_STATE, -1)).toThrow()
    expect(resetAccount(DEFAULT_STATE, 0).balanceSol).toBe(0) // 0 is the onboarding-gate value, must stay legal
  })

  it('resetAccount preserves settings (paper-mode toggle survives a reset)', () => {
    const state = { ...DEFAULT_STATE, settings: { paperModeEnabled: false } }
    const next = resetAccount(state, 5)
    expect(next.settings).toEqual({ paperModeEnabled: false })
  })
})
