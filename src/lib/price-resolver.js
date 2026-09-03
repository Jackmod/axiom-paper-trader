import { fetchJupiterPrice } from './price-sources/jupiter.js'
import { fetchDexScreenerPrice } from './price-sources/dexscreener.js'
import { fetchPumpFunPrice } from './price-sources/pumpfun.js'

export async function resolvePrice(mint) {
  const jupiterPrice = await fetchJupiterPrice(mint)
  if (jupiterPrice != null) return { priceUsd: jupiterPrice, source: 'jupiter' }

  const dexScreenerPrice = await fetchDexScreenerPrice(mint)
  if (dexScreenerPrice != null) return { priceUsd: dexScreenerPrice, source: 'dexscreener' }

  const pumpFunPrice = await fetchPumpFunPrice(mint)
  if (pumpFunPrice != null) return { priceUsd: pumpFunPrice, source: 'pumpfun' }

  return null
}
