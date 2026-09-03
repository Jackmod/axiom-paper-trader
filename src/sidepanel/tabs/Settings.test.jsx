import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/preact'
import { Settings } from './Settings.jsx'

beforeEach(() => {
  globalThis.chrome = { runtime: { sendMessage: vi.fn() }, storage: { local: { set: vi.fn() } } }
  vi.stubGlobal(
    'confirm',
    vi.fn(() => true),
  )
})

describe('Settings', () => {
  it('reflects the current paper-mode setting in the checkbox', () => {
    render(<Settings settings={{ paperModeEnabled: true }} />)
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('toggling the checkbox persists the flipped value to storage', () => {
    render(<Settings settings={{ paperModeEnabled: true }} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ settings: { paperModeEnabled: false } })
  })

  it('Top up sends a TOP_UP message with the entered SOL amount', () => {
    render(<Settings settings={{ paperModeEnabled: true }} />)
    fireEvent.input(screen.getByPlaceholderText('SOL amount'), { target: { value: '2.5' } })
    fireEvent.click(screen.getByRole('button', { name: /top up/i }))
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'TOP_UP', payload: { solAmount: 2.5 } },
      expect.any(Function), // response callback — surfaces a rejection back to the user
    )
  })

  it('Withdraw sends a WITHDRAW message with the entered SOL amount', () => {
    render(<Settings settings={{ paperModeEnabled: true }} />)
    fireEvent.input(screen.getByPlaceholderText('SOL amount'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: /withdraw/i }))
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'WITHDRAW', payload: { solAmount: 1 } },
      expect.any(Function),
    )
  })

  it('does nothing on Top up / Withdraw when the amount field is empty', () => {
    render(<Settings settings={{ paperModeEnabled: true }} />)
    fireEvent.click(screen.getByRole('button', { name: /top up/i }))
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('Reset account asks for confirmation and sends RESET_ACCOUNT only when confirmed', () => {
    render(<Settings settings={{ paperModeEnabled: true }} />)
    fireEvent.click(screen.getByRole('button', { name: /reset account/i }))
    expect(confirm).toHaveBeenCalled()
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'RESET_ACCOUNT',
      payload: { startingBalanceSol: 10 },
    })
  })

  it('Reset account sends nothing when the confirmation is declined', () => {
    confirm.mockReturnValue(false)
    render(<Settings settings={{ paperModeEnabled: true }} />)
    fireEvent.click(screen.getByRole('button', { name: /reset account/i }))
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })
})

// The background rejects non-positive amounts and over-withdrawals. These cover the
// user-visible half of that contract: the request is not sent when it can't succeed,
// and a rejection from the background is shown rather than silently swallowed.
describe('Settings — balance change feedback', () => {
  it('refuses a zero amount locally and explains why, instead of a silent no-op', () => {
    render(<Settings settings={{ paperModeEnabled: true }} />)
    fireEvent.input(screen.getByPlaceholderText('SOL amount'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /top up/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/greater than zero/i)
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('refuses a negative amount locally', () => {
    render(<Settings settings={{ paperModeEnabled: true }} />)
    fireEvent.input(screen.getByPlaceholderText('SOL amount'), { target: { value: '-5' } })
    fireEvent.click(screen.getByRole('button', { name: /withdraw/i }))

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it("surfaces the background's rejection reason (e.g. withdrawing more than the balance)", () => {
    chrome.runtime.sendMessage = vi.fn((_msg, cb) => cb({ ok: false, error: 'Cannot withdraw more than the available balance' }))
    render(<Settings settings={{ paperModeEnabled: true }} />)
    fireEvent.input(screen.getByPlaceholderText('SOL amount'), { target: { value: '999' } })
    fireEvent.click(screen.getByRole('button', { name: /withdraw/i }))

    expect(screen.getByRole('alert')).toHaveTextContent(/more than the available balance/i)
  })

  it('clears the input and shows no error when the change succeeds', () => {
    chrome.runtime.sendMessage = vi.fn((_msg, cb) => cb({ ok: true }))
    render(<Settings settings={{ paperModeEnabled: true }} />)
    fireEvent.input(screen.getByPlaceholderText('SOL amount'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /top up/i }))

    expect(screen.getByPlaceholderText('SOL amount')).toHaveValue(null)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
