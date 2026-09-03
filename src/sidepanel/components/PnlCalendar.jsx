import { bucketSnapshotsByDay } from './pnl-calendar-math.js'

// Snapshots are appended by `refreshAllPositions` on a 1-minute background alarm, and
// again on every SYNC_NOW the side panel sends while it is open.
const CADENCE = 'The first cell appears as soon as a reading is recorded, which happens within a minute.'

export function PnlCalendar({ snapshots }) {
  const buckets = bucketSnapshotsByDay(snapshots ?? [])
  // Zero-padded date keys sort lexicographically, so this is oldest-first however
  // the snapshots happened to be written.
  const days = Object.entries(buckets).sort(([a], [b]) => a.localeCompare(b))
  // The floor of 1 keeps a sub-1-SOL day from scaling against itself and blazing at
  // full intensity as though it were a huge move.
  const maxAbsPnl = Math.max(1, ...days.map(([, pnl]) => Math.abs(pnl)))

  if (days.length === 0) {
    return <p class="axpt-empty">{`Not enough history yet for a calendar — no readings recorded. ${CADENCE}`}</p>
  }

  // One square is what a correct calendar looks like on day one, and it is the single
  // most common "this is broken" report. Say the rule the grid is following so a lone
  // cell reads as one day of history rather than a rendering failure.
  const note =
    days.length === 1
      ? "1 day of history so far. Each cell is one day's closing PnL, so a second cell appears after midnight."
      : `${days.length} days of history. Each cell is one day's closing PnL.`

  return (
    <div class="axpt-pnl-calendar-wrap">
      <div class="axpt-pnl-calendar">
        {days.map(([date, pnl]) => {
          const intensity = Math.min(1, Math.abs(pnl) / maxAbsPnl)
          const color =
            pnl >= 0 ? `rgba(34, 197, 94, ${0.15 + intensity * 0.6})` : `rgba(236, 72, 153, ${0.15 + intensity * 0.6})`
          return (
            <div
              key={date}
              class="axpt-pnl-calendar-cell"
              style={{
                background: color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '9px',
                color: 'var(--color-text)',
              }}
              title={`${date}: ${pnl.toFixed(2)} SOL`}
            >
              {/* A bare coloured square says nothing without a hover — unavailable to a
                  keyboard, a screen reader, or anyone glancing at the panel. */}
              {String(Number(date.slice(8)))}
            </div>
          )
        })}
      </div>
      <p class="axpt-empty axpt-chart-note">{note}</p>
    </div>
  )
}
