// src/content/inject.jsx
//
// The content-script entry point registered in manifest.config.js. It is `.jsx`, not
// the plan's `.js`: Vite 8's oxc transformer refuses JSX inside a `.js` file, so the
// build fails outright with the plan's filename.
import { render } from 'preact'
import { useState, useEffect, useRef, useCallback } from 'preact/hooks'
import { Widget } from './widget/Widget.jsx'
import { attachTradeInterception, resolveFillPrice } from './trade-interceptor.js'
import { scrapeTradeContext } from './dom-scraper.js'
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

  const mint = pageContext?.mint ?? null

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
      const scraped = scrapeTradeContext()
      if (scraped) setPageContext(scraped)
      if (scraped || attempts >= SCRAPE_RETRY_LIMIT) clearInterval(timer)
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
      setPosition(null)
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
  async function handleBuyPreset(amountSol) {
    const context = scrapeTradeContext()
    if (!context) return
    const priceUsd = await resolveFillPrice(context, amountSol)
    sendTrade({ side: 'buy', ...context, solSpent: amountSol, priceUsd })
  }

  function handleSellPreset(pct) {
    const context = scrapeTradeContext()
    if (!context) return
    sendTrade({ side: 'sell', ...context, sellPercent: pct, priceUsd: context.priceUsd })
  }

  // Paper mode off (or not yet known) means no widget and no interception at all.
  if (!paperModeEnabled) return null

  return (
    <Widget
      position={position}
      mint={mint}
      priceUsd={pageContext?.priceUsd}
      balanceSol={account.balanceSol}
      solUsdPrice={account.solUsdPrice}
      marketCapText={pageContext?.marketCapText ?? ''}
      onBuyPreset={handleBuyPreset}
      onSellPreset={handleSellPreset}
    />
  )
}

const mountPoint = document.createElement('div')
mountPoint.id = 'axiom-paper-trader-root'

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
