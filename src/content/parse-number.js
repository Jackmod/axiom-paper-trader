export function parseNumber(text) {
  if (!text) return null
  const cleaned = text.replace(/[^0-9.]/g, '')
  return cleaned && cleaned !== '.' ? Number(cleaned) : null
}
