import { findBuyButton } from './dom-scraper.js'

export const WARNING_ID = 'axpt-interception-warning'

const MESSAGE =
  'Axiom Paper Trader: trade interception unavailable — Axiom’s page structure has ' +
  'changed, or this is not a token page. Trades will NOT be recorded until this is fixed.'

// Spec §13: if the scraper's selectors stop matching Axiom's markup, say so loudly.
// The dangerous failure here is the quiet one — a user believing paper mode is armed,
// clicking Buy, and having nothing recorded (or worse, the real trade going through
// because interception never attached).
export function checkInterceptionHealth() {
  const healthy = Boolean(findBuyButton())

  if (healthy) {
    dismissInterceptionWarning()
    return true
  }

  // Idempotent: this runs on a re-check timer and on SPA navigation, and stacking a
  // banner per call would bury the page.
  if (document.getElementById(WARNING_ID)) return false

  const banner = document.createElement('div')
  banner.id = WARNING_ID
  banner.setAttribute('role', 'alert')
  banner.textContent = MESSAGE
  banner.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'right:0',
    'z-index:2147483647',
    'background:#2a1420',
    'color:#ec4899',
    'padding:8px 12px',
    'text-align:center',
    'font:500 12px/1.4 system-ui,sans-serif',
  ].join(';')

  document.body.prepend(banner)
  return false
}

export function dismissInterceptionWarning() {
  document.getElementById(WARNING_ID)?.remove()
}
