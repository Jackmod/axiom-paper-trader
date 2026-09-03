import { fetchJupiterPrice, SOL_MINT } from './jupiter.js'

const LAMPORTS_PER_SOL = 1_000_000_000

// Jupiter Swap/Quote API. The plan drafted against `quote-api.jup.ag/v6/quote`,
// which Jupiter retired — that host no longer resolves at all (no DNS record),
// so a request to it fails before it ever reaches the network. The v6 quote
// endpoint moved to `/swap/v1/quote`; `lite-api.jup.ag` is the keyless free
// tier (same host `jupiter.js` uses for prices), while `api.jup.ag` is the
// keyed tier with higher rate limits. Query params and the `inAmount` /
// `outAmount` (decimal strings) response fields are unchanged from v6.
export const JUPITER_QUOTE_ENDPOINT = 'https://lite-api.jup.ag/swap/v1/quote'

// `inAmount / outAmount` alone is SOL per token, but every consumer of this
// value is USD-denominated: the declared contract ("USD-equivalent price per
// token"), the storage schema (`avgEntryUsd`, `lastPriceUsd`,
// `tradeHistory[].priceUsd`, spec §12), and the DOM-displayed price this is
// the interchangeable fallback for (spec §5). Returning SOL per token would
// understate every quoted entry by the SOL/USD rate (~100x today) and mix two
// currencies inside the one-position-per-mint weighted average. So the SOL
// leg is converted to USD before the division.
//
// Preferred source is the quote's own `swapUsdValue` — Jupiter's USD valuation
// of this exact route, present on the live v1 response and exact for the
// "USD paid / tokens received" definition of a fill price, at no extra
// request. When it is absent we fall back to the SOL/USD spot price from the
// Price API client. Verified live 2026-09-03: quoting 0.1 SOL into USDC
// returns outAmount 10031790 (10.03 USDC) with swapUsdValue "10.030…", so this
// yields ~$1.00 per USDC — the raw SOL-per-token figure would have been
// $0.00997.
async function resolveUsdIn(body, solIn) {
  const quotedUsd = Number(body.swapUsdValue)
  if (Number.isFinite(quotedUsd) && quotedUsd > 0) return quotedUsd
  const solUsd = Number(await fetchJupiterPrice(SOL_MINT))
  return solIn * solUsd
}

export async function fetchQuotedFillPrice({
  inputMint,
  outputMint,
  amountLamports,
  outputDecimals,
  slippageBps = 100,
}) {
  try {
    const url = `${JUPITER_QUOTE_ENDPOINT}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountLamports}&slippageBps=${slippageBps}`
    const res = await fetch(url)
    if (!res.ok) return null
    const body = await res.json()
    if (body?.inAmount == null || body?.outAmount == null) return null
    const solIn = Number(body.inAmount) / LAMPORTS_PER_SOL
    const tokensOut = Number(body.outAmount) / 10 ** outputDecimals
    // A malformed amount makes these NaN, which is not caught by a `!x` or a
    // `?? ` guard downstream — Task 15 hands the result straight to `priceUsd`,
    // so a NaN here would permanently poison cost basis and PnL.
    if (!Number.isFinite(solIn) || solIn <= 0) return null
    if (!Number.isFinite(tokensOut) || tokensOut <= 0) return null
    const usdIn = await resolveUsdIn(body, solIn)
    if (!Number.isFinite(usdIn) || usdIn <= 0) return null // no USD rate is "no quote", not a wrong-currency quote
    const priceUsd = usdIn / tokensOut
    return Number.isFinite(priceUsd) ? priceUsd : null
  } catch {
    return null // no route, network failure, malformed JSON — all "no quote available", never a crash
  }
}
