import { getUnrealizedPnl } from '../../lib/position-engine.js'

export function Positions({ positions }) {
  const entries = Object.entries(positions ?? {})
  if (entries.length === 0) return <p class="axpt-empty">No open positions yet.</p>

  return (
    <ul class="axpt-position-list">
      {entries.map(([mint, p]) => {
        const { pnlUsd, pnlPct } = getUnrealizedPnl(p)
        return (
          <li key={mint} class="axpt-position-row">
            <img src={p.imageUrl} alt="" />
            <div class="axpt-position-main">
              <span>{p.name}</span>
              <span class="mono axpt-muted">
                {p.qty.toFixed(4)} {p.symbol}
              </span>
            </div>
            <div class="axpt-position-figures">
              {/* Spec §11 rows are (icon, name, qty, USD value, PnL) — the held
                  value is what the position is worth now, not what it has made. */}
              <div class="mono axpt-position-value">${(p.qty * p.lastPriceUsd).toFixed(2)}</div>
              <div class={`mono ${pnlUsd >= 0 ? 'axpt-pnl-positive' : 'axpt-pnl-negative'}`}>
                {pnlUsd >= 0 ? '+' : ''}
                {pnlUsd.toFixed(2)} ({pnlPct.toFixed(1)}%)
                {p.stale && <span class="axpt-stale-dot" title="Price may be stale" />}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
