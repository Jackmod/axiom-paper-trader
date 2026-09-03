import { describe, it, expect } from 'vitest'
import { scaleSnapshotsToPath } from './trend-graph-math.js'

describe('scaleSnapshotsToPath', () => {
  it('maps snapshots to an SVG path spanning the given width/height', () => {
    const snapshots = [
      { timestamp: 0, totalPnlSol: 0 },
      { timestamp: 1, totalPnlSol: 1 },
      { timestamp: 2, totalPnlSol: -1 },
    ]
    const path = scaleSnapshotsToPath(snapshots, 100, 50)
    expect(path).toMatch(/^M 0 25/) // first point vertically centered (pnl 0 among range [-1, 1])
    expect(path.match(/L/g)).toHaveLength(2) // two more points after the initial M
  })

  it('returns an empty string for fewer than 2 snapshots', () => {
    expect(scaleSnapshotsToPath([], 100, 50)).toBe('')
    expect(scaleSnapshotsToPath([{ timestamp: 0, totalPnlSol: 0 }], 100, 50)).toBe('')
  })
})
