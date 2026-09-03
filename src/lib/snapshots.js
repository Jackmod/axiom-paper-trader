import { getUnrealizedPnl } from './position-engine.js'

/**
 * A point-in-time reading of the whole portfolio, in SOL, for the analytics views.
 *
 * The fields are named ...Sol and now really are SOL. An earlier version summed
 * `qty × lastPriceUsd` — a USD figure — into fields labelled SOL, so the trend graph and
 * calendar were plotting one currency under another currency's name. Conversion goes
 * through the same engine the rest of the app uses, so a snapshot can never disagree
 * with what the user was shown at the time.
 */
export function captureSnapshot(state) {
  const solUsdPrice = state.solUsdPrice ?? 0
  let totalPositionValueSol = 0
  let totalPnlSol = 0

  for (const position of Object.values(state.positions ?? {})) {
    const { valueSol, pnlSol } = getUnrealizedPnl(position, solUsdPrice)
    // Without a SOL/USD rate these are unknowable; contributing zero is honest, whereas
    // contributing a USD number would silently corrupt the history with mixed units.
    totalPositionValueSol += valueSol ?? 0
    totalPnlSol += pnlSol ?? 0
  }

  return { timestamp: Date.now(), balanceSol: state.balanceSol, totalPositionValueSol, totalPnlSol }
}

export function appendSnapshot(snapshots, snapshot, maxEntries = 180) {
  const next = [...snapshots, snapshot]
  return next.length > maxEntries ? next.slice(next.length - maxEntries) : next
}
