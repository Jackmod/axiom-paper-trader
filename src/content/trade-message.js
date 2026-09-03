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
    return {
      type: 'BUY',
      payload: {
        mint: trade.mint,
        symbol: trade.symbol,
        name: trade.name,
        imageUrl: trade.imageUrl,
        qtySol: trade.qtySol,
        priceUsd: trade.priceUsd,
        priorityFeeSol: trade.priorityFeeSol,
        slippagePct: trade.slippagePct,
      },
    }
  }

  // A sell is a percentage of what is actually held, so it needs the open position.
  // With no position, a zero quantity, or an unreadable percentage there is nothing
  // to sell: return null rather than sending `qtySol: 0`, which `applySell` rejects
  // ("qtySol must be positive") and which the router would swallow as an { ok: false }
  // response the page never surfaces.
  const qtySol = (position?.qty ?? 0) * ((trade.sellPercent ?? 0) / 100)
  if (!(qtySol > 0)) return null

  return {
    type: 'SELL',
    payload: {
      mint: trade.mint,
      qtySol,
      priceUsd: trade.priceUsd,
      priorityFeeSol: trade.priorityFeeSol,
      slippagePct: trade.slippagePct,
    },
  }
}
