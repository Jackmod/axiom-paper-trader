import { parseNumber } from './parse-number.js'
import * as discovery from './discovery.js'
import { detectMint, findMintCandidates } from './mint-detector.js'

// How the extension locates Axiom's controls: by LABEL, at runtime (see discovery.js).
//
// This deliberately does not ship hardcoded CSS selectors. An earlier version did —
// `[data-testid="buy-button"]` and friends — and every one of them was a guess: Axiom
// serves logged-out visitors a marketing page and puts token pages behind a bot
// challenge, so they could never be verified, and the landing page emits no data-testid
// attributes at all. Guessed selectors meant the extension installed and then silently
// did nothing, with a human required to hand-edit source before it worked at all.
//
// Label-based discovery needs no configuration and survives the class-name churn of a
// frontend redeploy, because renaming the button a user clicks means changing what the
// user reads.

export const findBuyButton = () => discovery.findBuyButton(document)
export const findSellButtons = () => discovery.findSellButtons(document)
export const findBuyPresets = () => discovery.findBuyPresets(document)
export const findAmountInput = () => discovery.findAmountInput(document)
export const canIntercept = () => discovery.canIntercept(document)
export const { percentOf, amountOf } = discovery

// Solana mint addresses are base58, 32-44 chars. Axiom's token routes carry the mint
// directly (e.g. /meme/<mint>), which is far more durable than any DOM attribute — a
// redesign rewrites markup, but the route has to keep identifying the token.
// Detection lives in mint-detector.js, which looks in every place a mint plausibly
// appears — the route, explorer links, copy-CA buttons, data attributes, page text — and
// ranks them. It used to be the URL alone, and when that guess missed, `mint` was null,
// every buy button was disabled, and with no position every sell was disabled too: one
// wrong assumption silently disabled the whole product.
export const readMint = () => detectMint(document, window.location.href)
export const mintCandidates = () => findMintCandidates(document, window.location.href)

// Display-only details (spec §6). Every one of these is best-effort: if a heuristic
// misses, the field is empty and the trade still records correctly. Token name, symbol
// and image are backfilled from the price APIs by the background worker, so a miss here
// costs nothing — which is why none of them can block a trade.
function readOptionalDetails() {
  const withLabel = (pattern) =>
    [...document.querySelectorAll('span, div, p')].find(
      (el) => el.children.length === 0 && pattern.test((el.textContent || '').trim()),
    )

  const price = withLabel(/^\$\s?[\d,]+\.?\d*$/)
  const marketCap = withLabel(/^(mc|market cap)?\s*\$\s?[\d,.]+[kmb]?$/i)
  const slippage = withLabel(/^\d{1,3}(\.\d+)?\s*%$/)

  return {
    priceUsd: parseNumber(price?.textContent),
    // MC is carried as the page's own text rather than parsed: Axiom renders magnitude
    // suffixes ("$450K"), and parsing that to a number would be wrong by 1000x.
    marketCapText: marketCap?.textContent?.trim() ?? '',
    slippagePct: parseNumber(slippage?.textContent) ?? 0,
  }
}

export function scrapeTradeContext() {
  const mint = readMint()
  if (!mint) return null

  const details = readOptionalDetails()

  return {
    mint,
    symbol: '',
    name: '',
    imageUrl: '',
    priceUsd: details.priceUsd,
    // Axiom's own priority fee is not reliably discoverable by label, and guessing a
    // fee would corrupt PnL with a number the user never agreed to. Absent means zero.
    priorityFeeSol: 0,
    slippagePct: details.slippagePct,
    marketCapText: details.marketCapText,
    rugBadgeText: '',
  }
}
