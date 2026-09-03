import { describe, it, expect } from 'vitest'
import { buildTradeMessage } from './trade-message.js'

// The scraped page context that rides along with every intercepted click. It deliberately
// carries more than either payload needs (market cap, rug badge) so the tests can prove the
// builder sends the router exactly the fields it destructures and nothing else.
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

// qty is TOKENS and avgEntryUsd is USD PER TOKEN — the units the engine now stores. The
// builder only ever asks "is anything held?", so the token count here is deliberately huge
// and memecoin-shaped: nothing in a SELL payload may scale with it.
const POSITION = {
  symbol: 'BONK',
  qty: 12_500_000,
  avgEntryUsd: 0.000004,
  solInvested: 0.25,
  lastPriceUsd: 0.000005,
}

describe('buildTradeMessage — buy', () => {
  it('produces exactly the payload message-router destructures for BUY', () => {
    const message = buildTradeMessage({ side: 'buy', ...CONTEXT, solSpent: 0.25, priceUsd: 0.000005 }, null)

    // A buy is denominated in the SOL the user parts with; the router turns that into a
    // token quantity itself, so no token maths may appear here.
    expect(message).toEqual({
      type: 'BUY',
      payload: {
        mint: CONTEXT.mint,
        symbol: 'BONK',
        name: 'Bonk Token',
        imageUrl: 'https://img.example/bonk.png',
        solSpent: 0.25,
        priceUsd: 0.000005,
        priorityFeeSol: 0.001,
        slippagePct: 20,
      },
    })
  })

  it('does not need an open position (the first buy of a token has none)', () => {
    const message = buildTradeMessage({ side: 'buy', ...CONTEXT, solSpent: 1, priceUsd: 0.00001 }, null)
    expect(message.payload.solSpent).toBe(1)
  })

  it('adding to a position still sends only the new SOL, never the running total', () => {
    // POSITION already cost 0.25 SOL. A second 0.4 SOL buy must send 0.4 — the engine
    // accumulates solInvested, and double-counting here would corrupt every later PnL.
    const message = buildTradeMessage({ side: 'buy', ...CONTEXT, solSpent: 0.4, priceUsd: 0.000006 }, POSITION)
    expect(message.payload.solSpent).toBe(0.4)
  })

  it('passes a sub-cent price through at full precision, never rounded toward zero', () => {
    // Memecoin prices live several decimals below a cent. Any rounding on the way to the
    // router lands as a wrong entry price forever — $0.0000 would divide the position size
    // by infinity. The exact double must survive the trip.
    const priceUsd = 0.000004521
    const message = buildTradeMessage({ side: 'buy', ...CONTEXT, solSpent: 0.25, priceUsd }, null)

    expect(message.payload.priceUsd).toBe(0.000004521)
    expect(message.payload.priceUsd).toBeGreaterThan(0)
  })

  it('sends nothing when the SOL amount is missing, zero or negative', () => {
    // applyBuy throws on a non-positive solSpent, and a throw in the background surfaces to
    // the page as nothing at all. Refusing here keeps the failure visible in the widget.
    for (const solSpent of [undefined, null, 0, -0.5, NaN]) {
      expect(buildTradeMessage({ side: 'buy', ...CONTEXT, solSpent, priceUsd: 0.000005 }, null)).toBeNull()
    }
  })

  it('sends nothing when the fill price is missing, zero or negative', () => {
    // A zero price would divide by zero when converting SOL to tokens.
    for (const priceUsd of [undefined, null, 0, -0.000005, NaN]) {
      expect(buildTradeMessage({ side: 'buy', ...CONTEXT, solSpent: 0.25, priceUsd }, null)).toBeNull()
    }
  })

  it('defaults a missing priority fee and slippage to 0 rather than sending undefined', () => {
    // The router subtracts priorityFeeSol from the balance; an undefined would turn the
    // whole paper balance into NaN.
    const message = buildTradeMessage(
      { side: 'buy', mint: CONTEXT.mint, symbol: 'BONK', name: 'Bonk Token', imageUrl: '', solSpent: 0.25, priceUsd: 0.000005 },
      null,
    )

    expect(message.payload.priorityFeeSol).toBe(0)
    expect(message.payload.slippagePct).toBe(0)
  })

  it('keeps an explicit zero fee and zero slippage instead of treating them as missing', () => {
    const message = buildTradeMessage(
      { side: 'buy', ...CONTEXT, solSpent: 0.25, priceUsd: 0.000005, priorityFeeSol: 0, slippagePct: 0 },
      null,
    )

    expect(message.payload.priorityFeeSol).toBe(0)
    expect(message.payload.slippagePct).toBe(0)
  })
})

describe('buildTradeMessage — sell', () => {
  it('produces exactly the payload message-router destructures for SELL', () => {
    const message = buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: 25, priceUsd: 0.000005 }, POSITION)

    // A sell is a FRACTION of what is held — the engine owns the token maths — so the
    // payload carries no quantity at all, and none of the scraped display text.
    expect(message).toEqual({
      type: 'SELL',
      payload: {
        mint: CONTEXT.mint,
        fraction: 0.25,
        priceUsd: 0.000005,
        priorityFeeSol: 0.001,
        slippagePct: 20,
      },
    })
  })

  it('sells the whole position at 100%, so a full close actually closes it', () => {
    const message = buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: 100, priceUsd: 0.000005 }, POSITION)
    expect(message.payload.fraction).toBe(1)
  })

  it('halves the position at 50%', () => {
    const message = buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: 50, priceUsd: 0.000005 }, POSITION)
    expect(message.payload.fraction).toBe(0.5)
  })

  it('sends the same fraction whatever the position size — it is a share, not an amount', () => {
    // This is the units bug in miniature: the old payload carried an absolute quantity
    // derived from the position, which is how SOL and tokens got mixed. 25% of a dust bag
    // and 25% of a billion-token bag are both the number 0.25.
    const tiny = buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: 25, priceUsd: 0.000005 }, { ...POSITION, qty: 0.004 })
    const huge = buildTradeMessage(
      { side: 'sell', ...CONTEXT, sellPercent: 25, priceUsd: 0.000005 },
      { ...POSITION, qty: 3_200_000_000 },
    )

    expect(tiny.payload.fraction).toBe(0.25)
    expect(huge.payload.fraction).toBe(0.25)
  })

  it('clamps above 100% to a whole position, which is the most applySell accepts', () => {
    // applySell rejects any fraction greater than 1 outright, so a misread "150%" must
    // become a full close rather than an error the page never surfaces.
    for (const pct of [101, 150, 1000]) {
      const message = buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: pct, priceUsd: 0.000005 }, POSITION)
      expect(message.payload.fraction).toBe(1)
    }
  })

  it('sends nothing when no position is open (applySell throws on an unknown mint)', () => {
    expect(buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: 100, priceUsd: 0.000005 }, null)).toBeNull()
    expect(buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: 100, priceUsd: 0.000005 }, undefined)).toBeNull()
  })

  it('sends nothing when the held token quantity is zero', () => {
    expect(
      buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: 100, priceUsd: 0.000005 }, { ...POSITION, qty: 0 }),
    ).toBeNull()
  })

  it('sends nothing for an unreadable or 0% sell button', () => {
    // Never a silent 0% sell: better no message than one the router turns into an
    // { ok: false } the page has no way to show.
    expect(buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: 0, priceUsd: 0.000005 }, POSITION)).toBeNull()
    expect(
      buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: undefined, priceUsd: 0.000005 }, POSITION),
    ).toBeNull()
    expect(buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: null, priceUsd: 0.000005 }, POSITION)).toBeNull()
    expect(buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: NaN, priceUsd: 0.000005 }, POSITION)).toBeNull()
    expect(buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: -25, priceUsd: 0.000005 }, POSITION)).toBeNull()
  })

  it('sends nothing without a usable exit price', () => {
    // Proceeds are priced in USD per token; a zero or missing price would realise the whole
    // position as a total loss.
    for (const priceUsd of [undefined, null, 0, -0.000005, NaN]) {
      expect(buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: 50, priceUsd }, POSITION)).toBeNull()
    }
  })

  it('never asks to sell more than is held, which applySell rejects', () => {
    for (const pct of [1, 25, 50, 100]) {
      const message = buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: pct, priceUsd: 0.000005 }, POSITION)
      expect(message.payload.fraction).toBeGreaterThan(0)
      expect(message.payload.fraction).toBeLessThanOrEqual(1)
    }
  })

  it('defaults a missing priority fee and slippage to 0 rather than sending undefined', () => {
    const message = buildTradeMessage(
      { side: 'sell', mint: CONTEXT.mint, sellPercent: 50, priceUsd: 0.000005 },
      POSITION,
    )

    expect(message.payload.priorityFeeSol).toBe(0)
    expect(message.payload.slippagePct).toBe(0)
  })

  it('passes a sub-cent exit price through at full precision', () => {
    const message = buildTradeMessage({ side: 'sell', ...CONTEXT, sellPercent: 50, priceUsd: 0.000004521 }, POSITION)
    expect(message.payload.fraction).toBe(0.5)
    expect(message.payload.priceUsd).toBe(0.000004521)
  })
})
