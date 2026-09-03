import { PUMPFUN_API } from './price-sources/pumpfun.js'
// Token description — name, symbol, image, market cap — resolved from the price APIs
// rather than scraped off Axiom's page.
//
// Scraping was fragile in both directions: the selectors were guesses, and a miss left a
// position rendering as a blank row with no name and no icon. Market cap was worse than
// blank — a text heuristic over the page picked up whatever "$…" it found and reported it
// as MC, so the panel could show a confidently wrong figure. The same APIs that already
// price a token also describe it and publish its market cap as a number; they are already
// in the extension's host permissions, and they answer for tokens the user is holding but
// not currently looking at — which the DOM cannot do at all.
//
// Ordered the same way as price resolution: DexScreener covers anything with a real
// pair, pump.fun covers brand-new bonding-curve tokens that have not graduated yet.

/** Every field a source may contribute, in the shape callers receive. */
const FIELDS = ['name', 'symbol', 'imageUrl', 'marketCapUsd']

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function cleanUrl(value) {
  const text = cleanText(value)
  if (!text) return null
  // Only ever hand the UI an http(s) image. A `javascript:` or `data:` URL from a
  // third-party API must never reach an <img src> in an extension page.
  return /^https?:\/\//i.test(text) ? text : null
}

// Market cap is returned as a raw number for the UI to format. Zero, NaN and numeric
// strings that don't parse all collapse to null: a token's market cap is never actually
// $0, so a 0 here means "the source didn't know", and rendering "$0" would be a wrong
// figure rather than a missing one.
function cleanUsd(value) {
  const amount = typeof value === 'number' ? value : NaN
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

export async function fetchDexScreenerToken(mint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`)
    if (!res.ok) return null
    const body = await res.json()
    const pairs = body.pairs ?? []
    if (pairs.length === 0) return null

    // Same choice the price client makes: the deepest pair is the most trustworthy
    // description of the token.
    const best = pairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a))
    const base = best.baseToken ?? {}
    const name = cleanText(base.name)
    const symbol = cleanText(base.symbol)
    const imageUrl = cleanUrl(best.info?.imageUrl)
    // `marketCap` is circulating-supply cap; `fdv` is fully diluted. They are equal for
    // every fixed-supply pump-origin token, so the fallback only matters for the tokens
    // where DexScreener omits `marketCap` — and there fdv is the honest best answer.
    // Both are read off the same deepest pair the identity came from.
    const marketCapUsd = cleanUsd(best.marketCap) ?? cleanUsd(best.fdv)

    if (!name && !symbol && !imageUrl && marketCapUsd == null) return null
    return { name, symbol, imageUrl, marketCapUsd }
  } catch {
    return null
  }
}

export async function fetchPumpFunToken(mint) {
  try {
    // v3, not v2. v2 is now 503, and the manifest only grants a host permission for v3 —
    // so calls to v2 were CORS-blocked before they ever reached the network, surfacing as
    // "No 'Access-Control-Allow-Origin' header" in the extension's error log.
    // A 404 here is normal and expected: it just means this mint is not a pump.fun coin.
    const res = await fetch(`${PUMPFUN_API}/coins/${mint}`)
    if (!res.ok) return null
    const body = await res.json()
    const name = cleanText(body.name)
    const symbol = cleanText(body.symbol)
    const imageUrl = cleanUrl(body.image_uri)
    // `usd_market_cap` only. The sibling `market_cap` is denominated in SOL — a live coin
    // read market_cap 162.22 against usd_market_cap 16899.49 — so treating it as dollars
    // would understate the coin by roughly the SOL price.
    const marketCapUsd = cleanUsd(body.usd_market_cap)

    if (!name && !symbol && !imageUrl && marketCapUsd == null) return null
    return { name, symbol, imageUrl, marketCapUsd }
  } catch {
    return null
  }
}

/**
 * Resolve everything known about a token, merging the sources field by field.
 *
 * This deliberately does NOT return the first source that answers. DexScreener answers
 * for most pump-origin tokens with name + symbol + market cap but no `info.imageUrl` —
 * a spot check of 27 recently-traded pump mints found 14 of them imageless — while
 * pump.fun carries `image_uri` for every one of those same mints. Short-circuiting on
 * DexScreener is what left those rows with no icon.
 *
 * Merge order is source order, so the first source to supply a field wins it and
 * DexScreener's market cap outranks pump.fun's. pump.fun is only called when something
 * is still missing after DexScreener.
 *
 * Returns null when no source knew anything, which callers treat as "try again next
 * refresh" rather than as a failure — a nameless position still trades correctly.
 */
export async function fetchTokenMetadata(mint) {
  const merged = { name: null, symbol: null, imageUrl: null, marketCapUsd: null }
  const missing = () => FIELDS.filter((field) => merged[field] == null)

  for (const source of [fetchDexScreenerToken, fetchPumpFunToken]) {
    if (missing().length === 0) break
    const result = await source(mint)
    if (!result) continue
    for (const field of missing()) {
      if (result[field] != null) merged[field] = result[field]
    }
  }

  return missing().length === FIELDS.length ? null : merged
}

/**
 * True when a position is still missing identity worth showing in a row.
 *
 * Market cap is intentionally not part of this. Name, symbol and image never change, so
 * one successful lookup settles them for good; market cap moves every block. Gating on it
 * would mean re-fetching identity forever, and treating it as "resolved once" would pin a
 * stale figure to the row permanently. Callers that want a live market cap should ask for
 * metadata unconditionally.
 */
export function needsMetadata(position) {
  return !position?.name || !position?.symbol || !position?.imageUrl
}

/** Fill only the gaps — never overwrite identity a position already has. */
export function mergeMetadata(position, metadata) {
  if (!metadata) return position
  return {
    ...position,
    name: position.name || metadata.name || '',
    symbol: position.symbol || metadata.symbol || '',
    imageUrl: position.imageUrl || metadata.imageUrl || '',
    // Market cap is live data, not identity, so a fresher figure replaces the old one.
    // When the lookup came back without one, the last known value is kept rather than
    // blanked — and if there has never been one, it stays null so the UI shows a
    // placeholder instead of a number nobody reported.
    marketCapUsd: metadata.marketCapUsd ?? position.marketCapUsd ?? null,
  }
}
