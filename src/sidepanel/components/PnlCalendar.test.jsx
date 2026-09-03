import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/preact'
import { PnlCalendar } from './PnlCalendar.jsx'

const at = (iso, totalPnlSol) => ({ timestamp: new Date(iso).getTime(), totalPnlSol })

// The alpha channel is the heatmap's whole signal, so tests read it back off the
// rendered style rather than asserting a hard-coded float.
function cellStyle(index) {
  return document.querySelectorAll('.axpt-pnl-calendar-cell')[index].getAttribute('style')
}
function alphaOf(index) {
  return Number(/rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(cellStyle(index))[1])
}

describe('PnlCalendar', () => {
  it('shows an empty-state message when there is no snapshot history', () => {
    render(<PnlCalendar snapshots={[]} />)
    expect(screen.getByText(/not enough history/i)).toBeInTheDocument()
  })

  // SidePanel.jsx feeds this straight from chrome.storage.local, so before the first
  // alarm tick `state.portfolioSnapshots` is genuinely undefined on a fresh install —
  // that must render the empty state, not throw.
  it('shows the empty state when portfolioSnapshots has never been written', () => {
    const { unmount } = render(<PnlCalendar snapshots={undefined} />)
    expect(screen.getByText(/not enough history/i)).toBeInTheDocument()
    expect(document.querySelectorAll('.axpt-pnl-calendar-cell')).toHaveLength(0)
    unmount()

    render(<PnlCalendar />)
    expect(screen.getByText(/not enough history/i)).toBeInTheDocument()
  })

  it('renders exactly one cell per distinct day, with the day and PnL in its title', () => {
    render(
      <PnlCalendar
        snapshots={[
          { timestamp: new Date('2026-09-01T10:00').getTime(), totalPnlSol: 1 },
          { timestamp: new Date('2026-09-01T18:00').getTime(), totalPnlSol: 3 },
          { timestamp: new Date('2026-09-02T09:00').getTime(), totalPnlSol: -2 },
        ]}
      />,
    )
    const cells = document.querySelectorAll('.axpt-pnl-calendar-cell')
    expect(cells).toHaveLength(2) // two distinct days, not three snapshots
    expect(screen.getByTitle(/3\.00 SOL/)).toBeInTheDocument()
    expect(screen.getByTitle(/-2\.00 SOL/)).toBeInTheDocument()
    // The date belongs in the title too — an unlabelled heatmap square says nothing.
    expect(screen.getByTitle(/^2026-09-01: 3\.00 SOL$/)).toBeInTheDocument()
    expect(screen.queryByTitle(/1\.00 SOL/)).not.toBeInTheDocument() // the day's close, not its open
  })

  // Snapshots arrive in write order, but a calendar that renders them unsorted (or
  // sorted by insertion) would put a backfilled older day after a newer one.
  it('lays the days out oldest-first regardless of the order they arrive in', () => {
    render(
      <PnlCalendar snapshots={[at('2026-09-03T10:00', 3), at('2026-09-01T10:00', 1), at('2026-09-02T10:00', 2)]} />,
    )
    const titles = [...document.querySelectorAll('.axpt-pnl-calendar-cell')].map((c) => c.getAttribute('title'))
    expect(titles).toEqual(['2026-09-01: 1.00 SOL', '2026-09-02: 2.00 SOL', '2026-09-03: 3.00 SOL'])
  })

  it('paints winning days green and losing days pink', () => {
    render(<PnlCalendar snapshots={[at('2026-09-01T10:00', 5), at('2026-09-02T10:00', -5)]} />)
    expect(cellStyle(0)).toMatch(/rgba\(34, 197, 94/)
    expect(cellStyle(1)).toMatch(/rgba\(236, 72, 153/)
  })

  // Break-even is the boundary the component branches on (`>= 0`) and where a fresh
  // portfolio sits: a `> 0` regression would paint an untraded day loss-pink.
  it('treats a break-even day as non-negative (green)', () => {
    render(<PnlCalendar snapshots={[at('2026-09-01T10:00', 0)]} />)
    expect(cellStyle(0)).toMatch(/rgba\(34, 197, 94/)
    expect(screen.getByTitle('2026-09-01: 0.00 SOL')).toBeInTheDocument()
  })

  it('scales cell intensity by PnL magnitude, with the biggest day at full strength', () => {
    render(
      <PnlCalendar snapshots={[at('2026-09-01T10:00', 1), at('2026-09-02T10:00', 4), at('2026-09-03T10:00', -2)]} />,
    )
    expect(alphaOf(1)).toBeCloseTo(0.75) // |4| is the max -> full intensity
    expect(alphaOf(0)).toBeLessThan(alphaOf(2)) // |1| fainter than |2|
    expect(alphaOf(0)).toBeGreaterThan(0.15) // still visible, never fully transparent
  })

  // Without the `Math.max(1, ...)` floor, a single sub-1-SOL day would divide by its
  // own magnitude and blaze at full intensity as though it were a huge move.
  it('does not blow a tiny day up to full intensity', () => {
    render(<PnlCalendar snapshots={[at('2026-09-01T10:00', 0.1)]} />)
    expect(alphaOf(0)).toBeLessThan(0.3)
  })

  // The single most common "the calendar is broken" report: a new user's whole history
  // is inside one day, so the grid correctly contains exactly one square and looks like
  // a rendering failure. The view has to state the rule it is following.
  it('explains that one square means one day of history, not a broken grid', () => {
    render(<PnlCalendar snapshots={[at('2026-09-01T10:00', 1), at('2026-09-01T20:00', 2)]} />)
    expect(document.querySelectorAll('.axpt-pnl-calendar-cell')).toHaveLength(1)
    expect(screen.getByText(/1 day of history/i)).toBeInTheDocument()
    expect(screen.getByText(/midnight/i)).toBeInTheDocument()
  })

  it('reports the day count once there is more than one day', () => {
    render(<PnlCalendar snapshots={[at('2026-09-01T10:00', 1), at('2026-09-02T10:00', 2), at('2026-09-03T10:00', 3)]} />)
    expect(screen.getByText(/3 days of history/i)).toBeInTheDocument()
    // "the next cell appears after midnight" is only interesting while there is one cell.
    expect(screen.queryByText(/midnight/i)).not.toBeInTheDocument()
  })

  // The empty state has to say what is missing and whether waiting fixes it, the same as
  // the trend view — a bare "not enough history" reads as a fault.
  it('says what the empty calendar is waiting for and roughly how long', () => {
    render(<PnlCalendar snapshots={[]} />)
    expect(screen.getByText(/not enough history/i)).toBeInTheDocument()
    expect(screen.getByText(/within a minute/i)).toBeInTheDocument()
  })

  // A bare coloured square carries no information without a hover, which is unavailable
  // to keyboard and screen-reader users and invisible in a screenshot.
  it('prints the day of the month inside each cell', () => {
    render(<PnlCalendar snapshots={[at('2026-09-01T10:00', 1), at('2026-09-02T10:00', 2)]} />)
    const cells = [...document.querySelectorAll('.axpt-pnl-calendar-cell')]
    expect(cells.map((c) => c.textContent.trim())).toEqual(['1', '2'])
  })

  // `undefined.toFixed(2)` throws, and a throw inside a cell takes the whole Analytics
  // tab down — the loudest possible version of "the calendar isn't working".
  it('renders the readable days when the history contains an unreadable reading', () => {
    render(
      <PnlCalendar
        snapshots={[
          at('2026-09-01T10:00', 3),
          { timestamp: new Date('2026-09-02T10:00').getTime(), totalPnlSol: undefined },
          at('2026-09-03T10:00', -1),
        ]}
      />,
    )
    const titles = [...document.querySelectorAll('.axpt-pnl-calendar-cell')].map((c) => c.getAttribute('title'))
    expect(titles).toEqual(['2026-09-01: 3.00 SOL', '2026-09-03: -1.00 SOL'])
  })
})
