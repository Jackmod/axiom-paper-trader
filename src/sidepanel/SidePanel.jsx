import { useEffect, useState } from 'preact/hooks'
import { Positions } from './tabs/Positions.jsx'
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

  return (
    <div class="axpt-panel panel-enter">
      <nav class="axpt-tabs">
        {TABS.map((t) => (
          <button key={t} class={t === tab ? 'axpt-tab-active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      <div class="axpt-tab-content">{tab === 'Positions' && <Positions positions={state.positions} />}</div>
    </div>
  )
}
