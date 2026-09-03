export const SOL_MINT = 'So11111111111111111111111111111111111111112'

// Jupiter Price API v3. The plan drafted against `api.jup.ag/price/v2`, which now
// 404s — v2 was retired. v3 is keyed directly by mint (no `data` wrapper) and
// returns `usdPrice` as a number. `lite-api.jup.ag` is the keyless free tier;
// `api.jup.ag` is the paid tier and expects an `x-api-key` header we have nowhere
// safe to put in an extension bundle.
export async function fetchJupiterPrice(mint) {
  try {
    const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mint}`)
    if (!res.ok) return null
    const body = await res.json()
    const entry = body?.[mint]
    return entry ? Number(entry.usdPrice) : null
  } catch {
    return null // network failure, DNS failure, malformed JSON — all treated as "no price available", never a crash
  }
}
