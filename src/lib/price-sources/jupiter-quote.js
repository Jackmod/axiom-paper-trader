const LAMPORTS_PER_SOL = 1_000_000_000

// Jupiter Swap/Quote API. The plan drafted against `quote-api.jup.ag/v6/quote`,
// which Jupiter retired — that host no longer resolves at all (no DNS record),
// so a request to it fails before it ever reaches the network. The v6 quote
// endpoint moved to `/swap/v1/quote`; `lite-api.jup.ag` is the keyless free
// tier (same host `jupiter.js` uses for prices), while `api.jup.ag` is the
// keyed tier with higher rate limits. Query params and the `inAmount` /
// `outAmount` (decimal strings) response fields are unchanged from v6.
export async function fetchQuotedFillPrice({
  inputMint,
  outputMint,
  amountLamports,
  outputDecimals,
  slippageBps = 100,
}) {
  try {
    const url = `https://lite-api.jup.ag/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps}`
    const res = await fetch(url)
    if (!res.ok) return null
    const body = await res.json()
    if (body.inAmount == null || body.outAmount == null) return null
    const solIn = Number(body.inAmount) / LAMPORTS_PER_SOL
    const tokensOut = Number(body.outAmount) / 10 ** outputDecimals
    if (!tokensOut) return null
    return solIn / tokensOut
  } catch {
    return null // no route, network failure, malformed JSON — all "no quote available", never a crash
  }
}
