import { useState } from 'preact/hooks'

export function Settings({ settings }) {
  const [amount, setAmount] = useState('')
  const [error, setError] = useState(null)

  function togglePaperMode() {
    const next = { ...settings, paperModeEnabled: !settings.paperModeEnabled }
    chrome.storage.local.set({ settings: next })
  }

  // The background rejects non-positive amounts and over-withdrawals (balance-actions.js).
  // Without surfacing that, clicking Top up with "0" or withdrawing more than the balance
  // just did nothing at all, with no explanation — a silent no-op the user can't diagnose.
  function submitBalanceChange(type) {
    const solAmount = Number(amount)
    if (!amount || Number.isNaN(solAmount)) return setError('Enter a SOL amount.')
    if (solAmount <= 0) return setError('Amount must be greater than zero.')

    setError(null)
    chrome.runtime.sendMessage({ type, payload: { solAmount } }, (response) => {
      if (response && response.ok === false) setError(response.error || 'That change was rejected.')
      else setAmount('')
    })
  }

  function handleTopUp() {
    submitBalanceChange('TOP_UP')
  }

  function handleWithdraw() {
    submitBalanceChange('WITHDRAW')
  }

  function handleReset() {
    if (!confirm('Reset your paper account? This clears all positions and history.')) return
    chrome.runtime.sendMessage({ type: 'RESET_ACCOUNT', payload: { startingBalanceSol: 10 } })
  }

  return (
    <div class="axpt-settings">
      <label class="axpt-toggle-row">
        <span>Paper mode</span>
        <input type="checkbox" checked={settings?.paperModeEnabled} onChange={togglePaperMode} />
      </label>

      <div class="axpt-balance-form">
        <input
          class="mono"
          type="number"
          placeholder="SOL amount"
          value={amount}
          onInput={(e) => setAmount(e.target.value)}
        />
        <button onClick={handleTopUp}>Top up</button>
        <button onClick={handleWithdraw}>Withdraw</button>
      </div>

      {error && (
        <p class="axpt-settings-error" role="alert">
          {error}
        </p>
      )}

      <button class="axpt-reset-btn" onClick={handleReset}>
        Reset account
      </button>
    </div>
  )
}
