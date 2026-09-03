import { formatSol, formatPrice } from '../../ui/format.js'
export function History({ tradeHistory }) {
  const sorted = [...(tradeHistory ?? [])].sort((a, b) => b.timestamp - a.timestamp)
  if (sorted.length === 0) return <p class="axpt-empty">No trades yet.</p>

  return (
    <ul class="axpt-history-list">
      {sorted.map((trade) => (
        <li key={trade.id} class="axpt-history-row mono">
          <span class={trade.side === 'buy' ? 'axpt-pnl-positive' : 'axpt-pnl-negative'}>
            {trade.side.toUpperCase()}
          </span>
          <span>{trade.symbol}</span>
          <span>
            {formatSol(trade.solAmount)} SOL @ {formatPrice(trade.priceUsd)}
          </span>
          <span class="axpt-muted">{new Date(trade.timestamp).toLocaleString()}</span>
        </li>
      ))}
    </ul>
  )
}
