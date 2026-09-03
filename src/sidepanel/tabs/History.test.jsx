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

// getByText compares an element's OWN text nodes, so a cell whose label sits in its own
// span (it has to, to stay muted inside a win/loss-coloured cell) is invisible to a
// whole-cell text query. Find the cell through its label and read the full textContent —
// which also keeps the assertions exact rather than substring matches.
const cell = (label, scope = screen) => scope.getByText(label, { selector: '.axpt-history-label' }).parentElement

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

  // "How much did I buy for?" — the SOL that left the account, the tokens that came back,
  // and the price those tokens cost, each in its own labelled cell so the row is readable
  // without a legend. formatSol gives a sub-1 amount 4 decimals (0.1 -> "0.1000"),
  // formatTokenAmount abbreviates a million (1_000_000 -> "1.00M") and formatPrice gives a
  // >= $1 price 2 decimals (13.4 -> "$13.40").
  it('shows what a buy cost, what it bought, and the price paid', () => {
    render(
      <History tradeHistory={[buy({ symbol: 'MORKO', solAmount: 0.1, tokenAmount: 1_000_000, priceUsd: 13.4 })]} />,
    )
    expect(cell('Spent').textContent).toBe('Spent 0.1000 SOL')
    expect(cell('Bought').textContent).toBe('Bought 1.00M MORKO')
    expect(cell('Price').textContent).toBe('Price $13.40')
  })

  // "How much did I sell at, and did I make money?" — every figure of the sell leg,
  // including the realized PnL that is recorded on the trade itself. 250_000 tokens ->
  // "250.00K", 0.2 SOL -> "0.2000", fraction 1 -> the whole position closed, and
  // realizedPnlSol 0.05 -> "+0.0500" because formatSol signs a gain.
  it('shows what a sell returned, the price sold at, how much was closed, and the realized profit', () => {
    render(
      <History
        tradeHistory={[
          sell({
            symbol: 'MORKO',
            solAmount: 0.2,
            tokenAmount: 250_000,
            priceUsd: 13.4,
            fraction: 1,
            realizedPnlSol: 0.05,
          }),
        ]}
      />,
    )
    expect(cell('Received').textContent).toBe('Received 0.2000 SOL')
    expect(cell('Sold').textContent).toBe('Sold 250.00K MORKO')
    expect(cell('Price').textContent).toBe('Price $13.40')
    expect(cell('Closed').textContent).toBe('Closed 100.00%')

    const realized = cell('Realized')
    expect(realized.textContent).toBe('Realized +0.0500 SOL')
    expect(realized).toHaveClass('axpt-pnl-positive')
    expect(realized).not.toHaveClass('axpt-pnl-negative')
  })

  // A loss must be distinguishable from a win at a glance: the negative class, and a
  // minus sign that formatSol carries from the number itself (-0.037 -> "-0.0370").
  it('styles a losing sell with the negative class and shows the loss signed', () => {
    render(<History tradeHistory={[sell({ symbol: 'RUG', realizedPnlSol: -0.037 })]} />)

    const realized = cell('Realized')
    expect(realized.textContent).toBe('Realized -0.0370 SOL')
    expect(realized).toHaveClass('axpt-pnl-negative')
    expect(realized).not.toHaveClass('axpt-pnl-positive')
  })

  // The fraction closed is a portion of a position, not a gain — it must not be dressed
  // up with the "+" that formatPercent puts on a positive PnL, which would read as a win.
  it('shows a partial sell as the percentage of the position closed, unsigned', () => {
    render(<History tradeHistory={[sell({ symbol: 'PART', fraction: 0.25 })]} />)
    expect(cell('Closed').textContent).toBe('Closed 25.00%')
    expect(cell('Closed').textContent).not.toMatch(/\+/)
  })

  // A buy has no realized PnL and no fraction closed. Rendering either — even as a zero —
  // would tell the user they broke even on a trade that has not been closed at all.
  it('never shows a realized PnL or a closed percentage on a buy', () => {
    render(<History tradeHistory={[buy({ symbol: 'MORKO' })]} />)
    expect(screen.queryByText(/Realized/)).toBeNull()
    expect(screen.queryByText(/Closed/)).toBeNull()
  })

  // An older sell written before realizedPnlSol was recorded has an unknown result, not a
  // break-even one: it gets the placeholder and neither win nor loss styling.
  it('renders a sell with no recorded realized PnL as a placeholder, not a break-even', () => {
    render(<History tradeHistory={[sell({ symbol: 'OLD', realizedPnlSol: undefined })]} />)

    const realized = cell('Realized')
    expect(realized.textContent).toBe('Realized —')
    expect(realized).not.toHaveClass('axpt-pnl-positive')
    expect(realized).not.toHaveClass('axpt-pnl-negative')
  })

  // An unrecorded token amount is unknown, not zero.
  it('renders a missing token amount as a placeholder rather than zero', () => {
    render(<History tradeHistory={[buy({ symbol: 'UNK', tokenAmount: undefined })]} />)
    expect(cell('Bought').textContent).toBe('Bought — UNK')
  })

  // The whole point of routing prices through formatPrice: memecoins trade far below a
  // cent, and a fixed toFixed(4) would render every one of them as "$0.0000" — the price
  // vanishes and a 10x move shows no change. Four significant digits must survive.
  it('renders a sub-cent price with real digits instead of zero', () => {
    render(<History tradeHistory={[buy({ symbol: 'PEPE', solAmount: 0.25, priceUsd: 0.000004521 })]} />)

    const price = cell('Price')
    expect(price.textContent).toBe('Price $0.000004521')
    // Guard the two ways the digits get lost: a fixed-decimal collapse to zero, and a
    // toPrecision result that escapes into exponent notation.
    expect(price.textContent).not.toMatch(/\$0(\.0+)?$/)
    expect(price.textContent).not.toMatch(/e[+-]/i)
    // The SOL leg keeps its own precision alongside it.
    expect(cell('Spent').textContent).toBe('Spent 0.2500 SOL')
  })

  // A price between a cent and a dollar keeps 4 decimals rather than dropping to the
  // 2-decimal dollar format, so cent-level moves stay visible.
  it('keeps four decimals for a price between a cent and a dollar', () => {
    render(<History tradeHistory={[buy({ symbol: 'SUB', solAmount: 1.5, priceUsd: 0.0342 })]} />)
    expect(cell('Price').textContent).toBe('Price $0.0342')
    // 1.5 SOL is >= 1, so formatSol drops to 3 decimals.
    expect(cell('Spent').textContent).toBe('Spent 1.500 SOL')
  })

  // A trade whose price was never resolved must show the em-dash placeholder, not "$0" or
  // "NaN" — an unknown price is not a zero price.
  it('renders a missing price as a placeholder rather than zero', () => {
    render(<History tradeHistory={[buy({ symbol: 'UNK', solAmount: 0.1, priceUsd: undefined })]} />)

    const price = cell('Price')
    expect(price.textContent).toBe('Price —')
    expect(price.textContent).not.toMatch(/0|NaN/)
  })

  // Every row says when it happened, in the viewer's own locale.
  it('shows a readable timestamp for each trade', () => {
    const ts = 1_700_000_000_000
    render(<History tradeHistory={[buy({ timestamp: ts })]} />)
    expect(screen.getByText(new Date(ts).toLocaleString())).toBeInTheDocument()
  })
})
