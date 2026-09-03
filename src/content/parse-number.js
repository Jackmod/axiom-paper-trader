export function parseNumber(text) {
  if (!text) return null
  const cleaned = text.replace(/[^0-9.]/g, '')
  if (!cleaned || cleaned === '.') return null
  const parsed = Number(cleaned)
  // Stripping can leave more than one decimal point (e.g. "$0.004521 -2.31%" ->
  // "0.004521.2.31"), which Number() turns into NaN. NaN is not null, so it
  // slips past every `?? 0` and `!= null` guard downstream and poisons cost
  // basis and PnL — collapse it to null, same as the price clients do.
  return Number.isFinite(parsed) ? parsed : null
}
