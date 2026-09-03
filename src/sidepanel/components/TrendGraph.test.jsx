import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/preact'
import { TrendGraph } from './TrendGraph.jsx'

describe('TrendGraph', () => {
  it('shows an empty-state message instead of an empty chart when there is under 2 snapshots', () => {
    render(<TrendGraph snapshots={[{ timestamp: 0, totalPnlSol: 0 }]} />)
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
    expect(container.querySelector('path')).toBeInTheDocument()
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
})
