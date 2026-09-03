import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getState, setState, DEFAULT_STATE, SCHEMA_VERSION } from './storage.js'

beforeEach(() => {
  const store = {}
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn((keys, cb) => cb({ ...store })),
        set: vi.fn((items, cb) => {
          Object.assign(store, items)
          cb?.()
        }),
      },
    },
  }
})

describe('storage', () => {
  it('returns DEFAULT_STATE when nothing is stored yet', async () => {
    const state = await getState()
    expect(state).toEqual(DEFAULT_STATE)
    expect(state.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('setState merges a partial update and persists it', async () => {
    await setState({ balanceSol: 5 })
    const state = await getState()
    expect(state.balanceSol).toBe(5)
    expect(state.positions).toEqual({}) // untouched fields survive the merge
  })

  it('never mutates the shared DEFAULT_STATE object across calls', async () => {
    const before = JSON.parse(JSON.stringify(DEFAULT_STATE))
    await setState({ balanceSol: 99 })
    await getState()
    expect(DEFAULT_STATE).toEqual(before)
  })

  it('two sequential setState calls both survive (no lost update from a stale merge base)', async () => {
    await setState({ balanceSol: 1 })
    await setState({ settings: { paperModeEnabled: false } })
    const state = await getState()
    expect(state.balanceSol).toBe(1)
    expect(state.settings.paperModeEnabled).toBe(false)
  })

  it('always includes schemaVersion, even on a state written before the field existed', async () => {
    chrome.storage.local.set({ balanceSol: 2 }, () => {}) // simulate a legacy stored object missing schemaVersion
    const state = await getState()
    expect(state.schemaVersion).toBe(SCHEMA_VERSION)
  })
})
