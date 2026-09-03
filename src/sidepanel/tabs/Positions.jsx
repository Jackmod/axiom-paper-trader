import { getUnrealizedPnl } from '../../lib/position-engine.js'
import { TokenIcon } from '../../ui/TokenIcon.jsx'
import { formatPrice, formatSol, formatPercent, formatTokenAmount, formatUsd } from '../../ui/format.js'

export function Positions({ positions, solUsdPrice = 0 }) {
  const entries = Object.entries(positions ?? {})
  if (entries.length === 0) return <p class="axpt-empty">No open positions yet.</p>

  return (
    <ul class="axpt-position-list">
      {entries.map(([mint, p]) => {
        const { pnlUsd, pnlPct, pnlSol, valueSol, valueUsd } = getUnrealizedPnl(p, solUsdPrice)
        const up = pnlUsd >= 0

        return (
          <li key={mint} class="axpt-position-row">
            <TokenIcon imageUrl={p.imageUrl} symbol={p.symbol} name={p.name} mint={mint} size={32} />
            <div class="axpt-position-main">
              <span>{p.name || p.symbol || 'Unnamed token'}</span>
              {/* Token quantities run from fractions to billions, and entry prices are
                  routinely sub-cent — both go through the formatters so neither collapses
                  to a meaningless "0.0000". */}
              <span class="mono axpt-muted">
                {formatTokenAmount(p.qty)} {p.symbol} @ {formatPrice(p.avgEntryUsd)}
              </span>
            </div>
            <div class="axpt-position-figures">
              {/* What the position is worth now, in the currency the account is funded in. */}
              <div class="mono axpt-position-value">
                {valueSol === null ? formatUsd(valueUsd) : `${formatSol(valueSol)} SOL`}
              </div>
              <div class={`mono ${up ? 'axpt-pnl-positive' : 'axpt-pnl-negative'}`}>
                {pnlSol === null ? formatUsd(pnlUsd, { signed: true }) : `${formatSol(pnlSol, { signed: true })} SOL`}{' '}
                ({formatPercent(pnlPct)})
                {p.stale && <span class="axpt-stale-dot" title="Price may be stale" />}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
