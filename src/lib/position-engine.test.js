import { describe, it, expect } from 'vitest'
import { applyBuy } from './position-engine.js'

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
