import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/preact'
import { TrendGraph } from './TrendGraph.jsx'

// The component plots into a 280x120 box with an 8px vertical inset, so the drawable
// band is y in [8, 112] and 104px tall, and the y-domain always contains 0:
//   x(i) = i / (n - 1) * 280
//   y(v) = 112 - (v - min) / (max - min) * 104,  min = min(0, ...v), max = max(0, ...v)
// Every `d` below is derived by hand from that, not copied from a render.
describe('TrendGraph', () => {
  it('shows an empty-state message instead of an empty chart when there is under 2 snapshots', () => {
    render(<TrendGraph snapshots={[{ timestamp: 0, totalPnlSol: 0 }]} />)
    expect(screen.getByText(/not enough history/i)).toBeInTheDocument()
  })

  // SidePanel.jsx feeds this straight from chrome.storage.local, so before the
  // first alarm tick `state.portfolioSnapshots` is genuinely undefined on a fresh
  // install — that must render the empty state, not throw on `snapshots.length`.
  it('shows the empty state when portfolioSnapshots has never been written', () => {
    const { unmount } = render(<TrendGraph snapshots={undefined} />)
    expect(screen.getByText(/not enough history/i)).toBeInTheDocument()
    unmount()

    render(<TrendGraph />)
    expect(screen.getByText(/not enough history/i)).toBeInTheDocument()
  })

  // "Not enough history" on its own reads as a fault. The user cannot act on it without
  // knowing how much is missing and whether waiting will fix it, so the empty state has
  // to carry the count it has, the count it needs, and the cadence readings arrive at.
  it('says how many readings it has, how many it needs, and when the next one lands', () => {
    const { unmount } = render(<TrendGraph snapshots={[{ timestamp: 0, totalPnlSol: 0 }]} />)
    expect(screen.getByText(/1 of 2 readings/i)).toBeInTheDocument()
    expect(screen.getByText(/minute/i)).toBeInTheDocument()
    unmount()

    render(<TrendGraph snapshots={[]} />)
    expect(screen.getByText(/0 of 2 readings/i)).toBeInTheDocument()
  })

  // Unreadable entries do not count towards the two the chart needs, so the count in the
  // empty state has to be the *plottable* count, not `snapshots.length`.
  it('counts only readable readings when reporting progress towards the first line', () => {
    render(
      <TrendGraph
        snapshots={[
          { timestamp: 0, totalPnlSol: 1 },
          { timestamp: 1, totalPnlSol: Number.NaN },
          { timestamp: 2 },
        ]}
      />,
    )
    expect(screen.getByText(/1 of 2 readings/i)).toBeInTheDocument()
    expect(screen.queryByText(/3 of 2/)).not.toBeInTheDocument()
  })

  it('renders an SVG path once there are 2+ snapshots', () => {
    const { container } = render(
      <TrendGraph
        snapshots={[
          { timestamp: 0, totalPnlSol: 0 },
          { timestamp: 1, totalPnlSol: 1 },
        ]}
      />,
    )
    // The exact `d` is asserted, not just the path's existence: it is the only
    // thing that proves the component scales into its own inset band and that the
    // rising snapshot ends at the top (y=8) rather than the bottom.
    // domain [0, 1]: y(0) = 112, y(1) = 112 - 104 = 8
    expect(container.querySelector('path')).toHaveAttribute('d', 'M 0 112 L 280 8')
  })

  it('draws a flat all-zero history across the middle, fully inside the SVG box', () => {
    const { container } = render(
      <TrendGraph
        snapshots={[
          { timestamp: 0, totalPnlSol: 0 },
          { timestamp: 1, totalPnlSol: 0 },
        ]}
      />,
    )
    // symmetric +/-1 fallback domain: y(0) = 112 - (1/2)*104 = 60
    expect(container.querySelector('path')).toHaveAttribute('d', 'M 0 60 L 280 60')
  })

  // A bare stroke says nothing about which side of break-even it is on. The baseline is
  // the reference the whole chart is read against, and it has to sit at the real y of
  // PnL = 0 — not at a fixed mid-height, which would be a lie on any one-sided history.
  it('draws the break-even baseline at the true y of zero, not at mid-height', () => {
    const { container } = render(
      <TrendGraph
        snapshots={[
          { timestamp: 0, totalPnlSol: 2 },
          { timestamp: 1, totalPnlSol: 4 },
        ]}
      />,
    )
    // domain [0, 4]: zero is the floor of the band -> y = 112, and the data sits above it
    const zero = container.querySelector('.axpt-trend-zero')
    expect(zero).toBeInTheDocument()
    expect(zero).toHaveAttribute('y1', '112')
    expect(zero).toHaveAttribute('y2', '112')
    // y(2) = 112 - (2/4)*104 = 60, y(4) = 112 - (4/4)*104 = 8 — both strictly above it
    expect(container.querySelector('path')).toHaveAttribute('d', 'M 0 60 L 280 8')
  })

  it('puts the baseline at the top of the band when every reading is a loss', () => {
    const { container } = render(
      <TrendGraph
        snapshots={[
          { timestamp: 0, totalPnlSol: -2 },
          { timestamp: 1, totalPnlSol: -4 },
        ]}
      />,
    )
    // domain [-4, 0]: y(0) = 8, y(-2) = 112 - (2/4)*104 = 60, y(-4) = 112
    expect(container.querySelector('.axpt-trend-zero')).toHaveAttribute('y1', '8')
    expect(container.querySelector('path')).toHaveAttribute('d', 'M 0 60 L 280 112')
  })

  // The number the user actually came for. A trend line with no value on it can only be
  // read as a shape.
  it('labels the latest reading with its signed SOL value', () => {
    const { unmount } = render(
      <TrendGraph
        snapshots={[
          { timestamp: 0, totalPnlSol: 0 },
          { timestamp: 1, totalPnlSol: 1.5 },
        ]}
      />,
    )
    // formatSol(1.5, { signed: true }) -> '+1.500'
    expect(screen.getByText('+1.500 SOL')).toBeInTheDocument()
    unmount()

    render(
      <TrendGraph
        snapshots={[
          { timestamp: 0, totalPnlSol: 0 },
          { timestamp: 1, totalPnlSol: -2 },
        ]}
      />,
    )
    expect(screen.getByText('-2.000 SOL')).toBeInTheDocument()
  })

  // Without tick values the vertical axis has no units at all: a line halfway up could be
  // half a SOL or half a thousand.
  it('labels the top and bottom of the vertical scale', () => {
    render(
      <TrendGraph
        snapshots={[
          { timestamp: 0, totalPnlSol: -2 },
          { timestamp: 1, totalPnlSol: 6 },
        ]}
      />,
    )
    // domain is [-2, 6] — the data range already spans zero, so these are the data bounds
    expect(screen.getByText('6.000')).toBeInTheDocument()
    expect(screen.getByText('-2.000')).toBeInTheDocument()
  })

  it('colors the line green when the latest PnL is non-negative, pink when negative', () => {
    const { container: up } = render(
      <TrendGraph
        snapshots={[
          { timestamp: 0, totalPnlSol: -1 },
          { timestamp: 1, totalPnlSol: 2 },
        ]}
      />,
    )
    expect(up.querySelector('path')).toHaveAttribute('stroke', 'var(--color-buy)')

    const { container: down } = render(
      <TrendGraph
        snapshots={[
          { timestamp: 0, totalPnlSol: 1 },
          { timestamp: 1, totalPnlSol: -2 },
        ]}
      />,
    )
    expect(down.querySelector('path')).toHaveAttribute('stroke', 'var(--color-sell)')
  })

  // Break-even is the boundary the component actually branches on (`>= 0`), and it
  // is where a fresh portfolio sits: a `> 0` regression would paint it loss-pink.
  it('treats a latest PnL of exactly zero as non-negative (green)', () => {
    const { container } = render(
      <TrendGraph
        snapshots={[
          { timestamp: 0, totalPnlSol: -1 },
          { timestamp: 1, totalPnlSol: 0 },
        ]}
      />,
    )
    expect(container.querySelector('path')).toHaveAttribute('stroke', 'var(--color-buy)')
  })

  // One `undefined` total inside `Math.min(...)` is NaN, and a path full of NaN is drawn
  // by the browser as nothing at all — no error, no line, a chart that "isn't working".
  it('still plots the readable readings when the history contains an unreadable one', () => {
    const { container } = render(
      <TrendGraph
        snapshots={[
          { timestamp: 0, totalPnlSol: 2 },
          { timestamp: 1, totalPnlSol: undefined },
          { timestamp: 2, totalPnlSol: 4 },
        ]}
      />,
    )
    // the two readable values scale as domain [0, 4]: y(2) = 60, y(4) = 8
    const path = container.querySelector('path')
    expect(path).toHaveAttribute('d', 'M 0 60 L 280 8')
    expect(path.getAttribute('d')).not.toMatch(/NaN/)
    // and the drop is disclosed rather than hidden
    expect(screen.getByText(/1 unreadable reading/i)).toBeInTheDocument()
  })

  it('says nothing about skipped readings when every reading is readable', () => {
    render(
      <TrendGraph
        snapshots={[
          { timestamp: 0, totalPnlSol: 2 },
          { timestamp: 1, totalPnlSol: 4 },
        ]}
      />,
    )
    expect(screen.queryByText(/unreadable reading/i)).not.toBeInTheDocument()
  })
})
