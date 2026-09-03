import { describe, it, expect } from 'vitest'
import { scaleSnapshotsToPath } from './trend-graph-math.js'

describe('scaleSnapshotsToPath', () => {
  it('maps snapshots to an SVG path spanning the given width/height', () => {
    const snapshots = [
      { timestamp: 0, totalPnlSol: 0 },
      { timestamp: 1, totalPnlSol: 1 },
      { timestamp: 2, totalPnlSol: -1 },
    ]
    // The whole path is asserted rather than just its first point: the first point
    // here (pnl 0 among range [-1, 1]) lands dead centre, which is the one y-value
    // that is identical whether the y-axis is flipped or not. Pinning every point
    // is what proves the max-PnL snapshot maps to y=0 (top, so gains point UP), the
    // min-PnL snapshot to y=height, and the last x to width (a `i / length` divisor
    // instead of `i / (length - 1)` would stop short at x=66.67).
    expect(scaleSnapshotsToPath(snapshots, 100, 50)).toBe('M 0 25 L 50 0 L 100 50')
    expect(scaleSnapshotsToPath(snapshots, 100, 50).match(/L/g)).toHaveLength(2) // two more points after the initial M
  })

  // Every snapshot at the same PnL is not an exotic edge: it is what a fresh
  // install writes every minute until the first position is opened, so this is the
  // most common input the chart ever sees. Without a zero-range guard every y is
  // NaN and the chart silently renders nothing.
  it('draws a flat series down the vertical centre instead of dividing by a zero range', () => {
    const flat = [
      { timestamp: 0, totalPnlSol: 0 },
      { timestamp: 1, totalPnlSol: 0 },
      { timestamp: 2, totalPnlSol: 0 },
    ]
    expect(scaleSnapshotsToPath(flat, 100, 50)).toBe('M 0 25 L 50 25 L 100 25')

    const flatNonZero = [
      { timestamp: 0, totalPnlSol: 5 },
      { timestamp: 1, totalPnlSol: 5 },
    ]
    const path = scaleSnapshotsToPath(flatNonZero, 100, 50)
    expect(path).toBe('M 0 25 L 100 25')
    expect(path).not.toMatch(/NaN|Infinity/)
  })

  it('returns an empty string for fewer than 2 snapshots', () => {
    expect(scaleSnapshotsToPath([], 100, 50)).toBe('')
    expect(scaleSnapshotsToPath([{ timestamp: 0, totalPnlSol: 0 }], 100, 50)).toBe('')
  })
})
