export const SOL_MINT = 'So11111111111111111111111111111111111111112'

// Jupiter Price API v3. The plan drafted against `api.jup.ag/price/v2`, which now
// 404s — v2 was retired. v3 is keyed directly by mint (no `data` wrapper) and
// returns `usdPrice` as a number. `lite-api.jup.ag` is the keyless free tier;
// `api.jup.ag` is the paid tier and expects an `x-api-key` header we have nowhere
// safe to put in an extension bundle.
//
// v3 also returns the token's `decimals`, which matters more than it looks: the swap
// quote converts a raw `outAmount` into a token count, and that conversion needs the
// real decimals. Assuming 6 for a 9-decimal token puts the fill price out by 1000x and
// silently corrupts cost basis — the same class of bug as storing SOL in a token field.
export async function fetchJupiterTokenInfo(mint) {
  try {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mint}`)
    if (!res.ok) return null
    const body = await res.json()
    const entry = body?.[mint]
    if (!entry) return null

    const priceUsd = Number(entry.usdPrice)
    const decimals = Number(entry.decimals)

    return {
      priceUsd: Number.isFinite(priceUsd) && priceUsd > 0 ? priceUsd : null,
      // Only ever hand back decimals we actually got. A default here would be a guess
      // wearing the costume of a fact.
      decimals: Number.isInteger(decimals) && decimals >= 0 ? decimals : null,
    }
  } catch {
    return null // network failure, DNS failure, malformed JSON — never a crash
  }
}

export async function fetchJupiterPrice(mint) {
  const info = await fetchJupiterTokenInfo(mint)
  return info?.priceUsd ?? null
}
