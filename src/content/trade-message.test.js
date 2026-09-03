import { describe, it, expect } from 'vitest'
import { buildTradeMessage } from './trade-message.js'

const CONTEXT = {
  mint: 'So11111111111111111111111111111111111111112',
  symbol: 'BONK',
  name: 'Bonk Token',
  imageUrl: 'https://img.example/bonk.png',
  priorityFeeSol: 0.001,
  slippagePct: 20,
  marketCapText: '$450K',
  rugBadgeText: 'Safe',
}

const POSITION = { symbol: 'BONK', qty: 2, avgEntryUsd: 0.000004, lastPriceUsd: 0.000005 }

describe('buildTradeMessage — buy', () => {
  it('produces exactly the payload message-router destructures for BUY', () => {
    const message = buildTradeMessage({ side: 'buy', ...CONTEXT, qtySol: 0.25, priceUsd: 0.000005 }, null)

    expect(message).toEqual({
      type: 'BUY',
      payload: {
        mint: CONTEXT.mint,
        symbol: 'BONK',
        name: 'Bonk Token',
        imageUrl: 'https://img.example/bonk.png',
        qtySol: 0.25,
        priceUsd: 0.000005,
        priorityFeeSol: 0.001,
        slippagePct: 20,
      },
    })
  })

  it('does not need an open position (the first buy of a token has none)', () => {
    const message = buildTradeMessage({ side: 'buy', ...CONTEXT, qtySol: 1, priceUsd: 0.00001 }, null)
    expect(message.payload.qtySol).toBe(1)
  })
})

describe('buildTradeMessage — sell', () => {
  it('sells the given percentage OF THE HELD QUANTITY, not 0', () => {
    const message = buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: 25, priceUsd: 0.000005 }, POSITION)

    expect(message).toEqual({
      type: 'SELL',
      payload: {
        mint: CONTEXT.mint,
        qtySol: 0.5,
        priceUsd: 0.000005,
        priorityFeeSol: 0.001,
        slippagePct: 20,
      },
    })
  })

  it('sells the whole position at 100%, so a full close actually closes it', () => {
    const message = buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: 100, priceUsd: 0.000005 }, POSITION)
    expect(message.payload.qtySol).toBe(POSITION.qty)
  })

  it('halves the position at 50%', () => {
    const message = buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: 50, priceUsd: 0.000005 }, POSITION)
    expect(message.payload.qtySol).toBe(1)
  })

  it('sends nothing when no position is open (applySell would throw on qtySol 0)', () => {
    expect(buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: 100, priceUsd: 0.000005 }, null)).toBeNull()
  })

  it('sends nothing when the held quantity is zero', () => {
    expect(
      buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: 100, priceUsd: 0.000005 }, { ...POSITION, qty: 0 }),
    ).toBeNull()
  })

  it('sends nothing for an unreadable or 0% sell button', () => {
    expect(buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: 0, priceUsd: 0.000005 }, POSITION)).toBeNull()
    expect(
      buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: undefined, priceUsd: 0.000005 }, POSITION),
    ).toBeNull()
  })

  it('never asks to sell more than is held, which applySell rejects', () => {
    for (const pct of [25, 50, 100]) {
      const message = buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: pct, priceUsd: 0.000005 }, POSITION)
      expect(message.payload.qtySol).toBeGreaterThan(0)
      expect(message.payload.qtySol).toBeLessThanOrEqual(POSITION.qty)
    }
  })
})
