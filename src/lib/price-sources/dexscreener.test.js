import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchDexScreenerPrice } from './dexscreener.js'

beforeEach(() => {
  globalThis.fetch = vi.fn()
})

describe('fetchDexScreenerPrice', () => {
  it('returns the highest-liquidity pair price as a number', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        pairs: [
          { priceUsd: '0.001', liquidity: { usd: 500 } },
          { priceUsd: '0.0012', liquidity: { usd: 50000 } },
        ],
      }),
    })
    expect(await fetchDexScreenerPrice('M')).toBeCloseTo(0.0012)
  })

  it('returns null when there are no pairs', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ pairs: [] }) })
    expect(await fetchDexScreenerPrice('M')).toBeNull()
  })

  it('returns null on a non-ok response', async () => {
    fetch.mockResolvedValue({ ok: false })
    expect(await fetchDexScreenerPrice('M')).toBeNull()
  })

  it('returns null (not a rejected promise) on a network error', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchDexScreenerPrice('M')).resolves.toBeNull()
  })

  it('returns null when pairs is missing from the response entirely', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    expect(await fetchDexScreenerPrice('M')).toBeNull()
  })

  it('picks the highest-liquidity pair even when liquidity data is missing on some pairs', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        pairs: [
          { priceUsd: '0.5', liquidity: undefined },
          { priceUsd: '0.7', liquidity: { usd: 1000 } },
        ],
      }),
    })
    expect(await fetchDexScreenerPrice('M')).toBeCloseTo(0.7)
  })
})
