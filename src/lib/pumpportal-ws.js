// Real-time bonding-curve price ticks from pumpportal.fun.
//
// PROTOCOL CHECK (Task 16 Step 1, performed against the live service):
// `subscribeTokenTrade` is NOT available on a keyless connection. The live endpoint
// answers a keyless subscribe with:
//   "'subscribeTokenTrade' and 'subscribeAccountTrade' methods are only available
//    when connecting with an API key funded with at least 0.02 SOL."
// Only `subscribeNewToken` / `subscribeMigration` are free; token-trade streams are
// metered at ~0.01 SOL per 10,000 events.
//
// That collides head-on with this project's first Global Constraint — zero real
// transactions, no wallet connection anywhere — and with the product's whole point:
// demanding 0.02 SOL of real funding to practise paper trading is self-defeating.
//
// RESOLUTION: this tier is OPT-IN and inert by default. With no API key it opens no
// socket and returns a no-op, and bonding-curve tokens are priced by the pump.fun REST
// tier in price-resolver.js exactly as they already are. Spec §9 only ever claimed the
// websocket as a "while watching" enhancement, never a background guarantee, so nothing
// in the product's promised behaviour depends on it. If a user chooses to supply their
// own funded key, the fast path switches on for them alone — the extension itself never
// holds or connects a wallet.
//
// Per the live docs, a single connection is shared across all subscriptions rather than
// one socket per token ("You should NOT open a new Websocket connection for every token").

const ENDPOINT = 'wss://pumpportal.fun/api/data'

let socket = null
const subscribers = new Map() // mint -> Set<onPrice>

// Bonding-curve price = SOL reserve / token reserve. Field names verified against live
// free-tier frames, which carry mint, vSolInBondingCurve, vTokensInBondingCurve.
function priceFromTrade(data) {
  const sol = data.vSolInBondingCurve
  const tokens = data.vTokensInBondingCurve
  if (!sol || !tokens) return null
  return sol / tokens
}

function handleMessage(event) {
  let data
  try {
    data = JSON.parse(event.data)
  } catch {
    return // service errors and non-JSON frames are not price ticks
  }
  const listeners = subscribers.get(data.mint)
  if (!listeners) return // includes the keyless rejection frame, which carries no mint
  const price = priceFromTrade(data)
  if (price === null) return
  for (const onPrice of listeners) onPrice(price)
}

function send(payload) {
  if (!socket) return
  const frame = JSON.stringify(payload)
  if (socket.readyState === WebSocket.OPEN) socket.send(frame)
  else socket.addEventListener('open', () => socket && socket.send(frame), { once: true })
}

/**
 * Subscribe to live price ticks for one bonding-curve token.
 * Without `apiKey` this is a deliberate no-op — see the protocol note above.
 * Returns an unsubscribe function.
 */
export function subscribeToPumpPortal(mint, onPrice, { apiKey } = {}) {
  if (!apiKey) return () => {}

  if (!socket) {
    socket = new WebSocket(`${ENDPOINT}?api-key=${encodeURIComponent(apiKey)}`)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('close', () => {
      socket = null
    })
  }

  if (!subscribers.has(mint)) {
    subscribers.set(mint, new Set())
    send({ method: 'subscribeTokenTrade', keys: [mint] })
  }
  subscribers.get(mint).add(onPrice)

  return () => {
    const listeners = subscribers.get(mint)
    if (!listeners) return
    listeners.delete(onPrice)
    if (listeners.size > 0) return

    subscribers.delete(mint)
    send({ method: 'unsubscribeTokenTrade', keys: [mint] })
    if (subscribers.size === 0) closePumpPortal()
  }
}

/** Tear the shared connection down — used when the Side Panel closes, and by tests. */
export function closePumpPortal() {
  if (!socket) return
  const closing = socket
  socket = null
  subscribers.clear()
  closing.close()
}
