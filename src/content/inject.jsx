// src/content/inject.jsx
//
// The content-script entry point registered in manifest.config.js. It is `.jsx`, not
// the plan's `.js`: Vite 8's oxc transformer refuses JSX inside a `.js` file, so the
// build fails outright with the plan's filename.
import { render } from 'preact'
import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import { Widget } from './widget/Widget.jsx'
import { attachTradeInterception, resolveFillPrice, resolveCurrentPrice } from './trade-interceptor.js'
import { scrapeTradeContext, tradeCandidates } from './dom-scraper.js'
import { buildTradeMessage } from './trade-message.js'
import { checkInterceptionHealth } from './selector-warning.js'
import { watchRoute } from './route-watcher.js'
import { DEFAULT_STATE } from '../lib/storage.js'
import '../ui/tokens.css'
import '../ui/motion.css'

const PAPER_MODE_DEFAULT = DEFAULT_STATE.settings.paperModeEnabled

// Axiom is an SPA: at document_idle the token panel usually isn't in the DOM yet, so
// a single scrape at mount finds nothing and the widget would sit empty until the
// first trade. Retry briefly, then give up — Task 27's health banner is what tells the
// user when the selectors never match at all.
// Spec §9's real-time tier: 7s sits inside the 5-10s window the Side Panel also uses.
export const PRICE_POLL_MS = 7000

const SCRAPE_RETRY_MS = 1000
const SCRAPE_RETRY_LIMIT = 15

function App() {
  // `undefined` = chrome.storage hasn't answered yet. Interception must never arm on a
  // guess: with the plan's `useState(true)` the listener attached before the settings
  // read resolved, and since nothing detached it, paper mode could never actually be
  // off — real Buy clicks stayed swallowed and phantom trades kept being recorded.
  const [paperModeEnabled, setPaperModeEnabled] = useState(undefined)
  const [pageContext, setPageContext] = useState(() => scrapeTradeContext())
  const [position, setPosition] = useState(null)
  // Balance and the SOL/USD rate, so the widget can show what the account is worth and
  // denominate PnL in SOL without doing any of that maths itself.
  const [account, setAccount] = useState({ balanceSol: 0, solUsdPrice: 0 })
  // Set when the user pastes an address because detection missed. Cleared on navigation,
  // so it can never silently follow them onto a different token.
  const [mintOverride, setMintOverride] = useState(null)
  const [pageCandidates, setPageCandidates] = useState(() => tradeCandidates())

  useEffect(() => {
    chrome.storage.local.get(['balanceSol', 'solUsdPrice'], ({ balanceSol, solUsdPrice }) => {
      setAccount({ balanceSol: balanceSol ?? 0, solUsdPrice: solUsdPrice ?? 0 })
    })
    const onAccountChanged = (changes, areaName) => {
      if (areaName !== 'local') return
      if (!changes.balanceSol && !changes.solUsdPrice) return
      setAccount((prev) => ({
        balanceSol: changes.balanceSol ? (changes.balanceSol.newValue ?? 0) : prev.balanceSol,
        solUsdPrice: changes.solUsdPrice ? (changes.solUsdPrice.newValue ?? 0) : prev.solUsdPrice,
      }))
    }
    chrome.storage.onChanged.addListener(onAccountChanged)
    return () => chrome.storage.onChanged.removeListener(onAccountChanged)
  }, [])

  // The confirmed token: candidates go to the background, which asks the price APIs
  // which one is real. Nothing is displayed or traded until the market recognises it.
  const [tokenInfo, setTokenInfo] = useState(null)
  const candidateKey = mintOverride ?? pageCandidates.join(',')

  // Only a market-confirmed address is ever treated as the token. Every previous rule
  // guessed from page structure and each guess had its own false positive — most
  // recently a wallet from the holders table, shown as "Unnamed token".
  const mint = tokenInfo?.mint ?? null

  useEffect(() => {
    setTokenInfo(null)
    const candidates = mintOverride ? [mintOverride] : pageCandidates
    if (candidates.length === 0) return undefined

    let live = true
    chrome.runtime.sendMessage({ type: 'RESOLVE_TOKEN', payload: { candidates } }, (response) => {
      // Reading lastError is required, otherwise a torn-down worker logs an unchecked error.
      if (chrome.runtime.lastError) return
      if (live && response?.ok && response.mint) setTokenInfo(response)
    })
    return () => {
      live = false
    }
  }, [candidateKey])

  // Keep the price live while the user is watching the chart.
  //
  // Without this the widget was frozen: the background only repriced on its 1-minute
  // alarm, and TOKEN_INFO was fetched once when the token changed — so the chart moved
  // and the paper position sat stagnant, showing a PnL that had nothing to do with the
  // market. The Side Panel already polls in the spec's 5-10s window; the on-page widget
  // has exactly the same need, and is in fact where the user is looking.
  useEffect(() => {
    if (!mint) return undefined
    const tick = () => {
      chrome.runtime.sendMessage({ type: 'SYNC_NOW' }, () => void chrome.runtime.lastError)
      chrome.runtime.sendMessage({ type: 'TOKEN_INFO', payload: { mint } }, (response) => {
        if (chrome.runtime.lastError) return
        if (response?.ok) setTokenInfo(response)
      })
    }
    const timer = setInterval(tick, PRICE_POLL_MS)
    return () => clearInterval(timer)
  }, [mint])

  // The click listener is attached once and must always see the *current* position,
  // because a sell is a percentage of what is held. Reading it through a ref keeps it
  // fresh without putting `position` in the effect's deps, which would re-attach on
  // every fill and stack duplicate listeners (one click -> N duplicate BUY messages).
  const positionRef = useRef(null)
  useEffect(() => {
    positionRef.current = position
  }, [position])

  // Paper mode, live: read once and then follow chrome.storage, so flipping the
  // Settings toggle (spec §11) reaches an already-open axiom.trade tab.
  useEffect(() => {
    chrome.storage.local.get(['settings'], ({ settings }) => {
      setPaperModeEnabled(settings?.paperModeEnabled ?? PAPER_MODE_DEFAULT)
    })
    const onSettingsChanged = (changes, areaName) => {
      if (areaName !== 'local' || !changes.settings) return
      setPaperModeEnabled(changes.settings.newValue?.paperModeEnabled ?? PAPER_MODE_DEFAULT)
    }
    chrome.storage.onChanged.addListener(onSettingsChanged)
    return () => chrome.storage.onChanged.removeListener(onSettingsChanged)
  }, [])

  // The open position for THIS token, straight from the background's source of truth.
  // The background service worker is the only writer, so subscribing to storage is how
  // the widget's summary row and PnL update after a fill — and how a sell knows the
  // quantity it is a percentage of.
  useEffect(() => {
    if (!mint) return undefined
    let live = true
    chrome.storage.local.get(['positions'], ({ positions }) => {
      if (live) setPosition(positions?.[mint] ?? null)
    })
    const onPositionsChanged = (changes, areaName) => {
      if (areaName !== 'local' || !changes.positions) return
      setPosition(changes.positions.newValue?.[mint] ?? null)
    }
    chrome.storage.onChanged.addListener(onPositionsChanged)
    return () => {
      live = false
      chrome.storage.onChanged.removeListener(onPositionsChanged)
    }
  }, [mint])

  useEffect(() => {
    if (mint) return undefined
    let attempts = 0
    const timer = setInterval(() => {
      attempts += 1
      const found = tradeCandidates()
      if (found.length) setPageCandidates(found)
      setPageContext(scrapeTradeContext())
      if (found.length || attempts >= SCRAPE_RETRY_LIMIT) clearInterval(timer)
    }, SCRAPE_RETRY_MS)
    return () => clearInterval(timer)
  }, [mint])

  // Follow the user around the SPA. Clicking a token on Pulse, or any chart, swaps the
  // view without reloading the page — so without this the widget reads whatever was on
  // screen at load (usually the feed, with no token at all) and never updates again.
  // That is why it could sit there showing nothing while the user looked at a token.
  useEffect(() => {
    return watchRoute(() => {
      // Clearing first matters: if the new route's panel hasn't rendered yet, showing
      // the PREVIOUS token's position would invite a trade against the wrong coin.
      setPageContext(scrapeTradeContext())
      setPageCandidates(tradeCandidates())
      setPosition(null)
      setMintOverride(null)
    })
  }, [])

  const sendTrade = useCallback((trade) => {
    // Keep the display-only text (spec §6) in step with what was just scraped.
    setPageContext({ mint: trade.mint, marketCapText: trade.marketCapText, rugBadgeText: trade.rugBadgeText })

    const message = buildTradeMessage({ ...trade, solSpent: trade.solSpent ?? trade.qtySol }, positionRef.current)
    if (!message) return // nothing held to sell — see trade-message.js

    chrome.runtime.sendMessage(message, (response) => {
      // The position itself refreshes via the chrome.storage subscription above; this
      // callback exists so a rejected trade or a torn-down service worker is visible in
      // the page console instead of vanishing (chrome.runtime.lastError must be read).
      const error = chrome.runtime.lastError?.message ?? (response?.ok === false ? response.error : null)
      if (error) console.warn('[axiom-paper-trader] trade not recorded:', error)
    })
  }, [])

  // Interception is armed only once paper mode is *known* to be on, and the effect's
  // cleanup detaches it the moment that stops being true.
  useEffect(() => {
    if (paperModeEnabled !== true) return undefined
    return attachTradeInterception(sendTrade)
  }, [paperModeEnabled, sendTrade])

  // The widget's own preset buttons trade through exactly the same path as a hijacked
  // click on Axiom's button: same scrape, same quoted fill price, same BUY/SELL message.
  //
  // The scrape is best-effort, not a gate. It supplies display extras (price, MC), but
  // the mint is whatever the widget is actually showing — including one the user pasted
  // because detection missed. Requiring a successful scrape here would have reinstated
  // exactly the dead-button problem the manual entry exists to solve.
  function tradeContext() {
    if (!mint) return null
    return { ...(scrapeTradeContext() ?? {}), mint }
  }

  async function handleBuyPreset(amountSol) {
    const context = tradeContext()
    if (!context) return
    const priceUsd = await resolveFillPrice(context, amountSol)
    sendTrade({ side: 'buy', ...context, solSpent: amountSol, priceUsd })
  }

  async function handleSellPreset(pct) {
    const context = tradeContext()
    if (!context) return
    // Same authoritative price the buy used — never the page's scraped number, which
    // once matched an unrelated .76 and booked a 120,000x mispriced exit.
    const priceUsd = await resolveCurrentPrice(context)
    if (!(priceUsd > 0)) return
    sendTrade({ side: 'sell', ...context, sellPercent: pct, priceUsd })
  }

  // Paper mode off (or not yet known) means no widget and no interception at all.
  if (!paperModeEnabled) return null

  return (
    <Widget
      position={position}
      mint={mint}
      onMintOverride={setMintOverride}
      tokenName={tokenInfo?.name ?? ''}
      tokenSymbol={tokenInfo?.symbol ?? ''}
      tokenImageUrl={tokenInfo?.imageUrl ?? ''}
      // The API price is authoritative; the page's own number is the fallback for the
      // moment before it arrives.
      priceUsd={tokenInfo?.priceUsd ?? null}
      balanceSol={account.balanceSol}
      solUsdPrice={account.solUsdPrice}
      marketCapUsd={tokenInfo?.marketCapUsd ?? null}
      onBuyPreset={handleBuyPreset}
      onSellPreset={handleSellPreset}
    />
  )
}

// A loud, unmistakable boot marker. Diagnosing "is it even running?" by squinting at a
// screenshot cost several rounds; now the answer is one line in the console and one
// attribute in the DOM. If neither is present, the content script never ran — which
// almost always means dist/ was not rebuilt, since Chrome's Reload button reloads the
// built output, not the source.
const BUILD = chrome.runtime.getManifest().version
console.info(
  `%c[Axiom Paper Trader] v${BUILD} loaded on ${location.pathname}`,
  'background:#22c55e;color:#0a0e14;font-weight:700;padding:2px 6px;border-radius:4px',
)

const mountPoint = document.createElement('div')
mountPoint.id = 'axiom-paper-trader-root'
mountPoint.dataset.axptVersion = BUILD

// Positioned inline, not via the stylesheet, so Axiom's own CSS cannot win against it.
// Without this the widget was a plain block appended to <body>: a full-width banner that
// shoved the entire page down. It has to be a compact floating panel that sits over the
// page like Axiom's own quick-trade menu and takes up no layout space at all.
Object.assign(mountPoint.style, {
  position: 'fixed',
  right: '16px',
  bottom: '16px',
  zIndex: '2147483646', // one below the health banner, which must always win
  width: '320px',
  maxWidth: 'calc(100vw - 32px)',
  colorScheme: 'dark',
})

document.body.appendChild(mountPoint)
render(<App />, mountPoint)

// Spec §13: surface a broken scraper instead of failing silently. Axiom is a SPA, so
// the trading UI may not exist on first paint and the route can change without a
// reload — a single check at startup would false-alarm on a slow render and then miss
// a real break after navigation. Re-checking on an interval covers both, and the check
// clears its own banner as soon as the selectors match again.
export const HEALTH_CHECK_MS = 5000
setTimeout(checkInterceptionHealth, 1000)
setInterval(checkInterceptionHealth, HEALTH_CHECK_MS)
