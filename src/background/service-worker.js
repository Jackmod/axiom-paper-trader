import { handleMessage } from './message-router.js'
import { getState, setState } from '../lib/storage.js'
import { refreshAllPositions } from './refresh.js'
import { resolvePrice } from '../lib/price-resolver.js'
import { fetchJupiterPrice, fetchJupiterTokenInfo, SOL_MINT } from '../lib/price-sources/jupiter.js'
import { fetchTokenMetadata } from '../lib/token-metadata.js'

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  ;(async () => {
    if (message.type === 'SYNC_NOW') {
      const state = await getState()
      await setState(await refreshAllPositions(state, resolvePrice))
      sendResponse({ ok: true })
      return
    }
    // "What am I looking at?" — the content script cannot fetch these APIs itself
    // (a page-origin request is subject to the page's CORS), so identity and price for
    // the token currently on screen are resolved here, before any position exists. This
    // is what lets the widget name the coin the moment it opens rather than only after
    // a trade.
    // Which of these addresses is actually the token?
    //
    // Every previous answer was a guess about page structure — the route, a copy button,
    // an explorer link, how many addresses were present — and each guess had a new class
    // of false positive, most recently a wallet from the holders table shown as "Unnamed
    // token" priced at a number scraped off the page.
    //
    // The price APIs settle it definitively: a wallet address is unknown to them, a real
    // mint comes back with a price. So the content script proposes candidates in priority
    // order and the first one the market recognises wins. A candidate nothing recognises
    // is not a token, however convincing its position on the page.
    if (message.type === 'RESOLVE_TOKEN') {
      const candidates = (message.payload.candidates ?? []).slice(0, 6)
      for (const mint of candidates) {
        const info = await fetchJupiterTokenInfo(mint)
        if (!info?.priceUsd) continue
        const metadata = await fetchTokenMetadata(mint)
        sendResponse({
          ok: true,
          mint,
          priceUsd: info.priceUsd,
          name: metadata?.name ?? '',
          symbol: metadata?.symbol ?? '',
          imageUrl: metadata?.imageUrl ?? '',
          marketCapUsd: metadata?.marketCapUsd ?? null,
        })
        return
      }
      sendResponse({ ok: true, mint: null })
      return
    }

    if (message.type === 'TOKEN_INFO') {
      const { mint } = message.payload
      const [metadata, price] = await Promise.all([fetchTokenMetadata(mint), resolvePrice(mint)])
      sendResponse({
        ok: true,
        // Echo the mint back. This is a refresh of an already-confirmed token and the
        // caller stores the whole response, so omitting the mint meant every poll tick
        // erased the identity it was supposed to be refreshing — detection "dropped"
        // exactly one tick after it succeeded.
        mint,
        name: metadata?.name ?? '',
        symbol: metadata?.symbol ?? '',
        imageUrl: metadata?.imageUrl ?? '',
        marketCapUsd: metadata?.marketCapUsd ?? null,
        priceUsd: price?.priceUsd ?? null,
      })
      return
    }

    // Sell from anywhere — the Side Panel, with no Axiom page in sight.
    //
    // A page-initiated sell carries the price the content script resolved, but the panel
    // has no page and no token context. Rather than let the UI invent a price, the worker
    // resolves the market price itself and then goes through exactly the same SELL path,
    // so a sell closed from the portfolio list is identical to one closed from the chart.
    if (message.type === 'SELL_AT_MARKET') {
      const { mint, fraction } = message.payload
      const price = await resolvePrice(mint)
      if (!price?.priceUsd) {
        sendResponse({ ok: false, error: 'No live price for this token right now — try again in a moment' })
        return
      }
      const priced = { type: 'SELL', payload: { mint, fraction, priceUsd: price.priceUsd } }
      const current = await getState()
      const { nextState, response } = await handleMessage(priced, current)
      await setState(nextState)
      sendResponse(response)
      return
    }

    let state = await getState()

    // Trades convert between SOL and USD, so they need the SOL/USD rate — and on a fresh
    // install nothing has populated it yet, because it is normally written by the refresh
    // loop. Without this, the very first buy after installing was rejected outright and
    // the extension looked like it simply did not work. Fetch it on demand rather than
    // making the user wait for a background tick they cannot see.
    if ((message.type === 'BUY' || message.type === 'SELL') && !(state.solUsdPrice > 0)) {
      const solUsdPrice = await fetchJupiterPrice(SOL_MINT)
      if (solUsdPrice > 0) {
        state = { ...state, solUsdPrice }
        await setState({ solUsdPrice })
      }
    }

    const { nextState, response } = await handleMessage(message, state)
    await setState(nextState)
    sendResponse(response)

    // A brand-new position has no name or icon yet — identity comes from the price APIs,
    // not the page. Resolve it right after the trade instead of leaving the row blank
    // until the next refresh tick, which the user would read as the trade not landing.
    // This runs after sendResponse so the trade still feels instant.
    if (response?.ok && (message.type === 'BUY' || message.type === 'SELL')) {
      const refreshed = await refreshAllPositions(await getState(), resolvePrice)
      await setState(refreshed)
    }
  })()
  return true // keep the message channel open for the async response
})

chrome.runtime.onStartup.addListener(async () => {
  const state = await getState()
  await setState(await refreshAllPositions(state, resolvePrice))
})

const REFRESH_ALARM = 'refresh-positions'

chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 1 })

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== REFRESH_ALARM) return
  const state = await getState()
  const nextState = await refreshAllPositions(state, resolvePrice)
  await setState(nextState)
})
