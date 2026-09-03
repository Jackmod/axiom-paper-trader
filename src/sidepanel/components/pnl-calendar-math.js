// A PnL calendar shows the user *their* days, so snapshots are bucketed by local
// date. Bucketing with `toISOString()` would bucket by UTC: west of Greenwich an
// evening snapshot lands on tomorrow's key, splitting one trading day in two.
function localDateKey(timestamp) {
  const d = new Date(timestamp)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

export function bucketSnapshotsByDay(snapshots) {
  const buckets = {}
  for (const snapshot of snapshots) {
    // Later entries in iteration order overwrite earlier ones for the same day, so
    // each cell reports where that day *closed*, not its high-water mark.
    buckets[localDateKey(snapshot.timestamp)] = snapshot.totalPnlSol
  }
  return buckets
}
