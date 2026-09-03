import { describe, it, expect } from 'vitest'
import { scaleSnapshotsToPath, buildTrendGeometry } from './trend-graph-math.js'

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

// `buildTrendGeometry` is what the chart actually draws from. It differs from
// `scaleSnapshotsToPath` in two deliberate ways, both of them about honesty:
//
//   1. The y-domain ALWAYS contains 0, so the break-even baseline is a real, on-scale
//      line rather than a decoration parked at an arbitrary height. A chart of the data
//      range alone would put an all-profit history's floor at the bottom of the box,
//      which reads as "you were at zero" when you never were.
//   2. It plots into an inset band [pad, height - pad], so the extreme points keep their
//      whole stroke inside the SVG instead of losing half of it to the clip edge.
//
// Every expectation below is derived by hand from
//   x(i) = i / (n - 1) * width           (single point: x = width)
//   y(v) = (height - pad) - (v - min) / (max - min) * (height - 2 * pad)
// at width 100, height 50, pad 5 -> plot band y in [5, 45], 40px tall.
describe('buildTrendGeometry', () => {
  const geom = (snapshots) => buildTrendGeometry(snapshots, 100, 50, 5)

  it('maps a mixed series into the inset band and reports the zero baseline', () => {
    // values 0, 1, -1 -> min = -1, max = 1, range 2
    //   y(0)  = 45 - (1/2)*40 = 25   <- the one y that is identical under a flipped axis,
    //   y(1)  = 45 - (2/2)*40 =  5      so the other two are what prove gains point UP
    //   y(-1) = 45 - (0/2)*40 = 45
    const g = geom([
      { timestamp: 0, totalPnlSol: 0 },
      { timestamp: 1, totalPnlSol: 1 },
      { timestamp: 2, totalPnlSol: -1 },
    ])

    expect(g.path).toBe('M 0 25 L 50 5 L 100 45')
    expect(g.zeroY).toBe(25)
    expect(g.minPnlSol).toBe(-1)
    expect(g.maxPnlSol).toBe(1)
    expect(g.pointCount).toBe(3)
    expect(g.skippedCount).toBe(0)
  })

  // The whole point of rule (1). Without the zero-extension the domain would be
  // [-4, -2], y(-2) would be 5 (top of the box) and the zero line would sit at y = -35,
  // outside the SVG entirely — an invisible baseline on the chart that needs it most.
  it('stretches an all-losing series down from an on-scale zero line', () => {
    // values -2, -4 -> min = min(0, -4) = -4, max = max(0, -2) = 0, range 4
    //   y(-2) = 45 - (2/4)*40 = 25
    //   y(-4) = 45 - (0/4)*40 = 45
    //   y(0)  = 45 - (4/4)*40 =  5
    const g = geom([
      { timestamp: 0, totalPnlSol: -2 },
      { timestamp: 1, totalPnlSol: -4 },
    ])

    expect(g.path).toBe('M 0 25 L 100 45')
    expect(g.zeroY).toBe(5)
    expect(g.minPnlSol).toBe(-4)
    expect(g.maxPnlSol).toBe(0)
  })

  // The mirror image, and the case that proves the inset band earns its keep: at the top
  // of its own domain this line would sit on y = 0 and be half-clipped without the pad.
  it('keeps a flat winning series inside the box with zero along the bottom', () => {
    // values 5, 5 -> min = 0, max = 5, range 5
    //   y(5) = 45 - (5/5)*40 = 5      y(0) = 45 - (0/5)*40 = 45
    const g = geom([
      { timestamp: 0, totalPnlSol: 5 },
      { timestamp: 1, totalPnlSol: 5 },
    ])

    expect(g.path).toBe('M 0 5 L 100 5')
    expect(g.zeroY).toBe(45)
    expect(g.path).not.toMatch(/NaN|Infinity/)
  })

  // A fresh install writes an all-zero history every tick until the first position opens,
  // so this is the most common input the chart ever sees. min === max === 0 has no range
  // to divide by; a symmetric +/-1 fallback centres the line ON the zero baseline, which
  // is exactly where a break-even portfolio belongs.
  it('centres an all-zero history on the zero line instead of dividing by a zero range', () => {
    const g = geom([
      { timestamp: 0, totalPnlSol: 0 },
      { timestamp: 1, totalPnlSol: 0 },
      { timestamp: 2, totalPnlSol: 0 },
    ])

    expect(g.path).toBe('M 0 25 L 50 25 L 100 25')
    expect(g.zeroY).toBe(25)
    expect(g.path).not.toMatch(/NaN/)
  })

  // The latest reading is the number the user came to read; the chart labels it, so the
  // geometry has to hand back both its value and where to hang the label.
  it('reports the latest reading and pins it to the right-hand edge', () => {
    const g = geom([
      { timestamp: 0, totalPnlSol: 0 },
      { timestamp: 1, totalPnlSol: 1 },
      { timestamp: 2, totalPnlSol: -1 },
    ])

    expect(g.latest).toEqual({ x: 100, y: 45, pnlSol: -1 })
  })

  // A stored history can predate a schema change, or hold an entry written while some
  // total was unavailable. `Math.min(...)` over one `undefined` is NaN, which makes every
  // coordinate NaN and renders a path the browser silently draws as nothing at all — the
  // chart "not working" with no error anywhere. Drop the unreadable reading and say so;
  // never invent a 0 for it, which would plot a break-even the user never had.
  it('skips unreadable readings rather than NaN-ing the whole chart', () => {
    // usable values 2 and 4 -> min = 0, max = 4, range 4
    //   y(2) = 45 - (2/4)*40 = 25     y(4) = 45 - (4/4)*40 = 5
    const g = geom([
      { timestamp: 0, totalPnlSol: 2 },
      { timestamp: 1, totalPnlSol: undefined },
      { timestamp: 2 },
      { timestamp: 3, totalPnlSol: Number.NaN },
      { timestamp: 4, totalPnlSol: 4 },
    ])

    expect(g.path).toBe('M 0 25 L 100 5')
    expect(g.pointCount).toBe(2)
    expect(g.skippedCount).toBe(3)
    expect(g.latest).toEqual({ x: 100, y: 5, pnlSol: 4 })
    expect(g.path).not.toMatch(/NaN/)
  })

  it('draws no path from a single reading but still reports it as the latest', () => {
    // one value 3 -> min = 0, max = 3, range 3 -> y(3) = 45 - (3/3)*40 = 5
    const g = geom([{ timestamp: 0, totalPnlSol: 3 }])

    expect(g.path).toBe('')
    expect(g.pointCount).toBe(1)
    expect(g.latest).toEqual({ x: 100, y: 5, pnlSol: 3 })
    expect(g.zeroY).toBe(45)
  })

  // SidePanel hands this straight out of chrome.storage.local, where the key is genuinely
  // absent until the first refresh tick.
  it('survives an empty or missing history', () => {
    for (const input of [[], undefined]) {
      const g = buildTrendGeometry(input, 100, 50, 5)
      expect(g.path).toBe('')
      expect(g.pointCount).toBe(0)
      expect(g.skippedCount).toBe(0)
      expect(g.latest).toBe(null)
      expect(g.zeroY).toBe(25) // the +/-1 fallback domain, so the baseline is still drawable
    }
  })

  it('reports the wall-clock span the plotted readings cover', () => {
    const g = geom([
      { timestamp: 1_000, totalPnlSol: 0 },
      { timestamp: 61_000, totalPnlSol: 1 },
    ])
    expect(g.spanMs).toBe(60_000)

    expect(geom([{ timestamp: 5, totalPnlSol: 1 }]).spanMs).toBe(0)
    expect(buildTrendGeometry([], 100, 50, 5).spanMs).toBe(null)
  })
})
