import { useEffect, useState } from 'preact/hooks'
import { Positions } from './tabs/Positions.jsx'
import { History } from './tabs/History.jsx'
import { Analytics } from './tabs/Analytics.jsx'
import { getPortfolioStats } from '../lib/portfolio-stats.js'
import './SidePanel.css'
import '../ui/tokens.css'
import '../ui/motion.css'

const TABS = ['Positions', 'History', 'Analytics', 'Settings']

// Spec §9 real-time tier: while the Side Panel is open it polls faster than the
// background's 1-minute `chrome.alarms` floor. 7s sits inside the spec's 5–10s
// window; closing the panel tears the interval down, so the cadence falls back
// to the alarm on its own.
export const PANEL_POLL_MS = 7000

export function SidePanel() {
  const [tab, setTab] = useState('Positions')
  const [state, setState] = useState(null)

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

  const { balanceSol, totalPnlUsd, winRate } = getPortfolioStats(state)

  return (
    <div class="axpt-panel panel-enter">
      {/* Portfolio-level stats header (spec §11): balance, total PnL, win rate. */}
      <header class="axpt-panel-stats">
        <div class="axpt-stat">
          <span class="axpt-stat-label">Balance</span>
          <span class="mono axpt-stat-value">{balanceSol.toFixed(3)} SOL</span>
        </div>
        <div class="axpt-stat">
          <span class="axpt-stat-label">Total PnL</span>
          <span class={`mono axpt-stat-value ${totalPnlUsd >= 0 ? 'axpt-pnl-positive' : 'axpt-pnl-negative'}`}>
            {totalPnlUsd >= 0 ? '+' : ''}
            {totalPnlUsd.toFixed(2)}
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
        {tab === 'Positions' && <Positions positions={state.positions} />}
        {tab === 'History' && <History tradeHistory={state.tradeHistory} />}
        {tab === 'Analytics' && <Analytics snapshots={state.portfolioSnapshots} />}
      </div>
    </div>
  )
}
