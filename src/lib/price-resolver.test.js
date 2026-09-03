import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolvePrice } from './price-resolver.js'
import * as jupiter from './price-sources/jupiter.js'
import * as dexscreener from './price-sources/dexscreener.js'
import * as pumpfun from './price-sources/pumpfun.js'

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolvePrice', () => {
  it('uses Jupiter when it has a price', async () => {
    vi.spyOn(jupiter, 'fetchJupiterPrice').mockResolvedValue(1.5)
    const result = await resolvePrice('M')
    expect(result).toEqual({ priceUsd: 1.5, source: 'jupiter' })
  })

  it('falls back to DexScreener when Jupiter has nothing', async () => {
    vi.spyOn(jupiter, 'fetchJupiterPrice').mockResolvedValue(null)
    vi.spyOn(dexscreener, 'fetchDexScreenerPrice').mockResolvedValue(0.002)
    const result = await resolvePrice('M')
    expect(result).toEqual({ priceUsd: 0.002, source: 'dexscreener' })
  })

  it('returns null when neither source has anything', async () => {
    vi.spyOn(jupiter, 'fetchJupiterPrice').mockResolvedValue(null)
    vi.spyOn(dexscreener, 'fetchDexScreenerPrice').mockResolvedValue(null)
    expect(await resolvePrice('M')).toBeNull()
  })

  it('short-circuits: never calls DexScreener once Jupiter succeeds', async () => {
    vi.spyOn(jupiter, 'fetchJupiterPrice').mockResolvedValue(1.5)
    const dexSpy = vi.spyOn(dexscreener, 'fetchDexScreenerPrice')
    await resolvePrice('M')
    expect(dexSpy).not.toHaveBeenCalled()
  })

  // Every priced result has to say where the number came from: the UI shows the source, and a
  // price with no provenance is a price nobody can audit when two services disagree.
  it('labels the source on whichever tier answered', async () => {
    vi.spyOn(jupiter, 'fetchJupiterPrice').mockResolvedValue(3)
    expect((await resolvePrice('M')).source).toBe('jupiter')

    vi.restoreAllMocks()
    vi.spyOn(jupiter, 'fetchJupiterPrice').mockResolvedValue(null)
    vi.spyOn(dexscreener, 'fetchDexScreenerPrice').mockResolvedValue(3)
    expect((await resolvePrice('M')).source).toBe('dexscreener')
  })

  // Jupiter's own layer collapses a zero/absent/malformed `usdPrice` to null (see
  // price-sources/jupiter.js) precisely so it does not slip through the resolver's `!= null`
  // guard. These two drive the REAL fetchJupiterPrice through a stubbed network response, so
  // they fail if that filter is ever loosened — a 0 or NaN entry price silently corrupts cost
  // basis and every PnL figure derived from it.
  it.each([
    ['zero', 0],
    ['NaN-producing garbage', 'not-a-number'],
    ['missing', undefined],
  ])('does not treat a %s Jupiter price as an answer', async (_label, usdPrice) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ M: { usdPrice, decimals: 6 } }),
      })
    )
    vi.spyOn(dexscreener, 'fetchDexScreenerPrice').mockResolvedValue(0.002)

    const result = await resolvePrice('M')
    expect(result).toEqual({ priceUsd: 0.002, source: 'dexscreener' })
  })

  // pump.fun is an identity source only. Its v3 API has no price field at all, so the old
  // third tier returned null on every call, and v2 (which had the field) is now 503 and
  // CORS-blocked by the manifest. Deriving a price from the bonding curve was rejected on
  // purpose — see price-sources/pumpfun.js. This guards against the tier being re-added by
  // asserting the module still exposes no price function to re-add it with.
  it('exposes no pump.fun price source to fall back to', () => {
    expect(pumpfun.PUMPFUN_API).toBe('https://frontend-api-v3.pump.fun')
    expect(Object.keys(pumpfun).filter((k) => /price/i.test(k))).toEqual([])
  })
})
