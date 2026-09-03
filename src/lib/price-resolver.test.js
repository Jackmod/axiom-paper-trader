import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolvePrice } from './price-resolver.js'
import * as jupiter from './price-sources/jupiter.js'
import * as dexscreener from './price-sources/dexscreener.js'
import * as pumpfun from './price-sources/pumpfun.js'

beforeEach(() => {
  vi.restoreAllMocks()
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

  it('falls back to pump.fun when Jupiter and DexScreener both have nothing', async () => {
    vi.spyOn(jupiter, 'fetchJupiterPrice').mockResolvedValue(null)
    vi.spyOn(dexscreener, 'fetchDexScreenerPrice').mockResolvedValue(null)
    vi.spyOn(pumpfun, 'fetchPumpFunPrice').mockResolvedValue(0.0000009)
    const result = await resolvePrice('M')
    expect(result).toEqual({ priceUsd: 0.0000009, source: 'pumpfun' })
  })

  it('returns null when every source has nothing', async () => {
    vi.spyOn(jupiter, 'fetchJupiterPrice').mockResolvedValue(null)
    vi.spyOn(dexscreener, 'fetchDexScreenerPrice').mockResolvedValue(null)
    vi.spyOn(pumpfun, 'fetchPumpFunPrice').mockResolvedValue(null)
    expect(await resolvePrice('M')).toBeNull()
  })

  it('short-circuits: never calls DexScreener or pump.fun once Jupiter succeeds', async () => {
    vi.spyOn(jupiter, 'fetchJupiterPrice').mockResolvedValue(1.5)
    const dexSpy = vi.spyOn(dexscreener, 'fetchDexScreenerPrice')
    const pumpSpy = vi.spyOn(pumpfun, 'fetchPumpFunPrice')
    await resolvePrice('M')
    expect(dexSpy).not.toHaveBeenCalled()
    expect(pumpSpy).not.toHaveBeenCalled()
  })

  it('never calls pump.fun once DexScreener succeeds', async () => {
    vi.spyOn(jupiter, 'fetchJupiterPrice').mockResolvedValue(null)
    vi.spyOn(dexscreener, 'fetchDexScreenerPrice').mockResolvedValue(0.5)
    const pumpSpy = vi.spyOn(pumpfun, 'fetchPumpFunPrice')
    await resolvePrice('M')
    expect(pumpSpy).not.toHaveBeenCalled()
  })
})
