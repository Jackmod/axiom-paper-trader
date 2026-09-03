import { scaleSnapshotsToPath } from './trend-graph-math.js'

export function TrendGraph({ snapshots }) {
  const width = 280
  const height = 120
  const path = scaleSnapshotsToPath(snapshots ?? [], width, height)
  const latestPnl = snapshots?.at(-1)?.totalPnlSol ?? 0

  if (!path) return <p class="axpt-empty">Not enough history yet to plot a trend.</p>

  return (
    <svg width={width} height={height} class="axpt-trend-graph">
      <path d={path} fill="none" stroke={latestPnl >= 0 ? 'var(--color-buy)' : 'var(--color-sell)'} stroke-width="2" />
    </svg>
  )
}
