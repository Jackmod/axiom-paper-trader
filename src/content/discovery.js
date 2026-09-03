// Runtime discovery of Axiom's trading controls.
//
// The extension does NOT ship hardcoded CSS selectors for axiom.trade. Selectors built
// from generated class names break on every redeploy, and a selector nobody can verify
// without a logged-in session is worse than useless — it fails silently on a site we
// don't control.
//
// Instead we find controls the way a person does: by what they say. A Buy button says
// "Buy". A sell preset says "50%". A one-click amount preset says "0.25". Labels are the
// most stable thing about a trading UI, because changing them changes what users see.
//
// Everything here is pure and takes a `doc`, so it is testable against realistic markup.

const SOL_AMOUNT = /^\.?\d+(\.\d+)?$/ // "2", "0.25", ".5", "0.025"
const PERCENT = /^(\d{1,3})\s*%$/
const BUY_WORD = /^buy\b/i
const SELL_WORD = /^sell\b/i

export function isHidden(el) {
  if (!el || el.hasAttribute?.('hidden') || el.getAttribute?.('aria-hidden') === 'true') return true
  if (el.disabled) return true
  const style = el.ownerDocument?.defaultView?.getComputedStyle?.(el)
  return Boolean(style && (style.display === 'none' || style.visibility === 'hidden'))
}

export function labelOf(el) {
  return (el.getAttribute?.('aria-label') || el.textContent || '').trim()
}

function controls(doc) {
  return [...doc.querySelectorAll('button, [role="button"], a')].filter((el) => !isHidden(el))
}

/**
 * An explicit "Buy" button — the pattern where the user types an amount and confirms.
 * Excludes anything that also mentions selling, and excludes longer phrases like
 * "Buy with card" that aren't the trade action.
 */
export function findBuyButton(doc = document) {
  const candidates = controls(doc).filter((el) => {
    const label = labelOf(el)
    if (!BUY_WORD.test(label) || SELL_WORD.test(label) || label.length > 20) return false
    // A Buy/Sell TAB says "Buy" too, and clicking it changes a view rather than placing
    // a trade. Intercepting it would record a purchase the user never made while leaving
    // the real submit button untouched.
    const role = el.getAttribute('role')
    if (role === 'tab' || el.closest?.('[role="tablist"]')) return false
    return true
  })

  // Axiom labels its submit button with the ticker — "Buy DESI" — while the mode toggle
  // above it is a bare "Buy". Prefer the specific one: it is unambiguously the action.
  return candidates.find((el) => labelOf(el).length > 4) ?? candidates[0] ?? null
}

/** The sell submit button — "Sell DESI", or a bare "Sell" that is not a mode tab. */
export function findSellButton(doc = document) {
  const candidates = controls(doc).filter((el) => {
    const label = labelOf(el)
    if (!SELL_WORD.test(label) || label.length > 20) return false
    const role = el.getAttribute('role')
    if (role === 'tab' || el.closest?.('[role="tablist"]')) return false
    return true
  })
  return candidates.find((el) => labelOf(el).length > 5) ?? candidates[0] ?? null
}

/**
 * Percentage controls — "25%", "50%", "100%".
 *
 * Whether clicking one is a TRADE or merely fills in a size depends on the layout, which
 * is why `presetsAreOneClick` exists. On Axiom they set the size and the trade happens on
 * the submit button; treating them as trades would record sales the user never made.
 */
export function findSellButtons(doc = document) {
  return controls(doc).filter((el) => PERCENT.test(labelOf(el)))
}

/**
 * True when a preset click IS the trade.
 *
 * Axiom's panel has amount presets (0.1 / 2 / 5 / 10) that only populate its AMOUNT
 * field, with a separate "Buy DESI" button that actually submits. Intercepting a preset
 * there would book a purchase from a click that, on the real site, does nothing but type
 * a number — and would simultaneously miss every real trade, since the submit button was
 * never the thing being watched. So presets only count as one-click trades on a layout
 * that has no submit button at all.
 */
export function presetsAreOneClick(doc = document) {
  return !findBuyButton(doc) && !findSellButton(doc)
}

export function percentOf(el) {
  const match = PERCENT.exec(labelOf(el))
  return match ? Number(match[1]) : null
}

/**
 * One-click buy presets — buttons labelled with a bare SOL amount ("0.1", "2", ".25").
 *
 * Deliberately excludes anything inside the same container as the percentage presets:
 * on a panel that shows both, a stray number next to the sell controls is far more
 * likely to be sell-side chrome than a buy preset, and mistaking one for the other
 * would record a trade the user never made.
 */
export function findBuyPresets(doc = document) {
  const sellContainers = new Set(findSellButtons(doc).map((el) => el.parentElement))
  return controls(doc).filter((el) => SOL_AMOUNT.test(labelOf(el)) && !sellContainers.has(el.parentElement))
}

export function amountOf(el) {
  const label = labelOf(el)
  return SOL_AMOUNT.test(label) ? Number(label) : null
}

/**
 * The free-text amount field, for the explicit-Buy-button pattern. Prefers a number
 * input, then one whose placeholder mentions an amount or SOL.
 */
export function findAmountInput(doc = document) {
  const inputs = [...doc.querySelectorAll('input')].filter((el) => !isHidden(el))
  return (
    inputs.find((el) => el.type === 'number') ??
    inputs.find((el) => /amount|sol/i.test(el.placeholder || el.getAttribute('aria-label') || '')) ??
    null
  )
}

/**
 * True when we can actually intercept trades on this page — i.e. there is something to
 * click. Used by the health banner so a broken page says so instead of silently
 * recording nothing.
 */
export function canIntercept(doc = document) {
  return Boolean(findBuyButton(doc)) || findBuyPresets(doc).length > 0 || findSellButtons(doc).length > 0
}
