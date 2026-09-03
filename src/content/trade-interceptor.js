import {
  findBuyButton,
  findSellButtons,
  findBuyPresets,
  findAmountInput,
  scrapeTradeContext,
  percentOf,
  amountOf,
} from './dom-scraper.js'
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
  const input = findAmountInput()
  return Number(input?.value ?? 0)
}

// Which control did this click land on? Axiom supports two shapes and we must handle
// both: one-click SOL presets (the amount is the button's own label) and an explicit
// Buy button (the amount is in the adjacent field).
function classifyClick(event) {
  const hits = (el) => el && (event.target === el || el.contains(event.target))

  const preset = findBuyPresets().find(hits)
  if (preset) return { kind: 'buy', qtySol: amountOf(preset) }

  if (hits(findBuyButton())) return { kind: 'buy', qtySol: readSolAmount() }

  const sell = findSellButtons().find(hits)
  if (sell) return { kind: 'sell', sellPercent: percentOf(sell) }

  return null
}

// Returns a detach handle. Interception is conditional on the paper-mode setting
// (spec §11), so the caller has to be able to disarm it when the setting flips —
// without one, an unmounted or disabled widget would keep swallowing the user's
// real Buy clicks for the lifetime of the page.
export function attachTradeInterception(onTradeConfirmed) {
  const onClick = async (event) => {
    const hit = classifyClick(event)
    if (!hit) return // not a trading control — leave the page alone

    // Swallow the click BEFORE anything async, so Axiom's own handler never runs and no
    // real transaction is ever built. This is the zero-real-transactions guarantee.
    event.preventDefault()
    event.stopPropagation()

    const context = scrapeTradeContext()
    if (!context) return

    if (hit.kind === 'buy') {
      if (!hit.qtySol || hit.qtySol <= 0) return // no readable amount — better nothing than a phantom trade
      const priceUsd = await resolveFillPrice(context, hit.qtySol)
      onTradeConfirmed({ side: 'buy', ...context, qtySol: hit.qtySol, priceUsd })
      return
    }

    if (!hit.sellPercent) return // unreadable percentage — never a silent 0% sell
    onTradeConfirmed({ side: 'sell', ...context, sellPercent: hit.sellPercent, priceUsd: context.priceUsd })
  }

  document.addEventListener('click', onClick, { capture: true })
  return () => document.removeEventListener('click', onClick, { capture: true })
}
