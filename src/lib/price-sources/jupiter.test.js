import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchJupiterPrice, SOL_MINT } from './jupiter.js'

beforeEach(() => {
  globalThis.fetch = vi.fn()
})

describe('fetchJupiterPrice', () => {
  it('returns the USD price as a number on success', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ M: { usdPrice: 13.4 } }) })
    const price = await fetchJupiterPrice('M')
    expect(price).toBeCloseTo(13.4)
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('M'))
  })

  it('returns null when the token is not present in the response', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    expect(await fetchJupiterPrice('missing')).toBeNull()
  })

  it('returns null on a non-ok response instead of throwing', async () => {
    fetch.mockResolvedValue({ ok: false })
    expect(await fetchJupiterPrice('M')).toBeNull()
  })

  it('returns null (not a rejected promise) when fetch itself throws a network error', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchJupiterPrice('M')).resolves.toBeNull()
  })

  it('returns null when the response body is not valid JSON', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })
    await expect(fetchJupiterPrice('M')).resolves.toBeNull()
  })

  it('exposes the wrapped SOL mint address for SOL/USD conversion', () => {
    expect(SOL_MINT).toBe('So11111111111111111111111111111111111111112')
  })
})
