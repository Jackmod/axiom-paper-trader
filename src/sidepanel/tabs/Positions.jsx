import { useState } from 'preact/hooks'
import { getUnrealizedPnl } from '../../lib/position-engine.js'
import { TokenIcon } from '../../ui/TokenIcon.jsx'
import { formatPrice, formatSol, formatPercent, formatTokenAmount, formatUsd, pnlClass } from '../../ui/format.js'

const SELL_PRESETS_PCT = [25, 50, 100]

/**
 * Open positions, each closable from here.
 *
 * Selling used to be possible only from the token's own Axiom page: navigate away and the
 * position was stranded, visible but untouchable. The panel has no page context and no
 * scraped price, so it asks the background to close at market — the worker resolves the
 * live price and runs the same SELL path a page-initiated sell does, rather than letting
 * this component invent a price of its own.
 */
export function Positions({ positions, solUsdPrice = 0 }) {
  const [pending, setPending] = useState(null)
  const [error, setError] = useState(null)

  const entries = Object.entries(positions ?? {})
  if (entries.length === 0) return <p class="axpt-empty">No open positions yet.</p>

  function sell(mint, percent) {
    setError(null)
    setPending(`${mint}:${percent}`)
    chrome.runtime.sendMessage({ type: 'SELL_AT_MARKET', payload: { mint, fraction: percent / 100 } }, (response) => {
      setPending(null)
      const failure = chrome.runtime.lastError?.message ?? (response?.ok === false ? response.error : null)
      // A sell that quietly does nothing is indistinguishable from a broken button.
      if (failure) setError(failure)
    })
  }

  return (
    <>
      {error && (
        <p class="axpt-settings-error" role="alert">
          {error}
        </p>
      )}
      <ul class="axpt-position-list">
        {entries.map(([mint, p]) => {
          const { pnlUsd, pnlPct, pnlSol, valueSol, valueUsd } = getUnrealizedPnl(p, solUsdPrice)

          // Formatted once, then used for both the text and its colour — see pnlClass.
          const pnlText = formatUsd(pnlUsd, { signed: true })

          return (
            <li key={mint} class="axpt-position-row">
              <div class="axpt-position-head">
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
                  <div class={`mono ${pnlClass(pnlText)}`}>
                    {/* SOL · USD · % — the same trio the on-page widget shows, so the two
                        surfaces can never appear to disagree about the same position. USD
                        needs no SOL/USD rate, so it is the figure that always renders. */}
                    {pnlSol === null ? '' : `${formatSol(pnlSol, { signed: true })} SOL · `}
                    {pnlText} ({formatPercent(pnlPct)})
                    {p.stale && <span class="axpt-stale-dot" title="Price may be stale" />}
                  </div>
                </div>
              </div>

              <div class="axpt-position-sell">
                {SELL_PRESETS_PCT.map((percent) => (
                  <button
                    key={percent}
                    class="axpt-preset-btn axpt-sell-btn"
                    aria-label={`Sell ${percent}% of ${p.symbol || p.name || 'position'}`}
                    disabled={pending !== null}
                    onClick={() => sell(mint, percent)}
                  >
                    {pending === `${mint}:${percent}` ? '…' : `${percent}%`}
                  </button>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
    </>
  )
}
