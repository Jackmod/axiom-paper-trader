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
  const sign = signed && value > 0 ? '+' : ''
  const abs = Math.abs(value)
  const decimals = abs >= 1 ? 3 : abs >= 0.001 ? 4 : 6
  return `${sign}${value.toFixed(decimals)}`
}

export function formatPercent(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(2)}%`
}

/** USD totals for the portfolio header. */
export function formatUsd(value, { signed = false } = {}) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  // The sign belongs OUTSIDE the currency symbol. Taking the sign from the number itself
  // rendered losses as "$-4.00", which reads as a malformed price rather than a loss.
  const sign = value < 0 ? '-' : signed && value > 0 ? '+' : ''
  const abs = Math.abs(value)
  return `${sign}$${abs >= 1 ? abs.toFixed(2) : abs.toPrecision(3)}`
}
