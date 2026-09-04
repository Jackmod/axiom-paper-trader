import { applyBuy, applySell } from '../lib/position-engine.js'
import { topUp, withdraw, resetAccount } from './balance-actions.js'

export async function handleMessage(message, state) {
  // Both trade branches need the SOL/USD rate to convert between the currency the user
  // spends (SOL) and the currency tokens are priced in (USD). It is refreshed every tick
  // and carried in state; a trade may pass a fresher one it just fetched.
  const solUsdPrice = Number(message.payload?.solUsdPrice) || state.solUsdPrice

  if (message.type === 'BUY') {
    const { mint, symbol, name, imageUrl, solSpent, priceUsd, priorityFeeSol = 0, slippagePct = 0 } = message.payload
    try {
      if (!(solUsdPrice > 0)) throw new Error('No SOL/USD rate available yet — try again in a moment')

      // The balance is a floor, because risk you cannot run out of is not risk. The whole
      // product is practice at losing real money safely, and an account that can always
      // afford one more trade teaches the opposite lesson.
      //
      // The fee counts: a buy that only fits by ignoring it still overdraws. The epsilon is
      // one lamport, so spending the balance to the last decimal is an all-in rather than
      // an overdraw when floating-point noise lands a hair on the wrong side.
      const cost = solSpent + priorityFeeSol
      if (cost > state.balanceSol + 1e-9) {
        // An empty account is a different problem from a shortfall, and it has a different
        // fix. The balance starts at zero until the user sets one, so "you have 0.0000 SOL"
        // would state the obstacle to a first-run user without telling them where to clear it.
        throw new Error(
          state.balanceSol > 0
            ? `Not enough paper SOL — that costs ${cost.toFixed(4)} SOL and you have ${state.balanceSol.toFixed(4)} SOL`
            : 'Your paper account is empty — open the side panel to set a starting balance',
        )
      }

      const positions = applyBuy(state.positions, { mint, symbol, name, imageUrl, solSpent, priceUsd, solUsdPrice })
      const tokensBought = positions[mint].qty - (state.positions[mint]?.qty ?? 0)

      const tradeHistory = [
        ...state.tradeHistory,
        {
          id: crypto.randomUUID(),
          mint,
          symbol,
          side: 'buy',
          solAmount: solSpent,
          tokenAmount: tokensBought,
          priceUsd,
          solUsdPrice,
          priorityFeeSol,
          slippagePct,
          timestamp: Date.now(),
        },
      ]
      const nextState = { ...state, positions, tradeHistory, balanceSol: state.balanceSol - solSpent - priorityFeeSol }
      return { nextState, response: { ok: true, tokensBought } }
    } catch (e) {
      return { nextState: state, response: { ok: false, error: e.message } }
    }
  }

  if (message.type === 'SELL') {
    // Sells are expressed as a FRACTION of the holding (Axiom's 25/50/100% presets), not
    // an absolute quantity — the user picks a proportion, and the engine owns the token math.
    const { mint, fraction, priceUsd, priorityFeeSol = 0, slippagePct = 0 } = message.payload
    const before = state.positions[mint]

    try {
      if (!(solUsdPrice > 0)) throw new Error('No SOL/USD rate available yet — try again in a moment')

      const { positions, proceedsSol, realizedPnlSol, realizedPnlUsd, soldTokens } = applySell(state.positions, {
        mint,
        fraction,
        priceUsd,
        solUsdPrice,
      })
      const tradeHistory = [
        ...state.tradeHistory,
        {
          id: crypto.randomUUID(),
          mint,
          symbol: before?.symbol,
          side: 'sell',
          solAmount: proceedsSol,
          tokenAmount: soldTokens,
          fraction,
          priceUsd,
          solUsdPrice,
          realizedPnlSol,
          priorityFeeSol,
          slippagePct,
          timestamp: Date.now(),
        },
      ]
      const nextState = {
        ...state,
        positions,
        tradeHistory,
        balanceSol: state.balanceSol + proceedsSol - priorityFeeSol,
      }
      return { nextState, response: { ok: true, realizedPnlSol, realizedPnlUsd } }
    } catch (e) {
      return { nextState: state, response: { ok: false, error: e.message } }
    }
  }

  if (message.type === 'SYNC_NOW') {
    return { nextState: state, response: { ok: true } } // service-worker.js does the actual refresh; the router just acknowledges
  }

  // All three balance actions can throw on invalid input, and every one of them must come back as an
  // { ok: false } response like BUY/SELL do: service-worker.js calls handleMessage from an async IIFE
  // with no catch, so an escaping throw leaves sendResponse uncalled and hangs the caller's channel.
  if (message.type === 'TOP_UP') {
    try {
      return { nextState: topUp(state, message.payload.solAmount), response: { ok: true } }
    } catch (e) {
      return { nextState: state, response: { ok: false, error: e.message } }
    }
  }

  if (message.type === 'WITHDRAW') {
    try {
      return { nextState: withdraw(state, message.payload.solAmount), response: { ok: true } }
    } catch (e) {
      return { nextState: state, response: { ok: false, error: e.message } }
    }
  }

  if (message.type === 'RESET_ACCOUNT') {
    try {
      return { nextState: resetAccount(state, message.payload.startingBalanceSol), response: { ok: true } }
    } catch (e) {
      return { nextState: state, response: { ok: false, error: e.message } }
    }
  }

  return { nextState: state, response: { ok: false, error: `Unknown message type: ${message.type}` } }
}
