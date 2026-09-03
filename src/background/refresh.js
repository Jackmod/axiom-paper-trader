import { captureSnapshot, appendSnapshot } from '../lib/snapshots.js'
import { fetchTokenMetadata, needsMetadata, mergeMetadata } from '../lib/token-metadata.js'
 import { fetchJupiterPrice, SOL_MINT } from '../lib/price-sources/jupiter.js'

/**
 * Refresh every open position's price, and fill in any missing token identity.
 *
 * Identity is resolved here rather than scraped from Axiom's page because the page can
 * only ever describe the token currently on screen — this runs for every position the
 * user holds, including ones they aren't looking at, and keeps working after they close
 * the tab. `resolveMetadata` is injected so this stays testable without the network.
 */
export async function refreshAllPositions(
  state,
  resolvePrice,
  resolveMetadata = fetchTokenMetadata,
  resolveSolUsd = () => fetchJupiterPrice(SOL_MINT),
) {
  // Kept fresh here so a trade never has to block on fetching it.
  const solUsdPrice = Number(await resolveSolUsd().catch(() => null)) || state.solUsdPrice || 0
  const positions = { ...state.positions }

  for (const [mint, position] of Object.entries(positions)) {
    const result = await resolvePrice(mint)
    let next = result
      ? {
          ...position,
          lastPriceUsd: result.priceUsd,
          priceSource: result.source,
          lastPriceUpdatedAt: Date.now(),
          stale: false,
        }
      : { ...position, stale: true }

    // Only ask for identity we don't already have. A nameless position still trades
    // correctly — it just renders as a blank row — so a failed lookup is retried on the
    // next tick rather than being treated as an error.
    if (needsMetadata(next)) {
      try {
        next = mergeMetadata(next, await resolveMetadata(mint))
      } catch {
        // Identity is cosmetic; never let it break a price refresh.
      }
    }

    positions[mint] = next
  }

  const nextState = { ...state, positions, solUsdPrice }
  const snapshot = captureSnapshot(nextState)
  return { ...nextState, portfolioSnapshots: appendSnapshot(state.portfolioSnapshots, snapshot) }
}
