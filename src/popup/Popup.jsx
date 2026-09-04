import { useEffect, useState } from 'preact/hooks'
import { getUnrealizedPnl } from '../lib/position-engine.js'
import { formatSol, formatTokenAmount, formatUsd, pnlClass } from '../ui/format.js'
import { TokenIcon } from '../ui/TokenIcon.jsx'
import './Popup.css'
import '../ui/tokens.css'
import '../ui/motion.css'

// Spec §9 real-time tier: while the popup is open it polls faster than the
// background's 1-minute `chrome.alarms` floor. 7s sits inside the spec's 5–10s
// window; closing the popup tears the interval down, so the cadence falls back
// to the alarm on its own.
export const POPUP_POLL_MS = 7000

export function Popup() {
  const [state, setState] = useState(null)

  useEffect(() => {
    const syncNow = () => chrome.runtime.sendMessage({ type: 'SYNC_NOW' })
    syncNow()
    chrome.storage.local.get(null, setState)
    const listener = (changes, areaName) => {
      // Storage is chrome.storage.local only (spec §3); ignore any other area.
      if (areaName !== 'local') return
      setState((prev) => ({
        ...prev,
        ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])),
      }))
    }
    chrome.storage.onChanged.addListener(listener)
    const poll = setInterval(syncNow, POPUP_POLL_MS)
    return () => {
      clearInterval(poll)
      chrome.storage.onChanged.removeListener(listener)
    }
  }, [])

  if (!state) return <div class="axpt-popup">Loading…</div>

  const positions = Object.entries(state.positions ?? {})
  const solUsdPrice = state.solUsdPrice ?? 0
  // SOL when a rate is known, USD otherwise — never a number in an unstated currency.
  const totalPnlSol = solUsdPrice > 0 ? positions.reduce((sum, [, p]) => sum + (getUnrealizedPnl(p, solUsdPrice).pnlSol ?? 0), 0) : null
  const totalPnlUsd = positions.reduce((sum, [, p]) => sum + getUnrealizedPnl(p).pnlUsd, 0)
  // Formatted once, then used for both the text and its colour — see pnlClass.
  const totalPnlText =
    totalPnlSol === null
      ? formatUsd(totalPnlUsd, { signed: true })
      : `${formatSol(totalPnlSol, { signed: true })} SOL`

  return (
    <div class="axpt-popup panel-enter">
      <div class="axpt-popup-header">
        <span class="mono">{formatSol(state.balanceSol ?? 0)} SOL</span>
        <span class={`mono ${pnlClass(totalPnlText)}`}>{totalPnlText} PnL</span>
      </div>
      <ul class="axpt-popup-positions">
        {positions.slice(0, 4).map(([mint, p]) => (
          <li key={mint} class="axpt-popup-position">
            <TokenIcon imageUrl={p.imageUrl} symbol={p.symbol} name={p.name} mint={mint} size={20} />
            <span>{p.symbol}</span>
            <span class="mono">{formatTokenAmount(p.qty)}</span>
          </li>
        ))}
      </ul>
      <button
        class="axpt-expand-btn"
        onClick={() => chrome.sidePanel.open({ windowId: chrome.windows?.WINDOW_ID_CURRENT })}
      >
        Expand
      </button>
    </div>
  )
}
