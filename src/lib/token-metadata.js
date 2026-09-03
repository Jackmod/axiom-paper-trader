// Token identity — name, symbol, image — resolved from the price APIs rather than
// scraped off Axiom's page.
//
// Scraping identity was fragile in both directions: the selectors were guesses, and a
// miss left a position rendering as a blank row with no name and no icon. The same APIs
// that already price a token also describe it, they are already in the extension's host
// permissions, and they answer for tokens the user is holding but not currently looking
// at — which the DOM cannot do at all.
//
// Ordered the same way as price resolution: DexScreener covers anything with a real
// pair, pump.fun covers brand-new bonding-curve tokens that have not graduated yet.

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

    if (!name && !symbol && !imageUrl) return null
    return { name, symbol, imageUrl }
  } catch {
    return null
  }
}

export async function fetchPumpFunToken(mint) {
  try {
    const res = await fetch(`https://frontend-api-v2.pump.fun/coins/${mint}`)
    if (!res.ok) return null
    const body = await res.json()
    const name = cleanText(body.name)
    const symbol = cleanText(body.symbol)
    const imageUrl = cleanUrl(body.image_uri)

    if (!name && !symbol && !imageUrl) return null
    return { name, symbol, imageUrl }
  } catch {
    return null
  }
}

/**
 * Resolve a token's identity. Returns null when no source knows it, which callers treat
 * as "try again next refresh" rather than as a failure — a nameless position still
 * trades correctly, it just looks worse until identity arrives.
 */
export async function fetchTokenMetadata(mint) {
  return (await fetchDexScreenerToken(mint)) ?? (await fetchPumpFunToken(mint))
}

/** True when a position is still missing anything worth showing in a row. */
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
  }
}
