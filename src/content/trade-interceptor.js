import {
  findBuyButton,
  findSellButton,
  findSellButtons,
  findBuyPresets,
  findAmountInput,
  presetsAreOneClick,
  scrapeTradeContext,
  percentOf,
  amountOf,
} from './dom-scraper.js'
import { fetchQuotedFillPrice } from '../lib/price-sources/jupiter-quote.js'
import { SOL_MINT, fetchJupiterTokenInfo } from '../lib/price-sources/jupiter.js'

const LAMPORTS_PER_SOL = 1_000_000_000

// Exported so the widget's own preset buttons (inject.jsx) fill at the same quoted
// execution price as a hijacked click on Axiom's button — one price path, not two.
export async function resolveFillPrice(context, qtySol) {
  const info = await fetchJupiterTokenInfo(context.mint)

  // No decimals means no trustworthy token count, and therefore no trustworthy fill
  // price. Fall back to the price the page is showing rather than quoting against a
  // guessed scale — an honest approximate price beats a confidently wrong one.
  if (!Number.isInteger(info?.decimals)) return info?.priceUsd ?? context.priceUsd

  const decimals = info.decimals
  const quoted = await fetchQuotedFillPrice({
    inputMint: SOL_MINT,
    outputMint: context.mint,
    amountLamports: Math.round(qtySol * LAMPORTS_PER_SOL),
    // The token's REAL decimals, read from Jupiter alongside its price. This was
    // hardcoded to 6 on the assumption that "most SPL memecoins use 6" — but a 9-decimal
    // token would then have its fill price computed 1000x wrong and written into cost
    // basis, where it is indistinguishable from a real entry forever after. A wrong
    // decimals is not a rounding error, it is a corrupt position.
    outputDecimals: decimals,
  })
  return quoted ?? info.priceUsd ?? context.priceUsd // quote > spot > whatever the page showed
}

function readSolAmount() {
  const input = findAmountInput()
  return Number(input?.value ?? 0)
}

// What the user last picked but has not yet submitted. On Axiom the presets only fill in
// a size; the trade happens when the submit button is pressed, so the chosen size has to
// be remembered across those two clicks.
let pendingSol = null
let pendingPercent = null

/**
 * Which control did this click land on?
 *
 * Two layouts, and the difference matters enormously:
 *
 *  - Submit layout (Axiom's): presets fill the AMOUNT field and "Buy DESI" trades. A
 *    preset click is NOT a trade — it is remembered, and passed through untouched so
 *    Axiom's own handler still fills its field.
 *  - One-click layout: there is no submit button, so the preset itself is the trade.
 */
function classifyClick(event) {
  const hits = (el) => el && (event.target === el || el.contains(event.target))
  const oneClick = presetsAreOneClick()

  const preset = findBuyPresets().find(hits)
  if (preset) {
    const amount = amountOf(preset)
    if (oneClick) return { kind: 'buy', qtySol: amount }
    pendingSol = amount // remember the size; let Axiom fill its own field
    return null
  }

  const percent = findSellButtons().find(hits)
  if (percent) {
    const pct = percentOf(percent)
    if (oneClick) return { kind: 'sell', sellPercent: pct }
    pendingPercent = pct
    return null
  }

  if (hits(findBuyButton())) {
    // The typed amount wins over a remembered preset: if the user picked 2 and then typed
    // 0.5, they meant 0.5.
    const typed = readSolAmount()
    const qtySol = typed > 0 ? typed : pendingSol
    pendingSol = null
    return { kind: 'buy', qtySol }
  }

  if (hits(findSellButton())) {
    const sellPercent = pendingPercent
    pendingPercent = null
    return { kind: 'sell', sellPercent }
  }

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
      onTradeConfirmed({ side: 'buy', ...context, solSpent: hit.qtySol, priceUsd })
      return
    }

    if (!hit.sellPercent) return // unreadable percentage — never a silent 0% sell
    onTradeConfirmed({ side: 'sell', ...context, sellPercent: hit.sellPercent, priceUsd: context.priceUsd })
  }

  document.addEventListener('click', onClick, { capture: true })
  return () => document.removeEventListener('click', onClick, { capture: true })
}
