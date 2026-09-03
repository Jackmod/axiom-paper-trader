import { describe, it, expect, vi, afterEach } from 'vitest'
import { watchRoute } from './route-watcher.js'

const stops = []
const watch = (fn) => {
  const stop = watchRoute(fn)
  stops.push(stop)
  return stop
}

afterEach(() => {
  while (stops.length) stops.pop()()
  window.history.replaceState({}, '', '/')
  vi.useRealTimers()
})

describe('watchRoute', () => {
  it('fires when the SPA navigates via pushState — the case that broke everything', () => {
    const onChange = vi.fn()
    watch(onChange)

    window.history.pushState({}, '', '/meme/TOKEN_A')

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0][0]).toContain('/meme/TOKEN_A')
  })

  it('fires on replaceState too', () => {
    const onChange = vi.fn()
    watch(onChange)

    window.history.replaceState({}, '', '/meme/TOKEN_B')

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does not fire when the URL has not actually changed', () => {
    const onChange = vi.fn()
    watch(onChange)

    window.history.pushState({}, '', window.location.pathname)

    expect(onChange).not.toHaveBeenCalled()
  })

  it('fires once per navigation, not once per listener mechanism', () => {
    const onChange = vi.fn()
    watch(onChange)

    window.history.pushState({}, '', '/meme/TOKEN_C')
    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(onChange).toHaveBeenCalledTimes(1) // popstate sees no further change
  })

  it('catches a route change that fired no event at all, via the polling backstop', async () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    watch(onChange)

    // Simulate a navigation that bypasses both patched methods and popstate.
    const patched = history.pushState
    const unpatched = Object.getPrototypeOf(history).pushState
    history.pushState = unpatched
    history.pushState({}, '', '/meme/SNEAKY')
    history.pushState = patched

    await vi.advanceTimersByTimeAsync(500)

    expect(onChange).toHaveBeenCalled()
  })

  it('restores the original history methods when stopped, leaving the page as it found it', () => {
    const before = history.pushState
    const stop = watchRoute(vi.fn())
    expect(history.pushState).not.toBe(before)

    stop()

    expect(history.pushState).toBe(before)
  })

  it('stops firing after it is stopped', () => {
    const onChange = vi.fn()
    const stop = watchRoute(onChange)
    stop()

    window.history.pushState({}, '', '/meme/AFTER_STOP')

    expect(onChange).not.toHaveBeenCalled()
  })
})
