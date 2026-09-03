import { describe, it, expect } from 'vitest'
import { bucketSnapshotsByDay } from './pnl-calendar-math.js'

describe('bucketSnapshotsByDay', () => {
  it('buckets by local date and keeps the LAST snapshot pnl of each day', () => {
    const day1 = new Date('2026-09-01T10:00:00').getTime()
    const day1Later = new Date('2026-09-01T18:00:00').getTime()
    const day2 = new Date('2026-09-02T09:00:00').getTime()
    const snapshots = [
      { timestamp: day1, totalPnlSol: 1 },
      { timestamp: day1Later, totalPnlSol: 3 },
      { timestamp: day2, totalPnlSol: -2 },
    ]
    const buckets = bucketSnapshotsByDay(snapshots)
    expect(buckets['2026-09-01']).toBe(3)
    expect(buckets['2026-09-02']).toBe(-2)
    // Three snapshots, two days — a bucketer that keyed off the timestamp rather
    // than the date would produce three entries and still satisfy the lookups above.
    expect(Object.keys(buckets)).toEqual(['2026-09-01', '2026-09-02'])
  })

  // The panel reads `portfolioSnapshots` straight out of chrome.storage.local, so
  // the very first render of a fresh install passes an empty list.
  it('returns an empty object for an empty history', () => {
    expect(bucketSnapshotsByDay([])).toEqual({})
  })

  it('keeps a single snapshot as that day, unchanged', () => {
    const only = new Date('2026-09-01T00:00:00').getTime()
    expect(bucketSnapshotsByDay([{ timestamp: only, totalPnlSol: 4.5 }])).toEqual({ '2026-09-01': 4.5 })
  })

  // "Last wins", not "best wins" and not "first wins": a day that opens up and
  // closes down must report the close. Bucketing with Math.max, or with a
  // `if (!(key in buckets))` guard, both pass the happy-path test above.
  it('lets a losing close overwrite an earlier winning snapshot on the same day', () => {
    const buckets = bucketSnapshotsByDay([
      { timestamp: new Date('2026-09-01T09:00:00').getTime(), totalPnlSol: 10 },
      { timestamp: new Date('2026-09-01T12:00:00').getTime(), totalPnlSol: 2 },
      { timestamp: new Date('2026-09-01T23:00:00').getTime(), totalPnlSol: -7 },
    ])
    expect(buckets).toEqual({ '2026-09-01': -7 })
  })

  // Bucketing via toISOString() is UTC bucketing: west of Greenwich a late-evening
  // snapshot lands on tomorrow's key, splitting one trading day across two calendar
  // cells. A PnL calendar has to show the user *their* days.
  it('keeps a late-evening snapshot on the local day it happened, not the UTC one', () => {
    const buckets = bucketSnapshotsByDay([
      { timestamp: new Date('2026-09-01T23:30:00').getTime(), totalPnlSol: 8 },
      { timestamp: new Date('2026-09-02T00:30:00').getTime(), totalPnlSol: 9 },
    ])
    expect(buckets).toEqual({ '2026-09-01': 8, '2026-09-02': 9 })
  })

  // Hand-built local date keys are where zero-padding gets dropped; unpadded keys
  // ('2026-1-5') break the calendar's date sort as well as the cell titles.
  it('zero-pads single-digit months and days so keys sort lexicographically', () => {
    const buckets = bucketSnapshotsByDay([
      { timestamp: new Date('2026-01-05T10:00:00').getTime(), totalPnlSol: 1 },
      { timestamp: new Date('2026-11-20T10:00:00').getTime(), totalPnlSol: 2 },
    ])
    expect(Object.keys(buckets)).toEqual(['2026-01-05', '2026-11-20'])
  })

  // A break-even day is a real day with a real cell, not a missing one.
  it('records a zero-PnL day rather than dropping it', () => {
    const buckets = bucketSnapshotsByDay([{ timestamp: new Date('2026-09-01T10:00:00').getTime(), totalPnlSol: 0 }])
    expect(buckets['2026-09-01']).toBe(0)
    expect(Object.keys(buckets)).toHaveLength(1)
  })
})
