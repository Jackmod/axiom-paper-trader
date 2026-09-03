import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/preact'
import { TrendGraph } from './TrendGraph.jsx'

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
    // thing that proves the component scales into its own 280x120 box and that the
    // rising snapshot ends at the top (y=0) rather than the bottom.
    expect(container.querySelector('path')).toHaveAttribute('d', 'M 0 120 L 280 0')
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
    expect(container.querySelector('path')).toHaveAttribute('d', 'M 0 60 L 280 60')
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
})
