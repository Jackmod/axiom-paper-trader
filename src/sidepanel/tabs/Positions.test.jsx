import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/preact'
import { Positions } from './Positions.jsx'

describe('Positions', () => {
  it('shows an empty-state message when there are no open positions', () => {
    render(<Positions positions={{}} />)
    expect(screen.getByText(/no open positions/i)).toBeInTheDocument()
  })

  it('renders one row per position with name, quantity, and symbol', () => {
    render(
      <Positions
        positions={{
          M: {
            name: 'Morko',
            symbol: 'MORKO',
            imageUrl: '',
            qty: 0.5,
            avgEntryUsd: 10,
            lastPriceUsd: 10,
            stale: false,
          },
        }}
      />,
    )
    expect(screen.getByText('Morko')).toBeInTheDocument()
    expect(screen.getByText('0.5000 MORKO')).toBeInTheDocument()
  })

  it('shows a positive PnL in the buy-green style and a negative PnL in the sell-pink style', () => {
    render(
      <Positions
        positions={{
          WIN: { name: 'Win', symbol: 'WIN', imageUrl: '', qty: 1, avgEntryUsd: 10, lastPriceUsd: 12, stale: false },
          LOSE: { name: 'Lose', symbol: 'LOSE', imageUrl: '', qty: 1, avgEntryUsd: 10, lastPriceUsd: 8, stale: false },
        }}
      />,
    )
    expect(screen.getByText(/\+2\.00/)).toHaveClass('axpt-pnl-positive')
    expect(screen.getByText(/-2\.00/)).toHaveClass('axpt-pnl-negative')
  })

  it('shows a stale indicator only on positions whose price refresh failed', () => {
    render(
      <Positions
        positions={{
          FRESH: {
            name: 'Fresh',
            symbol: 'FRESH',
            imageUrl: '',
            qty: 1,
            avgEntryUsd: 10,
            lastPriceUsd: 10,
            stale: false,
          },
          STALE: {
            name: 'Stale',
            symbol: 'STALE',
            imageUrl: '',
            qty: 1,
            avgEntryUsd: 10,
            lastPriceUsd: 10,
            stale: true,
          },
        }}
      />,
    )
    expect(screen.getByTitle(/price may be stale/i)).toBeInTheDocument()
    expect(screen.queryAllByTitle(/price may be stale/i)).toHaveLength(1)
  })
})
