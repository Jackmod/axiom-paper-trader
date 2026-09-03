import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/preact'
import { Onboarding } from './Onboarding.jsx'
import * as jupiter from '../../lib/price-sources/jupiter.js'

beforeEach(() => {
  // Without this, a spy from an earlier test keeps its call history and its stub, so
  // "was never called" assertions read another test's calls as their own.
  vi.restoreAllMocks()
  globalThis.chrome = { runtime: { sendMessage: vi.fn() } }
})

describe('Onboarding', () => {
  it('shows SOL presets by default', () => {
    render(<Onboarding onComplete={() => {}} />)
    for (const sol of [1, 2, 5, 10]) {
      expect(screen.getByRole('button', { name: `${sol} SOL` })).toBeInTheDocument()
    }
  })

  it('clicking a SOL preset sends RESET_ACCOUNT with that exact balance and calls onComplete', async () => {
    const onComplete = vi.fn()
    render(<Onboarding onComplete={onComplete} />)
    fireEvent.click(screen.getByRole('button', { name: '5 SOL' }))
    await waitFor(() =>
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'RESET_ACCOUNT',
        payload: { startingBalanceSol: 5 },
      }),
    )
    expect(onComplete).toHaveBeenCalled()
  })

  it('switching to USD mode shows a USD amount input instead of SOL presets', () => {
    render(<Onboarding onComplete={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'USD' }))
    expect(screen.getByPlaceholderText('USD amount')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '5 SOL' })).not.toBeInTheDocument()
  })

  it('switching back to SOL mode restores the presets', () => {
    render(<Onboarding onComplete={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'USD' }))
    fireEvent.click(screen.getByRole('button', { name: 'SOL' }))
    expect(screen.getByRole('button', { name: '5 SOL' })).toBeInTheDocument()
  })

  it('confirming a USD amount converts it to SOL at the live Jupiter rate before sending RESET_ACCOUNT', async () => {
    vi.spyOn(jupiter, 'fetchJupiterPrice').mockResolvedValue(200) // 1 SOL = $200
    const onComplete = vi.fn()
    render(<Onboarding onComplete={onComplete} />)
    fireEvent.click(screen.getByRole('button', { name: 'USD' }))
    fireEvent.input(screen.getByPlaceholderText('USD amount'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))
    await waitFor(() =>
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'RESET_ACCOUNT',
        payload: { startingBalanceSol: 0.5 },
      }),
    )
    expect(onComplete).toHaveBeenCalled()
  })

  it('asks Jupiter for the SOL mint specifically, not the token being viewed', async () => {
    const spy = vi.spyOn(jupiter, 'fetchJupiterPrice').mockResolvedValue(150)
    render(<Onboarding onComplete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'USD' }))
    fireEvent.input(screen.getByPlaceholderText('USD amount'), { target: { value: '300' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    await waitFor(() => expect(spy).toHaveBeenCalledWith(jupiter.SOL_MINT))
  })

  it('does not send a broken balance when the live rate is unavailable, and says why', async () => {
    vi.spyOn(jupiter, 'fetchJupiterPrice').mockResolvedValue(null)
    render(<Onboarding onComplete={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'USD' }))
    fireEvent.input(screen.getByPlaceholderText('USD amount'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    // A dead rate lookup used to fail silently, leaving a button that just did nothing.
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/rate/i)
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /confirm/i })).not.toBeDisabled()
  })

  it('rejects a zero or negative USD amount without calling out to the network', async () => {
    const spy = vi.spyOn(jupiter, 'fetchJupiterPrice')
    render(<Onboarding onComplete={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'USD' }))
    fireEvent.input(screen.getByPlaceholderText('USD amount'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }))

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(spy).not.toHaveBeenCalled()
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()
  })

  it('disables Confirm while the rate lookup is in flight, so a double-click cannot double-fund', async () => {
    let release
    vi.spyOn(jupiter, 'fetchJupiterPrice').mockReturnValue(new Promise((r) => (release = r)))
    render(<Onboarding onComplete={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'USD' }))
    fireEvent.input(screen.getByPlaceholderText('USD amount'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: /converting|confirm/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /converting/i })).toBeDisabled())

    release(200)
    await waitFor(() => expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1))
  })

  it('renders the boot scan line, the signature intro motion (spec §15)', () => {
    const { container } = render(<Onboarding onComplete={() => {}} />)
    expect(container.querySelector('.axpt-boot-scan-line')).toBeInTheDocument()
  })
})
