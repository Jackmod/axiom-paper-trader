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

// A gain carries exactly one '+': the formatters sign the value, and the header no
// longer prepends a sign of its own. It used to do both, rendering '++$3.50'.
const GAIN_SIGN = '+'

// Deliberately NOT a fixture whose PnL cancels to zero: a zero total survives a
// dropped total, a sign-flipped engine call, and summing pnlPct instead of
// pnlUsd. A: (12-10)*1 = +2, B: (5.75-5)*2 = +1.5 -> +3.50 and nothing else.
//
// qty is TOKENS and avgEntryUsd is USD-PER-TOKEN — the distinction the units fix exists
// to enforce. solInvested is the SOL actually paid, which is what SOL-denominated PnL is
// measured against, so it must not be derivable from the USD figures: at 100 USD/SOL,
// A is worth 12/100 = 0.12 SOL against 0.10 paid (+0.02) and B is worth 11.5/100 = 0.115
// SOL against 0.05 paid (+0.065), for +0.0850 SOL — a total that shares no digits with
// the +3.50 USD one, so neither branch can pass by rendering the other's number.
const WINNING_POSITIONS = {
  A: { symbol: 'A', imageUrl: '', qty: 1, avgEntryUsd: 10, lastPriceUsd: 12, solInvested: 0.1 },
  B: { symbol: 'B', imageUrl: '', qty: 2, avgEntryUsd: 5, lastPriceUsd: 5.75, solInvested: 0.05 },
}

// No solUsdPrice: the popup has no honest way to speak SOL, so it must speak USD.
const STATE = { balanceSol: 2.5, positions: WINNING_POSITIONS }

// The same holdings once a SOL/USD rate is known -> the header switches to SOL.
const STATE_WITH_RATE = { ...STATE, solUsdPrice: 100 }

// A: (8-10)*1 = -2, B: (4-5)*2 = -2 -> -4.00 USD.
// In SOL at 100 USD/SOL: A is worth 8/100 = 0.08 against 0.10 paid (-0.02) and B is worth
// 8/100 = 0.08 against 0.10 paid (-0.02), for -0.0400 SOL.
const LOSING_POSITIONS = {
  A: { symbol: 'A', imageUrl: '', qty: 1, avgEntryUsd: 10, lastPriceUsd: 8, solInvested: 0.1 },
  B: { symbol: 'B', imageUrl: '', qty: 2, avgEntryUsd: 5, lastPriceUsd: 4, solInvested: 0.1 },
}
const LOSING_STATE = { balanceSol: 0.5, positions: LOSING_POSITIONS }
const LOSING_STATE_WITH_RATE = { ...LOSING_STATE, solUsdPrice: 100 }

function positionsFor(symbols) {
  return Object.fromEntries(
    symbols.map((symbol, i) => [
      symbol,
      { symbol, imageUrl: '', qty: i + 1, avgEntryUsd: 1, lastPriceUsd: 1, solInvested: (i + 1) / 100 },
    ]),
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

  it('renders the balance via formatSol and, with no SOL/USD rate, a USD total', async () => {
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('2.500 SOL')).toBeInTheDocument())

    // +2.00 + +1.50 = +3.50 USD. The "$" is the whole point: without a rate the header
    // must not present a USD sum as though it were SOL, which is the units bug that
    // made a small position report -21 SOL.
    const pnl = screen.getByText(`${GAIN_SIGN}$3.50 PnL`)
    expect(pnl).toBeInTheDocument()
    expect(pnl).toHaveClass('axpt-pnl-positive')
    expect(pnl).not.toHaveClass('axpt-pnl-negative')
    expect(screen.queryByText(/3\.50 SOL/)).not.toBeInTheDocument()
  })

  it('renders the total in SOL once a SOL/USD rate is known', async () => {
    mockChromeWithState(STATE_WITH_RATE)
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('2.500 SOL')).toBeInTheDocument())

    // +0.02 + +0.065 = +0.0850 SOL, measured against the SOL actually paid.
    const pnl = screen.getByText(`${GAIN_SIGN}0.0850 SOL PnL`)
    expect(pnl).toBeInTheDocument()
    expect(pnl).toHaveClass('axpt-pnl-positive')
    expect(pnl).not.toHaveClass('axpt-pnl-negative')
    // The USD figure is a different number entirely; it must not leak into the header.
    expect(screen.queryByText(/\$3\.50/)).not.toBeInTheDocument()
  })

  it('renders a losing USD total with a minus sign and the negative accent', async () => {
    mockChromeWithState(LOSING_STATE)
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('0.5000 SOL')).toBeInTheDocument())

    // -2.00 + -2.00 = -4.00 USD.
    const pnl = screen.getByText('-$4.00 PnL')
    expect(pnl).toBeInTheDocument()
    expect(pnl).toHaveClass('axpt-pnl-negative')
    expect(pnl).not.toHaveClass('axpt-pnl-positive')
  })

  it('renders a losing SOL total with a minus sign and the negative accent', async () => {
    mockChromeWithState(LOSING_STATE_WITH_RATE)
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('0.5000 SOL')).toBeInTheDocument())

    // -0.02 + -0.02 = -0.0400 SOL.
    const pnl = screen.getByText('-0.0400 SOL PnL')
    expect(pnl).toBeInTheDocument()
    expect(pnl).toHaveClass('axpt-pnl-negative')
    expect(pnl).not.toHaveClass('axpt-pnl-positive')
    expect(screen.queryByText(/\$-4\.00/)).not.toBeInTheDocument()
  })

  it('does not round a sub-cent-priced position down to a flat $0.00', async () => {
    // 800 tokens bought at $0.000005 and now worth $0.0000075 each: a 50% gain, worth
    // 0.0020 USD. Fixed two-decimal money formatting would print "$0.00" and tell the
    // user their winning position did nothing.
    mockChromeWithState({
      balanceSol: 1,
      positions: {
        C: { symbol: 'C', imageUrl: '', qty: 800, avgEntryUsd: 0.000005, lastPriceUsd: 0.0000075, solInvested: 0.0001 },
      },
    })
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('C', NOT_DECORATIVE)).toBeInTheDocument())

    expect(screen.getByText(`${GAIN_SIGN}$0.00200 PnL`)).toBeInTheDocument()
    expect(screen.queryByText(/\$0\.00 PnL/)).not.toBeInTheDocument()
  })

  it('renders a fresh install with no balance and no positions', async () => {
    mockChromeWithState({})
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('0.000000 SOL')).toBeInTheDocument())
    // No rate and no positions -> an honest zero in USD, and no sign doubling because
    // formatUsd only signs values above zero.
    expect(screen.getByText('$0.00 PnL')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('renders each open position with its symbol and token quantity', async () => {
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('A', NOT_DECORATIVE)).toBeInTheDocument())
    expect(screen.getByText('B', NOT_DECORATIVE)).toBeInTheDocument()
    // qty is TOKENS held, rendered by formatTokenAmount.
    expect(screen.getByText('1.00')).toBeInTheDocument()
    expect(screen.getByText('2.00')).toBeInTheDocument()
  })

  it('abbreviates huge token counts and keeps fractional ones legible', async () => {
    // Memecoin balances span nine orders of magnitude in the same list: "1500000.00"
    // is unreadable and "0.00" is a lie.
    mockChromeWithState({
      balanceSol: 1,
      positions: {
        BIG: { symbol: 'BIG', imageUrl: '', qty: 1_500_000, avgEntryUsd: 1, lastPriceUsd: 1, solInvested: 1 },
        TINY: { symbol: 'TINY', imageUrl: '', qty: 0.00042, avgEntryUsd: 1, lastPriceUsd: 1, solInvested: 0.1 },
      },
    })
    render(<Popup />)
    await waitFor(() => expect(screen.getByText('BIG', NOT_DECORATIVE)).toBeInTheDocument())
    expect(screen.getByText('1.50M')).toBeInTheDocument()
    expect(screen.getByText('0.000420')).toBeInTheDocument()
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
    expect(screen.getByText(`${GAIN_SIGN}$3.50 PnL`)).toBeInTheDocument()
  })

  it('switches the total from USD to SOL when the background writes a SOL/USD rate', async () => {
    // refreshAllPositions resolves SOL/USD and writes state.solUsdPrice, so the popup can
    // open before any rate exists and gain one mid-session. Same holdings, same instant —
    // only the currency the header can honestly speak has changed.
    render(<Popup />)
    await waitFor(() => expect(screen.getByText(`${GAIN_SIGN}$3.50 PnL`)).toBeInTheDocument())

    const listener = capturedStorageListener()
    act(() => listener({ solUsdPrice: { newValue: 100 } }, 'local'))

    await waitFor(() => expect(screen.getByText(`${GAIN_SIGN}0.0850 SOL PnL`)).toBeInTheDocument())
    expect(screen.queryByText(/\$3\.50/)).not.toBeInTheDocument()
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
