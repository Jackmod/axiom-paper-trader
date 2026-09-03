import { describe, it, expect } from 'vitest'
import { applyBuy, applySell, getUnrealizedPnl } from './position-engine.js'

describe('applyBuy', () => {
  it('creates a new position on first buy', () => {
    const positions = applyBuy(
      {},
      {
        mint: 'MORKOmint',
        symbol: 'MORKO',
        name: 'Morko',
        imageUrl: 'https://x/img.png',
        qtySol: 0.1,
        priceUsd: 13.4,
      },
    )
    expect(positions['MORKOmint']).toEqual({
      symbol: 'MORKO',
      name: 'Morko',
      imageUrl: 'https://x/img.png',
      qty: 0.1,
      avgEntryUsd: 13.4,
      lastPriceUsd: 13.4,
      lastPriceUpdatedAt: expect.any(Number),
      priceSource: null,
      stale: false,
    })
  })

  it('merges a second buy into the SAME position with a weighted-average entry price', () => {
    let positions = applyBuy(
      {},
      {
        mint: 'MORKOmint',
        symbol: 'MORKO',
        name: 'Morko',
        imageUrl: 'https://x/img.png',
        qtySol: 0.1,
        priceUsd: 13.4,
      },
    )
    positions = applyBuy(positions, {
      mint: 'MORKOmint',
      symbol: 'MORKO',
      name: 'Morko',
      imageUrl: 'https://x/img.png',
      qtySol: 0.1,
      priceUsd: 11.2,
    })
    expect(Object.keys(positions)).toEqual(['MORKOmint']) // never a second row for the same mint
    expect(positions['MORKOmint'].qty).toBeCloseTo(0.2)
    expect(positions['MORKOmint'].avgEntryUsd).toBeCloseTo((0.1 * 13.4 + 0.1 * 11.2) / 0.2)
  })

  it('keeps two different mints as two separate positions', () => {
    let positions = applyBuy({}, { mint: 'A', symbol: 'A', name: 'A', imageUrl: '', qtySol: 1, priceUsd: 1 })
    positions = applyBuy(positions, { mint: 'B', symbol: 'B', name: 'B', imageUrl: '', qtySol: 1, priceUsd: 1 })
    expect(Object.keys(positions).sort()).toEqual(['A', 'B'])
  })

  it('correctly recomputes the average across three or more buys, not just two', () => {
    let positions = applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', qtySol: 1, priceUsd: 10 })
    positions = applyBuy(positions, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', qtySol: 1, priceUsd: 20 })
    positions = applyBuy(positions, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', qtySol: 2, priceUsd: 5 })
    // (1*10 + 1*20 + 2*5) / 4 = 10
    expect(positions['M'].qty).toBeCloseTo(4)
    expect(positions['M'].avgEntryUsd).toBeCloseTo(10)
  })

  it('does not mutate the positions object passed in (pure function contract)', () => {
    const before = applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', qtySol: 1, priceUsd: 10 })
    const beforeSnapshot = JSON.parse(JSON.stringify(before))
    applyBuy(before, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', qtySol: 1, priceUsd: 20 })
    expect(before).toEqual(beforeSnapshot)
  })

  it('throws on a non-positive qtySol instead of silently creating a zero/negative position', () => {
    expect(() => applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', qtySol: 0, priceUsd: 10 })).toThrow()
    expect(() => applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', qtySol: -1, priceUsd: 10 })).toThrow()
  })

  it('throws on a non-positive priceUsd instead of corrupting the average with a bad price', () => {
    expect(() => applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', qtySol: 1, priceUsd: 0 })).toThrow()
    expect(() => applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', qtySol: 1, priceUsd: -5 })).toThrow()
  })

  it('handles very small (dust) trade sizes without losing precision to the point of a wrong average', () => {
    let positions = applyBuy(
      {},
      { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', qtySol: 0.000001, priceUsd: 1000000 },
    )
    positions = applyBuy(positions, {
      mint: 'M',
      symbol: 'M',
      name: 'M',
      imageUrl: '',
      qtySol: 0.000001,
      priceUsd: 2000000,
    })
    expect(positions['M'].qty).toBeCloseTo(0.000002, 9)
    expect(positions['M'].avgEntryUsd).toBeCloseTo(1500000, 0)
  })
})

describe('applySell', () => {
  function seedPosition() {
    return applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', qtySol: 1, priceUsd: 10 })
  }

  it('reduces quantity and realizes PnL on the sold portion, keeping avg entry unchanged', () => {
    const positions = seedPosition()
    const { positions: after, realizedPnlUsd } = applySell(positions, { mint: 'M', qtySol: 0.4, priceUsd: 15 })
    expect(after['M'].qty).toBeCloseTo(0.6)
    expect(after['M'].avgEntryUsd).toBeCloseTo(10) // unchanged for the remainder
    expect(realizedPnlUsd).toBeCloseTo((15 - 10) * 0.4)
  })

  it('removes the position once quantity reaches zero', () => {
    const positions = seedPosition()
    const { positions: after } = applySell(positions, { mint: 'M', qtySol: 1, priceUsd: 12 })
    expect(after['M']).toBeUndefined()
  })

  it('throws when selling more than the held quantity', () => {
    const positions = seedPosition()
    expect(() => applySell(positions, { mint: 'M', qtySol: 2, priceUsd: 12 })).toThrow()
  })

  it('throws when selling a mint with no open position at all', () => {
    expect(() => applySell({}, { mint: 'GHOST', qtySol: 1, priceUsd: 12 })).toThrow()
  })

  it('throws on a non-positive qtySol', () => {
    const positions = seedPosition()
    expect(() => applySell(positions, { mint: 'M', qtySol: 0, priceUsd: 12 })).toThrow()
    expect(() => applySell(positions, { mint: 'M', qtySol: -0.1, priceUsd: 12 })).toThrow()
  })

  it('records a negative realizedPnlUsd when selling at a loss', () => {
    const positions = seedPosition() // avgEntry 10
    const { realizedPnlUsd } = applySell(positions, { mint: 'M', qtySol: 0.5, priceUsd: 6 })
    expect(realizedPnlUsd).toBeCloseTo((6 - 10) * 0.5)
    expect(realizedPnlUsd).toBeLessThan(0)
  })

  it('selling the exact held quantity (float remainder near zero) still fully closes the position', () => {
    // 0.1 + 0.2 in floating point is 0.30000000000000004 — this exercises that the close
    // check can't be a naive `remainingQty === 0` without an epsilon if qty was built up
    // from several float-imprecise buys. Seed a position the way real trades would.
    let positions = applyBuy({}, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', qtySol: 0.1, priceUsd: 10 })
    positions = applyBuy(positions, { mint: 'M', symbol: 'M', name: 'M', imageUrl: '', qtySol: 0.2, priceUsd: 10 })
    const { positions: after } = applySell(positions, { mint: 'M', qtySol: positions['M'].qty, priceUsd: 12 })
    expect(after['M']).toBeUndefined()
  })

  it('does not mutate the positions object passed in (pure function contract)', () => {
    const positions = seedPosition()
    const beforeSnapshot = JSON.parse(JSON.stringify(positions))
    applySell(positions, { mint: 'M', qtySol: 0.4, priceUsd: 15 })
    expect(positions).toEqual(beforeSnapshot)
  })
})

describe('getUnrealizedPnl', () => {
  it('computes SOL amount and percent from avg entry vs current price', () => {
    const position = { qty: 2, avgEntryUsd: 10, lastPriceUsd: 12 }
    const { pnlUsd, pnlPct } = getUnrealizedPnl(position)
    expect(pnlUsd).toBeCloseTo((12 - 10) * 2)
    expect(pnlPct).toBeCloseTo(20)
  })

  it('returns a negative pnlUsd and pnlPct when the price is below avg entry', () => {
    const position = { qty: 1, avgEntryUsd: 10, lastPriceUsd: 8 }
    const { pnlUsd, pnlPct } = getUnrealizedPnl(position)
    expect(pnlUsd).toBeCloseTo(-2)
    expect(pnlPct).toBeCloseTo(-20)
  })

  it('returns exactly zero for both when price equals avg entry', () => {
    const position = { qty: 5, avgEntryUsd: 3, lastPriceUsd: 3 }
    const { pnlUsd, pnlPct } = getUnrealizedPnl(position)
    expect(pnlUsd).toBe(0)
    expect(pnlPct).toBe(0)
  })
})
