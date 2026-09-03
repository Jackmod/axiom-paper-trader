// pump.fun is an IDENTITY source, not a price source. See token-metadata.js.
//
// The design originally made it the third price tier, for brand-new bonding-curve tokens
// that Jupiter and DexScreener had not indexed yet. Checking the live service killed that
// plan twice over:
//
// 1. The v3 API carries no `price_usd` field at all — the v2 field this code read no
//    longer exists, so the tier silently returned null on every call. (v2 itself is now
//    503, and the manifest only grants v3, so calls to it were also CORS-blocked.)
// 2. The tier is not needed. Jupiter's v3 price API answers for pump.fun tokens within
//    seconds of creation — verified against a mint eight seconds old, which Jupiter
//    priced at $0.0000040058 while DexScreener had a pair but no price yet.
//
// Price could be derived from the curve's `virtual_sol_reserves` / `virtual_token_reserves`,
// but those are quoted in whichever mint the curve uses (this coin's `quote_mint` was
// USDC, not SOL) and scaled by two different decimal fields. Getting that subtly wrong
// produces a *plausible but wrong* entry price, which corrupts cost basis permanently and
// is exactly the class of bug the units rewrite just removed. A redundant tier is not
// worth that risk, so this file intentionally exports no price function.

export const PUMPFUN_API = 'https://frontend-api-v3.pump.fun'
