export async function fetchDexScreenerPrice(mint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`)
    if (!res.ok) return null
    const body = await res.json()
    const pairs = body.pairs ?? []
    if (pairs.length === 0) return null
    const best = pairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a))
    const price = Number(best.priceUsd)
    // A malformed/absent priceUsd yields NaN, and NaN would slip through the resolver's `!= null` guard
    // and poison downstream PnL math — collapse it to null so the next source in the chain is tried.
    return Number.isFinite(price) ? price : null
  } catch {
    return null
  }
}
