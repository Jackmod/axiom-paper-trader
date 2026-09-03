import { handleMessage } from './message-router.js'
import { getState, setState } from '../lib/storage.js'
import { refreshAllPositions } from './refresh.js'
import { resolvePrice } from '../lib/price-resolver.js'

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  ;(async () => {
    if (message.type === 'SYNC_NOW') {
      const state = await getState()
      await setState(await refreshAllPositions(state, resolvePrice))
      sendResponse({ ok: true })
      return
    }
    const state = await getState()
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
