import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/preact'
import { SidePanel, PANEL_POLL_MS, INTRO_MS } from './SidePanel.jsx'

function mockChromeWithState(state) {
  globalThis.chrome = {
    runtime: { sendMessage: vi.fn() },
    storage: {
      local: { get: vi.fn((_keys, cb) => cb(state)) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  }
}

// UNITS. A position holds `qty` TOKENS bought at `avgEntryUsd` USD per token, having cost
// `solInvested` SOL. Every expectation below is derived from that contract by hand — the
// header used to be fed by a formula that subtracted USD-per-token figures and multiplied
// by a SOL amount, which is how a small position came to report −21 SOL and −95%.
//
// A round rate keeps the arithmetic checkable: 1 SOL = $100.
const SOL_USD = 100

// A: 1000 tok @ $0.010 entry (cost 0.1 SOL), now $0.012 -> value $12 = 0.120 SOL -> +0.020 SOL / +$2.00
// B: 2000 tok @ $0.005 entry (cost 0.1 SOL), now $0.00575 -> value $11.50 = 0.115 SOL -> +0.015 SOL / +$1.50
// Totals: +0.035 SOL unrealised, +$3.50 — figures that survive neither a dropped position
// nor a pnlPct-for-pnlUsd swap, and that differ from each other so a currency mix-up shows.
// tradeHistory closes two round trips, one profitable -> 50% win rate.
const STATE = {
  balanceSol: 2.5,
  solUsdPrice: SOL_USD,
  positions: {
    A: { name: 'Ay', symbol: 'A', imageUrl: '', qty: 1000, avgEntryUsd: 0.01, solInvested: 0.1, lastPriceUsd: 0.012, stale: false },
    B: { name: 'Bee', symbol: 'B', imageUrl: '', qty: 2000, avgEntryUsd: 0.005, solInvested: 0.1, lastPriceUsd: 0.00575, stale: false },
  },
  // The win rate is read from the `realizedPnlSol` each sell recorded at the time, so a
  // sell without one (a pre-fix record) is not counted rather than guessed at.
  tradeHistory: [
    { id: 't1', mint: 'W', symbol: 'W', side: 'buy', solAmount: 1, tokenAmount: 10000, priceUsd: 0.01, solUsdPrice: SOL_USD, timestamp: 1000 },
    { id: 't2', mint: 'W', symbol: 'W', side: 'sell', solAmount: 1.5, tokenAmount: 10000, fraction: 1, priceUsd: 0.015, solUsdPrice: SOL_USD, realizedPnlSol: 0.5, timestamp: 2000 },
    { id: 't3', mint: 'L', symbol: 'L', side: 'buy', solAmount: 1, tokenAmount: 10000, priceUsd: 0.01, solUsdPrice: SOL_USD, timestamp: 3000 },
    { id: 't4', mint: 'L', symbol: 'L', side: 'sell', solAmount: 0.5, tokenAmount: 10000, fraction: 1, priceUsd: 0.005, solUsdPrice: SOL_USD, realizedPnlSol: -0.5, timestamp: 4000 },
  ],
  portfolioSnapshots: [
    { timestamp: new Date('2026-09-01T10:00').getTime(), totalPnlSol: 0 },
    { timestamp: new Date('2026-09-02T10:00').getTime(), totalPnlSol: 2 },
    { timestamp: new Date('2026-09-03T10:00').getTime(), totalPnlSol: 1 },
  ],
}

// A: now $0.008 -> value $8 = 0.08 SOL -> -0.020 SOL / -$2.00
// B: now $0.004 -> value $8 = 0.08 SOL -> -0.020 SOL / -$2.00  => -0.040 SOL / -$4.00
const LOSING_STATE = {
  balanceSol: 0.5,
  solUsdPrice: SOL_USD,
  positions: {
    A: { name: 'Ay', symbol: 'A', imageUrl: '', qty: 1000, avgEntryUsd: 0.01, solInvested: 0.1, lastPriceUsd: 0.008, stale: false },
    B: { name: 'Bee', symbol: 'B', imageUrl: '', qty: 2000, avgEntryUsd: 0.005, solInvested: 0.1, lastPriceUsd: 0.004, stale: false },
  },
  tradeHistory: [],
}

// The same holdings with no SOL/USD rate yet — the panel must fall back to the USD figure
// rather than invent a rate to convert with.
const NO_RATE_STATE = { ...STATE, solUsdPrice: 0, tradeHistory: [] }

// One closed trade, and it lost. 0% is a real, earned win rate; "—" means "nothing closed
// yet", and conflating the two would tell a losing user they have no record at all.
const ONE_LOSS_STATE = {
  balanceSol: 1,
  solUsdPrice: SOL_USD,
  positions: {},
  tradeHistory: [
    { id: 's1', mint: 'L', symbol: 'L', side: 'sell', solAmount: 0.5, tokenAmount: 100, fraction: 1, priceUsd: 0.005, solUsdPrice: SOL_USD, realizedPnlSol: -0.5, timestamp: 1000 },
  ],
}

// A real memecoin: 2,000,000 tokens entered at $0.000004521 (cost $9.042 = 0.09042 SOL),
// now doubled to $0.000009042 -> value $18.084 = 0.18084 SOL -> +0.09042 SOL, +100%.
// Rendered with a fixed 4 decimal places the entry price would read "$0.0000", every token
// would look identical, and this 2x would show as no move at all.
const SUBCENT_STATE = {
  balanceSol: 1,
  solUsdPrice: SOL_USD,
  positions: {
    N: {
      name: 'Nano',
      symbol: 'NANO',
      imageUrl: '',
      qty: 2_000_000,
      avgEntryUsd: 0.000004521,
      solInvested: 0.09042,
      lastPriceUsd: 0.000009042,
      stale: false,
    },
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

// Reads one header stat BY ITS LABEL, so a figure printed under the wrong heading fails
// instead of quietly satisfying a page-wide text search.
function statValue(container, label) {
  const stat = [...container.querySelectorAll('.axpt-stat')].find(
    (node) => node.querySelector('.axpt-stat-label')?.textContent === label,
  )
  expect(stat, `no "${label}" stat in the header`).toBeTruthy()
  return stat.querySelector('.axpt-stat-value')
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

  it('renders the portfolio stats header: balance, unrealised PnL in SOL, and win rate (spec §11)', async () => {
    const { container } = render(<SidePanel />)
    await waitFor(() => expect(statValue(container, 'Balance').textContent).toBe('2.500 SOL'))
    // +0.020 (A) +0.015 (B). SOL, not the $3.50 the same holdings are worth in USD —
    // SOL is what the account is funded in, and the two differ by 100x here on purpose.
    expect(statValue(container, 'Total PnL').textContent).toBe('+0.0350 SOL')
    expect(statValue(container, 'Total PnL')).toHaveClass('axpt-pnl-positive')
    expect(statValue(container, 'Total PnL')).not.toHaveClass('axpt-pnl-negative')
    expect(statValue(container, 'Win rate').textContent).toBe('50%') // 1 of 2 closed trades profitable
  })

  it('renders a losing total with a minus sign and the negative accent', async () => {
    mockChromeWithState(LOSING_STATE)
    const { container } = render(<SidePanel />)
    await waitFor(() => expect(statValue(container, 'Balance').textContent).toBe('0.5000 SOL'))
    expect(statValue(container, 'Total PnL').textContent).toBe('-0.0400 SOL')
    expect(statValue(container, 'Total PnL')).toHaveClass('axpt-pnl-negative')
    expect(statValue(container, 'Total PnL')).not.toHaveClass('axpt-pnl-positive')
  })

  // No SOL/USD rate means no honest way to convert; the panel shows what it does know
  // (the USD figure) rather than converting with a made-up rate.
  it('falls back to the USD total while no SOL/USD rate is known', async () => {
    mockChromeWithState(NO_RATE_STATE)
    const { container } = render(<SidePanel />)
    await waitFor(() => expect(statValue(container, 'Balance').textContent).toBe('2.500 SOL'))
    expect(statValue(container, 'Total PnL').textContent).toBe('+$3.50') // +$2.00 (A) +$1.50 (B)
    expect(statValue(container, 'Total PnL')).toHaveClass('axpt-pnl-positive')
  })

  // solUsdPrice is refreshed on every tick and lands in storage like any other key, so the
  // header has to switch currencies the moment it arrives — no reload, no stale USD.
  it('switches the total to SOL as soon as a rate arrives from storage', async () => {
    mockChromeWithState(NO_RATE_STATE)
    const { container } = render(<SidePanel />)
    await waitFor(() => expect(statValue(container, 'Total PnL').textContent).toBe('+$3.50'))

    const listener = capturedStorageListener()
    act(() => listener({ solUsdPrice: { newValue: SOL_USD } }, 'local'))

    await waitFor(() => expect(statValue(container, 'Total PnL').textContent).toBe('+0.0350 SOL'))
  })

  it('shows a placeholder win rate rather than 0% when nothing has been closed yet', async () => {
    mockChromeWithState(LOSING_STATE) // empty tradeHistory
    const { container } = render(<SidePanel />)
    await waitFor(() => expect(statValue(container, 'Balance').textContent).toBe('0.5000 SOL'))
    expect(statValue(container, 'Win rate').textContent).toBe('—')
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  it('shows 0% — not the placeholder — once a trade has closed at a loss', async () => {
    mockChromeWithState(ONE_LOSS_STATE)
    const { container } = render(<SidePanel />)
    await waitFor(() => expect(statValue(container, 'Win rate').textContent).toBe('0%'))
  })

  // A fresh install has no key written at all, so state.positions is undefined —
  // the panel must render, not throw, because `if (!state)` does not catch `{}`.
  it('renders a fresh install where storage is completely empty', async () => {
    mockChromeWithState({})
    const { container } = render(<SidePanel />)
    // Zero shows at dust precision rather than being rounded away to a bare "0".
    await waitFor(() => expect(statValue(container, 'Balance').textContent).toBe('0.000000 SOL'))
    expect(statValue(container, 'Total PnL').textContent).toBe('$0.00') // no positions, no rate
    expect(screen.getByText(/no open positions/i)).toBeInTheDocument()
  })

  it('opens on the Positions tab and lists the open positions', async () => {
    render(<SidePanel />)
    await waitFor(() => expect(screen.getByText('Ay')).toBeInTheDocument())
    expect(screen.getByText('Bee')).toBeInTheDocument()
    // 1000 tokens held, entered at $0.01 — a token count and a per-token price, which is
    // what the position actually stores now.
    expect(screen.getByText('1.00K A @ $0.0100')).toBeInTheDocument()
    // B entered below a cent, so its price keeps significant digits instead of a fixed 4dp.
    expect(screen.getByText('2.00K B @ $0.005000')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Positions' })).toHaveClass('axpt-tab-active')
  })

  // The whole reason src/ui/format.js exists: at four fixed decimals a $0.000004521 entry
  // renders as "$0.0000", every memecoin looks identically worthless, and a 2x is invisible.
  it('never renders a sub-cent price as $0.0000, and shows the move it made', async () => {
    mockChromeWithState(SUBCENT_STATE)
    const { container } = render(<SidePanel />)
    await waitFor(() => expect(screen.getByText('Nano')).toBeInTheDocument())

    expect(container.textContent).toContain('$0.000004521')
    expect(container.textContent).not.toMatch(/\$0\.0000(?!\d)/) // a collapsed price, if any
    expect(screen.getByText('2.00M NANO @ $0.000004521')).toBeInTheDocument()
    expect(container.textContent).toContain('(+100.00%)') // the doubling is legible
    // 0.18084 SOL now against 0.09042 SOL paid.
    expect(statValue(container, 'Total PnL').textContent).toBe('+0.0904 SOL')
  })

  it('switches tabs on click, hiding the Positions list', async () => {
    const { container } = render(<SidePanel />)
    await waitFor(() => expect(screen.getByText('Ay')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'History' }))

    await waitFor(() => expect(screen.queryByText('Ay')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'History' })).toHaveClass('axpt-tab-active')
    expect(screen.getByRole('button', { name: 'Positions' })).not.toHaveClass('axpt-tab-active')
    expect(statValue(container, 'Balance').textContent).toBe('2.500 SOL') // the stats header spans every tab
  })

  // The History tab has to be fed from `state.tradeHistory` specifically — asserting
  // only that the Positions list vanished would still pass if the tab rendered nothing.
  it('renders the trade log from state.tradeHistory on the History tab', async () => {
    render(<SidePanel />)
    await waitFor(() => expect(screen.getByText('Ay')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'History' }))

    // t2: sold W for 1.5 SOL at $0.015 a token. SOL is the amount that moved through the
    // account; the price is per token, and the two are no longer the same number.
    await waitFor(() => expect(screen.getByText('1.500 SOL @ $0.0150')).toBeInTheDocument())
    expect(screen.getAllByRole('listitem')).toHaveLength(4) // one row per logged trade, newest first
    // t4, the newest: the losing close of L for 0.5 SOL at $0.005 a token.
    const newest = screen.getAllByRole('listitem')[0]
    expect(newest).toHaveTextContent('SELL')
    expect(newest).toHaveTextContent('0.5000 SOL @ $0.005000')
  })

  it('shows the History empty state on a fresh install, where tradeHistory is undefined', async () => {
    mockChromeWithState({})
    const { container } = render(<SidePanel />)
    await waitFor(() => expect(statValue(container, 'Balance').textContent).toBe('0.000000 SOL'))

    fireEvent.click(screen.getByRole('button', { name: 'History' }))

    await waitFor(() => expect(screen.getByText(/no trades yet/i)).toBeInTheDocument())
  })

  // Like the History tab, the Analytics tab has to be fed from a specific storage key
  // — asserting only that a chart appeared would still pass if the tab rendered an
  // unfed <TrendGraph/>, so the path is pinned to the snapshot PnLs in STATE.
  it('renders the Analytics charts from state.portfolioSnapshots', async () => {
    const { container } = render(<SidePanel />)
    await waitFor(() => expect(screen.getByText('Ay')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Analytics' }))

    await waitFor(() => expect(container.querySelector('.axpt-trend-graph')).toBeInTheDocument())
    expect(container.querySelector('.axpt-trend-graph path')).toHaveAttribute('d', 'M 0 120 L 140 0 L 280 60')
    expect(screen.queryByText('Ay')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }))

    await waitFor(() => expect(container.querySelectorAll('.axpt-pnl-calendar-cell')).toHaveLength(3))
    expect(screen.getByTitle('2026-09-03: 1.00 SOL')).toBeInTheDocument()
  })

  it('shows the Analytics empty states on a fresh install, where portfolioSnapshots is undefined', async () => {
    mockChromeWithState({})
    const { container } = render(<SidePanel />)
    await waitFor(() => expect(statValue(container, 'Balance').textContent).toBe('0.000000 SOL'))

    fireEvent.click(screen.getByRole('button', { name: 'Analytics' }))

    await waitFor(() => expect(screen.getByText(/not enough history yet to plot a trend/i)).toBeInTheDocument())
  })

  it('re-renders live when the background writes to chrome.storage.local', async () => {
    const { container } = render(<SidePanel />)
    await waitFor(() => expect(statValue(container, 'Balance').textContent).toBe('2.500 SOL'))

    const listener = capturedStorageListener()
    act(() => listener({ balanceSol: { newValue: 9.25 } }, 'local'))

    await waitFor(() => expect(statValue(container, 'Balance').textContent).toBe('9.250 SOL'))
    expect(screen.getByText('Ay')).toBeInTheDocument() // keys the write didn't touch survive
    expect(statValue(container, 'Total PnL').textContent).toBe('+0.0350 SOL')
  })

  it('ignores storage changes from any area other than local (spec §3)', async () => {
    const { container } = render(<SidePanel />)
    await waitFor(() => expect(statValue(container, 'Balance').textContent).toBe('2.500 SOL'))

    const listener = capturedStorageListener()
    act(() => listener({ balanceSol: { newValue: 9.25 } }, 'sync'))

    expect(statValue(container, 'Balance').textContent).toBe('2.500 SOL')
    expect(screen.queryByText('9.250 SOL')).not.toBeInTheDocument()
  })

  it('unsubscribes from storage when the panel closes', () => {
    const { unmount } = render(<SidePanel />)
    const listener = capturedStorageListener()
    unmount()
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(listener)
  })
})

// A fresh install has no balance, no positions and no trades. Spending down to zero
// leaves history behind, which is what separates "never set up" from "traded it all away".
const FRESH_STATE = { balanceSol: 0, solUsdPrice: 0, positions: {}, tradeHistory: [], portfolioSnapshots: [] }
const SPENT_STATE = {
  balanceSol: 0,
  solUsdPrice: SOL_USD,
  positions: {},
  tradeHistory: [
    { id: '1', mint: 'A', symbol: 'A', side: 'sell', solAmount: 1, tokenAmount: 200, fraction: 1, priceUsd: 0.005, solUsdPrice: SOL_USD, realizedPnlSol: 0.5, timestamp: 1000 },
  ],
  portfolioSnapshots: [],
}

describe('SidePanel — onboarding gate', () => {
  it('shows the balance-setup screen on a fresh account instead of an empty portfolio', async () => {
    mockChromeWithState(FRESH_STATE)
    render(<SidePanel />)
    await waitFor(() => expect(screen.getByText(/set your starting balance/i)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Positions' })).not.toBeInTheDocument()
  })

  it('does NOT re-run setup for a user who traded their balance down to zero', async () => {
    mockChromeWithState(SPENT_STATE)
    render(<SidePanel />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Positions' })).toBeInTheDocument())
    expect(screen.queryByText(/set your starting balance/i)).not.toBeInTheDocument()
  })

  it('leaves setup as soon as it completes, without flashing back while storage catches up', async () => {
    mockChromeWithState(FRESH_STATE)
    render(<SidePanel />)
    await waitFor(() => screen.getByText(/set your starting balance/i))

    fireEvent.click(screen.getByRole('button', { name: '5 SOL' }))

    // Storage has not echoed the new balance back yet — the panel must not bounce
    // the user back into setup in the meantime.
    await waitFor(() => expect(screen.queryByText(/set your starting balance/i)).not.toBeInTheDocument())
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'RESET_ACCOUNT',
      payload: { startingBalanceSol: 5 },
    })
  })
})

describe('SidePanel — intro animation', () => {
  it('plays the boot sweep over the mounted panel, then clears it', async () => {
    vi.useFakeTimers()
    const { container } = render(<SidePanel />)

    expect(container.querySelector('.axpt-intro-overlay')).toBeInTheDocument()
    // The panel is mounted underneath the whole time — the sweep never gates the data.
    expect(container.querySelector('.axpt-tabs')).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(INTRO_MS + 1)
    expect(container.querySelector('.axpt-intro-overlay')).not.toBeInTheDocument()
  })

  it('marks the overlay decorative so it is not announced to screen readers', () => {
    const { container } = render(<SidePanel />)
    expect(container.querySelector('.axpt-intro-overlay')).toHaveAttribute('aria-hidden', 'true')
  })
})
