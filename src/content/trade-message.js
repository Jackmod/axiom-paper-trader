// src/content/trade-message.js
//
// The one piece of genuinely pure logic in the content-script entry point: turning
// an intercepted (or widget-initiated) trade plus the currently open position into
// the exact message shape `background/message-router.js` destructures.
//
// It lives in its own module rather than inline in `inject.jsx` so it can be unit
// tested — importing `inject.jsx` mounts the widget into the document as an import
// side effect, so nothing there is testable in isolation.

export function buildTradeMessage(trade, position) {
  if (trade.side === 'buy') {
    // `solSpent` is what the user actually parts with. The background converts it to a
    // token quantity using the fill price and the SOL/USD rate — the content script does
    // no position maths of its own, so there is exactly one place that can get it wrong.
    if (!(trade.solSpent > 0) || !(trade.priceUsd > 0)) return null

    return {
      type: 'BUY',
      payload: {
        mint: trade.mint,
        symbol: trade.symbol,
        name: trade.name,
        imageUrl: trade.imageUrl,
        solSpent: trade.solSpent,
        priceUsd: trade.priceUsd,
        priorityFeeSol: trade.priorityFeeSol ?? 0,
        slippagePct: trade.slippagePct ?? 0,
      },
    }
  }

  // A sell is a FRACTION of what is actually held — Axiom's 25/50/100% presets — so the
  // engine owns the token maths. With no position, nothing held, or an unreadable
  // percentage there is nothing to sell: return null rather than sending a zero the
  // router would reject into an { ok: false } the page never surfaces.
  const fraction = (trade.sellPercent ?? 0) / 100
  if (!(fraction > 0) || !((position?.qty ?? 0) > 0) || !(trade.priceUsd > 0)) return null

  return {
    type: 'SELL',
    payload: {
      mint: trade.mint,
      fraction: Math.min(fraction, 1),
      priceUsd: trade.priceUsd,
      priorityFeeSol: trade.priorityFeeSol ?? 0,
      slippagePct: trade.slippagePct ?? 0,
    },
  }
}
