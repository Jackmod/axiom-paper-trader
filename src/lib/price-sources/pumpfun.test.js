import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as pumpfun from './pumpfun.js'
import { PUMPFUN_API } from './pumpfun.js'
import { fetchPumpFunToken } from '../token-metadata.js'
import manifest from '../../../manifest.config.js'

beforeEach(() => {
  vi.restoreAllMocks()
  globalThis.fetch = vi.fn()
})

// A real pump.fun mint shape: base58 with the `pump` suffix the launchpad appends.
const MINT = 'BhQ1eGmyfcCcbNi9y8k5hAaGT9K8x1JzYtV3xk7Wpump'

// The exact URL the identity lookup must produce. Written out by hand rather than
// interpolated from PUMPFUN_API, so a change to the constant fails this test instead of
// silently rewriting the expectation along with the code.
const COINS_URL = `https://frontend-api-v3.pump.fun/coins/${MINT}`

describe('PUMPFUN_API', () => {
  it('points at the v3 host', () => {
    expect(PUMPFUN_API).toBe('https://frontend-api-v3.pump.fun')
  })

  it('is not the v2 host, which is what CORS-blocked the identity lookup', () => {
    // v2 is now 503 and the manifest never granted it, so requests to it died before they
    // reached the network as "No 'Access-Control-Allow-Origin' header" — the error the
    // user reported. `frontend-api.pump.fun` (no version) is a Cloudflare 530 and is
    // equally wrong.
    expect(PUMPFUN_API).not.toContain('frontend-api-v2')
    expect(PUMPFUN_API).not.toContain('frontend-api.pump.fun')
    expect(PUMPFUN_API).not.toMatch(/v[012](\b|\.)/)
  })

  it('carries no trailing slash, so callers appending /coins/<mint> build one clean path', () => {
    expect(PUMPFUN_API.endsWith('/')).toBe(false)
    expect(`${PUMPFUN_API}/coins/${MINT}`).not.toContain('.fun//')
  })

  it('has its origin granted by the extension manifest', () => {
    // The root cause of the reported failure was a host the manifest did not grant. An
    // origin the extension cannot reach is a CORS error at runtime, not a test failure,
    // so the two are pinned together here.
    const origin = new URL(PUMPFUN_API).origin
    const granted = manifest.host_permissions.some((pattern) => pattern.startsWith(`${origin}/`))
    expect(granted).toBe(true)
  })

  it('exports no price function — pump.fun is an identity source only', () => {
    // The price tier was removed deliberately: v3 has no price_usd field at all, so the
    // tier returned null on every call, and Jupiter already prices pump.fun mints seconds
    // after creation. Deriving price from the bonding curve was rejected because the
    // reserves are quoted in whichever mint the curve uses (one live coin quoted USDC, not
    // SOL) and scaled by two different decimals fields — a subtly wrong derivation writes a
    // plausible-but-wrong entry price into cost basis permanently.
    expect(pumpfun.fetchPumpFunPrice).toBeUndefined()
    expect(Object.values(pumpfun).some((exported) => typeof exported === 'function')).toBe(false)
  })
})

describe('fetchPumpFunToken (the call PUMPFUN_API exists for)', () => {
  it('requests PUMPFUN_API/coins/<mint> — the exact call that was failing', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ name: 'Fresh', symbol: 'FRESH' }) })

    await fetchPumpFunToken(MINT)

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(COINS_URL)
    // ...and that URL is built from the constant, not from a second hardcoded host that
    // could drift away from the manifest permission on its own.
    expect(fetch.mock.calls[0][0].startsWith(`${PUMPFUN_API}/`)).toBe(true)
  })

  it('returns name, symbol, image and USD market cap for a bonding-curve coin v3 knows', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        mint: MINT,
        name: 'Fresh Coin',
        symbol: 'FRESH',
        image_uri: 'https://ipfs.io/ipfs/QmFresh/image.png',
        // v3 quotes the curve's cap twice: market_cap in SOL, usd_market_cap in dollars.
        market_cap: 48.37320459098604,
        usd_market_cap: 5036.585904750017,
        complete: false,
      }),
    })

    await expect(fetchPumpFunToken(MINT)).resolves.toEqual({
      name: 'Fresh Coin',
      symbol: 'FRESH',
      imageUrl: 'https://ipfs.io/ipfs/QmFresh/image.png',
      marketCapUsd: 5036.585904750017,
    })
  })

  it('returns null on a 404 without reading the body — not a pump.fun coin is a normal outcome', async () => {
    // Unknown mints get a clean 404 from v3. Every position the user holds that did not
    // launch on pump.fun takes this path on every metadata refresh, so it must be quiet:
    // null, no throw, and no attempt to parse an error page as JSON.
    const json = vi.fn()
    fetch.mockResolvedValue({ ok: false, status: 404, json })

    await expect(fetchPumpFunToken(MINT)).resolves.toBeNull()
    expect(json).not.toHaveBeenCalled()
  })

  it('returns null (not a rejected promise) on a network error', async () => {
    // A blocked or unreachable host surfaces as exactly this TypeError — including the
    // CORS rejection that started all of it. Identity is best-effort: a failure must leave
    // the position nameless until the next refresh, never break the refresh loop.
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchPumpFunToken(MINT)).resolves.toBeNull()
  })

  it('returns null (not a rejected promise) when the body is not valid JSON', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    })
    await expect(fetchPumpFunToken(MINT)).resolves.toBeNull()
  })

  it('rejects a non-http image_uri rather than putting it in an <img src>', async () => {
    // pump.fun's image_uri is user-supplied metadata. A `javascript:` or `data:` URL from a
    // third-party API must never reach an <img> in an extension page, and a bare `ipfs://`
    // URI is not loadable by the browser either. The name and symbol still come through —
    // rejecting the image must not cost the token its identity.
    for (const imageUri of ['javascript:alert(1)', 'data:text/html;base64,PHN2Zz4=', 'ipfs://QmFresh/image.png']) {
      fetch.mockResolvedValue({
        ok: true,
        json: async () => ({ name: 'Fresh Coin', symbol: 'FRESH', image_uri: imageUri }),
      })

      await expect(fetchPumpFunToken(MINT)).resolves.toEqual({
        name: 'Fresh Coin',
        symbol: 'FRESH',
        imageUrl: null,
        marketCapUsd: null,
      })
    }
  })

  it('returns null when the coin document describes nothing usable', async () => {
    // Blank strings are absent, not identity: a position rendering as an empty name with a
    // broken icon is worse than one still waiting on its next metadata refresh.
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ mint: MINT, name: '   ', symbol: '', image_uri: 'javascript:alert(1)' }),
    })

    await expect(fetchPumpFunToken(MINT)).resolves.toBeNull()
  })
})
