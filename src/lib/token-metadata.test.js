import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchDexScreenerToken,
  fetchPumpFunToken,
  fetchTokenMetadata,
  needsMetadata,
  mergeMetadata,
} from './token-metadata.js'

beforeEach(() => {
  vi.restoreAllMocks()
  globalThis.fetch = vi.fn()
})

// Shaped after a real `/latest/dex/tokens/<mint>` body: `marketCap` and `fdv` are plain
// numbers on the pair, alongside baseToken identity and an optional info.imageUrl.
const DEX_RESPONSE = {
  pairs: [
    {
      liquidity: { usd: 500 },
      baseToken: { name: 'Shallow', symbol: 'SHAL' },
      info: { imageUrl: 'https://img.example/shallow.png' },
      marketCap: 111,
      fdv: 111,
    },
    {
      liquidity: { usd: 90000 },
      baseToken: { name: 'Morko', symbol: 'MORKO' },
      info: { imageUrl: 'https://img.example/morko.png' },
      marketCap: 622337569,
      fdv: 2376412712,
    },
  ],
}

describe('fetchDexScreenerToken', () => {
  it('takes identity from the deepest pair, not the first one listed', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => DEX_RESPONSE })

    await expect(fetchDexScreenerToken('M')).resolves.toEqual({
      name: 'Morko',
      symbol: 'MORKO',
      imageUrl: 'https://img.example/morko.png',
      marketCapUsd: 622337569,
    })
  })

  it('returns partial identity when the pair has no image', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ pairs: [{ liquidity: { usd: 1 }, baseToken: { name: 'N', symbol: 'S' } }] }),
    })

    await expect(fetchDexScreenerToken('M')).resolves.toEqual({
      name: 'N',
      symbol: 'S',
      imageUrl: null,
      marketCapUsd: null,
    })
  })

  it('reports market cap as a raw number, never pre-formatted text', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => DEX_RESPONSE })

    const { marketCapUsd } = await fetchDexScreenerToken('M')
    expect(typeof marketCapUsd).toBe('number')
  })

  it('takes market cap from the same deepest pair the identity came from', async () => {
    // The shallow pair is listed first and quotes a different market cap; picking it would
    // report a market cap that does not belong to the pair the price came from.
    fetch.mockResolvedValue({ ok: true, json: async () => DEX_RESPONSE })
    await expect(fetchDexScreenerToken('M')).resolves.toMatchObject({ marketCapUsd: 622337569 })
  })

  it('falls back to fdv when the pair reports no marketCap', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ pairs: [{ liquidity: { usd: 1 }, baseToken: { symbol: 'S' }, fdv: 48250 }] }),
    })

    await expect(fetchDexScreenerToken('M')).resolves.toMatchObject({ marketCapUsd: 48250 })
  })

  it('treats a zero or non-numeric market cap as absent rather than reporting $0', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        pairs: [{ liquidity: { usd: 1 }, baseToken: { symbol: 'S' }, marketCap: 0, fdv: 'n/a' }],
      }),
    })

    await expect(fetchDexScreenerToken('M')).resolves.toMatchObject({ marketCapUsd: null })
  })

  it('answers with market cap alone when the pair carries no identity at all', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ pairs: [{ liquidity: { usd: 1 }, baseToken: {}, marketCap: 9000 }] }),
    })

    await expect(fetchDexScreenerToken('M')).resolves.toEqual({
      name: null,
      symbol: null,
      imageUrl: null,
      marketCapUsd: 9000,
    })
  })

  it('returns null when the token is unknown, so the next source is tried', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ pairs: [] }) })
    await expect(fetchDexScreenerToken('M')).resolves.toBeNull()
  })

  it('returns null (never throws) on a network error or bad JSON', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchDexScreenerToken('M')).resolves.toBeNull()
  })

  it('refuses a non-http image URL rather than putting it in an <img src>', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        pairs: [{ liquidity: { usd: 1 }, baseToken: { name: 'N' }, info: { imageUrl: 'javascript:alert(1)' } }],
      }),
    })

    const result = await fetchDexScreenerToken('M')
    expect(result.imageUrl).toBeNull()
  })

  it('treats blank strings as absent rather than rendering an empty name', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ pairs: [{ liquidity: { usd: 1 }, baseToken: { name: '   ', symbol: '' } }] }),
    })

    await expect(fetchDexScreenerToken('M')).resolves.toBeNull()
  })
})

// Shaped after a real `/coins/<mint>` body. `market_cap` is denominated in SOL and
// `usd_market_cap` in USD — the live MOON coin read 162.22 and 16899.49 respectively.
const PUMP_RESPONSE = {
  name: 'Fresh',
  symbol: 'FRESH',
  image_uri: 'https://img.example/fresh.png',
  market_cap: 162.2190223049191,
  usd_market_cap: 16899.488856304444,
}

describe('fetchPumpFunToken', () => {
  it('reads name, symbol and image_uri for a bonding-curve token', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => PUMP_RESPONSE })

    await expect(fetchPumpFunToken('M')).resolves.toEqual({
      name: 'Fresh',
      symbol: 'FRESH',
      imageUrl: 'https://img.example/fresh.png',
      marketCapUsd: 16899.488856304444,
    })
  })

  it('reads usd_market_cap and never the SOL-denominated market_cap', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ symbol: 'S', market_cap: 162.219 }) })

    // 162 is SOL, not dollars. Reporting it as USD would understate the coin ~100x.
    await expect(fetchPumpFunToken('M')).resolves.toMatchObject({ marketCapUsd: null })
  })

  it('returns null for an unknown token', async () => {
    fetch.mockResolvedValue({ ok: false })
    await expect(fetchPumpFunToken('M')).resolves.toBeNull()
  })
})

describe('fetchTokenMetadata', () => {
  it('prefers DexScreener and does not call pump.fun when it supplies every field', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => DEX_RESPONSE })

    const result = await fetchTokenMetadata('M')
    expect(result).toEqual({
      name: 'Morko',
      symbol: 'MORKO',
      imageUrl: 'https://img.example/morko.png',
      marketCapUsd: 622337569,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('fills a missing image from pump.fun instead of returning DexScreener alone', async () => {
    // Roughly half of live pump-origin pairs answer with name + symbol + marketCap but no
    // info.imageUrl, while pump.fun carries image_uri for the same mint. Short-circuiting
    // on the first source that answers at all is what left those rows iconless.
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pairs: [{ liquidity: { usd: 4000 }, baseToken: { name: 'fomo', symbol: 'fomo' }, marketCap: 280181522 }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: 'fomo',
          symbol: 'fomo',
          image_uri: 'https://img.example/fomo.png',
          usd_market_cap: 280576023.411633,
        }),
      })

    await expect(fetchTokenMetadata('M')).resolves.toEqual({
      name: 'fomo',
      symbol: 'fomo',
      imageUrl: 'https://img.example/fomo.png',
      // DexScreener's market cap still wins — the merge takes the first source that has a
      // field, not the last.
      marketCapUsd: 280181522,
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('fills a missing market cap from pump.fun', async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pairs: [
            {
              liquidity: { usd: 4000 },
              baseToken: { name: 'N', symbol: 'S' },
              info: { imageUrl: 'https://img.example/n.png' },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ usd_market_cap: 5036.58 }) })

    await expect(fetchTokenMetadata('M')).resolves.toEqual({
      name: 'N',
      symbol: 'S',
      imageUrl: 'https://img.example/n.png',
      marketCapUsd: 5036.58,
    })
  })

  it('keeps the DexScreener answer when pump.fun has nothing to add', async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ pairs: [{ liquidity: { usd: 4000 }, baseToken: { name: 'N', symbol: 'S' } }] }),
      })
      .mockResolvedValueOnce({ ok: false })

    await expect(fetchTokenMetadata('M')).resolves.toEqual({
      name: 'N',
      symbol: 'S',
      imageUrl: null,
      marketCapUsd: null,
    })
  })

  it('falls back to pump.fun for a token no DEX knows yet', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pairs: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => PUMP_RESPONSE })

    await expect(fetchTokenMetadata('M')).resolves.toMatchObject({
      symbol: 'FRESH',
      imageUrl: 'https://img.example/fresh.png',
      marketCapUsd: 16899.488856304444,
    })
  })

  it('returns null when nothing knows the token', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ pairs: [] }) })
    await expect(fetchTokenMetadata('M')).resolves.toBeNull()
  })

  it('returns null (never throws) when DexScreener errors and pump.fun 404s', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce({ ok: false })
    await expect(fetchTokenMetadata('M')).resolves.toBeNull()
  })
})

describe('needsMetadata', () => {
  it('is true while any identity field is missing', () => {
    expect(needsMetadata({ name: 'N', symbol: 'S', imageUrl: '' })).toBe(true)
    expect(needsMetadata({ name: '', symbol: 'S', imageUrl: 'u' })).toBe(true)
  })

  it('is false once a position is fully described', () => {
    expect(needsMetadata({ name: 'N', symbol: 'S', imageUrl: 'u' })).toBe(false)
  })

  it('ignores market cap — it is a live figure, not missing identity', () => {
    // Identity never changes, so a one-shot lookup settles it. Market cap moves every
    // block; gating on it would either re-fetch forever or freeze the first number seen.
    expect(needsMetadata({ name: 'N', symbol: 'S', imageUrl: 'u', marketCapUsd: null })).toBe(false)
  })
})

describe('mergeMetadata', () => {
  it('fills only the gaps', () => {
    const merged = mergeMetadata(
      { name: '', symbol: 'KEEP', imageUrl: '', qty: 1 },
      { name: 'New', symbol: 'NEW', imageUrl: 'https://img/x.png' },
    )

    expect(merged).toMatchObject({ name: 'New', symbol: 'KEEP', imageUrl: 'https://img/x.png', qty: 1 })
  })

  it('leaves the position untouched when nothing was resolved', () => {
    const position = { name: 'N', symbol: 'S', imageUrl: 'u' }
    expect(mergeMetadata(position, null)).toBe(position)
  })

  it('never writes undefined into a field', () => {
    const merged = mergeMetadata({ name: '', symbol: '', imageUrl: '' }, { name: 'Only' })
    expect(merged).toEqual({ name: 'Only', symbol: '', imageUrl: '', marketCapUsd: null })
  })

  it('overwrites market cap with the fresher figure, unlike identity', () => {
    const merged = mergeMetadata(
      { name: 'N', symbol: 'S', imageUrl: 'u', marketCapUsd: 100 },
      { name: 'Other', marketCapUsd: 250 },
    )

    expect(merged).toMatchObject({ name: 'N', marketCapUsd: 250 })
  })

  it('keeps the last known market cap rather than blanking it when the lookup had none', () => {
    const merged = mergeMetadata({ name: 'N', symbol: 'S', imageUrl: 'u', marketCapUsd: 100 }, { imageUrl: 'v' })
    expect(merged.marketCapUsd).toBe(100)
  })

  it('reports a missing market cap as null so the UI can show an honest placeholder', () => {
    const merged = mergeMetadata({ name: '', symbol: '', imageUrl: '' }, { symbol: 'S' })
    expect(merged.marketCapUsd).toBeNull()
  })
})
