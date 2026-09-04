// src/content/widget/Widget.jsx
//
// The compact quick-trade panel that floats over axiom.trade. It deliberately mirrors
// the shape of Axiom's own quick-trade menu: a small header identifying the token and
// the position, one-click SOL amounts, a custom amount, and percentage sells.
import { useState } from 'preact/hooks'
import { TokenIcon } from '../../ui/TokenIcon.jsx'
import { getUnrealizedPnl } from '../../lib/position-engine.js'
import {
  formatPrice,
  formatSol,
  formatPercent,
  formatTokenAmount,
  formatMarketCap,
  formatUsd,
  pnlClass,
} from '../../ui/format.js'
import './Widget.css'

const BUY_PRESETS_SOL = [0.1, 0.25, 0.5, 1, 2, 5]
const SELL_PRESETS_PCT = [25, 50, 100]

export function Widget({
  position,
  mint,
  onMintOverride,
  tokenName = '',
  tokenSymbol = '',
  tokenImageUrl = '',
  priceUsd,
  balanceSol = 0,
  solUsdPrice = 0,
  marketCapUsd = null,
  error = null,
  onBuyPreset,
  onSellPreset,
}) {
  const [hovered, setHovered] = useState(null)
  const [customAmount, setCustomAmount] = useState('')
  const [collapsed, setCollapsed] = useState(false)

  const customSol = Number.parseFloat(customAmount)
  const customIsValid = Number.isFinite(customSol) && customSol > 0

  // The live price is whichever is freshest: the position's last refresh, or what the
  // page is showing for a token not yet held.
  const livePrice = Number.isFinite(position?.lastPriceUsd) ? position.lastPriceUsd : priceUsd
  const priceLabel = Number.isFinite(livePrice) && livePrice > 0 ? ` @ ${formatPrice(livePrice)}` : ''

  // PnL comes from the shared engine, so the widget can never disagree with the Side
  // Panel. `pnlSol` is measured against what was actually paid, not reconstructed.
  const pnl = position ? getUnrealizedPnl(position, solUsdPrice) : null
  const pnlUsdText = pnl ? formatUsd(pnl.pnlUsd, { signed: true }) : ''

  // Identity: prefer what the background resolved for the position, fall back to
  // whatever the page told us about the token currently being viewed.
  const name = position?.name || tokenName
  const symbol = position?.symbol || tokenSymbol
  const imageUrl = position?.imageUrl || tokenImageUrl

  return (
    <div class={`axpt-widget ${collapsed ? 'axpt-widget-collapsed' : ''}`}>
      <header class="axpt-widget-header">
        {/* Says whose panel this is at a glance. The incumbent extension this replaces
            floats in the same corner, and telling them apart from a screenshot was
            costing real debugging time. */}
        <span class="axpt-brand" title="Axiom Paper Trader — simulated trades only">PAPER</span>
        <TokenIcon imageUrl={imageUrl} symbol={symbol} name={name} mint={mint} size={22} />
        <div class="axpt-widget-title">
          <span class="axpt-widget-name">{name || symbol || (mint ? 'Unnamed token' : 'No token open')}</span>
          <span class="axpt-widget-sub mono">
            {mint ? formatPrice(livePrice) : 'Open a token to trade'}
            {marketCapUsd ? ` · MC ${formatMarketCap(marketCapUsd)}` : ''}
          </span>
        </div>
        <span class="axpt-widget-balance mono" title="Paper balance">
          {formatSol(balanceSol)} SOL
        </span>
        <button
          class="axpt-widget-collapse"
          aria-label={collapsed ? 'Expand paper trader' : 'Collapse paper trader'}
          onClick={() => setCollapsed((c) => !c)}
        >
          {collapsed ? '▴' : '▾'}
        </button>
      </header>

      {!collapsed && (
        <>
          {/* A rejected trade has to say so. The only report used to be console.warn: the
              user clicked buy, the panel did not change, and the extension read as broken.
              This is also what lets the account keep a hard balance floor — refusing an
              unaffordable buy is honest feedback here, and was indistinguishable from a
              dead button before. */}
          {error && (
            <p class="axpt-widget-error" role="alert">
              {error}
            </p>
          )}
          {/* Detection missing the token must never mean "no way to trade". Every other
              path here depends on `mint`, so when it is absent the user gets a way to
              supply it by hand rather than a panel of dead buttons and no explanation. */}
          {!mint && (
            <form
              class="axpt-mint-entry"
              onSubmit={(e) => {
                e.preventDefault()
                const value = e.currentTarget.elements.mint.value.trim()
                if (value) onMintOverride?.(value)
              }}
            >
              <label class="axpt-muted" for="axpt-mint-input">
                Couldn’t detect the token — paste its contract address
              </label>
              <div class="axpt-custom-row">
                <input
                  id="axpt-mint-input"
                  name="mint"
                  class="axpt-custom-input mono"
                  placeholder="Contract address"
                  aria-label="Token contract address"
                />
                <button class="axpt-preset-btn axpt-buy-btn" type="submit">
                  Use
                </button>
              </div>
            </form>
          )}

          {position && (
            <div class="axpt-widget-position mono">
              <span class="axpt-muted">Holding</span>
              <span>{formatTokenAmount(position.qty)}</span>
              <span class="axpt-muted">Avg</span>
              <span>{formatPrice(position.avgEntryUsd)}</span>
              <span class="axpt-muted">PnL</span>
              {/* Three units, because each answers a different question: SOL is what the
                  paper account is denominated in, USD is how a trader actually sizes a win,
                  and the percentage is how it compares to every other trade. USD needs no
                  SOL/USD rate — it falls out of the token price — so it always renders.
                  Colour comes from the formatted USD figure, the same rule the Side Panel
                  uses, so the two surfaces cannot disagree about the same position. */}
              <span class={pnlClass(pnlUsdText)}>
                {pnl.pnlSol === null ? '' : `${formatSol(pnl.pnlSol, { signed: true })} SOL · `}
                {pnlUsdText}
                {` (${formatPercent(pnl.pnlPct)})`}
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
                disabled={!mint}
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
              disabled={!customIsValid || !mint}
              // Guarded as well as disabled: `disabled` is a UI affordance, but junk input
              // would send NaN into applyBuy, which throws on a non-positive amount.
              onClick={() => customIsValid && mint && onBuyPreset(customSol)}
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
                disabled={!position}
              >
                {pct}%
                {hovered === `sell:${pct}` && (
                  <span class="axpt-tooltip mono" role="tooltip">
                    {position ? `${formatTokenAmount((position.qty * pct) / 100)} tokens${priceLabel}` : `Sell ${pct}%`}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
