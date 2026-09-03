import { useEffect, useState } from 'preact/hooks'
import { getUnrealizedPnl } from '../lib/position-engine.js'
import './Popup.css'
import '../ui/tokens.css'
import '../ui/motion.css'

export function Popup() {
  const [state, setState] = useState(null)

  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'SYNC_NOW' })
    chrome.storage.local.get(null, setState)
    const listener = (changes) => {
      setState((prev) => ({
        ...prev,
        ...Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])),
      }))
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  if (!state) return <div class="axpt-popup">Loading…</div>

  const positions = Object.entries(state.positions ?? {})
  const totalPnl = positions.reduce((sum, [, p]) => sum + getUnrealizedPnl(p).pnlUsd, 0)

  return (
    <div class="axpt-popup panel-enter">
      <div class="axpt-popup-header">
        <span class="mono">{state.balanceSol?.toFixed(3)} SOL</span>
        <span class={`mono ${totalPnl >= 0 ? 'axpt-pnl-positive' : 'axpt-pnl-negative'}`}>
          {totalPnl >= 0 ? '+' : ''}
          {totalPnl.toFixed(2)} PnL
        </span>
      </div>
      <ul class="axpt-popup-positions">
        {positions.slice(0, 4).map(([mint, p]) => (
          <li key={mint} class="axpt-popup-position">
            <img src={p.imageUrl} alt="" />
            <span>{p.symbol}</span>
            <span class="mono">{p.qty.toFixed(4)}</span>
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
