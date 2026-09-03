// src/popup/Popup.test.jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/preact'
import { Popup } from './Popup.jsx'

function mockChromeWithState(state) {
  globalThis.chrome = {
    runtime: { sendMessage: vi.fn() },
    storage: {
      local: { get: vi.fn((_keys, cb) => cb(state)) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    sidePanel: { open: vi.fn() },
    windows: { WINDOW_ID_CURRENT: -2 },
  }
}

const STATE = {
  balanceSol: 2.5,
  positions: {
    A: { symbol: 'A', imageUrl: '', qty: 1, avgEntryUsd: 10, lastPriceUsd: 12 },
    B: { symbol: 'B', imageUrl: '', qty: 2, avgEntryUsd: 5, lastPriceUsd: 4 },
  },
}

beforeEach(() => mockChromeWithState(STATE))

describe('Popup', () => {
  it('shows a loading state before storage resolves', () => {
    globalThis.chrome.storage.local.get = vi.fn() // never calls back
    render(<Popup />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('sends SYNC_NOW on mount so prices refresh immediately (spec §9 sync-on-reopen)', () => {
    render(<Popup />)
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'SYNC_NOW' })
  })

  it('renders the balance and total unrealized PnL once state loads', async () => {
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('2.500 SOL')).toBeInTheDocument())
    // A: (12-10)*1 = +2, B: (4-5)*2 = -2 -> total 0.00
    expect(screen.getByText(/0\.00 PnL/)).toBeInTheDocument()
  })

  it('renders up to 4 open positions by symbol', async () => {
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('A')).toBeInTheDocument())
    expect(screen.getByText('B')).toBeInTheDocument()
  })

  it('calls chrome.sidePanel.open when Expand is clicked', async () => {
    render(<Popup />)
    await waitFor(() => screen.getByRole('button', { name: /expand/i }))
    fireEvent.click(screen.getByRole('button', { name: /expand/i }))
    expect(chrome.sidePanel.open).toHaveBeenCalled()
  })
})
