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
    const price = await fetchDexScreenerPrice('M')
    expect(typeof price).toBe('number') // DexScreener ships priceUsd as a string; it must be converted
    expect(price).toBe(0.0012)
  })

  it('picks the highest-liquidity pair when it is first in the list, not merely the last one', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        pairs: [
          { priceUsd: '0.9', liquidity: { usd: 90000 } },
          { priceUsd: '0.2', liquidity: { usd: 10 } },
        ],
      }),
    })
    expect(await fetchDexScreenerPrice('M')).toBe(0.9)
  })

  it('requests the token endpoint for the given mint', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ pairs: [] }) })
    await fetchDexScreenerPrice('M')
    expect(fetch).toHaveBeenCalledWith('https://api.dexscreener.com/latest/dex/tokens/M')
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

  it('returns null (not a rejected promise) when the response body is not valid JSON', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })
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
    expect(await fetchDexScreenerPrice('M')).toBe(0.7)
  })

  it('treats a missing liquidity field on the leading pair as zero rather than crashing', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        pairs: [
          { priceUsd: '0.7', liquidity: { usd: 1000 } },
          { priceUsd: '0.5', liquidity: undefined },
        ],
      }),
    })
    expect(await fetchDexScreenerPrice('M')).toBe(0.7)
  })

  it('returns null rather than NaN when the winning pair has no usable priceUsd', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ pairs: [{ priceUsd: undefined, liquidity: { usd: 50000 } }] }),
    })
    expect(await fetchDexScreenerPrice('M')).toBeNull()
  })
})
