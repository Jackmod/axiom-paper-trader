import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/preact'
import { SidePanel, PANEL_POLL_MS } from './SidePanel.jsx'

function mockChromeWithState(state) {
  globalThis.chrome = {
    runtime: { sendMessage: vi.fn() },
    storage: {
      local: { get: vi.fn((_keys, cb) => cb(state)) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  }
}

// A: (12-10)*1 = +2.00, B: (5.75-5)*2 = +1.50 -> +3.50 total, a figure that
// survives neither a dropped position nor a pnlPct-for-pnlUsd swap.
// tradeHistory closes two trades, one profitable -> 50% win rate.
const STATE = {
  balanceSol: 2.5,
  positions: {
    A: { name: 'Ay', symbol: 'A', imageUrl: '', qty: 1, avgEntryUsd: 10, lastPriceUsd: 12, stale: false },
    B: { name: 'Bee', symbol: 'B', imageUrl: '', qty: 2, avgEntryUsd: 5, lastPriceUsd: 5.75, stale: false },
  },
  tradeHistory: [
    { mint: 'W', symbol: 'W', side: 'buy', qtySol: 1, priceUsd: 10 },
    { mint: 'W', symbol: 'W', side: 'sell', qtySol: 1, priceUsd: 15 },
    { mint: 'L', symbol: 'L', side: 'buy', qtySol: 1, priceUsd: 10 },
    { mint: 'L', symbol: 'L', side: 'sell', qtySol: 1, priceUsd: 5 },
  ],
}

// A: (8-10)*1 = -2, B: (4-5)*2 = -2 -> -4.00.
const LOSING_STATE = {
  balanceSol: 0.5,
  positions: {
    A: { name: 'Ay', symbol: 'A', imageUrl: '', qty: 1, avgEntryUsd: 10, lastPriceUsd: 8, stale: false },
    B: { name: 'Bee', symbol: 'B', imageUrl: '', qty: 2, avgEntryUsd: 5, lastPriceUsd: 4, stale: false },
  },
  tradeHistory: [],
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

describe('SidePanel', () => {
  it('shows a loading state before storage resolves', () => {
    globalThis.chrome.storage.local.get = vi.fn() // never calls back
    render(<SidePanel />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('sends SYNC_NOW on mount so prices refresh immediately (spec §9 sync-on-reopen)', () => {
    render(<SidePanel />)
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'SYNC_NOW' })
  })

  it('polls in the spec §9 5-10s real-time window while open', () => {
    expect(PANEL_POLL_MS).toBeGreaterThanOrEqual(5000)
    expect(PANEL_POLL_MS).toBeLessThanOrEqual(10000)
  })

  it('keeps polling SYNC_NOW while open and stops once the panel closes', () => {
    vi.useFakeTimers()
    const { unmount } = render(<SidePanel />)
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1) // the mount sync

    act(() => vi.advanceTimersByTime(PANEL_POLL_MS * 3))
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(4)
    expect(chrome.runtime.sendMessage).toHaveBeenLastCalledWith({ type: 'SYNC_NOW' })

    unmount()
    act(() => vi.advanceTimersByTime(PANEL_POLL_MS * 3))
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(4) // closed = back to the alarm cadence
  })

  it('renders the portfolio stats header: balance, total PnL, and win rate (spec §11)', async () => {
    render(<SidePanel />)
    await waitFor(() => expect(screen.getByText('2.500 SOL')).toBeInTheDocument())
    expect(screen.getByText('+3.50')).toBeInTheDocument()
    expect(screen.getByText('+3.50')).toHaveClass('axpt-pnl-positive')
    expect(screen.getByText('+3.50')).not.toHaveClass('axpt-pnl-negative')
    expect(screen.getByText('50%')).toBeInTheDocument()
  })

  it('renders a losing total with a minus sign and the negative accent', async () => {
    mockChromeWithState(LOSING_STATE)
    render(<SidePanel />)
    await waitFor(() => expect(screen.getByText('0.500 SOL')).toBeInTheDocument())
    expect(screen.getByText('-4.00')).toBeInTheDocument()
    expect(screen.getByText('-4.00')).toHaveClass('axpt-pnl-negative')
    expect(screen.getByText('-4.00')).not.toHaveClass('axpt-pnl-positive')
  })

  it('shows a placeholder win rate rather than 0% when nothing has been closed yet', async () => {
    mockChromeWithState(LOSING_STATE) // empty tradeHistory
    render(<SidePanel />)
    await waitFor(() => expect(screen.getByText('0.500 SOL')).toBeInTheDocument())
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  // A fresh install has no key written at all, so state.positions is undefined —
  // the panel must render, not throw, because `if (!state)` does not catch `{}`.
  it('renders a fresh install where storage is completely empty', async () => {
    mockChromeWithState({})
    render(<SidePanel />)
    await waitFor(() => expect(screen.getByText('0.000 SOL')).toBeInTheDocument())
    expect(screen.getByText('+0.00')).toBeInTheDocument()
    expect(screen.getByText(/no open positions/i)).toBeInTheDocument()
  })

  it('opens on the Positions tab and lists the open positions', async () => {
    render(<SidePanel />)
    await waitFor(() => expect(screen.getByText('Ay')).toBeInTheDocument())
    expect(screen.getByText('Bee')).toBeInTheDocument()
    expect(screen.getByText('1.0000 A')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Positions' })).toHaveClass('axpt-tab-active')
  })

  it('switches tabs on click, hiding the Positions list', async () => {
    render(<SidePanel />)
    await waitFor(() => expect(screen.getByText('Ay')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'History' }))

    await waitFor(() => expect(screen.queryByText('Ay')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'History' })).toHaveClass('axpt-tab-active')
    expect(screen.getByRole('button', { name: 'Positions' })).not.toHaveClass('axpt-tab-active')
    expect(screen.getByText('2.500 SOL')).toBeInTheDocument() // the stats header spans every tab
  })

  it('re-renders live when the background writes to chrome.storage.local', async () => {
    render(<SidePanel />)
    await waitFor(() => expect(screen.getByText('2.500 SOL')).toBeInTheDocument())

    const listener = capturedStorageListener()
    act(() => listener({ balanceSol: { newValue: 9.25 } }, 'local'))

    await waitFor(() => expect(screen.getByText('9.250 SOL')).toBeInTheDocument())
    expect(screen.getByText('Ay')).toBeInTheDocument() // keys the write didn't touch survive
    expect(screen.getByText('+3.50')).toBeInTheDocument()
  })

  it('ignores storage changes from any area other than local (spec §3)', async () => {
    render(<SidePanel />)
    await waitFor(() => expect(screen.getByText('2.500 SOL')).toBeInTheDocument())

    const listener = capturedStorageListener()
    act(() => listener({ balanceSol: { newValue: 9.25 } }, 'sync'))

    expect(screen.getByText('2.500 SOL')).toBeInTheDocument()
    expect(screen.queryByText('9.250 SOL')).not.toBeInTheDocument()
  })

  it('unsubscribes from storage when the panel closes', () => {
    const { unmount } = render(<SidePanel />)
    const listener = capturedStorageListener()
    unmount()
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(listener)
  })
})
