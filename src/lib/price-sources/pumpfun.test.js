import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchPumpFunPrice } from './pumpfun.js'

beforeEach(() => {
  globalThis.fetch = vi.fn()
})

// Trimmed from a real frontend-api-v3.pump.fun/coins/<mint> response captured 2026-09-03.
// The live payload has no price field at all — price must be derived from market cap and supply.
const liveCoin = (overrides = {}) => ({
  mint: 'M',
  name: 'Test Coin',
  symbol: 'TEST',
  complete: false,
  base_decimals: 6,
  total_supply: 1000000000000000,
  total_supply_str: '1000000000000000',
  market_cap: 210.5,
  market_cap_usd: 45000,
  usd_market_cap: 45000,
  ...overrides,
})

// Returns the coin document with the named fields absent, to exercise the fallback/guard branches.
const liveCoinWithout = (...keys) =>
  Object.fromEntries(Object.entries(liveCoin()).filter(([key]) => !keys.includes(key)))

describe('fetchPumpFunPrice', () => {
  it('derives the USD price from market cap and circulating supply for a bonding-curve token', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => liveCoin() })
    const price = await fetchPumpFunPrice('M')
    expect(typeof price).toBe('number') // a string or null would be a broken contract for the resolver
    expect(price).toBeCloseTo(0.000045, 12) // 45000 USD market cap / 1e9 tokens
  })

  it('requests the v3 coins endpoint for the given mint', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => liveCoin() })
    await fetchPumpFunPrice('M')
    expect(fetch).toHaveBeenCalledWith('https://frontend-api-v3.pump.fun/coins/M')
  })

  it('scales the raw supply by the token decimals rather than treating it as whole tokens', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => liveCoin({ base_decimals: 9, total_supply_str: '1000000000000000' }),
    })
    const price = await fetchPumpFunPrice('M')
    expect(price).toBeCloseTo(0.045, 9) // 45000 / 1e6 tokens, not 45000 / 1e9
  })

  it('defaults to 6 decimals when base_decimals is absent', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => liveCoinWithout('base_decimals') })
    expect(await fetchPumpFunPrice('M')).toBeCloseTo(0.000045, 12)
  })

  it('falls back to market_cap_usd when usd_market_cap is absent', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => liveCoinWithout('usd_market_cap') })
    expect(await fetchPumpFunPrice('M')).toBeCloseTo(0.000045, 12)
  })

  it('falls back to total_supply when total_supply_str is absent', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => liveCoinWithout('total_supply_str') })
    expect(await fetchPumpFunPrice('M')).toBeCloseTo(0.000045, 12)
  })

  it('returns null on a non-ok response (unknown mint returns 404)', async () => {
    fetch.mockResolvedValue({ ok: false })
    expect(await fetchPumpFunPrice('M')).toBeNull()
  })

  it('returns null (not a rejected promise) on a network error', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchPumpFunPrice('M')).resolves.toBeNull()
  })

  it('returns null (not a rejected promise) when the response body is not valid JSON', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })
    await expect(fetchPumpFunPrice('M')).resolves.toBeNull()
  })

  it('returns null when no market cap field is present', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => liveCoinWithout('usd_market_cap', 'market_cap_usd') })
    expect(await fetchPumpFunPrice('M')).toBeNull()
  })

  it('returns null when the market cap is not a number', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => liveCoin({ usd_market_cap: 'n/a', market_cap_usd: 'n/a' }) })
    expect(await fetchPumpFunPrice('M')).toBeNull()
  })

  it('returns null when no supply field is present', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => liveCoinWithout('total_supply', 'total_supply_str') })
    expect(await fetchPumpFunPrice('M')).toBeNull()
  })

  it('returns null rather than Infinity when the supply is zero', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => liveCoin({ total_supply: 0, total_supply_str: '0' }) })
    expect(await fetchPumpFunPrice('M')).toBeNull()
  })
})
