// src/content/inject.jsx
import { render } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { Widget } from './widget/Widget.jsx'
import { attachTradeInterception } from './trade-interceptor.js'
import '../ui/tokens.css'
import '../ui/motion.css'

function App() {
  const [position, setPosition] = useState(null)
  const [paperModeEnabled, setPaperModeEnabled] = useState(true)

  useEffect(() => {
    chrome.storage.local.get(['settings'], ({ settings }) => {
      setPaperModeEnabled(settings?.paperModeEnabled ?? true)
    })
  }, [])

  useEffect(() => {
    if (!paperModeEnabled) return
    attachTradeInterception(async (trade) => {
      const message =
        trade.side === 'buy'
          ? { type: 'BUY', payload: trade }
          : {
              type: 'SELL',
              payload: {
                mint: trade.mint,
                qtySol: (position?.qty ?? 0) * (trade.sellPercent / 100),
                priceUsd: trade.priceUsd,
                priorityFeeSol: trade.priorityFeeSol,
                slippagePct: trade.slippagePct,
              },
            }
      chrome.runtime.sendMessage(message)
    })
  }, [paperModeEnabled, position])

  function handleBuyPreset(amountSol) {
    // Optimistic feedback only; the interceptor (attached above) reads the real DOM amount at click time.
    // This handler exists for the widget's own preset buttons when the widget itself initiates the trade
    // (as opposed to hijacking Axiom's own button) — both paths funnel through the same BUY message.
  }

  function handleSellPreset(_pct) {}

  return <Widget position={position} onBuyPreset={handleBuyPreset} onSellPreset={handleSellPreset} />
}

const mountPoint = document.createElement('div')
mountPoint.id = 'axiom-paper-trader-root'
document.body.appendChild(mountPoint)
render(<App />, mountPoint)
