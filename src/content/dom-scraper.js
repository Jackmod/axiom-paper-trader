import { parseNumber } from './parse-number.js'

// UNVERIFIED PLACEHOLDER SELECTORS — every value below is the shape Task 14
// Step 2 proposes, NOT a selector read off the live site. Step 2/4 (element
// picker on a real token page, then calling scrapeTradeContext() in the
// DevTools console) still has to be done by hand, and it genuinely cannot be
// automated from here: axiom.trade serves logged-out visitors a marketing
// landing page, and /meme/<mint> sits behind a Cloudflare bot challenge
// ("Performing security verification"), so an automated browser never reaches
// the trading UI. The landing page it does serve emits zero [data-testid]
// attributes — only framework-generated ones (data-dpl-id, data-discover,
// data-nimg) — which is further reason to treat these as guesses.
//
// Until a human replaces them, findBuyButton() returns null and
// scrapeTradeContext() returns null on the real site; Task 27's "trade
// interception unavailable" banner is what surfaces that to the user.
// Prefer stable data-* attributes or ARIA roles over generated class names,
// which Axiom may rebuild on every deploy, and re-verify after any UI change.
export const SELECTORS = {
  buyButton: '[data-testid="buy-button"]',
  sellButtons: '[data-testid="sell-percent-button"]',
  solAmountInput: '[data-testid="trade-amount-input"]',
  tokenName: '[data-testid="token-name"]',
  tokenSymbol: '[data-testid="token-symbol"]',
  tokenImage: '[data-testid="token-image"] img',
  tokenMint: '[data-token-mint]', // read the mint from a data attribute on this element
  priorityFee: '[data-testid="priority-fee-value"]',
  slippage: '[data-testid="slippage-value"]',
  displayedPrice: '[data-testid="token-price"]',
  marketCap: '[data-testid="market-cap"]',
  rugBadge: '[data-testid="rug-badge"]',
}

export function findBuyButton() {
  return document.querySelector(SELECTORS.buyButton)
}

export function findSellButtons() {
  return Array.from(document.querySelectorAll(SELECTORS.sellButtons))
}

export function scrapeTradeContext() {
  const mintEl = document.querySelector(SELECTORS.tokenMint)
  const mint = mintEl?.getAttribute('data-token-mint')
  if (!mint) return null

  return {
    mint,
    symbol: document.querySelector(SELECTORS.tokenSymbol)?.textContent?.trim() ?? '',
    name: document.querySelector(SELECTORS.tokenName)?.textContent?.trim() ?? '',
    imageUrl: document.querySelector(SELECTORS.tokenImage)?.getAttribute('src') ?? '',
    priceUsd: parseNumber(document.querySelector(SELECTORS.displayedPrice)?.textContent),
    priorityFeeSol: parseNumber(document.querySelector(SELECTORS.priorityFee)?.textContent) ?? 0,
    slippagePct: parseNumber(document.querySelector(SELECTORS.slippage)?.textContent) ?? 0,
    // MC and the rug badge are display-only (spec 6) and Axiom renders them with
    // magnitude suffixes ("$450K"), so they are carried as the page's own text
    // rather than parsed into numbers that would be wrong by 1000x.
    marketCapText: document.querySelector(SELECTORS.marketCap)?.textContent?.trim() ?? '',
    rugBadgeText: document.querySelector(SELECTORS.rugBadge)?.textContent?.trim() ?? '',
  }
}
