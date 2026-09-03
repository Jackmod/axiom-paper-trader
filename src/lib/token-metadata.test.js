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

const DEX_RESPONSE = {
  pairs: [
    {
      liquidity: { usd: 500 },
      baseToken: { name: 'Shallow', symbol: 'SHAL' },
      info: { imageUrl: 'https://img.example/shallow.png' },
    },
    {
      liquidity: { usd: 90000 },
      baseToken: { name: 'Morko', symbol: 'MORKO' },
      info: { imageUrl: 'https://img.example/morko.png' },
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
    })
  })

  it('returns partial identity when the pair has no image', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ pairs: [{ liquidity: { usd: 1 }, baseToken: { name: 'N', symbol: 'S' } }] }),
    })

    await expect(fetchDexScreenerToken('M')).resolves.toEqual({ name: 'N', symbol: 'S', imageUrl: null })
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

describe('fetchPumpFunToken', () => {
  it('reads name, symbol and image_uri for a bonding-curve token', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ name: 'Fresh', symbol: 'FRESH', image_uri: 'https://img.example/fresh.png' }),
    })

    await expect(fetchPumpFunToken('M')).resolves.toEqual({
      name: 'Fresh',
      symbol: 'FRESH',
      imageUrl: 'https://img.example/fresh.png',
    })
  })

  it('returns null for an unknown token', async () => {
    fetch.mockResolvedValue({ ok: false })
    await expect(fetchPumpFunToken('M')).resolves.toBeNull()
  })
})

describe('fetchTokenMetadata', () => {
  it('prefers DexScreener and does not call pump.fun when it answers', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => DEX_RESPONSE })

    const result = await fetchTokenMetadata('M')
    expect(result.symbol).toBe('MORKO')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('falls back to pump.fun for a token no DEX knows yet', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ pairs: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'Fresh', symbol: 'FRESH' }) })

    await expect(fetchTokenMetadata('M')).resolves.toMatchObject({ symbol: 'FRESH' })
  })

  it('returns null when nothing knows the token', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ pairs: [] }) })
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
    expect(merged).toEqual({ name: 'Only', symbol: '', imageUrl: '' })
  })
})
