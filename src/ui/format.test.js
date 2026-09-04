import { describe, it, expect } from 'vitest'
import {
  formatPrice,
  formatTokenAmount,
  formatSol,
  formatPercent,
  formatUsd,
  formatMarketCap,
  pnlClass,
} from './format.js'

describe('formatPrice', () => {
  it('keeps a sub-cent memecoin price legible instead of rounding it to zero', () => {
    // toFixed(4) turns this into "$0.0000" — the price vanishes and every token looks
    // identical. This is the bug this module exists to prevent.
    expect(formatPrice(0.000004521)).toBe('$0.000004521')
    expect(formatPrice(0.000004521)).not.toBe('$0.0000')
  })

  it('does not collapse an extremely small price to zero', () => {
    expect(formatPrice(0.00000000123)).not.toMatch(/^\$0\.?0*$/)
  })

  it('never uses scientific notation, which is unreadable in a price column', () => {
    expect(formatPrice(0.00000000123)).not.toMatch(/e/i)
  })

  it('uses cents for normal prices', () => {
    expect(formatPrice(31.0886)).toBe('$31.09')
    expect(formatPrice(1.37)).toBe('$1.37')
  })

  it('distinguishes two nearby tiny prices rather than showing both as zero', () => {
    expect(formatPrice(0.0000012)).not.toBe(formatPrice(0.0000089))
  })

  it('handles missing and non-finite values without printing NaN', () => {
    expect(formatPrice(null)).toBe('—')
    expect(formatPrice(NaN)).toBe('—')
    expect(formatPrice(undefined)).toBe('—')
  })
})

describe('formatTokenAmount', () => {
  it('abbreviates the large quantities a memecoin buy produces', () => {
    expect(formatTokenAmount(1_234_567)).toBe('1.23M')
    expect(formatTokenAmount(2_500_000_000)).toBe('2.50B')
    expect(formatTokenAmount(45_600)).toBe('45.60K')
  })

  it('keeps small holdings readable', () => {
    expect(formatTokenAmount(12.3456)).toBe('12.35')
    expect(formatTokenAmount(0.00123)).toContain('123')
  })

  it('handles missing values', () => {
    expect(formatTokenAmount(null)).toBe('—')
  })
})

describe('formatSol', () => {
  it('shows more decimals for small amounts, fewer for large', () => {
    expect(formatSol(1.23456)).toBe('1.235')
    expect(formatSol(0.0123)).toBe('0.0123')
    expect(formatSol(0.000123)).toBe('0.000123')
  })

  it('signs a gain when asked, so PnL is unambiguous', () => {
    expect(formatSol(0.5, { signed: true })).toBe('+0.5000')
    expect(formatSol(-0.5, { signed: true })).toBe('-0.5000')
  })

  // Same negative-zero trap as formatUsd: a position opened at the current price is flat
  // to six decimals, and the sign of the underlying dust rendered it as "-0.000000 SOL",
  // which reads as a loss and colours the whole PnL row red for no reason.
  it('never signs an amount that rounds to zero', () => {
    expect(formatSol(-0.0000000052, { signed: true })).toBe('0.000000')
    expect(formatSol(0, { signed: true })).toBe('0.000000')
  })

  it('handles missing values', () => {
    expect(formatSol(undefined)).toBe('—')
  })
})

describe('formatPercent', () => {
  // Completes the negative-zero family (see formatSol and formatUsd): a position sitting
  // at its entry price is flat to two decimals, and taking the sign from the raw value
  // rendered "-0.00%" — a loss of nothing, three times over on the same line.
  it('never signs a percentage that rounds to zero', () => {
    expect(formatPercent(-0.0000001)).toBe('0.00%')
    expect(formatPercent(0)).toBe('0.00%')
  })

  it('always signs, so a gain never reads as a loss', () => {
    expect(formatPercent(12.3456)).toBe('+12.35%')
    expect(formatPercent(-95.6)).toBe('-95.60%')
    expect(formatPercent(0)).toBe('0.00%')
  })

  it('handles missing values', () => {
    expect(formatPercent(null)).toBe('—')
  })
})

describe('formatUsd', () => {
  it('formats totals with an optional sign', () => {
    expect(formatUsd(1234.5)).toBe('$1234.50')
    expect(formatUsd(28, { signed: true })).toBe('+$28.00')
    // The sign belongs outside the currency symbol; '$-4.00' reads as a malformed price.
    expect(formatUsd(-4)).toBe('-$4.00')
  })

  // Cents down to a cent; significant digits below one.
  //
  // Everything above a cent is ordinary money and reads as money — 7 cents is "$0.07",
  // not "$0.0700". Below a cent, significance has to survive, because a tiny position can
  // still be a 50% winner and "$0.00" would report it as having done nothing.
  it('shows cents for ordinary amounts and keeps significance below one', () => {
    expect(formatUsd(12.345)).toBe('$12.35')
    expect(formatUsd(0.07, { signed: true })).toBe('+$0.07')
    expect(formatUsd(0.002)).toBe('$0.00200')
  })

  // ...but there is a floor. A hundredth of a cent is not an amount of money at any scale
  // a person trades — it is quote-rounding dust on a position opened seconds ago — and it
  // used to render as "-$0.00000502": eight characters of noise, carrying a minus sign,
  // in the one place the user looks to see whether they are up.
  it('treats dust below a hundredth of a cent as zero, unsigned', () => {
    expect(formatUsd(-0.00000502, { signed: true })).toBe('$0.00')
    expect(formatUsd(0, { signed: true })).toBe('$0.00')
    expect(formatUsd(-0)).toBe('$0.00')
  })
})

describe('pnlClass', () => {
  // Colour is derived from the TEXT, never from the float behind it. Four surfaces show
  // PnL (widget, popup, side-panel header, position rows) and each used to test the raw
  // number itself, so a position a few millionths of a dollar under water read "$0.00" in
  // green on one surface and "$0.00" in pink on another — at the same instant, for the
  // same position. Taking the sign from the rendered string makes that impossible.
  it('follows the rendered sign, so text and colour cannot disagree', () => {
    expect(pnlClass(formatUsd(-0.00000502, { signed: true }))).toBe('axpt-pnl-positive')
    expect(pnlClass(formatSol(-0.0000000052, { signed: true }))).toBe('axpt-pnl-positive')
    expect(pnlClass('-$4.00')).toBe('axpt-pnl-negative')
    expect(pnlClass('+0.2500 SOL')).toBe('axpt-pnl-positive')
    expect(pnlClass('—')).toBe('axpt-pnl-positive')
  })
})

describe('formatMarketCap', () => {
  it('uses the magnitude suffixes traders read at a glance', () => {
    expect(formatMarketCap(280181522)).toBe('$280.18M')
    expect(formatMarketCap(2376412712)).toBe('$2.38B')
    expect(formatMarketCap(12100)).toBe('$12.1K')
    expect(formatMarketCap(850)).toBe('$850')
  })

  it('reports an unknown cap honestly rather than as $0', () => {
    // A real market cap is never zero, so a 0 means "the source did not know".
    expect(formatMarketCap(0)).toBe('—')
    expect(formatMarketCap(null)).toBe('—')
    expect(formatMarketCap(undefined)).toBe('—')
    expect(formatMarketCap(NaN)).toBe('—')
  })
})
