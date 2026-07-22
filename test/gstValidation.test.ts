import { describe, it, expect } from 'vitest'
import {
  validateGSTIN,
  formatGSTIN,
  getStateFromGSTIN,
  looksLikeGSTIN
} from '../src/utils/gstValidation'

// Check digits below were computed with the module's own checksum algorithm.
const VALID_MAHARASHTRA = '27AABCU9603R1ZN'
const VALID_DELHI = '07AAPFU0939F1ZX'

describe('validateGSTIN', () => {
  it('accepts a well-formed GSTIN and extracts state + PAN', () => {
    const result = validateGSTIN(VALID_MAHARASHTRA)
    expect(result.valid).toBe(true)
    expect(result.stateCode).toBe('27')
    expect(result.stateName).toBe('Maharashtra')
    expect(result.panNumber).toBe('AABCU9603R')
  })

  it('accepts a second valid GSTIN from a different state', () => {
    const result = validateGSTIN(VALID_DELHI)
    expect(result.valid).toBe(true)
    expect(result.stateName).toBe('Delhi')
  })

  it('normalizes case and interior whitespace before validating', () => {
    expect(validateGSTIN('27aabcu9603r1zn').valid).toBe(true)
    expect(validateGSTIN('27 AABCU 9603 R1ZN').valid).toBe(true)
  })

  it('rejects an empty or whitespace-only value', () => {
    expect(validateGSTIN('')).toEqual({ valid: false, error: 'GSTIN is required' })
    expect(validateGSTIN('   ').valid).toBe(false)
  })

  it('rejects a GSTIN of the wrong length', () => {
    const result = validateGSTIN('27AABCU9603R1Z') // 14 chars
    expect(result.valid).toBe(false)
    expect(result.error).toContain('exactly 15 characters')
  })

  it('rejects a value that does not match the GSTIN format', () => {
    // digit in the PAN letter block (positions 3-7 must be letters)
    const result = validateGSTIN('27AABC09603R1ZN')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Invalid GSTIN format')
  })

  it('rejects an unknown state code before checking the checksum', () => {
    const result = validateGSTIN('99AABCU9603R1ZN')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('Invalid state code')
  })

  it('rejects a GSTIN whose checksum character is wrong', () => {
    // valid format + state, but last char should be N, not M
    const result = validateGSTIN('27AABCU9603R1ZM')
    expect(result.valid).toBe(false)
    expect(result.error).toContain('checksum')
  })
})

describe('formatGSTIN', () => {
  it('groups a valid GSTIN into readable segments', () => {
    expect(formatGSTIN(VALID_MAHARASHTRA)).toBe('27 AABCU 9603 R 1 Z N')
  })

  it('returns the original string when length is not 15', () => {
    expect(formatGSTIN('27AABCU')).toBe('27AABCU')
  })
})

describe('getStateFromGSTIN', () => {
  it('returns state code and name for a valid GSTIN', () => {
    expect(getStateFromGSTIN(VALID_MAHARASHTRA)).toEqual({ code: '27', name: 'Maharashtra' })
  })

  it('returns null for an invalid GSTIN', () => {
    expect(getStateFromGSTIN('99AABCU9603R1ZN')).toBeNull()
  })
})

describe('looksLikeGSTIN', () => {
  it('accepts anything shaped like a GSTIN (loose check)', () => {
    expect(looksLikeGSTIN(VALID_MAHARASHTRA)).toBe(true)
    expect(looksLikeGSTIN('27aabcu9603r1zn')).toBe(true)
  })

  it('rejects empty, short or wrongly-shaped values', () => {
    expect(looksLikeGSTIN('')).toBe(false)
    expect(looksLikeGSTIN('27AABCU')).toBe(false)
    expect(looksLikeGSTIN('2AABCU9603R1ZNXX')).toBe(false)
  })
})
