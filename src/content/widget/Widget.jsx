// src/content/widget/Widget.jsx
import { useState } from 'preact/hooks'
import { getUnrealizedPnl } from '../../lib/position-engine.js'
import './Widget.css'

const BUY_PRESETS_SOL = [0.1, 0.25, 0.5, 1, 2, 5]
const SELL_PRESETS_PCT = [25, 50, 100]

// Everything the widget knows about money is denominated the way the rest of the
// extension denominates it: `qty` and `balanceSol` are SOL (see message-router's
// BUY/SELL balance math), while `avgEntryUsd`/`lastPriceUsd` are USD per token.
// There is no SOL/USD rate anywhere in the content script, so a preset's USD
// notional cannot be computed here — the tooltips show the exact SOL amount plus
// the live USD price the trade would fill at, and never invent a USD total.
function formatSol(sol) {
  return `${sol >= 0 ? '+' : ''}${sol.toFixed(4)} SOL`
}

export function Widget({ position, onBuyPreset, onSellPreset, marketCapText = '', rugBadgeText = '' }) {
  // Which preset the cursor is on, as 'buy:0.25' / 'sell:50' — one hover at a time.
  const [hovered, setHovered] = useState(null)
  const [customAmount, setCustomAmount] = useState('')

  const customSol = Number.parseFloat(customAmount)
  const customIsValid = Number.isFinite(customSol) && customSol > 0

  const priceUsd = position?.lastPriceUsd
  const hasLivePrice = Number.isFinite(priceUsd) && priceUsd > 0
  const priceLabel = hasLivePrice ? ` @ $${priceUsd.toFixed(4)}` : ''

  // Unrealized PnL comes from the shared engine so the widget can never disagree
  // with the Side Panel. The SOL leg is the % applied to the SOL cost basis of the
  // position, which is exactly what message-router credits back on a full sell.
  const pnl = position ? getUnrealizedPnl(position) : null
  const pnlSol = pnl ? position.qty * (pnl.pnlPct / 100) : 0

  return (
    <div class="axpt-widget">
      {position && (
        <div class="axpt-widget-summary">
          <img class="axpt-token-image" src={position.imageUrl} alt="" />
          <span>{position.name}</span>
          {position.symbol && <span class="axpt-token-symbol">{position.symbol}</span>}
          {marketCapText && <span class="axpt-token-mc mono">MC {marketCapText}</span>}
          {rugBadgeText && <span class="axpt-rug-badge">{rugBadgeText}</span>}
          <span class="mono">Avg ${position.avgEntryUsd.toFixed(4)}</span>
          <span class={`mono ${pnl.pnlPct >= 0 ? 'axpt-pnl-positive' : 'axpt-pnl-negative'}`}>
            {formatSol(pnlSol)} ({pnl.pnlPct >= 0 ? '+' : ''}
            {pnl.pnlPct.toFixed(1)}%)
          </span>
        </div>
      )}

      <div class="axpt-buy-row">
        {BUY_PRESETS_SOL.map((amountSol) => (
          <button
            key={amountSol}
            class="axpt-preset-btn axpt-buy-btn"
            onMouseEnter={() => setHovered(`buy:${amountSol}`)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onBuyPreset(amountSol)}
            aria-label={`Buy ${amountSol} SOL`}
          >
            {amountSol}
            {hovered === `buy:${amountSol}` && (
              <span class="axpt-tooltip mono" role="tooltip">{`${amountSol} SOL${priceLabel}`}</span>
            )}
          </button>
        ))}
      </div>

      <div class="axpt-custom-row">
        <input
          class="axpt-custom-input mono"
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="Custom SOL"
          aria-label="Custom SOL amount"
          value={customAmount}
          onInput={(e) => setCustomAmount(e.currentTarget.value)}
        />
        <button
          class="axpt-preset-btn axpt-buy-btn"
          aria-label="Buy custom SOL amount"
          disabled={!customIsValid}
          // Guarded as well as disabled: `disabled` is a UI affordance, but an empty or
          // junk input would send NaN/0 into applyBuy, which throws on a non-positive qty.
          onClick={() => customIsValid && onBuyPreset(customSol)}
        >
          Buy
        </button>
      </div>

      <div class="axpt-sell-row">
        {SELL_PRESETS_PCT.map((pct) => (
          <button
            key={pct}
            class="axpt-preset-btn axpt-sell-btn"
            aria-label={`${pct}%`}
            onMouseEnter={() => setHovered(`sell:${pct}`)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onSellPreset(pct)}
          >
            {pct}%
            {hovered === `sell:${pct}` && (
              <span class="axpt-tooltip mono" role="tooltip">
                {position ? `${((position.qty * pct) / 100).toFixed(4)} SOL${priceLabel}` : `Sell ${pct}%`}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
