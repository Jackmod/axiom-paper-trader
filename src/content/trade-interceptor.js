import { findBuyButton, findSellButtons, scrapeTradeContext, SELECTORS } from './dom-scraper.js'
import { parseNumber } from './parse-number.js'
import { fetchQuotedFillPrice } from '../lib/price-sources/jupiter-quote.js'
import { SOL_MINT } from '../lib/price-sources/jupiter.js'

const LAMPORTS_PER_SOL = 1_000_000_000

// Exported so the widget's own preset buttons (inject.jsx) fill at the same quoted
// execution price as a hijacked click on Axiom's button — one price path, not two.
export async function resolveFillPrice(context, qtySol) {
  const quoted = await fetchQuotedFillPrice({
    inputMint: SOL_MINT,
    outputMint: context.mint,
    amountLamports: Math.round(qtySol * LAMPORTS_PER_SOL),
    outputDecimals: 6, // most SPL memecoins use 6 decimals; verify per-token if this proves wrong in manual testing
  })
  return quoted ?? context.priceUsd // fall back to the DOM-displayed price if the quote hasn't returned/failed
}

function readSolAmount() {
  const input = document.querySelector(SELECTORS.solAmountInput)
  return Number(input?.value ?? 0)
}

// Axiom's sell buttons carry their percentage as label text ("25%", "50%", "100%"),
// which is what SELECTORS.sellButtons matches and what the DOM fixtures model. An
// earlier version read a `data-sell-percent` attribute that exists nowhere in Axiom's
// markup, so every intercepted sell resolved to 0% and closed nothing. The attribute
// is still honoured first in case Axiom ever adds one, but the label is the real source.
function readSellPercent(button) {
  const fromAttribute = parseNumber(button.getAttribute('data-sell-percent'))
  if (fromAttribute !== null) return fromAttribute
  return parseNumber(button.textContent)
}

// Returns a detach handle. Interception is conditional on the paper-mode setting
// (spec §11), so the caller has to be able to disarm it when the setting flips —
// without one, an unmounted or disabled widget would keep swallowing the user's
// real Buy clicks for the lifetime of the page.
export function attachTradeInterception(onTradeConfirmed) {
  const onClick = async (event) => {
    const buyButton = findBuyButton()
    const sellButtons = findSellButtons()

    if (buyButton && (event.target === buyButton || buyButton.contains(event.target))) {
      event.preventDefault()
      event.stopPropagation()
      const context = scrapeTradeContext()
      if (!context) return
      const qtySol = readSolAmount()
      const priceUsd = await resolveFillPrice(context, qtySol)
      onTradeConfirmed({ side: 'buy', ...context, qtySol, priceUsd })
      return
    }

    const clickedSell = sellButtons.find((btn) => event.target === btn || btn.contains(event.target))
    if (clickedSell) {
      event.preventDefault()
      event.stopPropagation()
      const context = scrapeTradeContext()
      if (!context) return
      const percent = readSellPercent(clickedSell)
      if (percent === null) return // unreadable percentage — drop the trade rather than silently selling 0%
      onTradeConfirmed({ side: 'sell', ...context, sellPercent: percent, priceUsd: context.priceUsd })
    }
  }

  document.addEventListener('click', onClick, { capture: true })
  return () => document.removeEventListener('click', onClick, { capture: true })
}
