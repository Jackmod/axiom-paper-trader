import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { attachTradeInterception } from './trade-interceptor.js'

// Only the live quote API is mocked. Everything else runs against a real (jsdom) DOM,
// so these assertions are about actual click/interception behaviour, not about mocks
// agreeing with themselves.
vi.mock('../lib/price-sources/jupiter-quote.js', () => ({
  fetchQuotedFillPrice: vi.fn(async () => 0.000005),
}))

// Mirrors the fixture in dom-scraper.test.js. If SELECTORS change, change both.
const FIXTURE = `
  <div data-token-mint="So11111111111111111111111111111111111111112"></div>
  <span data-testid="token-symbol">BONK</span>
  <span data-testid="token-name">Bonk Token</span>
  <div data-testid="token-image"><img src="https://img.example/bonk.png" /></div>
  <span data-testid="token-price">$0.000004521</span>
  <span data-testid="priority-fee-value">0.001 SOL</span>
  <span data-testid="slippage-value">20%</span>
  <span data-testid="market-cap">$450K</span>
  <span data-testid="rug-badge">Safe</span>
  <input data-testid="trade-amount-input" value="0.25" />
  <button data-testid="buy-button">Buy <span id="buy-inner">now</span></button>
  <button data-testid="sell-percent-button">25%</button>
  <button data-testid="sell-percent-button">50%</button>
  <button data-testid="sell-percent-button">100%</button>
`

beforeEach(() => {
  document.body.innerHTML = FIXTURE
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('attachTradeInterception — sell percentage', () => {
  it('reads the percentage from the button the user actually clicked', async () => {
    const onTrade = vi.fn()
    attachTradeInterception(onTrade)

    click(document.querySelectorAll('[data-testid="sell-percent-button"]')[1]) // the 50% button
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0]).toMatchObject({ side: 'sell', sellPercent: 50 })
  })

  it('reads 100% correctly, so a full close actually closes the position', async () => {
    const onTrade = vi.fn()
    attachTradeInterception(onTrade)

    click(document.querySelectorAll('[data-testid="sell-percent-button"]')[2])
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0].sellPercent).toBe(100)
  })

  it('never reports a 0% sell for a real percentage button (a 0% sell silently closes nothing)', async () => {
    const onTrade = vi.fn()
    attachTradeInterception(onTrade)

    for (const btn of document.querySelectorAll('[data-testid="sell-percent-button"]')) click(btn)
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalledTimes(3))

    for (const call of onTrade.mock.calls) expect(call[0].sellPercent).toBeGreaterThan(0)
  })
})

describe('attachTradeInterception — zero real transactions guarantee', () => {
  it('swallows the buy click so Axiom never builds a real transaction', async () => {
    const axiomHandler = vi.fn()
    document.querySelector('[data-testid="buy-button"]').addEventListener('click', axiomHandler)
    attachTradeInterception(vi.fn())

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.querySelector('[data-testid="buy-button"]').dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(axiomHandler).not.toHaveBeenCalled()
  })

  it('swallows the sell click too', () => {
    const axiomHandler = vi.fn()
    const sell = document.querySelector('[data-testid="sell-percent-button"]')
    sell.addEventListener('click', axiomHandler)
    attachTradeInterception(vi.fn())

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    sell.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(axiomHandler).not.toHaveBeenCalled()
  })

  it('intercepts a click on an element nested inside the buy button', async () => {
    const onTrade = vi.fn()
    attachTradeInterception(onTrade)

    click(document.getElementById('buy-inner'))
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0].side).toBe('buy')
  })

  it('leaves unrelated clicks alone', () => {
    const onTrade = vi.fn()
    attachTradeInterception(onTrade)

    const other = document.createElement('button')
    document.body.appendChild(other)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    other.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(onTrade).not.toHaveBeenCalled()
  })
})

describe('attachTradeInterception — buy payload', () => {
  it('carries the scraped context, the entered SOL amount, and the quoted fill price', async () => {
    const onTrade = vi.fn()
    attachTradeInterception(onTrade)

    click(document.querySelector('[data-testid="buy-button"]'))
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0]).toMatchObject({
      side: 'buy',
      mint: 'So11111111111111111111111111111111111111112',
      symbol: 'BONK',
      qtySol: 0.25,
      priceUsd: 0.000005, // from the quote API, not the flat DOM price
      priorityFeeSol: 0.001,
      slippagePct: 20,
    })
  })

  it('does nothing when the page has no token mint (not a token page)', () => {
    document.body.innerHTML = '<button data-testid="buy-button">Buy</button>'
    const onTrade = vi.fn()
    attachTradeInterception(onTrade)

    click(document.querySelector('[data-testid="buy-button"]'))

    expect(onTrade).not.toHaveBeenCalled()
  })
})
