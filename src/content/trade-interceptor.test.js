import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { attachTradeInterception } from './trade-interceptor.js'

// Only the live quote API is mocked. Everything else runs against a real (jsdom) DOM,
// so these assertions are about actual click/interception behaviour, not about mocks
// agreeing with themselves.
vi.mock('../lib/price-sources/jupiter-quote.js', () => ({
  fetchQuotedFillPrice: vi.fn(async () => 0.000005),
}))

const MINT = 'So11111111111111111111111111111111111111112'

// Controls are discovered by LABEL at runtime, so these fixtures carry labels and the
// kind of generated class names a real build emits — no data-* hooks, because
// axiom.trade does not ship them and pretending otherwise is what broke this before.

// Layout A: a free-text amount plus an explicit confirm button.
const EXPLICIT_BUY = `
  <span>$0.000004521</span>
  <span>20%</span>
  <input type="number" value="0.25" />
  <button class="sc-1">Buy <span id="buy-inner">now</span></button>
  <button class="sc-2">25%</button>
  <button class="sc-2">50%</button>
  <button class="sc-2">100%</button>
`

// Layout B: Axiom's one-click presets, where the amount IS the button.
const ONE_CLICK = `
  <span>$0.000004521</span>
  <div class="sc-buy"><button>0.1</button><button>0.25</button><button>2</button></div>
  <div class="sc-sell"><button>25%</button><button>50%</button><button>100%</button></div>
`

const buttons = () => [...document.querySelectorAll('button')]
const byLabel = (label) => buttons().find((b) => b.textContent.trim() === label)
const sellButtons = () => buttons().filter((b) => /%$/.test(b.textContent.trim()))
const buyButton = () => buttons().find((b) => /^Buy/.test(b.textContent.trim()))

// Interception listens on `document`, which survives `document.body.innerHTML = ''`,
// so every attachment is detached after its test. Without this, a listener from an
// earlier test keeps preventDefault-ing clicks in later ones.
const attached = []

function attach(onTrade) {
  const detach = attachTradeInterception(onTrade)
  attached.push(detach)
  return detach
}

beforeEach(() => {
  window.history.replaceState({}, '', `/meme/${MINT}`)
  document.body.innerHTML = EXPLICIT_BUY
})

afterEach(() => {
  while (attached.length) attached.pop()()
  document.body.innerHTML = ''
  window.history.replaceState({}, '', '/')
  vi.restoreAllMocks()
})

function click(el) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

describe('attachTradeInterception — sell percentage', () => {
  it('reads the percentage from the button the user actually clicked', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    click(sellButtons()[1]) // the 50% button
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0]).toMatchObject({ side: 'sell', sellPercent: 50 })
  })

  it('reads 100% correctly, so a full close actually closes the position', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    click(sellButtons()[2])
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0].sellPercent).toBe(100)
  })

  it('never reports a 0% sell (a 0% sell silently closes nothing)', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    for (const btn of sellButtons()) click(btn)
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalledTimes(3))

    for (const call of onTrade.mock.calls) expect(call[0].sellPercent).toBeGreaterThan(0)
  })
})

describe("attachTradeInterception — Axiom's one-click amount presets", () => {
  beforeEach(() => {
    document.body.innerHTML = ONE_CLICK
  })

  it('takes the trade size from the preset button itself, with no amount field on the page', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    click(byLabel('0.25'))
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0]).toMatchObject({ side: 'buy', qtySol: 0.25 })
  })

  it('handles a whole-number preset', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    click(byLabel('2'))
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0].qtySol).toBe(2)
  })

  it('swallows the preset click so Axiom never fires the real one-click trade', () => {
    const axiomHandler = vi.fn()
    byLabel('0.1').addEventListener('click', axiomHandler)
    attach(vi.fn())

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    byLabel('0.1').dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(axiomHandler).not.toHaveBeenCalled()
  })

  it('still reads the sell presets on this layout', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    click(byLabel('50%'))
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0]).toMatchObject({ side: 'sell', sellPercent: 50 })
  })
})

describe('attachTradeInterception — zero real transactions guarantee', () => {
  it('swallows the buy click so Axiom never builds a real transaction', () => {
    const axiomHandler = vi.fn()
    buyButton().addEventListener('click', axiomHandler)
    attach(vi.fn())

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    buyButton().dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(axiomHandler).not.toHaveBeenCalled()
  })

  it('swallows the sell click too', () => {
    const axiomHandler = vi.fn()
    sellButtons()[0].addEventListener('click', axiomHandler)
    attach(vi.fn())

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    sellButtons()[0].dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(axiomHandler).not.toHaveBeenCalled()
  })

  it('intercepts a click on an element nested inside the buy button', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    click(document.getElementById('buy-inner'))
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0].side).toBe('buy')
  })

  it('leaves unrelated clicks alone', () => {
    const onTrade = vi.fn()
    attach(onTrade)

    const other = document.createElement('button')
    other.textContent = 'Share'
    document.body.appendChild(other)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    other.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(onTrade).not.toHaveBeenCalled()
  })
})

describe('attachTradeInterception — detaching', () => {
  it('returns a detach handle that stops intercepting, so paper mode can be turned off', () => {
    const onTrade = vi.fn()
    const axiomHandler = vi.fn()
    buyButton().addEventListener('click', axiomHandler)

    const detach = attach(onTrade)
    detach()

    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    buyButton().dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(onTrade).not.toHaveBeenCalled()
    expect(axiomHandler).toHaveBeenCalledTimes(1) // the page's own handler runs again
  })

  it('detaching one attachment leaves another attachment intercepting', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const detachFirst = attach(first)
    attach(second)

    detachFirst()
    click(buyButton())
    await vi.waitFor(() => expect(second).toHaveBeenCalledTimes(1))

    expect(first).not.toHaveBeenCalled()
  })
})

describe('attachTradeInterception — buy payload', () => {
  it('carries the mint, the entered SOL amount, and the quoted fill price', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    click(buyButton())
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0]).toMatchObject({
      side: 'buy',
      mint: MINT,
      qtySol: 0.25,
      priceUsd: 0.000005, // from the quote API, not the flat DOM price
    })
  })

  it('records nothing off a token route, even on a page full of buttons', () => {
    window.history.replaceState({}, '', '/discover')
    const onTrade = vi.fn()
    attach(onTrade)

    click(buyButton())

    expect(onTrade).not.toHaveBeenCalled()
  })

  it('drops a buy with no readable amount rather than recording a phantom trade', async () => {
    document.body.innerHTML = '<span>$0.01</span><button>Buy</button>' // no amount field at all
    const onTrade = vi.fn()
    attach(onTrade)

    click(buyButton())
    await new Promise((r) => setTimeout(r, 0))

    expect(onTrade).not.toHaveBeenCalled()
  })
})
