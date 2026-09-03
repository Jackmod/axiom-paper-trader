// src/content/widget/Widget.jsx
import { useState } from 'preact/hooks'
import './Widget.css'

const BUY_PRESETS_SOL = [0.1, 0.25, 0.5, 1, 2, 5]
const SELL_PRESETS_PCT = [25, 50, 100]

export function Widget({ position, onBuyPreset, onSellPreset }) {
  const [hoverAmount, setHoverAmount] = useState(null)

  return (
    <div class="axpt-widget">
      {position && (
        <div class="axpt-widget-summary mono">
          <img class="axpt-token-image" src={position.imageUrl} alt="" />
          <span>{position.name}</span>
          <span>Avg ${position.avgEntryUsd.toFixed(4)}</span>
          <span class={position.lastPriceUsd >= position.avgEntryUsd ? 'axpt-pnl-positive' : 'axpt-pnl-negative'}>
            {(((position.lastPriceUsd - position.avgEntryUsd) / position.avgEntryUsd) * 100).toFixed(1)}%
          </span>
        </div>
      )}

      <div class="axpt-buy-row">
        {BUY_PRESETS_SOL.map((amountSol) => (
          <button
            key={amountSol}
            class="axpt-preset-btn axpt-buy-btn"
            onMouseEnter={() => setHoverAmount(amountSol)}
            onMouseLeave={() => setHoverAmount(null)}
            onClick={() => onBuyPreset(amountSol)}
            aria-label={`Buy ${amountSol} SOL`}
          >
            {hoverAmount === amountSol ? `${amountSol} SOL` : amountSol}
          </button>
        ))}
      </div>

      <div class="axpt-sell-row">
        {SELL_PRESETS_PCT.map((pct) => (
          <button
            key={pct}
            class="axpt-preset-btn axpt-sell-btn"
            title={position ? `Sell ${((position.qty * pct) / 100).toFixed(4)} tokens` : `Sell ${pct}%`}
            onClick={() => onSellPreset(pct)}
          >
            {pct}%
          </button>
        ))}
      </div>
    </div>
  )
}
