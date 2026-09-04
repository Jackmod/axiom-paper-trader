// src/content/widget/Widget.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/preact'
import { Widget } from './Widget.jsx'

const MINT = 'MorkoMint1111111111111111111111111111111111'

// SOL/USD used throughout, chosen so every SOL figure below divides out by hand.
const SOL_USD = 200

// A winning position, in the units the engine actually stores:
//   qty         = 1,000,000 TOKENS held
//   avgEntryUsd = $0.00004 per token
//   solInvested = 0.2 SOL actually paid for those tokens
// At $0.00005 per token: value = 1e6 * 0.00005 = $50 = 0.25 SOL, so
//   pnlSol = 0.25 - 0.2  = +0.05 SOL
//   pnlPct = 0.00001 / 0.00004 * 100 = +25.00%
// The sub-cent entry/last prices are deliberate: this is what a memecoin costs, and it
// is exactly the shape of number the old fixed-4-decimal formatter erased.
const POSITION = {
  name: 'Morko',
  symbol: 'MORKO',
  imageUrl: 'https://x/img.png',
  qty: 1_000_000,
  avgEntryUsd: 0.00004,
  solInvested: 0.2,
  lastPriceUsd: 0.00005,
}

// A losing position, to exercise the other side of every sign-dependent branch.
//
// Cost basis has to agree with itself: 500,000 tokens at $0.0001 is $50 spent, which at
// $200/SOL is 0.25 SOL — not the 0.5 this fixture used to claim. applyBuy derives both
// numbers from one trade, so no real position can disagree with itself this way. The
// contradiction stayed invisible while only the SOL figure was displayed, and surfaced the
// moment USD was rendered beside it: the same position was down $10 by price basis and $60
// by SOL basis. A fixture that cannot exist is a test that proves nothing.
//   value  = 500,000 * 0.00008 = $40 = 0.2 SOL against 0.25 SOL invested → -0.05 SOL
//   pnlUsd = -0.00002 * 500,000 = -$10
//   pnlPct = -0.00002 / 0.0001 * 100 = -20.00%
const LOSING_POSITION = {
  name: 'Dumpo',
  symbol: 'DUMPO',
  imageUrl: 'https://x/dump.png',
  qty: 500_000,
  avgEntryUsd: 0.0001,
  solInvested: 0.25,
  lastPriceUsd: 0.00008,
}

const noop = () => {}

describe('Widget header', () => {
  it('renders the token name, live price and paper balance', () => {
    render(
      <Widget
        position={POSITION}
        mint={MINT}
        balanceSol={12.34567}
        solUsdPrice={SOL_USD}
        onBuyPreset={noop}
        onSellPreset={noop}
      />,
    )
    expect(screen.getByText('Morko')).toBeInTheDocument()
    // $0.00005 kept to four significant digits, not flattened to $0.0001 or $0.0000.
    expect(screen.getByText('$0.00005000')).toBeInTheDocument()
    // 12.34567 SOL rounds to three decimals above 1 SOL.
    expect(screen.getByTitle('Paper balance')).toHaveTextContent('12.346 SOL')
  })

  it('keeps sub-1 balances precise instead of rounding them away', () => {
    render(<Widget position={null} mint={MINT} balanceSol={0.05} onBuyPreset={noop} onSellPreset={noop} />)
    expect(screen.getByTitle('Paper balance')).toHaveTextContent('0.0500 SOL')
  })

  it('falls back to the page-scraped symbol when the position has no name', () => {
    render(
      <Widget
        position={{ ...POSITION, name: '' }}
        mint={MINT}
        tokenSymbol="WIF"
        solUsdPrice={SOL_USD}
        onBuyPreset={noop}
        onSellPreset={noop}
      />,
    )
    // position.symbol wins over the page's tokenSymbol, but either way a name is shown.
    expect(screen.getByText('MORKO')).toBeInTheDocument()
  })

  it('prefers the position identity over what the page is currently showing', () => {
    render(
      <Widget
        position={POSITION}
        mint={MINT}
        tokenName="Some Other Token"
        solUsdPrice={SOL_USD}
        onBuyPreset={noop}
        onSellPreset={noop}
      />,
    )
    expect(screen.getByText('Morko')).toBeInTheDocument()
    expect(screen.queryByText('Some Other Token')).not.toBeInTheDocument()
  })

  it('names the page token when nothing is held yet', () => {
    render(
      <Widget
        position={null}
        mint={MINT}
        tokenName="Fresh Launch"
        priceUsd={0.00005}
        onBuyPreset={noop}
        onSellPreset={noop}
      />,
    )
    expect(screen.getByText('Fresh Launch')).toBeInTheDocument()
    expect(screen.getByText('$0.00005000')).toBeInTheDocument()
  })

  it('says no token is open when the page is not on a token', () => {
    render(<Widget position={null} onBuyPreset={noop} onSellPreset={noop} />)
    expect(screen.getByText('No token open')).toBeInTheDocument()
    expect(screen.getByText('Open a token to trade')).toBeInTheDocument()
  })

  // Market cap now comes from the price APIs as a NUMBER, not scraped text. The scraped
  // version was brittle and in practice matched the token's PRICE instead of its cap.
  it('appends the market cap, formatted with a magnitude suffix, to the header price', () => {
    render(
      <Widget
        position={POSITION}
        mint={MINT}
        marketCapUsd={450000}
        solUsdPrice={SOL_USD}
        onBuyPreset={noop}
        onSellPreset={noop}
      />,
    )
    expect(screen.getByText('$0.00005000 · MC $450.0K')).toBeInTheDocument()
  })

  it('omits the market cap entirely when no source reported one', () => {
    const { container } = render(
      <Widget position={POSITION} mint={MINT} solUsdPrice={SOL_USD} onBuyPreset={noop} onSellPreset={noop} />,
    )
    // Not "MC is empty" — the separator and label must be absent, so a dangling
    // "· MC" can't sneak past.
    expect(container.querySelector('.axpt-widget-sub').textContent).toBe('$0.00005000')
    expect(screen.queryByText(/MC/)).not.toBeInTheDocument()
  })
})

describe('Widget price precision', () => {
  it('renders a sub-cent price with real digits, never $0.0000', () => {
    render(
      <Widget position={null} mint={MINT} priceUsd={0.000004521} onBuyPreset={noop} onSellPreset={noop} />,
    )
    // toFixed(4) would render this token — and every other sub-cent token — as
    // "$0.0000", making a 10x move invisible. Four significant digits instead.
    expect(screen.getByText('$0.000004521')).toBeInTheDocument()
    expect(screen.queryByText('$0.0000')).not.toBeInTheDocument()
  })

  it('carries the sub-cent price into the buy tooltip too', () => {
    render(
      <Widget position={null} mint={MINT} priceUsd={0.000004521} onBuyPreset={noop} onSellPreset={noop} />,
    )
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Buy 0.1 SOL' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('0.1 SOL @ $0.000004521')
  })
})

describe('Widget position summary', () => {
  it('does not render a position summary when there is no open position', () => {
    const { container } = render(
      <Widget position={null} mint={MINT} onBuyPreset={noop} onSellPreset={noop} />,
    )
    expect(screen.queryByText('Holding')).not.toBeInTheDocument()
    // Not just "no name" — the whole summary row is absent, so an empty/placeholder
    // row can't sneak past this test.
    expect(container.querySelector('.axpt-widget-position')).toBeNull()
  })

  it('renders holding in TOKENS and average entry in USD per token, in one row', () => {
    const { container } = render(
      <Widget position={POSITION} mint={MINT} solUsdPrice={SOL_USD} onBuyPreset={noop} onSellPreset={noop} />,
    )
    // 1,000,000 tokens held — a token count, not the 0.2 SOL that was paid for them.
    expect(screen.getByText('1.00M')).toBeInTheDocument()
    expect(screen.getByText('$0.00004000')).toBeInTheDocument()
    expect(container.querySelectorAll('.axpt-widget-position')).toHaveLength(1)
  })

  it('renders unrealized PnL in SOL, USD and %, in the gain colour', () => {
    render(
      <Widget position={POSITION} mint={MINT} solUsdPrice={SOL_USD} onBuyPreset={noop} onSellPreset={noop} />,
    )
    // 1e6 tokens * $0.00005 = $50 = 0.25 SOL, against 0.2 SOL invested → +0.05 SOL = +$10.
    // All three units together: SOL is what the paper account is denominated in, but "am I
    // up ten dollars or ten thousand" is the question a trader actually asks, and a
    // percentage alone answers it only if you remember the position size.
    const pnl = screen.getByText(/\+0\.0500 SOL/)
    expect(pnl).toHaveTextContent('+0.0500 SOL · +$10.00 (+25.00%)')
    expect(pnl).toHaveClass('axpt-pnl-positive')
    expect(pnl).not.toHaveClass('axpt-pnl-negative')
  })

  it('renders a losing position with a negative PnL in the loss colour', () => {
    render(
      <Widget
        position={LOSING_POSITION}
        mint={MINT}
        solUsdPrice={SOL_USD}
        onBuyPreset={noop}
        onSellPreset={noop}
      />,
    )
    // 5e5 tokens * $0.00008 = $40 = 0.2 SOL, against 0.25 SOL invested → -0.05 SOL = -$10.
    // The minus sits outside the dollar sign: "-$10.00", never "$-10.00".
    const pnl = screen.getByText(/-0\.0500 SOL/)
    expect(pnl).toHaveTextContent('-0.0500 SOL · -$10.00 (-20.00%)')
    expect(pnl).toHaveClass('axpt-pnl-negative')
    expect(pnl).not.toHaveClass('axpt-pnl-positive')
  })

  it('drops only the SOL figure when the SOL/USD rate is unknown', () => {
    render(<Widget position={POSITION} mint={MINT} onBuyPreset={noop} onSellPreset={noop} />)
    // Without a rate the engine returns pnlSol === null, and inventing a SOL figure would
    // be a lie. USD needs no rate, though — it comes straight from the token price — so
    // the dollar figure survives where the SOL one cannot.
    const pnl = screen.getByText(/\+\$10\.00/)
    expect(pnl).toHaveTextContent('+$10.00 (+25.00%)')
    expect(pnl).not.toHaveTextContent('SOL')
    expect(pnl).toHaveClass('axpt-pnl-positive')
  })
})

describe('Widget collapse toggle', () => {
  it('hides every trade control while keeping the header readable', () => {
    render(
      <Widget
        position={POSITION}
        mint={MINT}
        balanceSol={12.34567}
        solUsdPrice={SOL_USD}
        onBuyPreset={noop}
        onSellPreset={noop}
      />,
    )
    expect(screen.getByRole('button', { name: 'Buy 1 SOL' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Collapse paper trader' }))

    for (const amount of [0.1, 0.25, 0.5, 1, 2, 5]) {
      expect(screen.queryByRole('button', { name: `Buy ${amount} SOL` })).not.toBeInTheDocument()
    }
    for (const pct of [25, 50, 100]) {
      expect(screen.queryByRole('button', { name: `${pct}%` })).not.toBeInTheDocument()
    }
    expect(screen.queryByLabelText('Custom SOL amount')).not.toBeInTheDocument()
    expect(screen.queryByText('Holding')).not.toBeInTheDocument()

    // Collapsed is a glance state, not a hidden state: price and balance stay visible.
    expect(screen.getByText('Morko')).toBeInTheDocument()
    expect(screen.getByText('$0.00005000')).toBeInTheDocument()
    expect(screen.getByTitle('Paper balance')).toHaveTextContent('12.346 SOL')
  })

  it('re-expands, and the toggle announces what the next click will do', () => {
    render(
      <Widget position={POSITION} mint={MINT} solUsdPrice={SOL_USD} onBuyPreset={noop} onSellPreset={noop} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Collapse paper trader' }))
    const expand = screen.getByRole('button', { name: 'Expand paper trader' })
    expect(expand).toBeInTheDocument()

    fireEvent.click(expand)
    expect(screen.getByRole('button', { name: 'Collapse paper trader' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buy 1 SOL' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '50%' })).toBeInTheDocument()
  })
})

describe('Widget buying', () => {
  it('renders all six buy presets and all three sell presets', () => {
    render(<Widget position={POSITION} mint={MINT} solUsdPrice={SOL_USD} onBuyPreset={noop} onSellPreset={noop} />)
    for (const amount of [0.1, 0.25, 0.5, 1, 2, 5]) {
      expect(screen.getByRole('button', { name: `Buy ${amount} SOL` })).toBeInTheDocument()
    }
    for (const pct of [25, 50, 100]) {
      expect(screen.getByRole('button', { name: `${pct}%` })).toBeInTheDocument()
    }
  })

  it('calls onBuyPreset with the clicked SOL amount', () => {
    const onBuyPreset = vi.fn()
    render(<Widget position={null} mint={MINT} priceUsd={0.00005} onBuyPreset={onBuyPreset} onSellPreset={noop} />)
    fireEvent.click(screen.getByRole('button', { name: 'Buy 0.25 SOL' }))
    // The preset is SOL to spend — the widget never tries to compute a token count.
    expect(onBuyPreset).toHaveBeenCalledWith(0.25)
    expect(onBuyPreset).toHaveBeenCalledTimes(1)
  })

  it('buys a custom SOL amount typed into the input', () => {
    const onBuyPreset = vi.fn()
    render(<Widget position={null} mint={MINT} priceUsd={0.00005} onBuyPreset={onBuyPreset} onSellPreset={noop} />)
    fireEvent.input(screen.getByLabelText('Custom SOL amount'), { target: { value: '0.75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buy custom SOL amount' }))
    expect(onBuyPreset).toHaveBeenCalledWith(0.75)
  })

  it('refuses to buy an empty or non-positive custom amount', () => {
    const onBuyPreset = vi.fn()
    render(<Widget position={null} mint={MINT} priceUsd={0.00005} onBuyPreset={onBuyPreset} onSellPreset={noop} />)
    const customBuy = screen.getByRole('button', { name: 'Buy custom SOL amount' })
    expect(customBuy).toBeDisabled()

    fireEvent.input(screen.getByLabelText('Custom SOL amount'), { target: { value: '0' } })
    expect(customBuy).toBeDisabled()
    fireEvent.click(customBuy)
    // Guarded as well as disabled: NaN or 0 reaching applyBuy would throw.
    expect(onBuyPreset).not.toHaveBeenCalled()

    fireEvent.input(screen.getByLabelText('Custom SOL amount'), { target: { value: 'abc' } })
    expect(customBuy).toBeDisabled()
    fireEvent.click(customBuy)
    expect(onBuyPreset).not.toHaveBeenCalled()
  })
})

describe('Widget selling', () => {
  it('calls onSellPreset with the clicked percentage', () => {
    const onSellPreset = vi.fn()
    render(<Widget position={POSITION} mint={MINT} solUsdPrice={SOL_USD} onBuyPreset={noop} onSellPreset={onSellPreset} />)
    fireEvent.click(screen.getByRole('button', { name: '50%' }))
    // A percentage, not a token count: the message layer turns it into a fraction.
    expect(onSellPreset).toHaveBeenCalledWith(50)
    expect(onSellPreset).toHaveBeenCalledTimes(1)
  })

  it('calls onSellPreset with 100 for a full exit', () => {
    const onSellPreset = vi.fn()
    render(<Widget position={POSITION} mint={MINT} solUsdPrice={SOL_USD} onBuyPreset={noop} onSellPreset={onSellPreset} />)
    fireEvent.click(screen.getByRole('button', { name: '100%' }))
    expect(onSellPreset).toHaveBeenCalledWith(100)
  })
})

describe('Widget disabled states', () => {
  it('disables every buy control when no token is open', () => {
    const onBuyPreset = vi.fn()
    render(<Widget position={null} onBuyPreset={onBuyPreset} onSellPreset={noop} />)

    for (const amount of [0.1, 0.25, 0.5, 1, 2, 5]) {
      expect(screen.getByRole('button', { name: `Buy ${amount} SOL` })).toBeDisabled()
    }
    // Even a perfectly valid custom amount cannot buy a token that isn't there —
    // there would be no mint to attach the position to.
    fireEvent.input(screen.getByLabelText('Custom SOL amount'), { target: { value: '1.5' } })
    const customBuy = screen.getByRole('button', { name: 'Buy custom SOL amount' })
    expect(customBuy).toBeDisabled()
    // `.click()` rather than fireEvent.click: it runs the real activation algorithm,
    // which refuses to dispatch on a disabled control. fireEvent dispatches the event
    // unconditionally, which would prove nothing about what a browser does.
    customBuy.click()
    expect(onBuyPreset).not.toHaveBeenCalled()
  })

  it('enables the buy controls as soon as a token is open', () => {
    render(<Widget position={null} mint={MINT} priceUsd={0.00005} onBuyPreset={noop} onSellPreset={noop} />)
    for (const amount of [0.1, 0.25, 0.5, 1, 2, 5]) {
      expect(screen.getByRole('button', { name: `Buy ${amount} SOL` })).not.toBeDisabled()
    }
  })

  it('disables every sell control when nothing is held', () => {
    const onSellPreset = vi.fn()
    render(<Widget position={null} mint={MINT} priceUsd={0.00005} onBuyPreset={noop} onSellPreset={onSellPreset} />)
    for (const pct of [25, 50, 100]) {
      const button = screen.getByRole('button', { name: `${pct}%` })
      expect(button).toBeDisabled()
      // Real activation, which a browser refuses to run on a disabled control —
      // selling nothing would send fraction against a position that isn't there.
      button.click()
    }
    expect(onSellPreset).not.toHaveBeenCalled()
  })

  it('enables the sell controls once a position exists', () => {
    render(<Widget position={POSITION} mint={MINT} solUsdPrice={SOL_USD} onBuyPreset={noop} onSellPreset={noop} />)
    for (const pct of [25, 50, 100]) {
      expect(screen.getByRole('button', { name: `${pct}%` })).not.toBeDisabled()
    }
  })
})

describe('Widget tooltips', () => {
  it('shows the exact SOL amount in a tooltip on hover, before the click', () => {
    render(<Widget position={null} mint={MINT} onBuyPreset={noop} onSellPreset={noop} />)
    const button = screen.getByRole('button', { name: 'Buy 1 SOL' })
    fireEvent.mouseEnter(button)
    expect(button).toHaveTextContent('1 SOL')
    fireEvent.mouseLeave(button)
    expect(button).not.toHaveTextContent('1 SOL')
  })

  it('prices the buy tooltip off the live price when a position is open', () => {
    render(<Widget position={POSITION} mint={MINT} solUsdPrice={SOL_USD} onBuyPreset={noop} onSellPreset={noop} />)
    const button = screen.getByRole('button', { name: 'Buy 2 SOL' })
    fireEvent.mouseEnter(button)
    // The position's last refreshed price wins over whatever the page last scraped.
    expect(screen.getByRole('tooltip')).toHaveTextContent('2 SOL @ $0.00005000')
    fireEvent.mouseLeave(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows the exact token quantity a sell preset would sell', () => {
    render(<Widget position={POSITION} mint={MINT} solUsdPrice={SOL_USD} onBuyPreset={noop} onSellPreset={noop} />)
    const button = screen.getByRole('button', { name: '50%' })
    fireEvent.mouseEnter(button)
    // 50% of 1,000,000 tokens = 500,000 tokens — a token count, not the SOL paid.
    expect(screen.getByRole('tooltip')).toHaveTextContent('500.00K tokens @ $0.00005000')
    fireEvent.mouseLeave(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows the whole holding behind the 100% sell', () => {
    render(<Widget position={POSITION} mint={MINT} solUsdPrice={SOL_USD} onBuyPreset={noop} onSellPreset={noop} />)
    fireEvent.mouseEnter(screen.getByRole('button', { name: '100%' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('1.00M tokens @ $0.00005000')
  })

  it('falls back to the bare percentage in the sell tooltip when nothing is held', () => {
    render(<Widget position={null} mint={MINT} priceUsd={0.00005} onBuyPreset={noop} onSellPreset={noop} />)
    fireEvent.mouseEnter(screen.getByRole('button', { name: '25%' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sell 25%')
  })

  it('shows only one tooltip at a time', () => {
    render(<Widget position={POSITION} mint={MINT} solUsdPrice={SOL_USD} onBuyPreset={noop} onSellPreset={noop} />)
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Buy 1 SOL' }))
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Buy 2 SOL' }))
    expect(screen.getAllByRole('tooltip')).toHaveLength(1)
    expect(screen.getByRole('tooltip')).toHaveTextContent('2 SOL @ $0.00005000')
  })
})

// Detection failing must never mean "no way to trade". Before this existed, an
// undetected mint disabled every buy button, and with no position every sell button too
// — the whole product dead, with a panel of greyed-out controls and no explanation.
describe('Widget — manual token entry when detection misses', () => {
  const MINT = '31A8xLh6fwYavYvzdKeSsMjPGmK7RVz3Z4M5EG8Spump'

  it('offers a contract-address field when no token was detected', () => {
    render(<Widget position={null} mint={null} onBuyPreset={vi.fn()} onSellPreset={vi.fn()} />)

    expect(screen.getByLabelText(/token contract address/i)).toBeInTheDocument()
    expect(screen.getByText(/couldn’t detect the token/i)).toBeInTheDocument()
  })

  it('hands the pasted address back to the caller', () => {
    const onMintOverride = vi.fn()
    render(
      <Widget position={null} mint={null} onMintOverride={onMintOverride} onBuyPreset={vi.fn()} onSellPreset={vi.fn()} />,
    )

    fireEvent.input(screen.getByLabelText(/token contract address/i), { target: { value: `  ${MINT}  ` } })
    fireEvent.click(screen.getByRole('button', { name: /^use$/i }))

    // Trimmed: a pasted address routinely carries surrounding whitespace.
    expect(onMintOverride).toHaveBeenCalledWith(MINT)
  })

  it('ignores an empty submission rather than overriding with nothing', () => {
    const onMintOverride = vi.fn()
    render(
      <Widget position={null} mint={null} onMintOverride={onMintOverride} onBuyPreset={vi.fn()} onSellPreset={vi.fn()} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /^use$/i }))

    expect(onMintOverride).not.toHaveBeenCalled()
  })

  it('hides the field once a token is known, detected or pasted', () => {
    render(<Widget position={null} mint={MINT} onBuyPreset={vi.fn()} onSellPreset={vi.fn()} />)

    expect(screen.queryByLabelText(/token contract address/i)).not.toBeInTheDocument()
  })

  it('enables buying as soon as a token is known', () => {
    const onBuyPreset = vi.fn()
    render(<Widget position={null} mint={MINT} onBuyPreset={onBuyPreset} onSellPreset={vi.fn()} />)

    const buy = screen.getByRole('button', { name: 'Buy 0.25 SOL' })
    expect(buy).not.toBeDisabled()
    buy.click()

    expect(onBuyPreset).toHaveBeenCalledWith(0.25)
  })
})

// A rejected trade has to be VISIBLE.
//
// Until now the only report of a failure was console.warn: the user clicked buy, nothing
// happened, and the extension looked broken. That silence is also what justified letting
// the balance go negative rather than refusing an unaffordable buy — refusing it would
// have been indistinguishable from the button not working. With the rejection on screen,
// the account can hold its floor and still explain itself.
describe('Widget trade errors', () => {
  it('shows a rejected trade instead of leaving the user staring at an unchanged panel', () => {
    render(
      <Widget
        position={null}
        mint={MINT}
        solUsdPrice={SOL_USD}
        error="Not enough paper SOL — that costs 1.0000 SOL and you have 0.0500 SOL"
        onBuyPreset={noop}
        onSellPreset={noop}
      />,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Not enough paper SOL')
    expect(alert).toHaveTextContent('0.0500 SOL')
  })

  it('shows no alert when nothing has gone wrong', () => {
    render(<Widget position={null} mint={MINT} solUsdPrice={SOL_USD} onBuyPreset={noop} onSellPreset={noop} />)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
