import { describe, it, expect } from 'vitest'
import { tokensFor, applyBuy, applySell, getUnrealizedPnl } from './position-engine.js'

// The units are the whole point of this module. A position holds TOKENS (`qty`), priced in
// USD per token (`avgEntryUsd`), and separately remembers the SOL it actually cost
// (`solInvested`). Every expected value below is computed by hand from those definitions,
// because the bug this file guards against was arithmetic that "ran fine" while being
// dimensionally meaningless.

const SOL_USD = 200 // a fixed rate makes the hand-arithmetic in each test checkable by eye

describe('tokensFor', () => {
  it('converts SOL spent into tokens through the USD price', () => {
    // 1 SOL at $200/SOL is $200; at $0.50 per token that buys 400 tokens.
    expect(tokensFor({ solSpent: 1, priceUsd: 0.5, solUsdPrice: SOL_USD })).toBeCloseTo(400, 10)
  })

  it('scales linearly with SOL spent and inversely with token price', () => {
    // Doubling the spend doubles the tokens; doubling the price halves them. This is the
    // property the weighted average depends on.
    expect(tokensFor({ solSpent: 2, priceUsd: 0.5, solUsdPrice: SOL_USD })).toBeCloseTo(800, 10)
    expect(tokensFor({ solSpent: 1, priceUsd: 1, solUsdPrice: SOL_USD })).toBeCloseTo(200, 10)
  })

  it('treats the SOL/USD rate as a real input, not a constant', () => {
    // The same 1 SOL buys twice as many tokens when SOL is worth twice as much.
    expect(tokensFor({ solSpent: 1, priceUsd: 10, solUsdPrice: 100 })).toBeCloseTo(10, 10)
    expect(tokensFor({ solSpent: 1, priceUsd: 10, solUsdPrice: 200 })).toBeCloseTo(20, 10)
  })

  it('throws on a non-positive solSpent instead of returning zero/negative tokens', () => {
    expect(() => tokensFor({ solSpent: 0, priceUsd: 10, solUsdPrice: SOL_USD })).toThrow()
    expect(() => tokensFor({ solSpent: -1, priceUsd: 10, solUsdPrice: SOL_USD })).toThrow()
  })

  it('throws on a non-positive priceUsd rather than dividing by zero into Infinity tokens', () => {
    expect(() => tokensFor({ solSpent: 1, priceUsd: 0, solUsdPrice: SOL_USD })).toThrow()
    expect(() => tokensFor({ solSpent: 1, priceUsd: -5, solUsdPrice: SOL_USD })).toThrow()
  })

  it('throws when the SOL/USD rate is missing or non-positive', () => {
    // A missing rate must be loud: silently defaulting it would resurrect the old bug of
    // mixing SOL and USD quantities in the same expression.
    expect(() => tokensFor({ solSpent: 1, priceUsd: 10, solUsdPrice: 0 })).toThrow()
    expect(() => tokensFor({ solSpent: 1, priceUsd: 10, solUsdPrice: undefined })).toThrow()
    expect(() => tokensFor({ solSpent: 1, priceUsd: 10, solUsdPrice: -200 })).toThrow()
  })
})

describe('applyBuy', () => {
  it('creates a new position holding TOKENS, not the SOL that was spent', () => {
    // 0.5 SOL at $200/SOL is $100; at $0.50 per token that is 200 tokens. `qty` must be
    // 200 (tokens), while `solInvested` records the 0.5 SOL actually paid.
    const positions = applyBuy(
      {},
      {
        mint: 'MORKOmint',
        symbol: 'MORKO',
        name: 'Morko',
        imageUrl: 'https://x/img.png',
        solSpent: 0.5,
        priceUsd: 0.5,
        solUsdPrice: SOL_USD,
      },
    )
    expect(positions['MORKOmint']).toEqual({
      symbol: 'MORKO',
      name: 'Morko',
      imageUrl: 'https://x/img.png',
      qty: 200,
      avgEntryUsd: 0.5,
      solInvested: 0.5,
      lastPriceUsd: 0.5,
      lastPriceUpdatedAt: expect.any(Number),
      priceSource: null,
      stale: false,
    })
  })

  it('defaults missing metadata to empty strings rather than leaving undefined in state', () => {
    const positions = applyBuy({}, { mint: 'M', solSpent: 1, priceUsd: 10, solUsdPrice: SOL_USD })
    expect(positions['M'].symbol).toBe('')
    expect(positions['M'].name).toBe('')
    expect(positions['M'].imageUrl).toBe('')
    expect(positions['M'].qty).toBeCloseTo(20, 10)
  })

  it('merges a second buy into the SAME position with a TOKEN-weighted average entry price', () => {
    // Buy 1: 1 SOL = $200 at $0.50/token -> 400 tokens.
    // Buy 2: 1 SOL = $200 at $2.00/token -> 100 tokens.
    // Token-weighted average = (400*0.5 + 100*2) / 500 = 400/500 = $0.80.
    // A naive SOL-weighted average would give (0.5 + 2)/2 = $1.25, which is wrong; the
    // assertion below is deliberately chosen so those two answers differ.
    let positions = applyBuy(
      {},
      { mint: 'MORKOmint', symbol: 'MORKO', name: 'Morko', imageUrl: 'https://x/img.png', solSpent: 1, priceUsd: 0.5, solUsdPrice: SOL_USD },
    )
    positions = applyBuy(positions, {
      mint: 'MORKOmint',
      symbol: 'MORKO',
      name: 'Morko',
      imageUrl: 'https://x/img.png',
      solSpent: 1,
      priceUsd: 2,
      solUsdPrice: SOL_USD,
    })

    expect(Object.keys(positions)).toEqual(['MORKOmint']) // never a second row for the same mint
    expect(positions['MORKOmint'].qty).toBeCloseTo(500, 10)
    expect(positions['MORKOmint'].avgEntryUsd).toBeCloseTo(0.8, 12)
    expect(positions['MORKOmint'].avgEntryUsd).not.toBeCloseTo(1.25, 2) // not the SOL-weighted answer
    expect(positions['MORKOmint'].solInvested).toBeCloseTo(2, 12)
    expect(positions['MORKOmint'].lastPriceUsd).toBe(2) // most recent trade price
  })

  it('keeps the original metadata when a later buy of the same mint carries none', () => {
    // Metadata is resolved once at discovery; a later trade must not blank out the row.
    let positions = applyBuy(
      {},
      { mint: 'M', symbol: 'MORKO', name: 'Morko', imageUrl: 'https://x/img.png', solSpent: 1, priceUsd: 10, solUsdPrice: SOL_USD },
    )
    positions = applyBuy(positions, { mint: 'M', symbol: '', name: '', imageUrl: '', solSpent: 1, priceUsd: 10, solUsdPrice: SOL_USD })
    expect(positions['M'].symbol).toBe('MORKO')
    expect(positions['M'].name).toBe('Morko')
    expect(positions['M'].imageUrl).toBe('https://x/img.png')
  })

  it('keeps two different mints as two separate positions', () => {
    let positions = applyBuy({}, { mint: 'A', symbol: 'A', name: 'A', imageUrl: '', solSpent: 1, priceUsd: 1, solUsdPrice: SOL_USD })
    positions = applyBuy(positions, { mint: 'B', symbol: 'B', name: 'B', imageUrl: '', solSpent: 1, priceUsd: 1, solUsdPrice: SOL_USD })
    expect(Object.keys(positions).sort()).toEqual(['A', 'B'])
  })

  it('recomputes the token-weighted average across three buys made at different SOL/USD rates', () => {
    // Buy 1: 1 SOL @ $200/SOL = $200 at $10/token ->  20 tokens
    // Buy 2: 1 SOL @ $200/SOL = $200 at $20/token ->  10 tokens
    // Buy 3: 2 SOL @ $100/SOL = $200 at  $5/token ->  40 tokens
    // qty = 70 tokens, avg = (20*10 + 10*20 + 40*5) / 70 = 600/70 = $8.571428...
    // solInvested = 1 + 1 + 2 = 4 SOL, and it must stay in SOL even though the rate moved.
    let positions = applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 1, priceUsd: 10, solUsdPrice: 200 })
    positions = applyBuy(positions, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 1, priceUsd: 20, solUsdPrice: 200 })
    positions = applyBuy(positions, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 2, priceUsd: 5, solUsdPrice: 100 })

    expect(Object.keys(positions)).toEqual(['M'])
    expect(positions['M'].qty).toBeCloseTo(70, 10)
    expect(positions['M'].avgEntryUsd).toBeCloseTo((20 * 10 + 10 * 20 + 40 * 5) / 70, 12)
    expect(positions['M'].avgEntryUsd).toBeCloseTo(8.571428571428571, 9)
    expect(positions['M'].solInvested).toBeCloseTo(4, 12)
  })

  it('tracks solInvested in SOL, independent of the rate at which each buy happened', () => {
    // Two buys of 1 SOL each cost 2 SOL, whatever SOL was worth at the time. If
    // solInvested ever drifted into USD this would read 300 instead of 2.
    let positions = applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 1, priceUsd: 10, solUsdPrice: 100 })
    positions = applyBuy(positions, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 1, priceUsd: 10, solUsdPrice: 200 })
    expect(positions['M'].solInvested).toBeCloseTo(2, 12)
  })

  it('does not mutate the positions object passed in (pure function contract)', () => {
    const before = applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 1, priceUsd: 10, solUsdPrice: SOL_USD })
    const beforeSnapshot = JSON.parse(JSON.stringify(before))
    applyBuy(before, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 1, priceUsd: 20, solUsdPrice: SOL_USD })
    expect(before).toEqual(beforeSnapshot)
  })

  it('throws on a non-positive solSpent instead of silently creating a zero/negative position', () => {
    expect(() => applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 0, priceUsd: 10, solUsdPrice: SOL_USD })).toThrow()
    expect(() => applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: -1, priceUsd: 10, solUsdPrice: SOL_USD })).toThrow()
  })

  it('throws on a non-positive priceUsd instead of corrupting the average with a bad price', () => {
    expect(() => applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 1, priceUsd: 0, solUsdPrice: SOL_USD })).toThrow()
    expect(() => applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 1, priceUsd: -5, solUsdPrice: SOL_USD })).toThrow()
  })

  it('throws when no SOL/USD rate is supplied, because tokens cannot be computed without one', () => {
    expect(() => applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 1, priceUsd: 10 })).toThrow()
    expect(() => applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 1, priceUsd: 10, solUsdPrice: 0 })).toThrow()
  })

  it('leaves an existing position untouched when a bad buy throws', () => {
    // The caller keeps the object it passed in, so a rejected trade must not have already
    // half-applied itself.
    const positions = applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 1, priceUsd: 10, solUsdPrice: SOL_USD })
    const snapshot = JSON.parse(JSON.stringify(positions))
    expect(() => applyBuy(positions, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 1, priceUsd: 0, solUsdPrice: SOL_USD })).toThrow()
    expect(positions).toEqual(snapshot)
  })

  it('handles very small (dust) trade sizes without losing precision to the point of a wrong average', () => {
    // 0.000001 SOL @ $200/SOL = $0.0002. At $1,000,000/token that is 2e-10 tokens; at
    // $2,000,000/token, 1e-10 tokens. Average = (2e-10*1e6 + 1e-10*2e6)/3e-10 = $1,333,333.33.
    let positions = applyBuy(
      {},
      { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 0.000001, priceUsd: 1000000, solUsdPrice: SOL_USD },
    )
    positions = applyBuy(positions, {
      mint: 'M',
      symbol: 'M',
      name: 'M',
      imageUrl: '',
      solSpent: 0.000001,
      priceUsd: 2000000,
      solUsdPrice: SOL_USD,
    })
    expect(positions['M'].qty).toBeCloseTo(3e-10, 15)
    expect(positions['M'].avgEntryUsd).toBeCloseTo(4000000 / 3, 3)
    expect(positions['M'].solInvested).toBeCloseTo(0.000002, 15)
  })
})

describe('applySell', () => {
  // 2 SOL @ $200/SOL = $400 at $10/token -> 40 tokens, avgEntryUsd $10, solInvested 2 SOL.
  function seedPosition() {
    return applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 2, priceUsd: 10, solUsdPrice: SOL_USD })
  }

  it('sells a FRACTION of the holding, not an absolute quantity', () => {
    // 25% of 40 tokens is 10 tokens at $15 = $150 = 0.75 SOL of proceeds.
    const { positions: after, proceedsSol, soldTokens } = applySell(seedPosition(), {
      mint: 'M',
      fraction: 0.25,
      priceUsd: 15,
      solUsdPrice: SOL_USD,
    })
    expect(soldTokens).toBeCloseTo(10, 12)
    expect(proceedsSol).toBeCloseTo(0.75, 12)
    expect(after['M'].qty).toBeCloseTo(30, 12)
  })

  it('reduces quantity and solInvested proportionally while leaving avg entry unchanged', () => {
    // Selling half of the position leaves half the tokens and half the cost basis; what
    // remains still cost $10/token, so the average entry must not move.
    const { positions: after } = applySell(seedPosition(), { mint: 'M', fraction: 0.5, priceUsd: 15, solUsdPrice: SOL_USD })
    expect(after['M'].qty).toBeCloseTo(20, 12)
    expect(after['M'].solInvested).toBeCloseTo(1, 12)
    expect(after['M'].avgEntryUsd).toBeCloseTo(10, 12)
    expect(after['M'].lastPriceUsd).toBe(15)
    expect(after['M'].stale).toBe(false)
  })

  it('realizes PnL in SOL against solInvested and in USD against avgEntryUsd', () => {
    // 25% sell: 10 tokens at $15 = $150 = 0.75 SOL proceeds against a 0.5 SOL cost basis
    // (25% of the 2 SOL paid) -> +0.25 SOL. In USD: ($15 - $10) * 10 tokens = +$50.
    const { realizedPnlSol, realizedPnlUsd } = applySell(seedPosition(), {
      mint: 'M',
      fraction: 0.25,
      priceUsd: 15,
      solUsdPrice: SOL_USD,
    })
    expect(realizedPnlSol).toBeCloseTo(0.25, 12)
    expect(realizedPnlUsd).toBeCloseTo(50, 12)
  })

  it('reports a SOL loss on a USD-flat sale when SOL itself has appreciated', () => {
    // Bought 40 tokens for 2 SOL when SOL was $200. Sell all at the same $10/token, but
    // now SOL is $400: proceeds are $400 = 1 SOL against 2 SOL invested -> -1 SOL, while
    // the USD result is exactly flat. The two currencies genuinely disagree, and only
    // solInvested makes the SOL figure honest.
    const { realizedPnlSol, realizedPnlUsd, proceedsSol } = applySell(seedPosition(), {
      mint: 'M',
      fraction: 1,
      priceUsd: 10,
      solUsdPrice: 400,
    })
    expect(realizedPnlUsd).toBeCloseTo(0, 12)
    expect(proceedsSol).toBeCloseTo(1, 12)
    expect(realizedPnlSol).toBeCloseTo(-1, 12)
  })

  it('reports a USD profit alongside a SOL loss for a position built at mixed rates', () => {
    // Same three buys as the applyBuy case: 70 tokens, avg $8.571428..., 4 SOL invested.
    // Sell it all at $10/token with SOL at $200: proceeds $700 = 3.5 SOL.
    //   USD: ($10 - 600/70) * 70 = 700 - 600 = +$100
    //   SOL: 3.5 - 4 = -0.5 SOL
    let positions = applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 1, priceUsd: 10, solUsdPrice: 200 })
    positions = applyBuy(positions, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 1, priceUsd: 20, solUsdPrice: 200 })
    positions = applyBuy(positions, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 2, priceUsd: 5, solUsdPrice: 100 })

    const { realizedPnlSol, realizedPnlUsd, soldTokens } = applySell(positions, {
      mint: 'M',
      fraction: 1,
      priceUsd: 10,
      solUsdPrice: 200,
    })
    expect(soldTokens).toBeCloseTo(70, 10)
    expect(realizedPnlUsd).toBeCloseTo(100, 9)
    expect(realizedPnlSol).toBeCloseTo(-0.5, 12)
  })

  it('records a negative realizedPnl in both currencies when selling at a loss', () => {
    // 50% of 40 tokens is 20 tokens at $6 = $120 = 0.6 SOL against a 1 SOL cost basis.
    const { realizedPnlSol, realizedPnlUsd } = applySell(seedPosition(), {
      mint: 'M',
      fraction: 0.5,
      priceUsd: 6,
      solUsdPrice: SOL_USD,
    })
    expect(realizedPnlUsd).toBeCloseTo((6 - 10) * 20, 12)
    expect(realizedPnlSol).toBeCloseTo(-0.4, 12)
    expect(realizedPnlUsd).toBeLessThan(0)
    expect(realizedPnlSol).toBeLessThan(0)
  })

  it('removes the position entirely on a 100% sell', () => {
    const { positions: after, realizedPnlSol, realizedPnlUsd, soldTokens } = applySell(seedPosition(), {
      mint: 'M',
      fraction: 1,
      priceUsd: 15,
      solUsdPrice: SOL_USD,
    })
    expect(after['M']).toBeUndefined()
    expect(soldTokens).toBeCloseTo(40, 12)
    // 40 tokens at $15 = $600 = 3 SOL against 2 SOL invested.
    expect(realizedPnlSol).toBeCloseTo(1, 12)
    expect(realizedPnlUsd).toBeCloseTo(200, 12)
  })

  it('closes the position when a float remainder lands within the close epsilon', () => {
    // A "100%" sell can arrive as a fraction a hair under 1 once it has been through a UI
    // and JSON. 40 tokens * 1e-12 leaves 4e-11 tokens — dust well inside the 1e-9 epsilon,
    // and the row must not survive as an untradeable ghost. A naive `remaining === 0`
    // check would leave it behind.
    const { positions: after } = applySell(seedPosition(), {
      mint: 'M',
      fraction: 1 - 1e-12,
      priceUsd: 12,
      solUsdPrice: SOL_USD,
    })
    expect(after['M']).toBeUndefined()
  })

  it('keeps the position open when the remainder is real rather than float dust', () => {
    // The epsilon must not be so broad that it swallows a genuine 0.01% residual holding:
    // 40 tokens * 1e-4 = 4e-3 tokens, far above 1e-9.
    const { positions: after } = applySell(seedPosition(), {
      mint: 'M',
      fraction: 1 - 1e-4,
      priceUsd: 12,
      solUsdPrice: SOL_USD,
    })
    expect(after['M']).toBeDefined()
    expect(after['M'].qty).toBeCloseTo(4e-3, 12)
  })

  it('accepts a fraction of exactly 1 but throws on anything above it', () => {
    expect(() => applySell(seedPosition(), { mint: 'M', fraction: 1, priceUsd: 12, solUsdPrice: SOL_USD })).not.toThrow()
    expect(() => applySell(seedPosition(), { mint: 'M', fraction: 1.0001, priceUsd: 12, solUsdPrice: SOL_USD })).toThrow()
    expect(() => applySell(seedPosition(), { mint: 'M', fraction: 2, priceUsd: 12, solUsdPrice: SOL_USD })).toThrow()
  })

  it('throws on a non-positive fraction', () => {
    const positions = seedPosition()
    expect(() => applySell(positions, { mint: 'M', fraction: 0, priceUsd: 12, solUsdPrice: SOL_USD })).toThrow()
    expect(() => applySell(positions, { mint: 'M', fraction: -0.25, priceUsd: 12, solUsdPrice: SOL_USD })).toThrow()
    expect(() => applySell(positions, { mint: 'M', fraction: undefined, priceUsd: 12, solUsdPrice: SOL_USD })).toThrow()
  })

  it('throws on a non-positive priceUsd', () => {
    const positions = seedPosition()
    expect(() => applySell(positions, { mint: 'M', fraction: 0.5, priceUsd: 0, solUsdPrice: SOL_USD })).toThrow()
    expect(() => applySell(positions, { mint: 'M', fraction: 0.5, priceUsd: -12, solUsdPrice: SOL_USD })).toThrow()
  })

  it('throws when no SOL/USD rate is available, rather than reporting proceeds of Infinity', () => {
    const positions = seedPosition()
    expect(() => applySell(positions, { mint: 'M', fraction: 0.5, priceUsd: 12, solUsdPrice: 0 })).toThrow()
    expect(() => applySell(positions, { mint: 'M', fraction: 0.5, priceUsd: 12 })).toThrow()
  })

  it('throws when selling a mint with no open position at all', () => {
    expect(() => applySell({}, { mint: 'GHOST', fraction: 1, priceUsd: 12, solUsdPrice: SOL_USD })).toThrow()
  })

  it('does not mutate the positions object passed in (pure function contract)', () => {
    const positions = seedPosition()
    const beforeSnapshot = JSON.parse(JSON.stringify(positions))
    applySell(positions, { mint: 'M', fraction: 0.4, priceUsd: 15, solUsdPrice: SOL_USD })
    expect(positions).toEqual(beforeSnapshot)
  })

  it('does not mutate the position object itself when closing it out', () => {
    // The close branch deletes a key from a copy; the original row must be intact so a
    // caller holding a reference (the UI, mid-render) does not see it change underfoot.
    const positions = seedPosition()
    const original = positions['M']
    applySell(positions, { mint: 'M', fraction: 1, priceUsd: 15, solUsdPrice: SOL_USD })
    expect(positions['M']).toBe(original)
    expect(positions['M'].qty).toBeCloseTo(40, 12)
    expect(positions['M'].solInvested).toBeCloseTo(2, 12)
  })

  it('leaves total realized PnL unchanged whether sold in one slice or two', () => {
    // Two 50% sells at the same price must realize what one 100% sell would: the cost
    // basis has to shrink in step with the quantity, or the second slice double-counts.
    const priceUsd = 15
    const oneShot = applySell(seedPosition(), { mint: 'M', fraction: 1, priceUsd, solUsdPrice: SOL_USD })

    const first = applySell(seedPosition(), { mint: 'M', fraction: 0.5, priceUsd, solUsdPrice: SOL_USD })
    const second = applySell(first.positions, { mint: 'M', fraction: 1, priceUsd, solUsdPrice: SOL_USD })

    expect(first.realizedPnlSol + second.realizedPnlSol).toBeCloseTo(oneShot.realizedPnlSol, 12)
    expect(first.realizedPnlUsd + second.realizedPnlUsd).toBeCloseTo(oneShot.realizedPnlUsd, 12)
    expect(second.positions['M']).toBeUndefined()
  })
})

describe('getUnrealizedPnl', () => {
  // 40 tokens bought for 2 SOL at $10/token (i.e. 2 SOL when SOL was $200).
  const held = { qty: 40, avgEntryUsd: 10, solInvested: 2, lastPriceUsd: 12 }

  it('computes USD amount, percent, and value from avg entry vs current price', () => {
    const { pnlUsd, pnlPct, valueUsd } = getUnrealizedPnl(held, SOL_USD)
    expect(pnlUsd).toBeCloseTo((12 - 10) * 40, 12)
    expect(pnlPct).toBeCloseTo(20, 12)
    expect(valueUsd).toBeCloseTo(480, 12)
  })

  it('measures the SOL figure against solInvested, not against a reconstructed entry', () => {
    // 40 tokens at $12 = $480 = 2.4 SOL at $200/SOL, against 2 SOL actually paid -> +0.4 SOL.
    const { pnlSol, valueSol } = getUnrealizedPnl(held, SOL_USD)
    expect(valueSol).toBeCloseTo(2.4, 12)
    expect(pnlSol).toBeCloseTo(0.4, 12)
  })

  it('can be up in SOL while flat in USD when the SOL price has fallen', () => {
    // Token price unchanged at $10 (USD PnL exactly zero), but SOL halved to $100, so the
    // $400 of tokens is now worth 4 SOL against the 2 SOL paid -> +2 SOL. Percent is a
    // token-price measure and stays at zero.
    const flat = { qty: 40, avgEntryUsd: 10, solInvested: 2, lastPriceUsd: 10 }
    const { pnlUsd, pnlPct, pnlSol, valueSol } = getUnrealizedPnl(flat, 100)
    expect(pnlUsd).toBe(0)
    expect(pnlPct).toBe(0)
    expect(valueSol).toBeCloseTo(4, 12)
    expect(pnlSol).toBeCloseTo(2, 12)
  })

  it('returns a negative pnlUsd, pnlPct and pnlSol when the price is below avg entry', () => {
    const losing = { qty: 40, avgEntryUsd: 10, solInvested: 2, lastPriceUsd: 8 }
    const { pnlUsd, pnlPct, pnlSol, valueSol } = getUnrealizedPnl(losing, SOL_USD)
    expect(pnlUsd).toBeCloseTo(-80, 12)
    expect(pnlPct).toBeCloseTo(-20, 12)
    expect(valueSol).toBeCloseTo(1.6, 12) // $320 / $200
    expect(pnlSol).toBeCloseTo(-0.4, 12)
  })

  it('returns exactly zero USD PnL and percent when price equals avg entry', () => {
    const position = { qty: 5, avgEntryUsd: 3, solInvested: 0.075, lastPriceUsd: 3 }
    const { pnlUsd, pnlPct } = getUnrealizedPnl(position, SOL_USD)
    expect(pnlUsd).toBe(0)
    expect(pnlPct).toBe(0)
  })

  it('returns null pnlSol and valueSol when no SOL/USD rate is known', () => {
    // An honest "—" beats a number invented from a missing rate. USD figures still stand,
    // because they need no rate at all.
    for (const rate of [undefined, 0, -1, NaN]) {
      const { pnlUsd, pnlPct, pnlSol, valueUsd, valueSol } = getUnrealizedPnl(held, rate)
      expect(pnlSol).toBeNull()
      expect(valueSol).toBeNull()
      expect(pnlUsd).toBeCloseTo(80, 12)
      expect(pnlPct).toBeCloseTo(20, 12)
      expect(valueUsd).toBeCloseTo(480, 12)
    }
  })

  it('returns null pnlSol when the rate argument is omitted entirely', () => {
    // portfolio-stats calls getUnrealizedPnl(p) with one argument for the USD totals.
    const { pnlSol, valueSol, pnlUsd } = getUnrealizedPnl(held)
    expect(pnlSol).toBeNull()
    expect(valueSol).toBeNull()
    expect(pnlUsd).toBeCloseTo(80, 12)
  })

  it('reports 0% rather than NaN or Infinity when avgEntryUsd is zero', () => {
    const degenerate = { qty: 1, avgEntryUsd: 0, solInvested: 0.01, lastPriceUsd: 5 }
    expect(getUnrealizedPnl(degenerate, SOL_USD).pnlPct).toBe(0)
  })

  it('keeps a small position’s loss proportional to what was spent (the -21 SOL regression)', () => {
    // The bug: 0.1 SOL into a $13.40 token, price down 10%, once reported -21 SOL and -95%
    // because it subtracted USD-per-token figures and multiplied by SOL. The honest answer
    // is -0.01 SOL and -10%: 0.1 SOL @ $200/SOL = $20 -> 20/13.4 tokens; at $12.06 those
    // are worth $18 = 0.09 SOL, i.e. 0.01 SOL down on the 0.1 SOL paid.
    const positions = applyBuy(
      {},
      { mint: 'M', symbol: 'MORKO', name: 'Morko', imageUrl: '', solSpent: 0.1, priceUsd: 13.4, solUsdPrice: SOL_USD },
    )
    const position = { ...positions['M'], lastPriceUsd: 12.06 }
    const { pnlSol, pnlPct } = getUnrealizedPnl(position, SOL_USD)

    expect(pnlPct).toBeCloseTo(-10, 9)
    expect(pnlSol).toBeCloseTo(-0.01, 12)
    // A long-only position can never lose more than the SOL that went into it.
    expect(Math.abs(pnlSol)).toBeLessThanOrEqual(position.solInvested)
  })

  it('agrees with applySell: closing at the current price realizes the unrealized SOL PnL', () => {
    // The two functions must not drift apart — what the UI shows as unrealized is exactly
    // what a 100% sell at that price books.
    const positions = applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', solSpent: 2, priceUsd: 10, solUsdPrice: SOL_USD })
    const marked = { ...positions['M'], lastPriceUsd: 17 }
    const { pnlSol, pnlUsd } = getUnrealizedPnl(marked, 250)

    const { realizedPnlSol, realizedPnlUsd } = applySell({ M: marked }, { mint: 'M', fraction: 1, priceUsd: 17, solUsdPrice: 250 })
    expect(realizedPnlSol).toBeCloseTo(pnlSol, 12)
    expect(realizedPnlUsd).toBeCloseTo(pnlUsd, 12)
  })
})
