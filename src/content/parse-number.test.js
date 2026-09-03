import { describe, it, expect } from 'vitest'
import { parseNumber } from './parse-number.js'

describe('parseNumber', () => {
  it('strips a leading currency symbol', () => {
    expect(parseNumber('$13.4000')).toBe(13.4)
  })

  it('strips a trailing percent sign', () => {
    expect(parseNumber('20%')).toBe(20)
  })

  it('parses a plain decimal with no symbols', () => {
    expect(parseNumber('0.001')).toBe(0.001)
  })

  it('parses a sub-cent memecoin price without losing precision', () => {
    // Axiom renders memecoin prices well below one cent; toBeCloseTo's default
    // precision of 2 cannot tell 0.000004521 from null/0, so pin it exactly.
    const parsed = parseNumber('$0.000004521')
    expect(typeof parsed).toBe('number')
    expect(parsed).toBe(0.000004521)
  })

  it('returns null for empty, null, or undefined input instead of NaN', () => {
    expect(parseNumber('')).toBeNull()
    expect(parseNumber(null)).toBeNull()
    expect(parseNumber(undefined)).toBeNull()
  })

  it('returns null for text with no numeric content instead of NaN', () => {
    expect(parseNumber('N/A')).toBeNull()
  })

  it('returns null for punctuation that leaves only a bare dot', () => {
    expect(parseNumber('.')).toBeNull()
    expect(parseNumber('...')).toBeNull()
    expect(parseNumber('--.--')).toBeNull()
  })

  it('returns null rather than NaN when stripping leaves multiple decimal points', () => {
    // A cell holding price + change ("$0.004521 -2.31%") strips down to
    // "0.004521.2.31", which Number() turns into NaN. NaN must never escape:
    // it survives the `?? 0` guards downstream and poisons cost basis / PnL.
    expect(parseNumber('1.2.3')).toBeNull()
    expect(parseNumber('$0.004521 -2.31%')).toBeNull()
  })

  it('strips thousands-separator commas', () => {
    expect(parseNumber('$1,234.56')).toBe(1234.56)
  })
})
