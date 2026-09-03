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
