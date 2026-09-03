// Geometry for the portfolio PnL trend line.
//
// A snapshot's `totalPnlSol` can be missing or NaN — the stored history is long-lived
// (180 entries) and predates at least one correction to how it is captured. A single
// such entry poisons `Math.min(...)`, which makes every coordinate NaN, which the
// browser draws as *nothing at all*: no error, no line, a chart the user reports as
// "not working". Every function here therefore filters to finite readings first, and
// reports how many it had to drop rather than substituting a zero the user never had.

/** The finite `totalPnlSol` readings, in the order given. */
function readableValues(snapshots) {
  return (snapshots ?? []).map((s) => s?.totalPnlSol).filter((v) => Number.isFinite(v))
}

export function scaleSnapshotsToPath(snapshots, width, height) {
  if (snapshots.length < 2) return ''

  const pnls = snapshots.map((s) => s.totalPnlSol)
  const min = Math.min(...pnls)
  const max = Math.max(...pnls)
  const range = max - min

  const points = snapshots.map((s, i) => {
    const x = (i / (snapshots.length - 1)) * width
    // A flat series (every snapshot at the same PnL — the default state on a fresh
    // install) has no range to scale against: draw it down the middle rather than
    // dividing by zero (NaN, invisible path) or pinning it to the bottom edge,
    // where half of the stroke would be clipped outside the SVG box.
    const y = range === 0 ? height / 2 : height - ((s.totalPnlSol - min) / range) * height
    return [x, y]
  })

  const [first, ...rest] = points
  return `M ${first[0]} ${first[1]} ` + rest.map(([x, y]) => `L ${x} ${y}`).join(' ')
}

/**
 * Everything the chart needs to draw itself, in one pass over the history.
 *
 * Two rules distinguish this from a plain min/max sparkline, and both are about the
 * reading being truthful rather than merely pretty:
 *
 *   1. THE Y-DOMAIN ALWAYS CONTAINS 0. Break-even is the reference every PnL figure is
 *      read against, so the baseline has to be a real, on-scale line. Scaling to the data
 *      range alone would park an all-profit history's floor at the bottom of the box,
 *      which reads as "you started at zero" when the user never was at zero — and would
 *      put the zero line outside the SVG entirely, where it cannot be drawn at all.
 *   2. IT PLOTS INTO AN INSET BAND [pad, height - pad]. At the extremes of its own
 *      domain a 2px stroke would otherwise lose half its width to the clip edge.
 *
 * A degenerate all-zero history (min === max === 0, which is what a fresh install writes
 * every tick until the first position opens) gets a symmetric +/-1 domain, so the flat
 * line lands exactly ON the zero baseline where a break-even portfolio belongs.
 *
 * @returns {{
 *   path: string,            // '' below 2 readable readings
 *   zeroY: number,           // y of PnL = 0; always inside the band
 *   minPnlSol: number,       // bottom axis bound (a domain bound, not necessarily data)
 *   maxPnlSol: number,       // top axis bound
 *   latest: { x: number, y: number, pnlSol: number } | null,
 *   pointCount: number,      // readings actually plotted
 *   skippedCount: number,    // readings dropped as unreadable
 *   spanMs: number | null,   // wall-clock span the history covers
 * }}
 */
export function buildTrendGeometry(snapshots, width, height, pad = 8) {
  const all = snapshots ?? []
  const values = readableValues(all)
  const skippedCount = all.length - values.length

  const plotBottom = height - pad
  const plotHeight = height - pad * 2

  // Rule 1, then the all-zero fallback for rule 1's degenerate case.
  let min = Math.min(0, ...values)
  let max = Math.max(0, ...values)
  if (max === min) {
    min = -1
    max = 1
  }
  const range = max - min

  const y = (value) => plotBottom - ((value - min) / range) * plotHeight
  // The newest reading always hangs off the right edge, including when it is the only
  // one and there is no `n - 1` to divide by.
  const x = (i) => (values.length < 2 ? width : (i / (values.length - 1)) * width)

  const points = values.map((value, i) => [x(i), y(value)])
  const path =
    points.length < 2
      ? ''
      : `M ${points[0][0]} ${points[0][1]} ` + points.slice(1).map(([px, py]) => `L ${px} ${py}`).join(' ')

  const latest =
    points.length === 0
      ? null
      : { x: points[points.length - 1][0], y: points[points.length - 1][1], pnlSol: values[values.length - 1] }

  const times = all.map((s) => s?.timestamp).filter((t) => Number.isFinite(t))
  const spanMs = times.length === 0 ? null : Math.max(...times) - Math.min(...times)

  return { path, zeroY: y(0), minPnlSol: min, maxPnlSol: max, latest, pointCount: values.length, skippedCount, spanMs }
}
