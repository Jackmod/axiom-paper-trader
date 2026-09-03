import { fetchJupiterPrice } from './price-sources/jupiter.js'
import { fetchDexScreenerPrice } from './price-sources/dexscreener.js'

/**
 * The price a position is marked at.
 *
 * Two tiers, not the three the design originally called for. The third was pump.fun, for
 * brand-new bonding-curve tokens Jupiter had not indexed yet — checking the live services
 * showed that premise was simply false: Jupiter's v3 price API answered for a pump.fun
 * mint eight seconds after it was created, while DexScreener had a pair but no price.
 * pump.fun's own v3 API carries no price field at all, so that tier had been silently
 * returning null on every call anyway. See price-sources/pumpfun.js for the full note.
 *
 * DexScreener stays as the fallback because it covers tokens Jupiter drops or has not
 * routed, and the two disagree often enough to be worth having both.
 */
export async function resolvePrice(mint) {
  const jupiterPrice = await fetchJupiterPrice(mint)
  if (jupiterPrice != null) return { priceUsd: jupiterPrice, source: 'jupiter' }

  const dexScreenerPrice = await fetchDexScreenerPrice(mint)
  if (dexScreenerPrice != null) return { priceUsd: dexScreenerPrice, source: 'dexscreener' }

  return null
}
