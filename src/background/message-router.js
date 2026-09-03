import { applyBuy, applySell } from '../lib/position-engine.js'
import { topUp, withdraw, resetAccount } from './balance-actions.js'

export async function handleMessage(message, state) {
  if (message.type === 'BUY') {
    const { mint, symbol, name, imageUrl, qtySol, priceUsd, priorityFeeSol, slippagePct } = message.payload
    try {
      const positions = applyBuy(state.positions, { mint, symbol, name, imageUrl, qtySol, priceUsd })
      const tradeHistory = [
        ...state.tradeHistory,
        {
          id: crypto.randomUUID(),
          mint,
          symbol,
          side: 'buy',
          qtySol,
          priceUsd,
          priorityFeeSol,
          slippagePct,
          timestamp: Date.now(),
        },
      ]
      // Paper trading has no hard balance floor: balance is allowed to go negative rather than
      // silently dropping a trade the user believes went through. §13's stale/error handling is
      // about data integrity, not artificial spending limits.
      const nextState = { ...state, positions, tradeHistory, balanceSol: state.balanceSol - qtySol - priorityFeeSol }
      return { nextState, response: { ok: true } }
    } catch (e) {
      return { nextState: state, response: { ok: false, error: e.message } }
    }
  }

  if (message.type === 'SELL') {
    const { mint, qtySol, priceUsd, priorityFeeSol, slippagePct } = message.payload
    const before = state.positions[mint]

    try {
      // Proceeds in SOL = the quantity sold, revalued at the ratio of current price to avg entry price,
      // applied to the SOL originally spent on that slice (avgEntryUsd is the "cost basis" price).
      const soldFractionOfOriginalSol = before ? qtySol * (priceUsd / before.avgEntryUsd) : 0
      const { positions, realizedPnlUsd } = applySell(state.positions, { mint, qtySol, priceUsd })
      const tradeHistory = [
        ...state.tradeHistory,
        {
          id: crypto.randomUUID(),
          mint,
          symbol: before?.symbol,
          side: 'sell',
          qtySol,
          priceUsd,
          priorityFeeSol,
          slippagePct,
          timestamp: Date.now(),
        },
      ]
      const nextState = {
        ...state,
        positions,
        tradeHistory,
        balanceSol: state.balanceSol + soldFractionOfOriginalSol - priorityFeeSol,
      }
      return { nextState, response: { ok: true, realizedPnlUsd } }
    } catch (e) {
      return { nextState: state, response: { ok: false, error: e.message } }
    }
  }

  if (message.type === 'SYNC_NOW') {
    return { nextState: state, response: { ok: true } } // service-worker.js does the actual refresh; the router just acknowledges
  }

  if (message.type === 'TOP_UP') return { nextState: topUp(state, message.payload.solAmount), response: { ok: true } }

  if (message.type === 'WITHDRAW') {
    try {
      return { nextState: withdraw(state, message.payload.solAmount), response: { ok: true } }
    } catch (e) {
      return { nextState: state, response: { ok: false, error: e.message } }
    }
  }

  if (message.type === 'RESET_ACCOUNT')
    return { nextState: resetAccount(state, message.payload.startingBalanceSol), response: { ok: true } }

  return { nextState: state, response: { ok: false, error: `Unknown message type: ${message.type}` } }
}
