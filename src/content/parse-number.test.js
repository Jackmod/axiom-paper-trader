import { describe, it, expect } from 'vitest'
import { parseNumber } from './parse-number.js'

describe('parseNumber', () => {
  it('strips a leading currency symbol', () => {
    expect(parseNumber('$13.4000')).toBeCloseTo(13.4)
  })

  it('strips a trailing percent sign', () => {
    expect(parseNumber('20%')).toBeCloseTo(20)
  })

  it('parses a plain decimal with no symbols', () => {
    expect(parseNumber('0.001')).toBeCloseTo(0.001)
  })

  it('returns null for empty, null, or undefined input instead of NaN', () => {
    expect(parseNumber('')).toBeNull()
    expect(parseNumber(null)).toBeNull()
    expect(parseNumber(undefined)).toBeNull()
  })

  it('returns null for text with no numeric content instead of NaN', () => {
    expect(parseNumber('N/A')).toBeNull()
  })

  it('strips thousands-separator commas', () => {
    expect(parseNumber('$1,234.56')).toBeCloseTo(1234.56)
  })
})
