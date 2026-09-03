import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/preact'
import { Analytics } from './Analytics.jsx'

const SNAPSHOTS = [
  { timestamp: 0, totalPnlSol: 0 },
  { timestamp: 1, totalPnlSol: 1 },
]

// Dated snapshots, for the assertions that need to see real day keys come through.
const DATED = [
  { timestamp: new Date('2026-09-01T10:00').getTime(), totalPnlSol: 2 },
  { timestamp: new Date('2026-09-02T10:00').getTime(), totalPnlSol: -3 },
]

describe('Analytics', () => {
  it('shows the trend graph by default', () => {
    const { container } = render(<Analytics snapshots={SNAPSHOTS} />)
    expect(container.querySelector('.axpt-trend-graph')).toBeInTheDocument()
    expect(container.querySelector('.axpt-pnl-calendar')).not.toBeInTheDocument()
  })

  it('switches to the calendar view when Calendar is clicked, and back on Trend', () => {
    const { container } = render(<Analytics snapshots={SNAPSHOTS} />)
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }))
    expect(container.querySelector('.axpt-pnl-calendar')).toBeInTheDocument()
    expect(container.querySelector('.axpt-trend-graph')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Trend' }))
    expect(container.querySelector('.axpt-trend-graph')).toBeInTheDocument()
    expect(container.querySelector('.axpt-pnl-calendar')).not.toBeInTheDocument()
  })

  // Which view is showing has to be legible without reading the chart itself.
  it('marks the showing view as the active toggle', () => {
    render(<Analytics snapshots={SNAPSHOTS} />)
    expect(screen.getByRole('button', { name: 'Trend' })).toHaveClass('axpt-tab-active')
    expect(screen.getByRole('button', { name: 'Calendar' })).not.toHaveClass('axpt-tab-active')

    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }))

    expect(screen.getByRole('button', { name: 'Calendar' })).toHaveClass('axpt-tab-active')
    expect(screen.getByRole('button', { name: 'Trend' })).not.toHaveClass('axpt-tab-active')
  })

  // Both views have to be fed the *caller's* snapshots. Rendering `<PnlCalendar />`
  // with no props would still mount a chart element in the first two tests.
  it('feeds its snapshots to whichever view is showing', () => {
    const { container } = render(<Analytics snapshots={DATED} />)
    // 280x120 box with an 8px inset band and a zero-spanning domain [-3, 2]:
    //   y(2) = 112 - (5/5)*104 = 8,  y(-3) = 112 - (0/5)*104 = 112
    expect(container.querySelector('.axpt-trend-graph path')).toHaveAttribute('d', 'M 0 8 L 280 112')

    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }))

    expect(container.querySelectorAll('.axpt-pnl-calendar-cell')).toHaveLength(2)
    expect(screen.getByTitle('2026-09-01: 2.00 SOL')).toBeInTheDocument()
    expect(screen.getByTitle('2026-09-02: -3.00 SOL')).toBeInTheDocument()
  })

  // SidePanel passes `state.portfolioSnapshots`, which is undefined until the first
  // alarm tick writes one — the tab must render both empty states, not throw.
  it('renders each view empty state on a fresh install with no snapshots', () => {
    render(<Analytics />)
    expect(screen.getByText(/not enough history yet to plot a trend/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }))

    expect(screen.getByText(/not enough history yet for a calendar/i)).toBeInTheDocument()
  })

  // A blank box is indistinguishable from a crash. Whichever view a fresh user lands on
  // has to tell them what it is waiting for, not just that it has nothing.
  it('tells a fresh user what each empty view is waiting for', () => {
    render(<Analytics snapshots={[]} />)
    expect(screen.getByText(/0 of 2 readings/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }))

    expect(screen.getByText(/within a minute/i)).toBeInTheDocument()
  })
})
