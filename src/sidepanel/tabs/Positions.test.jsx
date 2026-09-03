import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/preact'
import { Positions } from './Positions.jsx'

// Fixtures follow the units the engine actually stores:
//   qty          TOKENS held
//   avgEntryUsd  USD per token
//   solInvested  SOL actually paid for the tokens still held
// A fixture that puts SOL in `qty` is the bug this suite exists to catch, so every
// position below carries all three fields and the numbers are internally consistent.

describe('Positions', () => {
  it('shows an empty-state message when there are no open positions', () => {
    render(<Positions positions={{}} solUsdPrice={200} />)
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

  it('renders one row per position with name, token quantity, symbol and average entry price', () => {
    render(
      <Positions
        positions={{
          M: {
            name: 'Morko',
            symbol: 'MORKO',
            imageUrl: '',
            qty: 1_500_000, // tokens, not SOL
            avgEntryUsd: 0.002,
            solInvested: 15,
            lastPriceUsd: 0.002,
            stale: false,
          },
        }}
        solUsdPrice={200}
      />,
    )
    expect(screen.getByText('Morko')).toBeInTheDocument()
    // 1,500,000 tokens abbreviates to 1.50M; the entry price is $0.002 per token.
    expect(screen.getByText('1.50M MORKO @ $0.002000')).toBeInTheDocument()
  })

  // The reason the formatters exist: memecoin entry prices are routinely far below a
  // cent, and a fixed toFixed(4) turns every one of them into "$0.0000" — the price
  // vanishes and every token looks identical.
  it('renders a sub-cent average entry with significant digits rather than $0.0000', () => {
    render(
      <Positions
        positions={{
          TINY: {
            name: 'Tiny',
            symbol: 'TINY',
            imageUrl: '',
            qty: 1000,
            avgEntryUsd: 0.000004521,
            solInvested: 0.0000226,
            lastPriceUsd: 0.000004521,
            stale: false,
          },
        }}
        solUsdPrice={200}
      />,
    )
    const entryLine = screen.getByText(/TINY @/)
    expect(entryLine).toHaveTextContent('@ $0.000004521')
    // "$0.0000" only counts as a failure when nothing significant follows it.
    expect(entryLine.textContent).not.toMatch(/\$0\.0000(?!\d)/)
  })

  // Spec §11: a row is (icon, name, qty @ entry, value, PnL). With a SOL/USD rate known,
  // the account's own currency is SOL, so value and PnL are shown in SOL.
  //
  // Worked by hand: 1000 tokens bought at $0.05 for 0.25 SOL, now $0.075 each.
  //   valueUsd = 1000 * 0.075          = $75
  //   valueSol = 75 / 200              = 0.375 SOL
  //   pnlSol   = 0.375 - 0.25          = +0.125 SOL   (measured against SOL actually paid)
  //   pnlPct   = (0.075 - 0.05) / 0.05 = +50%
  it('shows value and PnL in SOL when the SOL/USD rate is known', () => {
    render(
      <Positions
        positions={{
          A: {
            name: 'Alpha',
            symbol: 'ALPHA',
            imageUrl: '',
            qty: 1000,
            avgEntryUsd: 0.05,
            solInvested: 0.25,
            lastPriceUsd: 0.075,
            stale: false,
          },
        }}
        solUsdPrice={200}
      />,
    )
    expect(screen.getByText('0.3750 SOL')).toBeInTheDocument()
    expect(screen.getByText('+0.1250 SOL (+50.00%)')).toBeInTheDocument()
    // The USD figures are the fallback, not an extra column.
    expect(screen.queryByText('$75.00')).toBeNull()
    expect(screen.queryByText(/\+\$25\.00/)).toBeNull()
  })

  // The other branch: with no rate (fresh install, or the SOL/USD fetch failed) the row
  // must still show a real number, denominated in USD, rather than "—" or a bare figure
  // silently labelled SOL.
  it('falls back to USD value and PnL when no SOL/USD rate is known', () => {
    const position = {
      A: {
        name: 'Alpha',
        symbol: 'ALPHA',
        imageUrl: '',
        qty: 1000,
        avgEntryUsd: 0.05,
        solInvested: 0.25,
        lastPriceUsd: 0.075,
        stale: false,
      },
    }

    // pnlUsd = (0.075 - 0.05) * 1000 = +$25.00 on a $75.00 position.
    const { unmount } = render(<Positions positions={position} solUsdPrice={0} />)
    expect(screen.getByText('$75.00')).toBeInTheDocument()
    expect(screen.getByText('+$25.00 (+50.00%)')).toBeInTheDocument()
    expect(screen.queryByText(/SOL/)).toBeNull()
    unmount()

    // Same again when the prop is simply absent.
    render(<Positions positions={position} />)
    expect(screen.getByText('$75.00')).toBeInTheDocument()
    expect(screen.getByText('+$25.00 (+50.00%)')).toBeInTheDocument()
    expect(screen.queryByText(/SOL/)).toBeNull()
  })

  // Both winners hold 100 tokens bought at $1.00 for 0.50 SOL (rate 200).
  //   WIN  at $1.50: valueSol = 150/200 = 0.75 → pnlSol = +0.25 SOL, +50.00%
  //   LOSE at $0.50: valueSol =  50/200 = 0.25 → pnlSol = -0.25 SOL, -50.00%
  it('shows a positive PnL in the buy-green style and a negative PnL in the sell-pink style', () => {
    render(
      <Positions
        positions={{
          WIN: {
            name: 'Win',
            symbol: 'WIN',
            imageUrl: '',
            qty: 100,
            avgEntryUsd: 1,
            solInvested: 0.5,
            lastPriceUsd: 1.5,
            stale: false,
          },
          LOSE: {
            name: 'Lose',
            symbol: 'LOSE',
            imageUrl: '',
            qty: 100,
            avgEntryUsd: 1,
            solInvested: 0.5,
            lastPriceUsd: 0.5,
            stale: false,
          },
        }}
        solUsdPrice={200}
      />,
    )
    const win = screen.getByText('+0.2500 SOL (+50.00%)')
    const lose = screen.getByText('-0.2500 SOL (-50.00%)')
    expect(win).toHaveClass('axpt-pnl-positive')
    expect(win).not.toHaveClass('axpt-pnl-negative')
    expect(lose).toHaveClass('axpt-pnl-negative')
    expect(lose).not.toHaveClass('axpt-pnl-positive')
  })

  // The sign styling has to survive the USD fallback too — a losing position must not
  // turn green just because the SOL/USD rate is unavailable.
  it('keeps the PnL sign styling in the USD fallback', () => {
    render(
      <Positions
        positions={{
          WIN: {
            name: 'Win',
            symbol: 'WIN',
            imageUrl: '',
            qty: 100,
            avgEntryUsd: 1,
            solInvested: 0.5,
            lastPriceUsd: 1.5,
            stale: false,
          },
          LOSE: {
            name: 'Lose',
            symbol: 'LOSE',
            imageUrl: '',
            qty: 100,
            avgEntryUsd: 1,
            solInvested: 0.5,
            lastPriceUsd: 0.5,
            stale: false,
          },
        }}
      />,
    )
    const win = screen.getByText('+$50.00 (+50.00%)')
    // The minus sits outside the currency symbol — "-$50.00", not "$-50.00".
    const lose = screen.getByText(/-\$50\.00 \(-50\.00%\)/)
    expect(win).toHaveClass('axpt-pnl-positive')
    expect(win).not.toHaveClass('axpt-pnl-negative')
    expect(lose).toHaveClass('axpt-pnl-negative')
    expect(lose).not.toHaveClass('axpt-pnl-positive')
  })

  // The sign boundary: a position sitting exactly at its entry price is flat, and must
  // read as a zero in the neutral-to-positive style rather than a negative one in pink.
  // 100 tokens at $1.00 bought for 0.50 SOL, still $1.00 → valueSol 0.5, pnlSol exactly 0.
  it('renders a position sitting exactly at its entry price as a flat, non-negative PnL', () => {
    render(
      <Positions
        positions={{
          FLAT: {
            name: 'Flat',
            symbol: 'FLAT',
            imageUrl: '',
            qty: 100,
            avgEntryUsd: 1,
            solInvested: 0.5,
            lastPriceUsd: 1,
            stale: false,
          },
        }}
        solUsdPrice={200}
      />,
    )
    const flat = screen.getByText('0.000000 SOL (0.00%)')
    expect(flat).toHaveClass('axpt-pnl-positive')
    expect(flat).not.toHaveClass('axpt-pnl-negative')
    expect(flat.textContent.trim().startsWith('-')).toBe(false)
  })

  it('shows a stale indicator only on positions whose price refresh failed', () => {
    render(
      <Positions
        positions={{
          FRESH: {
            name: 'Fresh',
            symbol: 'FRESH',
            imageUrl: '',
            qty: 100,
            avgEntryUsd: 1,
            solInvested: 0.5,
            lastPriceUsd: 1,
            stale: false,
          },
          STALE: {
            name: 'Stale',
            symbol: 'STALE',
            imageUrl: '',
            qty: 100,
            avgEntryUsd: 1,
            solInvested: 0.5,
            lastPriceUsd: 1,
            stale: true,
          },
        }}
        solUsdPrice={200}
      />,
    )
    expect(screen.getByTitle(/price may be stale/i)).toBeInTheDocument()
    expect(screen.queryAllByTitle(/price may be stale/i)).toHaveLength(1)
  })

  // Spec §13: a stale price keeps its last known value on screen rather than blanking —
  // the dot is an annotation, not a replacement.
  //
  // 200 tokens bought at $1.00 for 1 SOL, last seen at $1.10 with the rate at 200:
  //   valueUsd = 220 → valueSol = 1.1 SOL, pnlSol = +0.1 SOL, pnlPct = +10.00%
  it('still shows the last known value, quantity and PnL on a stale position', () => {
    render(
      <Positions
        positions={{
          STALE: {
            name: 'Stale',
            symbol: 'STALE',
            imageUrl: '',
            qty: 200,
            avgEntryUsd: 1,
            solInvested: 1,
            lastPriceUsd: 1.1,
            stale: true,
          },
        }}
        solUsdPrice={200}
      />,
    )
    expect(screen.getByText('1.100 SOL')).toBeInTheDocument()
    expect(screen.getByText('200.00 STALE @ $1.00')).toBeInTheDocument()
    expect(screen.getByText(/\+0\.1000 SOL \(\+10\.00%\)/)).toBeInTheDocument()
  })
})
