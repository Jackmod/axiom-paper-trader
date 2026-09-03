// A PnL calendar shows the user *their* days, so snapshots are bucketed by local
// date. Bucketing with `toISOString()` would bucket by UTC: west of Greenwich an
// evening snapshot lands on tomorrow's key, splitting one trading day in two.
function localDateKey(timestamp) {
  if (!Number.isFinite(timestamp)) return null
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return null
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

export function bucketSnapshotsByDay(snapshots) {
  const buckets = {}
  for (const snapshot of snapshots ?? []) {
    // An unreadable total is skipped rather than recorded. Two things go wrong if it is
    // not: under "last wins" it becomes the day's close, and the calendar then calls
    // `.toFixed()` on `undefined` and takes the whole Analytics tab down with it; and
    // substituting 0 would paint a break-even day the user never actually had, sitting
    // next to days that are real.
    if (!Number.isFinite(snapshot?.totalPnlSol)) continue
    const key = localDateKey(snapshot.timestamp)
    if (key === null) continue
    // Later entries in iteration order overwrite earlier ones for the same day, so
    // each cell reports where that day *closed*, not its high-water mark.
    buckets[key] = snapshot.totalPnlSol
  }
  return buckets
}
