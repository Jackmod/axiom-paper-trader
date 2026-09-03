export function scaleSnapshotsToPath(snapshots, width, height) {
  if (snapshots.length < 2) return ''

  const pnls = snapshots.map((s) => s.totalPnlSol)
  const min = Math.min(...pnls)
  const max = Math.max(...pnls)
  const range = max - min || 1

  const points = snapshots.map((s, i) => {
    const x = (i / (snapshots.length - 1)) * width
    const y = height - ((s.totalPnlSol - min) / range) * height
    return [x, y]
  })

  const [first, ...rest] = points
  return `M ${first[0]} ${first[1]} ` + rest.map(([x, y]) => `L ${x} ${y}`).join(' ')
}
