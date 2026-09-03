import { buildTrendGeometry } from './trend-graph-math.js'
import { formatSol } from '../../ui/format.js'

const WIDTH = 280
const HEIGHT = 120
const PAD = 8

// A line needs two points. Stating the threshold in the empty state — rather than just
// "no data" — is what turns a blank box into a wait the user can understand.
export const MIN_READINGS = 2

// Snapshots are appended by `refreshAllPositions`, which runs on a 1-minute background
// alarm and again on every SYNC_NOW the side panel sends while it is open (every 7s).
// "Within a minute, faster while open" is true under both cadences.
const CADENCE = 'A reading is taken every few seconds while this panel is open, and once a minute in the background.'

function skippedNote(skippedCount) {
  if (skippedCount === 0) return null
  const plural = skippedCount === 1 ? 'reading' : 'readings'
  return <p class="axpt-empty axpt-chart-note">{`${skippedCount} unreadable ${plural} skipped.`}</p>
}

export function TrendGraph({ snapshots }) {
  const { path, zeroY, minPnlSol, maxPnlSol, latest, pointCount, skippedCount } = buildTrendGeometry(
    snapshots,
    WIDTH,
    HEIGHT,
    PAD,
  )

  if (!path) {
    return (
      <div class="axpt-trend">
        <p class="axpt-empty">
          {`Not enough history yet to plot a trend — ${pointCount} of ${MIN_READINGS} readings so far. ${CADENCE}`}
        </p>
        {skippedNote(skippedCount)}
      </div>
    )
  }

  const color = latest.pnlSol >= 0 ? 'var(--color-buy)' : 'var(--color-sell)'

  return (
    <div class="axpt-trend">
      <svg
        width={WIDTH}
        height={HEIGHT}
        class="axpt-trend-graph"
        role="img"
        aria-label={`Portfolio PnL trend over the last ${pointCount} readings. Latest ${formatSol(latest.pnlSol, { signed: true })} SOL.`}
      >
        {/* Break-even. Without it the stroke's shape is all there is to read, and a line
            drifting along the top of the box looks the same whether it is +0.001 SOL or
            +100 SOL above water. */}
        <line
          class="axpt-trend-zero"
          x1="0"
          y1={zeroY}
          x2={WIDTH}
          y2={zeroY}
          stroke="var(--color-border)"
          stroke-width="1"
          stroke-dasharray="3 3"
        />
        <path class="axpt-trend-line" d={path} fill="none" stroke={color} stroke-width="2" />
        {/* The newest reading, marked where the eye already goes. */}
        <circle class="axpt-trend-latest-dot" cx={latest.x} cy={latest.y} r="3" fill={color} />
        {/* Axis ticks: the top and bottom of the plotted band, so a height on the chart
            has a magnitude and not just a direction. */}
        <text class="axpt-trend-tick" x="2" y="10" font-size="9" fill="var(--color-text-muted)">
          {formatSol(maxPnlSol)}
        </text>
        <text class="axpt-trend-tick" x="2" y={HEIGHT - 2} font-size="9" fill="var(--color-text-muted)">
          {formatSol(minPnlSol)}
        </text>
      </svg>
      <p class="axpt-trend-latest">
        Latest{' '}
        <span class="mono" style={{ color }}>
          {`${formatSol(latest.pnlSol, { signed: true })} SOL`}
        </span>
      </p>
      {skippedNote(skippedCount)}
    </div>
  )
}
