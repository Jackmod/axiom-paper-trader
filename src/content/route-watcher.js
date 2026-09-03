// Follow Axiom as the user moves between tokens.
//
// Axiom is a single-page app: clicking a token on Pulse, or any chart, swaps the view
// client-side without ever reloading the page. A content script that reads the token
// once at startup therefore sees whatever was on screen at load — usually the feed, with
// no token at all — and then never notices anything again. That is why the widget could
// sit there showing nothing, or worse, showing a stale token while the user looked at a
// different one.
//
// `history.pushState`/`replaceState` fire no event of their own, so they are wrapped.
// `popstate` covers back/forward, and a slow poll is kept as a backstop for any route
// change that manages to happen without either — cheap insurance against an SPA doing
// something unusual.

const POLL_MS = 400

export function watchRoute(onChange) {
  let current = window.location.href

  const check = () => {
    const next = window.location.href
    if (next === current) return
    current = next
    onChange(next)
  }

  const originalPushState = history.pushState
  const originalReplaceState = history.replaceState

  history.pushState = function patchedPushState(...args) {
    const result = originalPushState.apply(this, args)
    check()
    return result
  }
  history.replaceState = function patchedReplaceState(...args) {
    const result = originalReplaceState.apply(this, args)
    check()
    return result
  }

  window.addEventListener('popstate', check)
  const poll = setInterval(check, POLL_MS)

  return () => {
    history.pushState = originalPushState
    history.replaceState = originalReplaceState
    window.removeEventListener('popstate', check)
    clearInterval(poll)
  }
}
