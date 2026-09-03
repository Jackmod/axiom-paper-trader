export async function fetchDexScreenerPrice(mint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`)
    if (!res.ok) return null
    const body = await res.json()
    const pairs = body.pairs ?? []
    if (pairs.length === 0) return null
    const best = pairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a))
    return Number(best.priceUsd)
  } catch {
    return null
  }
}
