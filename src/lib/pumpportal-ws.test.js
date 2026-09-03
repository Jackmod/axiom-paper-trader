import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { subscribeToPumpPortal, closePumpPortal } from './pumpportal-ws.js'

// A fake socket that records what was sent and lets a test push frames back. The module
// is a protocol adapter, so what matters is the frames it sends and how it maps frames it
// receives onto prices — both observable here without touching the live service.
class FakeSocket {
  static instances = []

  constructor(url) {
    this.url = url
    this.readyState = 0 // CONNECTING
    this.sent = []
    this.listeners = {}
    this.closed = false
    FakeSocket.instances.push(this)
  }

  addEventListener(type, fn) {
    ;(this.listeners[type] ||= []).push(fn)
  }

  send(frame) {
    this.sent.push(JSON.parse(frame))
  }

  close() {
    this.closed = true
    this.emit('close', {})
  }

  emit(type, event) {
    for (const fn of [...(this.listeners[type] || [])]) fn(event)
  }

  open() {
    this.readyState = 1 // OPEN
    this.emit('open', {})
  }

  pushFrame(payload) {
    this.emit('message', { data: JSON.stringify(payload) })
  }
}

const TRADE = {
  mint: 'MINT_A',
  vSolInBondingCurve: 30.98,
  vTokensInBondingCurve: 1_038_800_796,
}

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  WebSocket.OPEN = 1
})

afterEach(() => {
  closePumpPortal()
  vi.unstubAllGlobals()
})

describe('subscribeToPumpPortal without an API key', () => {
  it('opens no socket at all — the keyless token-trade stream is rejected by the service', () => {
    const onPrice = vi.fn()
    subscribeToPumpPortal('MINT_A', onPrice)
    expect(FakeSocket.instances).toHaveLength(0)
  })

  it('returns a working no-op unsubscribe rather than throwing', () => {
    const unsubscribe = subscribeToPumpPortal('MINT_A', vi.fn())
    expect(() => unsubscribe()).not.toThrow()
  })

  it('never invokes the price callback, so callers fall back to the REST tier', () => {
    const onPrice = vi.fn()
    subscribeToPumpPortal('MINT_A', onPrice)
    expect(onPrice).not.toHaveBeenCalled()
  })
})

describe('subscribeToPumpPortal with an API key', () => {
  it('connects with the key in the query string and subscribes to that mint', () => {
    subscribeToPumpPortal('MINT_A', vi.fn(), { apiKey: 'k-123' })
    const socket = FakeSocket.instances[0]

    expect(socket.url).toContain('api-key=k-123')
    socket.open()
    expect(socket.sent).toEqual([{ method: 'subscribeTokenTrade', keys: ['MINT_A'] }])
  })

  it('queues the subscribe until the socket is actually open', () => {
    subscribeToPumpPortal('MINT_A', vi.fn(), { apiKey: 'k' })
    const socket = FakeSocket.instances[0]

    expect(socket.sent).toHaveLength(0) // still CONNECTING
    socket.open()
    expect(socket.sent).toHaveLength(1)
  })

  it('derives price from the bonding-curve reserves', () => {
    const onPrice = vi.fn()
    subscribeToPumpPortal('MINT_A', onPrice, { apiKey: 'k' })
    const socket = FakeSocket.instances[0]
    socket.open()
    socket.pushFrame(TRADE)

    expect(onPrice).toHaveBeenCalledWith(TRADE.vSolInBondingCurve / TRADE.vTokensInBondingCurve)
  })

  it('shares ONE connection across multiple tokens instead of a socket per token', () => {
    subscribeToPumpPortal('MINT_A', vi.fn(), { apiKey: 'k' })
    subscribeToPumpPortal('MINT_B', vi.fn(), { apiKey: 'k' })
    FakeSocket.instances[0].open()

    expect(FakeSocket.instances).toHaveLength(1)
    expect(FakeSocket.instances[0].sent).toEqual([
      { method: 'subscribeTokenTrade', keys: ['MINT_A'] },
      { method: 'subscribeTokenTrade', keys: ['MINT_B'] },
    ])
  })

  it('routes each frame only to listeners for that mint', () => {
    const a = vi.fn()
    const b = vi.fn()
    subscribeToPumpPortal('MINT_A', a, { apiKey: 'k' })
    subscribeToPumpPortal('MINT_B', b, { apiKey: 'k' })
    const socket = FakeSocket.instances[0]
    socket.open()
    socket.pushFrame(TRADE) // MINT_A

    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })

  it('ignores the service error frame that a keyless/unfunded key produces', () => {
    const onPrice = vi.fn()
    subscribeToPumpPortal('MINT_A', onPrice, { apiKey: 'k' })
    const socket = FakeSocket.instances[0]
    socket.open()
    socket.pushFrame({
      message: "'subscribeTokenTrade' and 'subscribeAccountTrade' methods are only available when connecting with an API key funded with at least 0.02 SOL.",
    })

    expect(onPrice).not.toHaveBeenCalled()
  })

  it('ignores malformed frames and frames missing reserves rather than emitting NaN', () => {
    const onPrice = vi.fn()
    subscribeToPumpPortal('MINT_A', onPrice, { apiKey: 'k' })
    const socket = FakeSocket.instances[0]
    socket.open()

    socket.emit('message', { data: 'not json' })
    socket.pushFrame({ mint: 'MINT_A' }) // no reserves
    socket.pushFrame({ mint: 'MINT_A', vSolInBondingCurve: 0, vTokensInBondingCurve: 0 })

    expect(onPrice).not.toHaveBeenCalled()
  })
})

describe('unsubscribing', () => {
  it('stops delivering ticks to the unsubscribed listener', () => {
    const onPrice = vi.fn()
    const unsubscribe = subscribeToPumpPortal('MINT_A', onPrice, { apiKey: 'k' })
    const socket = FakeSocket.instances[0]
    socket.open()

    unsubscribe()
    socket.pushFrame(TRADE)

    expect(onPrice).not.toHaveBeenCalled()
  })

  it('keeps the stream alive for a second listener on the same mint', () => {
    const first = vi.fn()
    const second = vi.fn()
    const unsubscribeFirst = subscribeToPumpPortal('MINT_A', first, { apiKey: 'k' })
    subscribeToPumpPortal('MINT_A', second, { apiKey: 'k' })
    const socket = FakeSocket.instances[0]
    socket.open()

    unsubscribeFirst()
    socket.pushFrame(TRADE)

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    expect(socket.closed).toBe(false)
  })

  it('subscribes a mint only once even with several listeners', () => {
    subscribeToPumpPortal('MINT_A', vi.fn(), { apiKey: 'k' })
    subscribeToPumpPortal('MINT_A', vi.fn(), { apiKey: 'k' })
    FakeSocket.instances[0].open()

    expect(FakeSocket.instances[0].sent).toEqual([{ method: 'subscribeTokenTrade', keys: ['MINT_A'] }])
  })

  it('closes the shared socket once the last subscription goes away', () => {
    const unsubscribe = subscribeToPumpPortal('MINT_A', vi.fn(), { apiKey: 'k' })
    const socket = FakeSocket.instances[0]
    socket.open()

    unsubscribe()

    expect(socket.sent).toContainEqual({ method: 'unsubscribeTokenTrade', keys: ['MINT_A'] })
    expect(socket.closed).toBe(true)
  })

  it('opens a fresh socket after a full teardown', () => {
    subscribeToPumpPortal('MINT_A', vi.fn(), { apiKey: 'k' })
    closePumpPortal()
    subscribeToPumpPortal('MINT_A', vi.fn(), { apiKey: 'k' })

    expect(FakeSocket.instances).toHaveLength(2)
  })
})
