// src/content/widget/Widget.test.jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/preact'
import { Widget } from './Widget.jsx'

const POSITION = {
  name: 'Morko',
  imageUrl: 'https://x/img.png',
  qty: 0.2,
  avgEntryUsd: 12.2016,
  lastPriceUsd: 13.4,
}

// A losing position, to exercise the other side of every sign-dependent branch.
const LOSING_POSITION = {
  name: 'Dumpo',
  imageUrl: 'https://x/dump.png',
  qty: 0.5,
  avgEntryUsd: 10,
  lastPriceUsd: 8,
}

describe('Widget', () => {
  it('renders all six buy presets and all three sell presets', () => {
    render(<Widget position={null} onBuyPreset={() => {}} onSellPreset={() => {}} />)
    for (const amount of [0.1, 0.25, 0.5, 1, 2, 5]) {
      expect(screen.getByRole('button', { name: new RegExp(`Buy ${amount} SOL`) })).toBeInTheDocument()
    }
    for (const pct of [25, 50, 100]) {
      expect(screen.getByRole('button', { name: `${pct}%` })).toBeInTheDocument()
    }
  })

  it('does not render a position summary when there is no open position', () => {
    const { container } = render(<Widget position={null} onBuyPreset={() => {}} onSellPreset={() => {}} />)
    expect(screen.queryByText('Morko')).not.toBeInTheDocument()
    // Not just "no name" — the whole summary row is absent, so an empty/placeholder
    // row can't sneak past this test.
    expect(container.querySelector('.axpt-widget-summary')).toBeNull()
  })

  it('renders the position summary (name, avg entry, PnL%) when a position is open', () => {
    render(<Widget position={POSITION} onBuyPreset={() => {}} onSellPreset={() => {}} />)
    expect(screen.getByText('Morko')).toBeInTheDocument()
    expect(screen.getByText('Avg $12.2016')).toBeInTheDocument()
    expect(screen.getByText(/9\.8%/)).toBeInTheDocument() // (13.4 - 12.2016) / 12.2016 * 100 ≈ 9.8%
  })

  it('calls onBuyPreset with the clicked amount', () => {
    const onBuyPreset = vi.fn()
    render(<Widget position={null} onBuyPreset={onBuyPreset} onSellPreset={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Buy 0\.25 SOL/ }))
    expect(onBuyPreset).toHaveBeenCalledWith(0.25)
  })

  it('calls onSellPreset with the clicked percentage', () => {
    const onSellPreset = vi.fn()
    render(<Widget position={POSITION} onBuyPreset={() => {}} onSellPreset={onSellPreset} />)
    fireEvent.click(screen.getByRole('button', { name: '50%' }))
    expect(onSellPreset).toHaveBeenCalledWith(50)
  })

  it('shows the exact SOL amount in a tooltip on hover, before the click', () => {
    render(<Widget position={null} onBuyPreset={() => {}} onSellPreset={() => {}} />)
    const button = screen.getByRole('button', { name: /Buy 1 SOL/ })
    fireEvent.mouseEnter(button)
    expect(button).toHaveTextContent('1 SOL')
    fireEvent.mouseLeave(button)
    expect(button).not.toHaveTextContent('1 SOL')
  })

  it('renders unrealized PnL in SOL as well as %, in the gain colour', () => {
    render(<Widget position={POSITION} onBuyPreset={() => {}} onSellPreset={() => {}} />)
    // 0.2 SOL cost basis * ((13.4 / 12.2016) - 1) = +0.0196 SOL
    const pnl = screen.getByText(/\+0\.0196 SOL/)
    expect(pnl).toHaveTextContent('+0.0196 SOL (+9.8%)')
    expect(pnl).toHaveClass('axpt-pnl-positive')
    expect(pnl).not.toHaveClass('axpt-pnl-negative')
  })

  it('renders a losing position with a negative PnL in the loss colour', () => {
    render(<Widget position={LOSING_POSITION} onBuyPreset={() => {}} onSellPreset={() => {}} />)
    // 0.5 SOL cost basis * ((8 / 10) - 1) = -0.1 SOL, -20.0%
    const pnl = screen.getByText(/-20\.0%/)
    expect(pnl).toHaveTextContent('-0.1000 SOL (-20.0%)')
    expect(pnl).toHaveClass('axpt-pnl-negative')
    expect(pnl).not.toHaveClass('axpt-pnl-positive')
  })

  it('renders the scraped symbol, market cap and rug badge in the one summary row', () => {
    const { container } = render(
      <Widget
        position={{ ...POSITION, symbol: 'MORKO' }}
        marketCapText="$450K"
        rugBadgeText="Rug 12%"
        onBuyPreset={() => {}}
        onSellPreset={() => {}}
      />,
    )
    expect(screen.getByText('MORKO')).toBeInTheDocument()
    expect(screen.getByText('MC $450K')).toBeInTheDocument()
    expect(screen.getByText('Rug 12%')).toBeInTheDocument()
    expect(container.querySelectorAll('.axpt-widget-summary')).toHaveLength(1)
  })

  it('omits the market cap and rug badge when the page did not provide them', () => {
    render(<Widget position={POSITION} onBuyPreset={() => {}} onSellPreset={() => {}} />)
    expect(screen.queryByText(/^MC/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Rug/)).not.toBeInTheDocument()
  })

  it('prices the buy tooltip off the live price when a position is open', () => {
    render(<Widget position={POSITION} onBuyPreset={() => {}} onSellPreset={() => {}} />)
    const button = screen.getByRole('button', { name: /Buy 2 SOL/ })
    fireEvent.mouseEnter(button)
    expect(screen.getByRole('tooltip')).toHaveTextContent('2 SOL @ $13.4000')
    fireEvent.mouseLeave(button)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('shows the exact SOL quantity a sell preset would sell, from the current position', () => {
    render(<Widget position={POSITION} onBuyPreset={() => {}} onSellPreset={() => {}} />)
    const button = screen.getByRole('button', { name: '50%' })
    fireEvent.mouseEnter(button)
    // 50% of 0.2 SOL = 0.1 SOL, not 10 SOL and not 0.2 SOL
    expect(screen.getByRole('tooltip')).toHaveTextContent('0.1000 SOL @ $13.4000')
  })

  it('falls back to the bare percentage in the sell tooltip when nothing is held', () => {
    render(<Widget position={null} onBuyPreset={() => {}} onSellPreset={() => {}} />)
    fireEvent.mouseEnter(screen.getByRole('button', { name: '25%' }))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Sell 25%')
  })

  it('buys a custom SOL amount typed into the input', () => {
    const onBuyPreset = vi.fn()
    render(<Widget position={null} onBuyPreset={onBuyPreset} onSellPreset={() => {}} />)
    fireEvent.input(screen.getByLabelText('Custom SOL amount'), { target: { value: '0.75' } })
    fireEvent.click(screen.getByRole('button', { name: 'Buy custom SOL amount' }))
    expect(onBuyPreset).toHaveBeenCalledWith(0.75)
  })

  it('refuses to buy an empty or non-positive custom amount', () => {
    const onBuyPreset = vi.fn()
    render(<Widget position={null} onBuyPreset={onBuyPreset} onSellPreset={() => {}} />)
    const customBuy = screen.getByRole('button', { name: 'Buy custom SOL amount' })
    expect(customBuy).toBeDisabled()

    fireEvent.input(screen.getByLabelText('Custom SOL amount'), { target: { value: '0' } })
    expect(customBuy).toBeDisabled()
    fireEvent.click(customBuy)
    expect(onBuyPreset).not.toHaveBeenCalled()
  })
})
