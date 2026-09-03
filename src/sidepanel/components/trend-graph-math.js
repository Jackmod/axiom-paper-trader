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
