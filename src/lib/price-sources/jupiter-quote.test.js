import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchQuotedFillPrice, JUPITER_QUOTE_ENDPOINT } from './jupiter-quote.js'
import { SOL_MINT } from './jupiter.js'

beforeEach(() => {
  globalThis.fetch = vi.fn()
})

const SOL_USD = 200

// Trimmed from a real lite-api.jup.ag/swap/v1/quote response captured 2026-09-03.
// Amounts are decimal strings; swapUsdValue is Jupiter's own USD valuation of the route.
// 0.1 SOL (1e8 lamports) in, 1000 tokens (6 decimals => 1e9 base units) out.
const liveQuote = (overrides = {}) => ({
  inputMint: 'SOL',
  inAmount: '100000000',
  outputMint: 'M',
  outAmount: '1000000000',
  swapMode: 'ExactIn',
  slippageBps: 100,
  priceImpactPct: '0.0000683924200613703335415274',
  swapUsdValue: '25',
  ...overrides,
})

const liveQuoteWithout = (...keys) =>
  Object.fromEntries(Object.entries(liveQuote()).filter(([key]) => !keys.includes(key)))

// The client makes up to two requests: the quote itself, and — only when the
// quote carries no swapUsdValue — the Price API for the SOL/USD rate.
function mockQuote(
  quoteResponse,
  solPriceResponse = { ok: true, json: async () => ({ [SOL_MINT]: { usdPrice: SOL_USD } }) },
) {
  fetch.mockImplementation(async (url) =>
    String(url).startsWith(JUPITER_QUOTE_ENDPOINT) ? quoteResponse : solPriceResponse,
  )
}

const buy = (overrides = {}) =>
  fetchQuotedFillPrice({
    inputMint: 'SOL',
    outputMint: 'M',
    amountLamports: 100000000,
    outputDecimals: 6,
    ...overrides,
  })

describe('fetchQuotedFillPrice', () => {
  it('derives a USD per-token price from the quoted in/out amounts', async () => {
    mockQuote({ ok: true, json: async () => liveQuote() })
    const price = await buy()
    expect(typeof price).toBe('number') // null coerces to 0 inside toBeCloseTo, so pin the type first
    expect(price).toBeCloseTo(0.025, 12) // 25 USD paid / 1000 tokens received
  })

  it('prices in USD, not in SOL — the storage schema and the DOM fallback are both USD', async () => {
    mockQuote({ ok: true, json: async () => liveQuote() })
    const price = await buy()
    expect(price).not.toBeCloseTo(0.1 / 1000, 12) // 0.0001 is the raw SOL-per-token figure
  })

  it('scales the out amount by the token decimals rather than treating it as whole tokens', async () => {
    mockQuote({ ok: true, json: async () => liveQuote() })
    const price = await buy({ outputDecimals: 9 })
    expect(price).toBeCloseTo(25, 9) // 25 USD / 1 token, not 25 / 1000
  })

  it('requests the quote endpoint with the mints, trade size, and slippage', async () => {
    mockQuote({ ok: true, json: async () => liveQuote() })
    await buy()
    expect(fetch).toHaveBeenCalledWith(
      'https://lite-api.jup.ag/swap/v1/quote?inputMint=SOL&outputMint=M&amount=100000000&slippageBps=100',
    )
  })

  it('passes an explicit slippage tolerance through to the quote request', async () => {
    mockQuote({ ok: true, json: async () => liveQuote() })
    await buy({ slippageBps: 250 })
    expect(fetch).toHaveBeenCalledWith(
      'https://lite-api.jup.ag/swap/v1/quote?inputMint=SOL&outputMint=M&amount=100000000&slippageBps=250',
    )
  })

  it('uses the quote-supplied USD value without a second request', async () => {
    mockQuote({ ok: true, json: async () => liveQuote() })
    await buy()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('converts the SOL leg at the spot SOL/USD rate when the quote carries no USD value', async () => {
    mockQuote({ ok: true, json: async () => liveQuoteWithout('swapUsdValue') })
    const price = await buy()
    expect(typeof price).toBe('number')
    expect(price).toBeCloseTo(0.02, 12) // 0.1 SOL * 200 USD/SOL / 1000 tokens
    expect(fetch).toHaveBeenCalledWith(`https://lite-api.jup.ag/price/v3?ids=${SOL_MINT}`)
  })

  it('returns null rather than a SOL-denominated price when the SOL/USD rate is unavailable', async () => {
    mockQuote({ ok: true, json: async () => liveQuoteWithout('swapUsdValue') }, { ok: false })
    expect(await buy()).toBeNull()
  })

  it('returns null on a non-ok response (no route / illiquid token)', async () => {
    mockQuote({ ok: false })
    expect(await buy({ amountLamports: 1 })).toBeNull()
  })

  it('returns null (not a rejected promise) on a network error', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(buy({ amountLamports: 1 })).resolves.toBeNull()
  })

  it('returns null (not a rejected promise) when the response body is not valid JSON', async () => {
    mockQuote({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })
    await expect(buy()).resolves.toBeNull()
  })

  it('returns null instead of dividing by zero when outAmount is zero', async () => {
    mockQuote({ ok: true, json: async () => liveQuote({ outAmount: '0' }) })
    expect(await buy()).toBeNull()
  })

  it('returns null when the response is missing inAmount/outAmount entirely', async () => {
    mockQuote({ ok: true, json: async () => ({ error: 'no route found' }) })
    expect(await buy({ amountLamports: 1 })).toBeNull()
  })

  it('returns null rather than NaN when inAmount is not numeric', async () => {
    mockQuote({ ok: true, json: async () => liveQuote({ inAmount: 'abc' }) })
    expect(await buy()).toBeNull()
  })

  it('returns null rather than NaN when outAmount is not numeric', async () => {
    mockQuote({ ok: true, json: async () => liveQuote({ outAmount: 'abc' }) })
    expect(await buy()).toBeNull()
  })

  it('returns null rather than NaN when the token decimals are missing', async () => {
    mockQuote({ ok: true, json: async () => liveQuote() })
    expect(await buy({ outputDecimals: undefined })).toBeNull()
  })
})
