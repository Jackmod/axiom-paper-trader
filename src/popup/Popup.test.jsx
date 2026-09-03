// src/popup/Popup.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/preact'
import { Popup, POPUP_POLL_MS } from './Popup.jsx'

// Tokens with no image render a monogram avatar, which repeats the symbol's first
// letters but is aria-hidden. Text queries should look at what a user actually reads.
const NOT_DECORATIVE = { ignore: '[aria-hidden="true"]' }

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

// Deliberately NOT a fixture whose PnL cancels to zero: a zero total survives a
// dropped total, a sign-flipped engine call, and summing pnlPct instead of
// pnlUsd. A: (12-10)*1 = +2, B: (5.75-5)*2 = +1.5 -> +3.50 and nothing else.
const STATE = {
  balanceSol: 2.5,
  positions: {
    A: { symbol: 'A', imageUrl: '', qty: 1, avgEntryUsd: 10, lastPriceUsd: 12 },
    B: { symbol: 'B', imageUrl: '', qty: 2, avgEntryUsd: 5, lastPriceUsd: 5.75 },
  },
}

// A: (8-10)*1 = -2, B: (4-5)*2 = -2 -> -4.00.
const LOSING_STATE = {
  balanceSol: 0.5,
  positions: {
    A: { symbol: 'A', imageUrl: '', qty: 1, avgEntryUsd: 10, lastPriceUsd: 8 },
    B: { symbol: 'B', imageUrl: '', qty: 2, avgEntryUsd: 5, lastPriceUsd: 4 },
  },
}

function positionsFor(symbols) {
  return Object.fromEntries(
    symbols.map((symbol, i) => [symbol, { symbol, imageUrl: '', qty: i + 1, avgEntryUsd: 1, lastPriceUsd: 1 }]),
  )
}

// The listener the component handed to chrome.storage.onChanged, so tests can
// drive a real background write instead of asserting that it registered one.
function capturedStorageListener() {
  const calls = chrome.storage.onChanged.addListener.mock.calls
  expect(calls).toHaveLength(1)
  return calls[0][0]
}

beforeEach(() => mockChromeWithState(STATE))
afterEach(() => vi.useRealTimers())

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

  it('polls in the spec §9 5-10s real-time window while open', () => {
    expect(POPUP_POLL_MS).toBeGreaterThanOrEqual(5000)
    expect(POPUP_POLL_MS).toBeLessThanOrEqual(10000)
  })

  it('keeps polling SYNC_NOW while open and stops once the popup closes', () => {
    vi.useFakeTimers()
    const { unmount } = render(<Popup />)
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1) // the mount sync

    act(() => vi.advanceTimersByTime(POPUP_POLL_MS * 3))
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(4)
    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith({ type: 'SYNC_NOW' })

    unmount()
    act(() => vi.advanceTimersByTime(POPUP_POLL_MS * 3))
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(4) // closed = back to the alarm cadence
  })

  it('renders the balance and total unrealized PnL once state loads', async () => {
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('2.500 SOL')).toBeInTheDocument())
    expect(screen.getByText('+3.50 PnL')).toBeInTheDocument()
    expect(screen.getByText('+3.50 PnL')).toHaveClass('axpt-pnl-positive')
    expect(screen.getByText('+3.50 PnL')).not.toHaveClass('axpt-pnl-negative')
  })

  it('renders a losing total with a minus sign and the negative accent', async () => {
    mockChromeWithState(LOSING_STATE)
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('0.500 SOL')).toBeInTheDocument())
    expect(screen.getByText('-4.00 PnL')).toBeInTheDocument()
    expect(screen.getByText('-4.00 PnL')).toHaveClass('axpt-pnl-negative')
    expect(screen.getByText('-4.00 PnL')).not.toHaveClass('axpt-pnl-positive')
  })

  it('renders a fresh install with no balance and no positions', async () => {
    mockChromeWithState({})
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('0.000 SOL')).toBeInTheDocument())
    expect(screen.getByText('+0.00 PnL')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('renders each open position with its symbol and quantity', async () => {
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('A', NOT_DECORATIVE)).toBeInTheDocument())
    expect(screen.getByText('B', NOT_DECORATIVE)).toBeInTheDocument()
    expect(screen.getByText('1.0000')).toBeInTheDocument()
    expect(screen.getByText('2.0000')).toBeInTheDocument()
  })

  it('caps the quick view at 4 positions even when more are open', async () => {
    mockChromeWithState({ balanceSol: 1, positions: positionsFor(['A', 'B', 'C', 'D', 'E', 'F']) })
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('A', NOT_DECORATIVE)).toBeInTheDocument())
    expect(screen.queryAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByText('D', NOT_DECORATIVE)).toBeInTheDocument()
    expect(screen.queryByText('E')).not.toBeInTheDocument()
    expect(screen.queryByText('F')).not.toBeInTheDocument()
  })

  it('re-renders live when the background writes to chrome.storage.local', async () => {
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('2.500 SOL')).toBeInTheDocument())

    const listener = capturedStorageListener()
    act(() => listener({ balanceSol: { newValue: 9.25 } }, 'local'))

    await waitFor(() => expect(screen.getByText('9.250 SOL')).toBeInTheDocument())
    expect(screen.getByText('A', NOT_DECORATIVE)).toBeInTheDocument() // keys the write didn't touch survive
    expect(screen.getByText('+3.50 PnL')).toBeInTheDocument()
  })

  it('ignores storage changes from any area other than local (spec §3)', async () => {
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('2.500 SOL')).toBeInTheDocument())

    const listener = capturedStorageListener()
    act(() => listener({ balanceSol: { newValue: 9.25 } }, 'sync'))

    expect(screen.getByText('2.500 SOL')).toBeInTheDocument()
    expect(screen.queryByText('9.250 SOL')).not.toBeInTheDocument()
  })

  it('unsubscribes from storage when the popup closes', () => {
    const { unmount } = render(<Popup />)
    const listener = capturedStorageListener()
    unmount()
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(listener)
  })

  it('calls chrome.sidePanel.open for the current window when Expand is clicked', async () => {
    render(<Popup />)
    await waitFor(() => screen.getByRole('button', { name: /expand/i }))
    fireEvent.click(screen.getByRole('button', { name: /expand/i }))
    expect(chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: -2 })
  })
})
