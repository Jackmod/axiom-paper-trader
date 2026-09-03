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
    render(<Widget position={null} onBuyPreset={() => {}} onSellPreset={() => {}} />)
    expect(screen.queryByText('Morko')).not.toBeInTheDocument()
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
})
