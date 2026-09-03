export async function fetchPumpFunPrice(mint) {
  try {
    const res = await fetch(`https://frontend-api-v2.pump.fun/coins/${mint}`)
    if (!res.ok) return null
    const body = await res.json()
    return body.price_usd != null ? Number(body.price_usd) : null
  } catch {
    return null
  }
}
