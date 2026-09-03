import { useEffect, useState } from 'preact/hooks'
import { Positions } from './tabs/Positions.jsx'
import { History } from './tabs/History.jsx'
import { Analytics } from './tabs/Analytics.jsx'
import { Settings } from './tabs/Settings.jsx'
import { Onboarding } from './components/Onboarding.jsx'
import { getPortfolioStats } from '../lib/portfolio-stats.js'
import { formatSol, formatPercent, formatUsd } from '../ui/format.js'
import './SidePanel.css'
import '../ui/tokens.css'
import '../ui/motion.css'

const TABS = ['Positions', 'History', 'Analytics', 'Settings']

// Spec §9 real-time tier: while the Side Panel is open it polls faster than the
// background's 1-minute `chrome.alarms` floor. 7s sits inside the spec's 5–10s
// window; closing the panel tears the interval down, so the cadence falls back
// to the alarm on its own.
export const PANEL_POLL_MS = 7000

// Spec §15: a short "terminal boot" sweep plays every time the panel opens. It is an
// overlay rather than a gate — the panel mounts underneath it immediately, so the
// animation never delays the data being ready or hides a slow first paint behind a
// blank screen.
export const INTRO_MS = 500

// A genuinely fresh account: no balance, no positions, no trades. Spending down to zero
// leaves history behind, so a user who has traded is never dragged back through setup.
function needsOnboarding(state) {
  return (
    state.balanceSol === 0 &&
    Object.keys(state.positions ?? {}).length === 0 &&
    (state.tradeHistory?.length ?? 0) === 0
  )
}

export function SidePanel() {
  const [tab, setTab] = useState('Positions')
  const [state, setState] = useState(null)
  const [showIntro, setShowIntro] = useState(true)
  const [justOnboarded, setJustOnboarded] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShowIntro(false), INTRO_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const syncNow = () => chrome.runtime.sendMessage({ type: 'SYNC_NOW' })
    syncNow()
    chrome.storage.local.get(null, setState)
    const listener = (changes, areaName) => {
      // Storage is chrome.storage.local only (spec §3); ignore any other area.
      if (areaName !== 'local') return
      setState((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])) }))
    }
    chrome.storage.onChanged.addListener(listener)
    const poll = setInterval(syncNow, PANEL_POLL_MS)
    return () => {
      clearInterval(poll)
      chrome.storage.onChanged.removeListener(listener)
    }
  }, [])

  if (!state) return <div class="axpt-panel">Loading…</div>

  // `justOnboarded` covers the gap between sending RESET_ACCOUNT and the resulting
  // storage change arriving — without it the setup screen would flash back up for a beat.
  if (!justOnboarded && needsOnboarding(state)) {
    return (
      <div class="axpt-panel panel-enter">
        <Onboarding onComplete={() => setJustOnboarded(true)} />
      </div>
    )
  }

  const { balanceSol, positionValueSol, unrealizedPnlSol, totalPnlUsd, winRate } = getPortfolioStats(state)

  return (
    <div class="axpt-panel panel-enter">
      {showIntro && (
        <div class="axpt-intro-overlay" aria-hidden="true">
          <div class="axpt-boot-scan-line" />
        </div>
      )}
      {/* Portfolio-level stats header (spec §11): balance, total PnL, win rate. */}
      <header class="axpt-panel-stats">
        <div class="axpt-stat">
          <span class="axpt-stat-label">Balance</span>
          <span class="mono axpt-stat-value">{formatSol(balanceSol)} SOL</span>
        </div>
        <div class="axpt-stat">
          <span class="axpt-stat-label">Total PnL</span>
          <span class={`mono axpt-stat-value ${(unrealizedPnlSol ?? totalPnlUsd) >= 0 ? 'axpt-pnl-positive' : 'axpt-pnl-negative'}`}>
            {unrealizedPnlSol === null ? formatUsd(totalPnlUsd, { signed: true }) : `${formatSol(unrealizedPnlSol, { signed: true })} SOL`}
          </span>
        </div>
        <div class="axpt-stat">
          <span class="axpt-stat-label">Win rate</span>
          <span class="mono axpt-stat-value">{winRate === null ? '—' : `${(winRate * 100).toFixed(0)}%`}</span>
        </div>
      </header>
      <nav class="axpt-tabs">
        {TABS.map((t) => (
          <button key={t} class={t === tab ? 'axpt-tab-active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      <div class="axpt-tab-content">
        {tab === 'Positions' && <Positions positions={state.positions} solUsdPrice={state.solUsdPrice ?? 0} />}
        {tab === 'History' && <History tradeHistory={state.tradeHistory} />}
        {tab === 'Analytics' && <Analytics snapshots={state.portfolioSnapshots} />}
        {tab === 'Settings' && <Settings settings={state.settings} />}
      </div>
    </div>
  )
}
