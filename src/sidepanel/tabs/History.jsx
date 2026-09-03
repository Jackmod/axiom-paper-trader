import { formatPercent, formatPrice, formatSol, formatTokenAmount } from '../../ui/format.js'

/**
 * One labelled figure. The label lives inside the cell so a row reads as prose
 * ("Spent 0.1000 SOL") instead of a wall of numbers needing a legend, and stays muted
 * even when the cell itself carries a win/loss colour.
 */
function Field({ label, value, tone }) {
  return (
    <span class={tone ? `axpt-history-cell ${tone}` : 'axpt-history-cell'}>
      <span class="axpt-history-label">{label}</span> {value}
    </span>
  )
}

export function History({ tradeHistory }) {
  const sorted = [...(tradeHistory ?? [])].sort((a, b) => b.timestamp - a.timestamp)
  if (sorted.length === 0) return <p class="axpt-empty">No trades yet.</p>

  return (
    <ul class="axpt-history-list">
      {sorted.map((trade) => {
        const isBuy = trade.side === 'buy'
        const symbol = trade.symbol || '—'

        // Only a sell has a result. realizedPnlSol is recorded on every sell the engine
        // writes, but an entry that predates it has an UNKNOWN result, not a break-even
        // one — that gets the placeholder and neutral styling rather than a green zero.
        const hasRealized = Number.isFinite(trade.realizedPnlSol)
        const realizedTone = !hasRealized
          ? 'axpt-muted'
          : trade.realizedPnlSol >= 0
            ? 'axpt-pnl-positive'
            : 'axpt-pnl-negative'

        // `fraction` is 0–1 (position-engine.js), so it scales to a percentage. formatPercent
        // signs a positive number for PnL; a portion of a position has no direction, and a
        // leading "+" here would read as a gain, so it is dropped.
        const closed = formatPercent(trade.fraction * 100).replace(/^\+/, '')

        return (
          <li key={trade.id} class="axpt-history-row">
            <div class="axpt-history-head">
              <span class={`axpt-history-side ${isBuy ? 'axpt-pnl-positive' : 'axpt-pnl-negative'}`}>
                {trade.side.toUpperCase()}
              </span>
              <span class="axpt-history-symbol">{symbol}</span>
              <span class="axpt-muted axpt-history-time">{new Date(trade.timestamp).toLocaleString()}</span>
            </div>

            <div class="axpt-history-cells mono">
              {/* The SOL leg: what left the account on a buy, what came back on a sell. */}
              <Field label={isBuy ? 'Spent' : 'Received'} value={`${formatSol(trade.solAmount)} SOL`} />
              {/* Token counts run from fractions to billions and prices are routinely
                  sub-cent, so both go through the formatters rather than a fixed
                  decimal count that would collapse them to "0.0000". */}
              <Field label={isBuy ? 'Bought' : 'Sold'} value={`${formatTokenAmount(trade.tokenAmount)} ${symbol}`} />
              <Field label="Price" value={formatPrice(trade.priceUsd)} />
              {!isBuy && <Field label="Closed" value={closed} />}
              {!isBuy && (
                <Field
                  label="Realized"
                  value={hasRealized ? `${formatSol(trade.realizedPnlSol, { signed: true })} SOL` : '—'}
                  tone={realizedTone}
                />
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
