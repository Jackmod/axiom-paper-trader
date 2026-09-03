import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/preact'
import { History } from './History.jsx'

describe('History', () => {
  it('shows an empty-state message when there are no trades', () => {
    render(<History tradeHistory={[]} />)
    expect(screen.getByText(/no trades yet/i)).toBeInTheDocument()
  })

  it('sorts newest-first regardless of input order', () => {
    render(
      <History
        tradeHistory={[
          { id: '1', symbol: 'A', side: 'buy', qtySol: 0.1, priceUsd: 10, timestamp: 1000 },
          { id: '2', symbol: 'B', side: 'sell', qtySol: 0.2, priceUsd: 20, timestamp: 3000 },
          { id: '3', symbol: 'C', side: 'buy', qtySol: 0.3, priceUsd: 30, timestamp: 2000 },
        ]}
      />,
    )
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('B'),
      expect.stringContaining('C'),
      expect.stringContaining('A'),
    ])
  })

  it('renders BUY and SELL with distinct styling classes', () => {
    render(
      <History
        tradeHistory={[
          { id: '1', symbol: 'A', side: 'buy', qtySol: 0.1, priceUsd: 10, timestamp: 1000 },
          { id: '2', symbol: 'B', side: 'sell', qtySol: 0.2, priceUsd: 20, timestamp: 2000 },
        ]}
      />,
    )
    expect(screen.getByText('BUY')).toHaveClass('axpt-pnl-positive')
    expect(screen.getByText('SELL')).toHaveClass('axpt-pnl-negative')
  })

  it('shows the SOL amount and price for each trade', () => {
    render(
      <History
        tradeHistory={[{ id: '1', symbol: 'MORKO', side: 'buy', qtySol: 0.1, priceUsd: 13.4, timestamp: 1000 }]}
      />,
    )
    expect(screen.getByText(/0\.1000 SOL @ \$13\.400000/)).toBeInTheDocument()
  })
})
