// Number formatting for a memecoin trading UI.
//
// Fixed decimal places are wrong here. A token priced at $0.000004521 rendered with
// toFixed(4) becomes "$0.0000" — the price disappears, every token looks identical, and
// a 10x move shows no change at all. Precision has to follow magnitude.

/** USD price per token. Keeps significant digits no matter how small the number is. */
export function formatPrice(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  if (value === 0) return '$0'

  const abs = Math.abs(value)
  if (abs >= 1) return `$${value.toFixed(2)}`
  if (abs >= 0.01) return `$${value.toFixed(4)}`

  // Below a cent, keep four significant digits rather than a fixed count, so
  // 0.000004521 stays 0.000004521 instead of collapsing to zero.
  return `$${value.toPrecision(4).replace(/e[+-]\d+$/i, '')}`
}

/** Token quantities, which range from fractions to billions. */
export function formatTokenAmount(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'

  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `${(value / 1_000).toFixed(2)}K`
  if (abs >= 1) return value.toFixed(2)
  return value.toPrecision(3)
}

/** SOL amounts — always signed for PnL, so a gain reads unambiguously as a gain. */
export function formatSol(value, { signed = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const decimals = abs >= 1 ? 3 : abs >= 0.001 ? 4 : 6
  const digits = abs.toFixed(decimals)

  // Take the sign from the ROUNDED figure, not the raw one. A position opened at the
  // current price is flat to six decimals but carries a hair of quote-rounding dust, and
  // signing that produced "-0.000000 SOL" — a loss of nothing, painted red.
  const sign = Number(digits) === 0 ? '' : value < 0 ? '-' : signed ? '+' : ''
  return `${sign}${digits}`
}

export function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  // Sign from the ROUNDED figure, as in formatSol and formatUsd: a position at its entry
  // price is flat to two decimals, and signing the dust beneath produced "-0.00%".
  const digits = Math.abs(value).toFixed(2)
  const sign = Number(digits) === 0 ? '' : value < 0 ? '-' : '+'
  return `${sign}${digits}%`
}

/** USD totals for the portfolio header. */
export function formatUsd(value, { signed = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)

  // A floor, below which there is no money here to report. A position opened at the
  // current price carries a few millionths of a dollar of quote-rounding dust, and three
  // significant digits turned that into "-$0.00000502" — noise, wearing a minus sign, in
  // the one place the user looks to see whether they are up. A hundredth of a cent is not
  // an amount anyone trades; above it, significance still matters, because a tiny position
  // can be a 50% winner that "$0.00" would report as having done nothing.
  if (abs < 0.0001) return '$0.00'

  // Cents for ordinary money — 7 cents is "$0.07", not "$0.0700" — significant digits only
  // below a cent, where fixed decimals would erase the figure entirely.
  const digits = abs >= 0.01 ? abs.toFixed(2) : abs.toPrecision(3)

  // The sign belongs OUTSIDE the currency symbol — "$-4.00" reads as a malformed price
  // rather than a loss — and it comes from the ROUNDED figure, so dust below a cent is
  // never signed into a phantom loss.
  const sign = Number(digits) === 0 ? '' : value < 0 ? '-' : signed ? '+' : ''
  return `${sign}$${digits}`
}

/**
 * The CSS class a PnL figure should wear, taken from the text that will be shown.
 *
 * Four surfaces render PnL — the on-page widget, the popup, the Side Panel header and each
 * position row — and each used to decide its colour from the raw float. Entry prices come
 * back from swap quotes, so a position opened seconds ago sits a few millionths of a dollar
 * under water: every surface printed "$0.00", and they disagreed about whether that was
 * green or pink, for the same position at the same instant. Deriving the colour from the
 * rendered string is the only version of this rule that cannot drift out of sync with it.
 */
export function pnlClass(text) {
  return String(text).trim().startsWith('-') ? 'axpt-pnl-negative' : 'axpt-pnl-positive'
}

/**
 * Market cap, with the magnitude suffix traders read at a glance ("$280M").
 * Takes a NUMBER from the price APIs — never scraped text, which was both brittle and
 * frequently picked up the token's price instead of its cap.
 */
export function formatMarketCap(value) {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) return '—'
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`
  return `$${value.toFixed(0)}`
}
