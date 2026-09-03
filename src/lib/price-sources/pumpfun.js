// pump.fun exposes no USD price field, so the price is derived from market cap / circulating supply.
// Verified live 2026-09-03 against frontend-api-v3 (see the Task 7 note in the plan): the derived value
// tracks the DexScreener price for the same mint to within ~1% on both bonding-curve and graduated coins.
const PUMPFUN_COINS_ENDPOINT = 'https://frontend-api-v3.pump.fun/coins'
const PUMPFUN_DEFAULT_DECIMALS = 6

export async function fetchPumpFunPrice(mint) {
  try {
    const res = await fetch(`${PUMPFUN_COINS_ENDPOINT}/${mint}`)
    if (!res.ok) return null // 404 = unknown mint, 5xx = API down — both mean "no price from this tier"
    const body = await res.json()
    const marketCapUsd = Number(body?.usd_market_cap ?? body?.market_cap_usd)
    const decimals = Number(body?.base_decimals ?? PUMPFUN_DEFAULT_DECIMALS)
    const rawSupply = Number(body?.total_supply_str ?? body?.total_supply)
    if (!Number.isFinite(marketCapUsd) || !Number.isFinite(rawSupply) || !Number.isFinite(decimals)) return null
    const supply = rawSupply / 10 ** decimals
    if (supply <= 0) return null
    const price = marketCapUsd / supply
    return Number.isFinite(price) ? price : null
  } catch {
    return null
  }
}
