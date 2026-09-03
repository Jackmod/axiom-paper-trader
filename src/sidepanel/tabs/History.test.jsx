import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/preact'
import { History } from './History.jsx'

describe('History', () => {
  it('shows an empty-state message when there are no trades', () => {
    render(<History tradeHistory={[]} />)
    expect(screen.getByText(/no trades yet/i)).toBeInTheDocument()
  })

  // SidePanel.jsx reads chrome.storage.local directly, so before the first trade
  // `state.tradeHistory` is genuinely undefined on a fresh install — that must
  // render the empty state, not throw on a spread of undefined.
  it('shows the empty state when tradeHistory has never been written', () => {
    const { unmount } = render(<History tradeHistory={undefined} />)
    expect(screen.getByText(/no trades yet/i)).toBeInTheDocument()
    unmount()

    render(<History />)
    expect(screen.getByText(/no trades yet/i)).toBeInTheDocument()
  })

  // The symbol is read out of its own element and compared exactly, rather than
  // matching a substring of the whole row: a row's own chrome ("BUY", "SELL",
  // "SOL", and the AM/PM a localised timestamp emits) contains letters that make
  // whole-row substring assertions pass even when the sort runs backwards.
  it('sorts newest-first regardless of input order', () => {
    render(
      <History
        tradeHistory={[
          { id: '1', symbol: 'KIWI', side: 'buy', qtySol: 0.1, priceUsd: 10, timestamp: 1000 },
          { id: '2', symbol: 'ZIG', side: 'sell', qtySol: 0.2, priceUsd: 20, timestamp: 3000 },
          { id: '3', symbol: 'GRID', side: 'buy', qtySol: 0.3, priceUsd: 30, timestamp: 2000 },
        ]}
      />,
    )
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((r) => within(r).getByText(/^(KIWI|ZIG|GRID)$/).textContent)).toEqual(['ZIG', 'GRID', 'KIWI'])
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
    expect(screen.getByText('BUY')).not.toHaveClass('axpt-pnl-negative')
    expect(screen.getByText('SELL')).toHaveClass('axpt-pnl-negative')
    expect(screen.getByText('SELL')).not.toHaveClass('axpt-pnl-positive')
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
