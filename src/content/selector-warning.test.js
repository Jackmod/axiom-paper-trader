import { describe, it, expect, afterEach } from 'vitest'
import { checkInterceptionHealth, dismissInterceptionWarning, WARNING_ID } from './selector-warning.js'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('checkInterceptionHealth', () => {
  it('reports healthy and shows nothing when the buy button is found', () => {
    document.body.innerHTML = '<button data-testid="buy-button">Buy</button>'

    expect(checkInterceptionHealth()).toBe(true)
    expect(document.getElementById(WARNING_ID)).toBeNull()
  })

  it('warns loudly when the selectors no longer match anything', () => {
    document.body.innerHTML = '<div>some redesigned Axiom page</div>'

    expect(checkInterceptionHealth()).toBe(false)
    const banner = document.getElementById(WARNING_ID)
    expect(banner).not.toBeNull()
    // The user must understand that their trades are NOT being recorded — the silent
    // version of this failure is the one that loses someone's practice session.
    expect(banner.textContent).toMatch(/will NOT be recorded/i)
  })

  it('announces the warning to assistive tech', () => {
    document.body.innerHTML = '<div></div>'
    checkInterceptionHealth()

    expect(document.getElementById(WARNING_ID).getAttribute('role')).toBe('alert')
  })

  it('never stacks duplicate banners across repeated checks', () => {
    document.body.innerHTML = '<div></div>'
    checkInterceptionHealth()
    checkInterceptionHealth()
    checkInterceptionHealth()

    expect(document.querySelectorAll(`#${WARNING_ID}`)).toHaveLength(1)
  })

  it('clears an existing warning once interception starts working again', () => {
    document.body.innerHTML = '<div></div>'
    checkInterceptionHealth()
    expect(document.getElementById(WARNING_ID)).not.toBeNull()

    // e.g. Axiom's SPA finished rendering the trading UI after the first check.
    document.body.innerHTML = '<button data-testid="buy-button">Buy</button>'
    expect(checkInterceptionHealth()).toBe(true)
    expect(document.getElementById(WARNING_ID)).toBeNull()
  })

  it('puts the banner at the top of the document so it cannot be scrolled past unseen', () => {
    document.body.innerHTML = '<div id="page">page</div>'
    checkInterceptionHealth()

    expect(document.body.firstElementChild.id).toBe(WARNING_ID)
  })
})

describe('dismissInterceptionWarning', () => {
  it('removes the banner', () => {
    document.body.innerHTML = '<div></div>'
    checkInterceptionHealth()
    dismissInterceptionWarning()

    expect(document.getElementById(WARNING_ID)).toBeNull()
  })

  it('is safe to call when no banner exists', () => {
    expect(() => dismissInterceptionWarning()).not.toThrow()
  })
})
