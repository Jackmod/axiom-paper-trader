import { describe, it, expect, afterEach } from 'vitest'
import { findMintCandidates, detectMint, isPlausibleMint } from './mint-detector.js'

const MINT = '31A8xLh6fwYavYvzdKeSsMjPGmK7RVz3Z4M5EG8Spump'
const OTHER = 'DukWuNTcribb9pRez5PxafjWcZqWN3DjLHSd4qRGBRCx'
const SOL = 'So11111111111111111111111111111111111111112'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('isPlausibleMint', () => {
  it('accepts a real base58 mint', () => {
    expect(isPlausibleMint(MINT)).toBe(true)
  })

  it('rejects anything that is not a base58 address', () => {
    // Base58 excludes 0, O, I and l precisely so addresses cannot be misread.
    expect(isPlausibleMint('meme')).toBe(false)
    expect(isPlausibleMint('')).toBe(false)
    expect(isPlausibleMint(null)).toBe(false)
    expect(isPlausibleMint('0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl0OIl')).toBe(false)
    expect(isPlausibleMint('abc')).toBe(false) // too short
  })

  it('rejects addresses that are base58 but are never the traded token', () => {
    // These appear all over a Solana trading page. Pointing the widget at one would
    // quote and record trades against the wrong asset entirely.
    expect(isPlausibleMint(SOL)).toBe(false)
    expect(isPlausibleMint(USDC)).toBe(false)
    expect(isPlausibleMint('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')).toBe(false)
    expect(isPlausibleMint('11111111111111111111111111111111')).toBe(false)
  })
})

describe('findMintCandidates — where a mint can come from', () => {
  it('finds it in the URL path, the strongest single signal', () => {
    const [best] = findMintCandidates(document, `https://axiom.trade/meme/${MINT}`)
    expect(best.mint).toBe(MINT)
    expect(best.sources).toContain('url-path')
  })

  it('finds it in a query string, for routes that pass it that way', () => {
    const [best] = findMintCandidates(document, `https://axiom.trade/token?address=${MINT}`)
    expect(best.mint).toBe(MINT)
  })

  it('finds it in an explorer link when the URL has none', () => {
    document.body.innerHTML = `<a href="https://solscan.io/token/${MINT}">chart</a>`
    const [best] = findMintCandidates(document, 'https://axiom.trade/discover')
    expect(best.mint).toBe(MINT)
    expect(best.sources).toContain('explorer-link')
  })

  it('recognises every explorer/launchpad link shape it claims to', () => {
    for (const href of [
      `https://birdeye.so/token/${MINT}`,
      `https://dexscreener.com/solana/${MINT}`,
      `https://pump.fun/coin/${MINT}`,
      `https://solana.fm/address/${MINT}`,
      `https://rugcheck.xyz/tokens/${MINT}`,
    ]) {
      document.body.innerHTML = `<a href="${href}">x</a>`
      expect(detectMint(document, 'https://axiom.trade/discover')).toBe(MINT)
    }
  })

  it('finds it on a copy-contract-address button, which is exactly the traded token', () => {
    document.body.innerHTML = `<button data-clipboard-text="${MINT}">Copy CA</button>`
    expect(detectMint(document, 'https://axiom.trade/discover')).toBe(MINT)
  })

  it('finds it in a data attribute', () => {
    document.body.innerHTML = `<div data-mint="${MINT}"></div>`
    expect(detectMint(document, 'https://axiom.trade/discover')).toBe(MINT)
  })

  it('finds a bare address printed in the page text as a last resort', () => {
    document.body.innerHTML = `<span>${MINT}</span>`
    expect(detectMint(document, 'https://axiom.trade/discover')).toBe(MINT)
  })

  it('returns nothing on a page with no token at all', () => {
    document.body.innerHTML = '<h1>Trade faster on Axiom</h1>'
    expect(detectMint(document, 'https://axiom.trade/')).toBeNull()
    expect(findMintCandidates(document, 'https://axiom.trade/')).toEqual([])
  })
})

describe('findMintCandidates — ranking', () => {
  it('prefers the URL over an unrelated address mentioned in the page body', () => {
    // A feed of other people's trades is full of addresses; the route is what the user
    // is actually looking at.
    document.body.innerHTML = `<span>${OTHER}</span>`
    expect(detectMint(document, `https://axiom.trade/meme/${MINT}`)).toBe(MINT)
  })

  it('prefers an explorer link over a bare mention in text', () => {
    document.body.innerHTML = `<span>${OTHER}</span><a href="https://solscan.io/token/${MINT}">x</a>`
    expect(detectMint(document, 'https://axiom.trade/discover')).toBe(MINT)
  })

  it('adds weight when the same mint appears in several places', () => {
    document.body.innerHTML = `<a href="https://solscan.io/token/${MINT}">x</a><div data-mint="${MINT}"></div>`
    const [best] = findMintCandidates(document, `https://axiom.trade/meme/${MINT}`)
    expect(best.sources.length).toBeGreaterThan(1)
    expect(best.mint).toBe(MINT)
  })

  it('breaks a tie toward a pump.fun mint, which ends in "pump" by construction', () => {
    document.body.innerHTML = `<span>${OTHER}</span><span>${MINT}</span>`
    expect(detectMint(document, 'https://axiom.trade/discover')).toBe(MINT)
  })

  it('never surfaces SOL or USDC even though they are all over a trading page', () => {
    document.body.innerHTML = `<span>${SOL}</span><span>${USDC}</span>`
    expect(detectMint(document, 'https://axiom.trade/discover')).toBeNull()
  })

  it('returns every candidate so a caller can confirm the runner-up against a price API', () => {
    document.body.innerHTML = `<span>${OTHER}</span>`
    const candidates = findMintCandidates(document, `https://axiom.trade/meme/${MINT}`)
    expect(candidates.map((c) => c.mint)).toEqual([MINT, OTHER])
  })

  it('deduplicates a mint that appears many times rather than letting it flood the list', () => {
    document.body.innerHTML = `<span>${MINT}</span><span>${MINT}</span><div data-mint="${MINT}"></div>`
    const candidates = findMintCandidates(document, 'https://axiom.trade/discover')
    expect(candidates.filter((c) => c.mint === MINT)).toHaveLength(1)
  })

  it('survives a malformed URL instead of throwing detection away entirely', () => {
    document.body.innerHTML = `<span>${MINT}</span>`
    expect(detectMint(document, 'not a url')).toBe(MINT)
  })
})
