export function captureSnapshot(state) {
  let totalPositionValueSol = 0
  let totalPnlSol = 0
  for (const position of Object.values(state.positions)) {
    totalPositionValueSol += position.qty * position.lastPriceUsd
    totalPnlSol += (position.lastPriceUsd - position.avgEntryUsd) * position.qty
  }
  return { timestamp: Date.now(), balanceSol: state.balanceSol, totalPositionValueSol, totalPnlSol }
}

export function appendSnapshot(snapshots, snapshot, maxEntries = 180) {
  const next = [...snapshots, snapshot]
  return next.length > maxEntries ? next.slice(next.length - maxEntries) : next
}
