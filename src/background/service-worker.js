import { handleMessage } from './message-router.js'
import { getState, setState } from '../lib/storage.js'

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  ;(async () => {
    const state = await getState()
    const { nextState, response } = await handleMessage(message, state)
    await setState(nextState)
    sendResponse(response)
  })()
  return true // keep the message channel open for the async response
})
