import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchQuotedFillPrice } from './jupiter-quote.js'

beforeEach(() => {
  globalThis.fetch = vi.fn()
})

describe('fetchQuotedFillPrice', () => {
  it('derives a per-token price from the quoted in/out amounts', async () => {
    // 0.1 SOL (1e8 lamports) in, 1000 tokens (with 6 decimals => 1e9 base units) out
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ inAmount: '100000000', outAmount: '1000000000' }),
    })
    const price = await fetchQuotedFillPrice({
      inputMint: 'SOL',
      outputMint: 'M',
      amountLamports: 100000000,
      outputDecimals: 6,
    })
    expect(price).toBeCloseTo(0.1 / 1000)
  })

  it('returns null on a non-ok response (no route / illiquid token)', async () => {
    fetch.mockResolvedValue({ ok: false })
    const price = await fetchQuotedFillPrice({
      inputMint: 'SOL',
      outputMint: 'M',
      amountLamports: 1,
      outputDecimals: 6,
    })
    expect(price).toBeNull()
  })

  it('returns null (not a rejected promise) on a network error', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    const price = await fetchQuotedFillPrice({
      inputMint: 'SOL',
      outputMint: 'M',
      amountLamports: 1,
      outputDecimals: 6,
    })
    expect(price).toBeNull()
  })

  it('returns null instead of dividing by zero when outAmount is zero', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ inAmount: '100000000', outAmount: '0' }) })
    const price = await fetchQuotedFillPrice({
      inputMint: 'SOL',
      outputMint: 'M',
      amountLamports: 100000000,
      outputDecimals: 6,
    })
    expect(price).toBeNull()
  })

  it('returns null when the response is missing inAmount/outAmount entirely', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ error: 'no route found' }) })
    const price = await fetchQuotedFillPrice({
      inputMint: 'SOL',
      outputMint: 'M',
      amountLamports: 1,
      outputDecimals: 6,
    })
    expect(price).toBeNull()
  })
})
