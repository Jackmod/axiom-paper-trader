import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/preact'
import { Positions } from './Positions.jsx'

describe('Positions', () => {
  it('shows an empty-state message when there are no open positions', () => {
    render(<Positions positions={{}} />)
    expect(screen.getByText(/no open positions/i)).toBeInTheDocument()
  })

  // SidePanel.jsx reads chrome.storage.local directly, so before the first write
  // `state.positions` is genuinely undefined on a fresh install — that must render
  // the empty state, not throw.
  it('shows the empty state when positions has never been written', () => {
    const { unmount } = render(<Positions positions={undefined} />)
    expect(screen.getByText(/no open positions/i)).toBeInTheDocument()
    unmount()

    render(<Positions />)
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

  // Spec §11: a row is (icon, name, qty, USD value, PnL). The value is qty * price,
  // which for these fixtures is a different number from both the qty and the PnL.
  it('renders the current USD value of each position', () => {
    render(
      <Positions
        positions={{
          A: { name: 'A', symbol: 'A', imageUrl: '', qty: 3, avgEntryUsd: 10, lastPriceUsd: 12, stale: false },
          B: { name: 'B', symbol: 'B', imageUrl: '', qty: 0.5, avgEntryUsd: 10, lastPriceUsd: 7, stale: false },
        }}
      />,
    )
    expect(screen.getByText('$36.00')).toBeInTheDocument()
    expect(screen.getByText('$3.50')).toBeInTheDocument()
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
    expect(screen.getByText(/\+2\.00/)).not.toHaveClass('axpt-pnl-negative')
    expect(screen.getByText(/-2\.00/)).toHaveClass('axpt-pnl-negative')
    expect(screen.getByText(/-2\.00/)).not.toHaveClass('axpt-pnl-positive')
  })

  // Exact text, so the percentage half of the row is covered too: a $2.00 gain on a
  // $10.00 entry is +20.0%, a number nothing else in the row happens to equal.
  it('renders the PnL as both an absolute USD figure and a percentage', () => {
    render(
      <Positions
        positions={{
          WIN: { name: 'Win', symbol: 'WIN', imageUrl: '', qty: 1, avgEntryUsd: 10, lastPriceUsd: 12, stale: false },
          LOSE: { name: 'Lose', symbol: 'LOSE', imageUrl: '', qty: 1, avgEntryUsd: 10, lastPriceUsd: 8, stale: false },
        }}
      />,
    )
    expect(screen.getByText('+2.00 (20.0%)')).toBeInTheDocument()
    expect(screen.getByText('-2.00 (-20.0%)')).toBeInTheDocument()
  })

  // The sign boundary: a position sitting exactly at its entry price is flat, and
  // must read as +0.00 in the neutral-to-positive style rather than -0.00 in pink.
  it('renders a position sitting exactly at its entry price as a flat, non-negative PnL', () => {
    render(
      <Positions
        positions={{
          FLAT: { name: 'Flat', symbol: 'FLAT', imageUrl: '', qty: 2, avgEntryUsd: 5, lastPriceUsd: 5, stale: false },
        }}
      />,
    )
    expect(screen.getByText('+0.00 (0.0%)')).toBeInTheDocument()
    expect(screen.getByText('+0.00 (0.0%)')).toHaveClass('axpt-pnl-positive')
    expect(screen.getByText('+0.00 (0.0%)')).not.toHaveClass('axpt-pnl-negative')
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

  // Spec §13: a stale price keeps its last known value on screen rather than
  // blanking — the dot is an annotation, not a replacement.
  it('still shows the last known price and PnL on a stale position', () => {
    render(
      <Positions
        positions={{
          STALE: {
            name: 'Stale',
            symbol: 'STALE',
            imageUrl: '',
            qty: 2,
            avgEntryUsd: 10,
            lastPriceUsd: 11,
            stale: true,
          },
        }}
      />,
    )
    expect(screen.getByText('$22.00')).toBeInTheDocument()
    expect(screen.getByText('2.0000 STALE')).toBeInTheDocument()
    expect(screen.getByText(/\+2\.00 \(10\.0%\)/)).toBeInTheDocument()
  })
})
