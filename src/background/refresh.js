import { captureSnapshot, appendSnapshot } from '../lib/snapshots.js'

export async function refreshAllPositions(state, resolvePrice) {
  const positions = { ...state.positions }
  for (const [mint, position] of Object.entries(positions)) {
    const result = await resolvePrice(mint)
    positions[mint] = result
      ? {
          ...position,
          lastPriceUsd: result.priceUsd,
          priceSource: result.source,
          lastPriceUpdatedAt: Date.now(),
          stale: false,
        }
      : { ...position, stale: true }
  }
  const nextState = { ...state, positions }
  const snapshot = captureSnapshot(nextState)
  return { ...nextState, portfolioSnapshots: appendSnapshot(state.portfolioSnapshots, snapshot) }
}
