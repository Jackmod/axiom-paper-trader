import { describe, it, expect, afterEach } from 'vitest'
import { findBuyButton, findSellButtons, scrapeTradeContext, readMint } from './dom-scraper.js'

// These tests do NOT (and cannot) verify that SELECTORS match the real
// axiom.trade markup — only a human on a logged-in token page can do that
// (Task 14 Step 2/4). What they do verify is the mapping layer: which element
// feeds which field, the trimming, the no-mint early exit, and that no NaN
// escapes into the trade context. If Step 2 changes a selector, update the
// fixture below to match.
const FIXTURE = `
  <div data-token-mint="So11111111111111111111111111111111111111112"></div>
  <span data-testid="token-symbol">  BONK  </span>
  <span data-testid="token-name">  Bonk Token  </span>
  <div data-testid="token-image"><img src="https://img.example/bonk.png" /></div>
  <span data-testid="token-price">$0.000004521</span>
  <span data-testid="priority-fee-value">0.001 SOL</span>
  <span data-testid="slippage-value">20%</span>
  <span data-testid="market-cap">  $450K  </span>
  <span data-testid="rug-badge">  Safe  </span>
  <button data-testid="buy-button">Buy</button>
  <button data-testid="sell-percent-button">25%</button>
  <button data-testid="sell-percent-button">50%</button>
  <button data-testid="sell-percent-button">100%</button>
`

afterEach(() => {
  document.body.innerHTML = ''
})

describe('scrapeTradeContext', () => {
  it('returns null when the page has no mint element to key the position on', () => {
    document.body.innerHTML = '<span data-testid="token-symbol">BONK</span>'
    expect(scrapeTradeContext()).toBeNull()
  })

  it('returns null when the mint element carries an empty mint', () => {
    // Never fall back to symbol/name as the position key — that would break the
    // one-position-per-mint invariant.
    document.body.innerHTML = '<div data-token-mint=""></div><span data-testid="token-name">Bonk</span>'
    expect(scrapeTradeContext()).toBeNull()
  })

  it('maps each element to its field and trims the display text', () => {
    document.body.innerHTML = FIXTURE
    expect(scrapeTradeContext()).toEqual({
      mint: 'So11111111111111111111111111111111111111112',
      symbol: 'BONK',
      name: 'Bonk Token',
      imageUrl: 'https://img.example/bonk.png',
      priceUsd: 0.000004521,
      priorityFeeSol: 0.001,
      slippagePct: 20,
      marketCapText: '$450K',
      rugBadgeText: 'Safe',
    })
  })

  it('omits missing optional data rather than blocking the trade (spec 13)', () => {
    document.body.innerHTML = '<div data-token-mint="MintOnly111"></div>'
    expect(scrapeTradeContext()).toEqual({
      mint: 'MintOnly111',
      symbol: '',
      name: '',
      imageUrl: '',
      priceUsd: null,
      priorityFeeSol: 0,
      slippagePct: 0,
      marketCapText: '',
      rugBadgeText: '',
    })
  })

  it('never lets an unparseable number reach the trade context as NaN', () => {
    document.body.innerHTML = `
      <div data-token-mint="MintNaN111"></div>
      <span data-testid="token-price">$0.004521 -2.31%</span>
      <span data-testid="priority-fee-value">--</span>
      <span data-testid="slippage-value">N/A</span>
    `
    const context = scrapeTradeContext()
    expect(context.priceUsd).toBeNull()
    expect(context.priorityFeeSol).toBe(0)
    expect(context.slippagePct).toBe(0)
  })
})

describe('findBuyButton / findSellButtons', () => {
  it('finds the buy button and every sell preset on a token page', () => {
    document.body.innerHTML = FIXTURE
    expect(findBuyButton()?.textContent).toBe('Buy')
    expect(findSellButtons().map((el) => el.textContent)).toEqual(['25%', '50%', '100%'])
  })

  it('reports absence as null / empty array so callers can show the unavailable banner', () => {
    document.body.innerHTML = '<div data-token-mint="MintOnly111"></div>'
    expect(findBuyButton()).toBeNull()
    expect(findSellButtons()).toEqual([])
  })
})

// The mint is read from the route first: Axiom's token URLs carry it, and a URL is far
// more durable than markup a redesign can rewrite.
describe('readMint', () => {
  const setPath = (pathname) => window.history.replaceState({}, '', pathname)

  afterEach(() => setPath('/'))

  it('reads the mint from an Axiom token route', () => {
    setPath('/meme/So11111111111111111111111111111111111111112')
    expect(readMint()).toBe('So11111111111111111111111111111111111111112')
  })

  it('ignores non-mint path segments', () => {
    setPath('/meme/So11111111111111111111111111111111111111112')
    expect(readMint()).not.toBe('meme')
  })

  it('falls back to the DOM attribute when the route carries no mint', () => {
    setPath('/discover')
    document.body.innerHTML = '<div data-token-mint="So11111111111111111111111111111111111111112"></div>'
    expect(readMint()).toBe('So11111111111111111111111111111111111111112')
  })

  it('returns null when neither source has one', () => {
    setPath('/discover')
    document.body.innerHTML = '<div></div>'
    expect(readMint()).toBeNull()
  })

  it('rejects a segment that is too short to be a mint', () => {
    setPath('/meme/abc')
    document.body.innerHTML = ''
    expect(readMint()).toBeNull()
  })
})
