// UNVERIFIED PLACEHOLDER SELECTORS — these are the shapes the plan proposes, but
// they have NOT yet been checked against a live axiom.trade token page (Task 14
// Step 2 requires a human with DevTools open on the real site; no automated run
// can do it). Before this module is relied on, open a real token page, use the
// element picker on the Buy button, Sell buttons/tabs, SOL-amount input, token
// name/symbol, token image, mint, priority fee, and slippage, and replace any
// value below that does not match. Prefer stable data-* attributes or ARIA roles
// over generated class names, which Axiom may rebuild on every deploy. Re-verify
// after any Axiom UI change.
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
}

import { parseNumber } from './parse-number.js'

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
  }
}
