import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/preact'
import { History } from './History.jsx'

// tradeHistory entries carry the post-units-fix schema: solAmount is the SOL paid or
// received, tokenAmount the tokens moved, and priceUsd the USD price per token. There is
// no `qtySol` field any more — a fixture still using it would render "— SOL" and silently
// stop testing the amount at all.
const buy = (over = {}) => ({
  id: '1',
  mint: 'Mint1111111111111111111111111111111111111111',
  symbol: 'MORKO',
  side: 'buy',
  solAmount: 0.1,
  tokenAmount: 1_000_000,
  priceUsd: 13.4,
  solUsdPrice: 150,
  priorityFeeSol: 0.0001,
  slippagePct: 1,
  timestamp: 1000,
  ...over,
})

const sell = (over = {}) =>
  buy({ id: '2', side: 'sell', fraction: 1, realizedPnlSol: 0.05, timestamp: 2000, ...over })

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
          buy({ id: '1', symbol: 'KIWI', solAmount: 0.1, priceUsd: 10, timestamp: 1000 }),
          sell({ id: '2', symbol: 'ZIG', solAmount: 0.2, priceUsd: 20, timestamp: 3000 }),
          buy({ id: '3', symbol: 'GRID', solAmount: 0.3, priceUsd: 30, timestamp: 2000 }),
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
          buy({ id: '1', symbol: 'A', solAmount: 0.1, priceUsd: 10, timestamp: 1000 }),
          sell({ id: '2', symbol: 'B', solAmount: 0.2, priceUsd: 20, timestamp: 2000 }),
        ]}
      />,
    )
    expect(screen.getByText('BUY')).toHaveClass('axpt-pnl-positive')
    expect(screen.getByText('BUY')).not.toHaveClass('axpt-pnl-negative')
    expect(screen.getByText('SELL')).toHaveClass('axpt-pnl-negative')
    expect(screen.getByText('SELL')).not.toHaveClass('axpt-pnl-positive')
  })

  // solAmount is the SOL leg of the trade; priceUsd is USD per token. formatSol gives a
  // sub-1 amount 4 decimals (0.1 -> "0.1000") and formatPrice gives a >= $1 price 2
  // (13.4 -> "$13.40").
  it('shows the SOL amount and price for each trade', () => {
    render(<History tradeHistory={[buy({ symbol: 'MORKO', solAmount: 0.1, priceUsd: 13.4 })]} />)
    expect(screen.getByText(/^0\.1000 SOL @ \$13\.40$/)).toBeInTheDocument()
  })

  // The whole point of routing prices through formatPrice: memecoins trade far below a
  // cent, and a fixed toFixed(4) would render every one of them as "$0.0000" — the price
  // vanishes and a 10x move shows no change. Four significant digits must survive.
  it('renders a sub-cent price with real digits instead of zero', () => {
    render(<History tradeHistory={[buy({ symbol: 'PEPE', solAmount: 0.25, priceUsd: 0.000004521 })]} />)

    const line = screen.getByText(/SOL @ /)
    expect(line.textContent).toBe('0.2500 SOL @ $0.000004521')
    // Guard the two ways the digits get lost: a fixed-decimal collapse to zero, and a
    // toPrecision result that escapes into exponent notation.
    expect(line.textContent).not.toMatch(/@ \$0(\.0+)?$/)
    expect(line.textContent).not.toMatch(/e[+-]/i)
  })

  // A price between a cent and a dollar keeps 4 decimals rather than dropping to the
  // 2-decimal dollar format, so cent-level moves stay visible.
  it('keeps four decimals for a price between a cent and a dollar', () => {
    render(<History tradeHistory={[buy({ symbol: 'SUB', solAmount: 1.5, priceUsd: 0.0342 })]} />)
    expect(screen.getByText(/^1\.500 SOL @ \$0\.0342$/)).toBeInTheDocument()
  })

  // A trade whose price was never resolved must show the em-dash placeholder, not "$0" or
  // "NaN" — an unknown price is not a zero price.
  it('renders a missing price as a placeholder rather than zero', () => {
    render(<History tradeHistory={[buy({ symbol: 'UNK', solAmount: 0.1, priceUsd: undefined })]} />)
    expect(screen.getByText(/^0\.1000 SOL @ —$/)).toBeInTheDocument()
  })
})
