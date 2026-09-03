import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { attachTradeInterception } from './trade-interceptor.js'

// Only the live quote/price APIs are mocked. Everything else runs against a real (jsdom)
// DOM, so these assertions are about actual click behaviour, not mocks agreeing with
// themselves.
vi.mock('../lib/price-sources/jupiter-quote.js', () => ({
  fetchQuotedFillPrice: vi.fn(async () => 0.000005),
}))
vi.mock('../lib/price-sources/jupiter.js', () => ({
  SOL_MINT: 'So11111111111111111111111111111111111111112',
  fetchJupiterTokenInfo: vi.fn(async () => ({ priceUsd: 0.000005, decimals: 6 })),
}))

// A realistic memecoin mint — deliberately not wrapped SOL or USDC, which the detector
// denylists because they litter a trading page and are never the traded token.
const MINT = '31A8xLh6fwYavYvzdKeSsMjPGmK7RVz3Z4M5EG8Spump'

// LAYOUT A — Axiom's real panel, taken from a live screenshot. The presets only FILL the
// AMOUNT field; the trade happens on "Buy DESI". Note the bare "Buy"/"Sell" mode tabs
// above it, which say the right word but are not the action.
const SUBMIT_LAYOUT = `
  <span>$0.000004521</span>
  <div role="tablist"><button role="tab">Buy</button><button role="tab">Sell</button></div>
  <input type="number" placeholder="AMOUNT" value="" />
  <div class="sc-presets"><button>0.1</button><button>2</button><button>5</button><button>10</button></div>
  <div class="sc-pcts"><button>25%</button><button>50%</button><button>100%</button></div>
  <button class="sc-submit">Buy DESI</button>
  <button class="sc-submit">Sell DESI</button>
`

// LAYOUT B — a panel with no submit button at all, where a preset click IS the trade.
const ONE_CLICK_LAYOUT = `
  <span>$0.000004521</span>
  <div class="sc-buy"><button>0.1</button><button>0.25</button><button>2</button></div>
  <div class="sc-sell"><button>25%</button><button>50%</button><button>100%</button></div>
`

const buttons = () => [...document.querySelectorAll('button')]
const byLabel = (label) => buttons().find((b) => b.textContent.trim() === label)
const amountField = () => document.querySelector('input[type="number"]')

const attached = []
function attach(onTrade) {
  const detach = attachTradeInterception(onTrade)
  attached.push(detach)
  return detach
}

beforeEach(() => {
  window.history.replaceState({}, '', `/meme/${MINT}`)
  document.body.innerHTML = SUBMIT_LAYOUT
})

afterEach(() => {
  while (attached.length) attached.pop()()
  document.body.innerHTML = ''
  window.history.replaceState({}, '', '/')
  vi.clearAllMocks()
})

function click(el) {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  el.dispatchEvent(event)
  return event
}

const settle = () => new Promise((r) => setTimeout(r, 0))

describe('submit layout — a preset only sets the size, it is not a trade', () => {
  it('does not record a trade when a preset is clicked', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    click(byLabel('2'))
    await settle()

    // On Axiom, clicking "2" types 2 into a field. Booking a 2 SOL purchase from that
    // would invent a trade out of a keystroke.
    expect(onTrade).not.toHaveBeenCalled()
  })

  it('lets the preset click through so Axiom can still fill its own field', () => {
    const axiomHandler = vi.fn()
    byLabel('2').addEventListener('click', axiomHandler)
    attach(vi.fn())

    const event = click(byLabel('2'))

    expect(event.defaultPrevented).toBe(false)
    expect(axiomHandler).toHaveBeenCalledTimes(1)
  })

  it('does not record a trade when a percentage is clicked', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    click(byLabel('50%'))
    await settle()

    expect(onTrade).not.toHaveBeenCalled()
  })
})

describe('submit layout — the submit button is the trade', () => {
  it('buys the amount typed into the field', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    amountField().value = '0.75'
    click(byLabel('Buy DESI'))
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0]).toMatchObject({ side: 'buy', solSpent: 0.75, mint: MINT })
  })

  it('buys the size chosen from a preset when the field is empty', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    click(byLabel('5')) // remembered, not traded
    click(byLabel('Buy DESI'))
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0].solSpent).toBe(5)
  })

  it('prefers a typed amount over an earlier preset — the later intent wins', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    click(byLabel('5'))
    amountField().value = '0.25'
    click(byLabel('Buy DESI'))
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0].solSpent).toBe(0.25)
  })

  it('sells the percentage chosen before submitting', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    click(byLabel('50%'))
    click(byLabel('Sell DESI'))
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0]).toMatchObject({ side: 'sell', sellPercent: 50 })
  })

  it('does not reuse a stale size on the next trade', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    click(byLabel('5'))
    click(byLabel('Buy DESI'))
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalledTimes(1))

    // Second submit with nothing chosen and an empty field: there is no size, so there
    // must be no trade rather than a silent repeat of the last one.
    click(byLabel('Buy DESI'))
    await settle()

    expect(onTrade).toHaveBeenCalledTimes(1)
  })
})

describe('submit layout — zero real transactions guarantee', () => {
  it('swallows the buy submit so Axiom never builds a real transaction', () => {
    const axiomHandler = vi.fn()
    byLabel('Buy DESI').addEventListener('click', axiomHandler)
    attach(vi.fn())

    amountField().value = '1'
    const event = click(byLabel('Buy DESI'))

    expect(event.defaultPrevented).toBe(true)
    expect(axiomHandler).not.toHaveBeenCalled()
  })

  it('swallows the sell submit too', () => {
    const axiomHandler = vi.fn()
    byLabel('Sell DESI').addEventListener('click', axiomHandler)
    attach(vi.fn())

    click(byLabel('50%'))
    const event = click(byLabel('Sell DESI'))

    expect(event.defaultPrevented).toBe(true)
    expect(axiomHandler).not.toHaveBeenCalled()
  })

  it('never mistakes the Buy/Sell mode tab for the submit button', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    const event = click(document.querySelector('[role="tab"]'))
    await settle()

    // Switching panel mode is not a purchase, and swallowing it would break the site.
    expect(onTrade).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('leaves unrelated clicks alone', () => {
    const onTrade = vi.fn()
    attach(onTrade)

    const other = document.createElement('button')
    other.textContent = 'Share'
    document.body.appendChild(other)

    expect(click(other).defaultPrevented).toBe(false)
    expect(onTrade).not.toHaveBeenCalled()
  })

  it('records nothing off a token route', async () => {
    window.history.replaceState({}, '', '/discover')
    const onTrade = vi.fn()
    attach(onTrade)

    amountField().value = '1'
    click(byLabel('Buy DESI'))
    await settle()

    expect(onTrade).not.toHaveBeenCalled()
  })

  it('drops a submit with no readable size rather than recording a phantom trade', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    click(byLabel('Buy DESI')) // nothing typed, no preset chosen
    await settle()

    expect(onTrade).not.toHaveBeenCalled()
  })
})

describe('one-click layout — the preset itself is the trade', () => {
  beforeEach(() => {
    document.body.innerHTML = ONE_CLICK_LAYOUT
  })

  it('takes the trade size from the preset button, with no amount field on the page', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    click(byLabel('0.25'))
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0]).toMatchObject({ side: 'buy', solSpent: 0.25 })
  })

  it('sells straight from a percentage button', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    click(byLabel('50%'))
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalled())

    expect(onTrade.mock.calls[0][0]).toMatchObject({ side: 'sell', sellPercent: 50 })
  })

  it('swallows the preset click, since here it IS the trade', () => {
    const axiomHandler = vi.fn()
    byLabel('0.1').addEventListener('click', axiomHandler)
    attach(vi.fn())

    const event = click(byLabel('0.1'))

    expect(event.defaultPrevented).toBe(true)
    expect(axiomHandler).not.toHaveBeenCalled()
  })

  it('never reports a 0% sell, which would silently close nothing', async () => {
    const onTrade = vi.fn()
    attach(onTrade)

    for (const label of ['25%', '50%', '100%']) click(byLabel(label))
    await vi.waitFor(() => expect(onTrade).toHaveBeenCalledTimes(3))

    for (const call of onTrade.mock.calls) expect(call[0].sellPercent).toBeGreaterThan(0)
  })
})

describe('detaching', () => {
  it('stops intercepting so paper mode can be turned off', () => {
    const axiomHandler = vi.fn()
    byLabel('Buy DESI').addEventListener('click', axiomHandler)
    const onTrade = vi.fn()

    attach(onTrade)()

    amountField().value = '1'
    const event = click(byLabel('Buy DESI'))

    expect(event.defaultPrevented).toBe(false)
    expect(onTrade).not.toHaveBeenCalled()
    expect(axiomHandler).toHaveBeenCalledTimes(1) // the page's own handler runs again
  })
})
