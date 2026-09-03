import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchPumpFunPrice } from './pumpfun.js'

beforeEach(() => {
  globalThis.fetch = vi.fn()
})

describe('fetchPumpFunPrice', () => {
  it('returns the USD price for a bonding-curve token', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ usd_market_cap: 45000, price_usd: '0.0000045' }) })
    expect(await fetchPumpFunPrice('M')).toBeCloseTo(0.0000045)
  })

  it('returns null on a non-ok response (token graduated or not found)', async () => {
    fetch.mockResolvedValue({ ok: false })
    expect(await fetchPumpFunPrice('M')).toBeNull()
  })

  it('returns null (not a rejected promise) on a network error', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchPumpFunPrice('M')).resolves.toBeNull()
  })

  it('returns null when price_usd is absent from the response body', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ usd_market_cap: 100 }) })
    expect(await fetchPumpFunPrice('M')).toBeNull()
  })
})
