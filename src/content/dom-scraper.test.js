import { describe, it, expect, afterEach } from 'vitest'
import { findBuyButton, findSellButtons, scrapeTradeContext, readMint, canIntercept, tradeCandidates } from './dom-scraper.js'

// A realistic memecoin mint. It deliberately is NOT wrapped SOL or USDC: those are on
// the detector denylist precisely because they litter a trading page and are never the
// token being traded.
const MINT = '31A8xLh6fwYavYvzdKeSsMjPGmK7RVz3Z4M5EG8Spump'

// Realistic markup: labels a user reads, and generated class names of the kind a real
// build emits. Nothing here relies on data-* attributes, because axiom.trade does not
// ship them and an earlier version of this file pretended otherwise.
const TOKEN_PAGE = `
  <div class="sc-9f2a">
    <span>$0.000004521</span>
    <span>20%</span>
    <div class="sc-buy"><button>0.1</button><button>0.25</button><button>2</button></div>
    <div class="sc-sell"><button>25%</button><button>50%</button><button>100%</button></div>
  </div>
`

const setPath = (pathname) => window.history.replaceState({}, '', pathname)

afterEach(() => {
  document.body.innerHTML = ''
  setPath('/')
})

describe('scrapeTradeContext', () => {
  it('returns null off a token route, so nothing is recorded on the marketing page', () => {
    setPath('/')
    document.body.innerHTML = TOKEN_PAGE
    expect(scrapeTradeContext()).toBeNull()
  })

  it('keys the context on the mint from the route', () => {
    setPath(`/meme/${MINT}`)
    document.body.innerHTML = TOKEN_PAGE
    expect(scrapeTradeContext().mint).toBe(MINT)
  })

  it('reads the displayed price when one is on the page', () => {
    setPath(`/meme/${MINT}`)
    document.body.innerHTML = TOKEN_PAGE
    expect(scrapeTradeContext().priceUsd).toBeCloseTo(0.000004521)
  })

  it('still returns a usable context when every optional detail is missing (spec §13)', () => {
    setPath(`/meme/${MINT}`)
    document.body.innerHTML = '<div></div>'

    const context = scrapeTradeContext()
    // A missing price is fine: the real fill price comes from Jupiter's quote API, and
    // name/symbol/image are backfilled from the price APIs. None of them may block a trade.
    expect(context.mint).toBe(MINT)
    expect(context.priceUsd).toBeNull()
    expect(context.marketCapText).toBe('')
  })

  it('never lets an unparseable number reach the trade context as NaN', () => {
    setPath(`/meme/${MINT}`)
    document.body.innerHTML = '<span>$—</span><span>N/A</span>'

    const context = scrapeTradeContext()
    expect(Number.isNaN(context.priceUsd)).toBe(false)
    expect(Number.isNaN(context.slippagePct)).toBe(false)
  })

  it('reports a priority fee of zero rather than guessing one', () => {
    setPath(`/meme/${MINT}`)
    document.body.innerHTML = TOKEN_PAGE
    // Inventing a fee would corrupt PnL with a cost the user never agreed to.
    expect(scrapeTradeContext().priorityFeeSol).toBe(0)
  })
})

describe('control discovery', () => {
  it('finds the sell presets on a token page without any configuration', () => {
    document.body.innerHTML = TOKEN_PAGE
    expect(findSellButtons()).toHaveLength(3)
  })

  it('reports interception as available on a trading panel', () => {
    document.body.innerHTML = TOKEN_PAGE
    expect(canIntercept()).toBe(true)
  })

  it('reports absence on the logged-out marketing page, which raises the warning banner', () => {
    document.body.innerHTML = '<h1>Trade faster on Axiom</h1>'
    expect(findBuyButton()).toBeNull()
    expect(findSellButtons()).toEqual([])
    expect(canIntercept()).toBe(false)
  })
})

describe('readMint', () => {
  it('reads the mint from an Axiom token route', () => {
    setPath(`/meme/${MINT}`)
    expect(readMint()).toBe(MINT)
  })

  it('ignores non-mint path segments', () => {
    setPath(`/meme/${MINT}`)
    expect(readMint()).not.toBe('meme')
  })

  it('falls back to a DOM attribute when the route carries no mint', () => {
    setPath('/discover')
    document.body.innerHTML = `<div data-token-mint="${MINT}"></div>`
    expect(readMint()).toBe(MINT)
  })

  it('returns null when neither source has one', () => {
    setPath('/discover')
    document.body.innerHTML = '<div></div>'
    expect(readMint()).toBeNull()
  })

  it('rejects a segment too short to be a mint', () => {
    setPath('/meme/abc')
    expect(readMint()).toBeNull()
  })
})

// Structure gates, the market confirms. Both guards are required, and the failure modes
// they cover are opposite: structure alone picked a wallet out of a holders table and
// showed it as "Unnamed token"; API confirmation alone cannot tell a discovery feed from
// a token page, because every coin listed on a feed IS a real tradeable token.
describe('tradeCandidates', () => {
  // Valid base58: no 0, O, I or l. An earlier fixture used 'W00…', which is not a
  // possible address, so every test built on it passed without testing anything.
  const WALLET = 'WabC3D4E5F6G7H8J9K1L2M3N4P5Q6R7S8T9U1V2W3'

  it('offers nothing on a page that is not about a single token', () => {
    // Nothing to confirm means nothing to trade — the widget asks for an address instead.
    setPath('/pulse')
    document.body.innerHTML = `<span>${MINT}</span><span>${WALLET}</span>`
    expect(tradeCandidates()).toEqual([])
  })

  it('puts the routed token first so the market is asked about it before anything else', () => {
    setPath(`/meme/${MINT}`)
    document.body.innerHTML = `<table><tr><td>${WALLET}</td></tr></table>`
    expect(tradeCandidates()[0]).toBe(MINT)
  })

  it('still offers the other addresses as fallbacks, in case the first is not a token', () => {
    // This is what rescues a route that carries a pool or pair address rather than a mint:
    // the price API rejects it and the next candidate gets its turn.
    setPath(`/meme/${MINT}`)
    document.body.innerHTML = `<table><tr><td>${WALLET}</td></tr></table>`
    expect(tradeCandidates()).toContain(WALLET)
  })

  it('never repeats the detected token in its own fallback list', () => {
    setPath(`/meme/${MINT}`)
    document.body.innerHTML = `<span>${MINT}</span>`
    expect(tradeCandidates().filter((m) => m === MINT)).toHaveLength(1)
  })
})
