import { useState } from 'preact/hooks'
import { fetchJupiterPrice, SOL_MINT } from '../../lib/price-sources/jupiter.js'

const SOL_PRESETS = [1, 2, 5, 10]

export function Onboarding({ onComplete }) {
  const [mode, setMode] = useState('sol')
  const [amount, setAmount] = useState('')
  const [converting, setConverting] = useState(false)
  const [error, setError] = useState(null)

  function confirmSol(sol) {
    chrome.runtime.sendMessage({ type: 'RESET_ACCOUNT', payload: { startingBalanceSol: sol } })
    onComplete()
  }

  // USD is converted at the live SOL/USD rate rather than a baked-in guess, so the
  // starting balance means what the user thinks it means. If the rate is unavailable we
  // refuse rather than fund the account at a wrong or zero rate — and we say so, because
  // a Confirm button that silently does nothing is indistinguishable from a broken one.
  async function confirmUsd() {
    const usd = Number(amount)
    if (!amount || Number.isNaN(usd)) return setError('Enter a USD amount.')
    if (usd <= 0) return setError('Amount must be greater than zero.')

    setError(null)
    setConverting(true)
    let solUsdPrice = null
    try {
      solUsdPrice = await fetchJupiterPrice(SOL_MINT)
    } finally {
      setConverting(false)
    }

    if (!solUsdPrice) return setError("Couldn't fetch the live SOL rate. Check your connection and try again.")
    confirmSol(usd / solUsdPrice)
  }

  return (
    <div class="axpt-onboarding">
      <div class="axpt-boot-scan-line" />
      <h2>Set your starting balance</h2>

      <div class="axpt-mode-toggle">
        <button class={mode === 'sol' ? 'axpt-tab-active' : ''} onClick={() => setMode('sol')}>
          SOL
        </button>
        <button class={mode === 'usd' ? 'axpt-tab-active' : ''} onClick={() => setMode('usd')}>
          USD
        </button>
      </div>

      {mode === 'sol' ? (
        <div class="axpt-preset-row">
          {SOL_PRESETS.map((sol) => (
            <button key={sol} class="axpt-preset-btn" onClick={() => confirmSol(sol)}>
              {sol} SOL
            </button>
          ))}
        </div>
      ) : (
        <div class="axpt-balance-form">
          <input
            class="mono"
            type="number"
            placeholder="USD amount"
            value={amount}
            onInput={(e) => setAmount(e.target.value)}
          />
          <button onClick={confirmUsd} disabled={converting}>
            {converting ? 'Converting…' : 'Confirm'}
          </button>
        </div>
      )}

      {error && (
        <p class="axpt-settings-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
