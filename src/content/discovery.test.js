import { describe, it, expect, afterEach } from 'vitest'
import {
  findBuyButton,
  findSellButtons,
  findBuyPresets,
  findAmountInput,
  percentOf,
  amountOf,
  canIntercept,
  labelOf,
  isHidden,
} from './discovery.js'

afterEach(() => {
  document.body.innerHTML = ''
})

// Modelled on Axiom's actual panel: one-click SOL amount presets on the buy side,
// percentage presets on the sell side. Class names are intentionally the kind of
// generated garbage a real build emits, to prove nothing here depends on them.
const AXIOM_PANEL = `
  <div class="sc-a1b2c3">
    <div class="sc-buy-row">
      <span>Buy</span>
      <button class="sc-x9">0.1</button>
      <button class="sc-x9">0.25</button>
      <button class="sc-x9">.5</button>
      <button class="sc-x9">2</button>
    </div>
    <div class="sc-sell-row">
      <span>Sell</span>
      <button class="sc-y7">25%</button>
      <button class="sc-y7">50%</button>
      <button class="sc-y7">100%</button>
    </div>
  </div>
`

// The other common shape: a single Buy button plus a free-text amount field.
const EXPLICIT_BUY = `
  <input type="number" placeholder="Amount" />
  <button class="whatever">Buy</button>
  <button>50%</button>
`

describe('findBuyButton', () => {
  it('finds a button by its label, not by any class or data attribute', () => {
    document.body.innerHTML = EXPLICIT_BUY
    expect(labelOf(findBuyButton())).toBe('Buy')
  })

  it('finds it via aria-label when the text is an icon', () => {
    document.body.innerHTML = '<button aria-label="Buy"><svg></svg></button>'
    expect(findBuyButton()).not.toBeNull()
  })

  it('ignores a Sell button', () => {
    document.body.innerHTML = '<button>Sell</button>'
    expect(findBuyButton()).toBeNull()
  })

  it('ignores unrelated long labels like "Buy with card"', () => {
    document.body.innerHTML = '<button>Buy with card instead</button>'
    expect(findBuyButton()).toBeNull()
  })

  it('ignores hidden and disabled controls', () => {
    document.body.innerHTML = '<button style="display:none">Buy</button><button disabled>Buy</button>'
    expect(findBuyButton()).toBeNull()
  })

  it('returns null on a page with no trading panel at all', () => {
    document.body.innerHTML = '<div>marketing landing page</div>'
    expect(findBuyButton()).toBeNull()
  })
})

describe('findSellButtons', () => {
  it('finds every percentage preset', () => {
    document.body.innerHTML = AXIOM_PANEL
    expect(findSellButtons().map(labelOf)).toEqual(['25%', '50%', '100%'])
  })

  it('reads the percentage off the button', () => {
    document.body.innerHTML = AXIOM_PANEL
    expect(findSellButtons().map(percentOf)).toEqual([25, 50, 100])
  })

  it('tolerates a space before the percent sign', () => {
    document.body.innerHTML = '<button>50 %</button>'
    expect(percentOf(findSellButtons()[0])).toBe(50)
  })
})

describe('findBuyPresets', () => {
  it("finds Axiom's one-click SOL amount presets", () => {
    document.body.innerHTML = AXIOM_PANEL
    expect(findBuyPresets().map(labelOf)).toEqual(['0.1', '0.25', '.5', '2'])
  })

  it('parses the amount off each preset, including leading-dot amounts', () => {
    document.body.innerHTML = AXIOM_PANEL
    expect(findBuyPresets().map(amountOf)).toEqual([0.1, 0.25, 0.5, 2])
  })

  it('does not mistake a percentage preset for a SOL amount', () => {
    document.body.innerHTML = AXIOM_PANEL
    expect(findBuyPresets().map(labelOf)).not.toContain('25%')
  })

  it('ignores bare numbers sitting among the sell controls', () => {
    // A stray number next to the sell presets is far more likely to be sell-side chrome
    // than a buy preset — treating it as buyable would record a trade nobody made.
    document.body.innerHTML = `
      <div><button>25%</button><button>50%</button><button>5</button></div>
    `
    expect(findBuyPresets()).toHaveLength(0)
  })
})

describe('findAmountInput', () => {
  it('prefers a number input', () => {
    document.body.innerHTML = EXPLICIT_BUY
    expect(findAmountInput().type).toBe('number')
  })

  it('falls back to a placeholder mentioning an amount', () => {
    document.body.innerHTML = '<input type="text" placeholder="SOL amount" />'
    expect(findAmountInput()).not.toBeNull()
  })

  it('returns null when there is no amount field', () => {
    document.body.innerHTML = '<input type="checkbox" />'
    expect(findAmountInput()).toBeNull()
  })
})

describe('canIntercept', () => {
  it('is true on a real trading panel', () => {
    document.body.innerHTML = AXIOM_PANEL
    expect(canIntercept()).toBe(true)
  })

  it('is true for the explicit-Buy-button layout', () => {
    document.body.innerHTML = EXPLICIT_BUY
    expect(canIntercept()).toBe(true)
  })

  it('is false on the logged-out marketing page, which is what triggers the warning banner', () => {
    document.body.innerHTML = '<h1>Trade faster on Axiom</h1><a>Sign in</a>'
    expect(canIntercept()).toBe(false)
  })
})

describe('isHidden', () => {
  it('treats aria-hidden and hidden as hidden', () => {
    document.body.innerHTML = '<button hidden>a</button><button aria-hidden="true">b</button>'
    const [a, b] = document.querySelectorAll('button')
    expect(isHidden(a)).toBe(true)
    expect(isHidden(b)).toBe(true)
  })

  it('treats a normal button as visible', () => {
    document.body.innerHTML = '<button>a</button>'
    expect(isHidden(document.querySelector('button'))).toBe(false)
  })
})
