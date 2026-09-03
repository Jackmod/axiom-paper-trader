import { describe, it, expect, afterEach } from 'vitest'
import { findBuyButton, findSellButtons, scrapeTradeContext, readMint, canIntercept } from './dom-scraper.js'

const MINT = 'So11111111111111111111111111111111111111112'

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
