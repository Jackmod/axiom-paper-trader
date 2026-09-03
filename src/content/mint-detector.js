// Work out which token the user is looking at.
//
// This used to be one guess — "the URL path contains the mint" — and everything hung off
// it: no mint meant every buy button was disabled, and with no buy there was no position,
// so every sell was disabled too. One wrong assumption disabled the entire product, and
// silently, because a disabled button looks like a design choice rather than a failure.
//
// So this gathers candidates from every place a Solana mint plausibly appears on a token
// page, ranks them, and lets the caller confirm the best one against a price API. Callers
// must still cope with finding nothing — the widget offers a manual address entry — but
// that is now the rare case rather than the normal one.

const BASE58 = '[1-9A-HJ-NP-Za-km-z]{32,44}'
const BASE58_EXACT = new RegExp(`^${BASE58}$`)
const BASE58_ANYWHERE = new RegExp(BASE58, 'g')

// Addresses that are base58 and all over Solana pages, but are never the token being
// traded. Matching one of these would point the whole widget at the wrong asset.
const NOT_A_TRADED_TOKEN = new Set([
  'So11111111111111111111111111111111111111112', // wrapped SOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token program
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
  '11111111111111111111111111111111', // System program
  'ComputeBudget111111111111111111111111111111',
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated token program
])

// Links that identify a token by address. A mint inside one of these is about as strong a
// signal as the page can give.
const EXPLORER_PATTERNS = [
  new RegExp(`solscan\\.io/token/(${BASE58})`, 'i'),
  new RegExp(`birdeye\\.so/token/(${BASE58})`, 'i'),
  new RegExp(`dexscreener\\.com/solana/(${BASE58})`, 'i'),
  new RegExp(`pump\\.fun/(?:coin/)?(${BASE58})`, 'i'),
  new RegExp(`solana\\.fm/address/(${BASE58})`, 'i'),
  new RegExp(`explorer\\.solana\\.com/address/(${BASE58})`, 'i'),
  new RegExp(`rugcheck\\.xyz/tokens/(${BASE58})`, 'i'),
]

const MINT_ATTRIBUTES = ['data-token-mint', 'data-mint', 'data-address', 'data-ca', 'data-clipboard-text']

export function isPlausibleMint(value) {
  return typeof value === 'string' && BASE58_EXACT.test(value) && !NOT_A_TRADED_TOKEN.has(value)
}

function add(candidates, value, source, weight) {
  if (!isPlausibleMint(value)) return
  const existing = candidates.get(value)
  // A mint seen in several places is more credible than one seen once, so weights add.
  if (existing) {
    existing.weight += weight
    if (!existing.sources.includes(source)) existing.sources.push(source)
    return
  }
  candidates.set(value, { mint: value, weight, sources: [source] })
}

/**
 * Every plausible mint on the page, best first.
 *
 * Weights encode how much a location tells us. The URL and explorer links are close to
 * definitive; a bare address in body text is weak on its own but corroborates.
 */
export function findMintCandidates(doc = document, url = window.location.href) {
  const candidates = new Map()

  // 1. The URL — path segments first, then query values.
  try {
    const parsed = new URL(url)
    for (const segment of parsed.pathname.split('/')) add(candidates, segment, 'url-path', 100)
    for (const value of parsed.searchParams.values()) add(candidates, value, 'url-query', 80)
  } catch {
    // A malformed URL is not worth failing detection over.
  }

  // 2. Explorer / launchpad links anywhere on the page.
  for (const anchor of doc.querySelectorAll('a[href]')) {
    const href = anchor.getAttribute('href') || ''
    for (const pattern of EXPLORER_PATTERNS) {
      const match = pattern.exec(href)
      if (match) add(candidates, match[1], 'explorer-link', 70)
    }
  }

  // 3. Attributes that name an address outright, including copy-to-clipboard buttons —
  //    a "copy contract address" control is exactly the token being traded.
  for (const attribute of MINT_ATTRIBUTES) {
    for (const el of doc.querySelectorAll(`[${attribute}]`)) {
      add(candidates, el.getAttribute(attribute)?.trim(), `attr:${attribute}`, 60)
    }
  }

  // 4. Bare addresses in the page's own text. Weakest signal, and read one TEXT NODE at a
  //    time rather than from body.textContent: concatenating the whole document runs
  //    adjacent addresses together, and a 44-character window straddling that seam is a
  //    syntactically valid base58 string that belongs to no token at all. On a live feed
  //    listing many addresses that would manufacture phantom mints — and a phantom mint
  //    passes every other check, so it would be quoted and traded like a real one.
  const walker = doc.createTreeWalker(doc.body ?? doc, 4 /* NodeFilter.SHOW_TEXT */)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const match of node.nodeValue?.match(BASE58_ANYWHERE) ?? []) {
      add(candidates, match, 'page-text', 10)
    }
  }

  return [...candidates.values()]
    .map((candidate) => ({
      ...candidate,
      // pump.fun mints end in "pump" by construction, which on a memecoin terminal is a
      // strong hint that this address is the traded token rather than a program or wallet.
      weight: candidate.weight + (candidate.mint.endsWith('pump') ? 25 : 0),
    }))
    .sort((a, b) => b.weight - a.weight)
}

/** The single best guess, or null when the page offers nothing plausible. */
export function detectMint(doc = document, url = window.location.href) {
  return findMintCandidates(doc, url)[0]?.mint ?? null
}
