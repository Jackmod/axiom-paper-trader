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
    expect(next).toMatchObject({ balanceSol: 5, positions: {}, tradeHistory: [], portfolioSnapshots: [] })
  })

  it('resetAccount preserves settings (paper-mode toggle survives a reset)', () => {
    const state = { ...DEFAULT_STATE, settings: { paperModeEnabled: false } }
    const next = resetAccount(state, 5)
    expect(next.settings).toEqual({ paperModeEnabled: false })
  })
})
