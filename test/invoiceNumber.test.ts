import { describe, it, expect } from 'vitest'
import {
  normalizeInvoiceNumber,
  getFiscalYear,
  determineSupplyType
} from '../electron/main/handlers/salesLogic'

describe('normalizeInvoiceNumber', () => {
  it('zero-pads a single-digit trailing segment to two digits', () => {
    expect(normalizeInvoiceNumber('NS/SL/26-27/6')).toBe('NS/SL/26-27/06')
  })

  it('leaves an already two-digit trailing segment unchanged', () => {
    expect(normalizeInvoiceNumber('NS/SL/26-27/06')).toBe('NS/SL/26-27/06')
  })

  it('does not truncate segments longer than two digits', () => {
    expect(normalizeInvoiceNumber('NS/SL/26-27/123')).toBe('NS/SL/26-27/123')
  })

  it('trims surrounding whitespace before normalizing', () => {
    expect(normalizeInvoiceNumber('  NS/SL/26-27/6  ')).toBe('NS/SL/26-27/06')
  })

  it('strips a leading zero from a padded value (parseInt canonicalizes)', () => {
    expect(normalizeInvoiceNumber('NS/SL/26-27/007')).toBe('NS/SL/26-27/07')
  })

  it('normalizes a bare number with no separators', () => {
    expect(normalizeInvoiceNumber('7')).toBe('07')
  })

  it('leaves a non-numeric trailing segment untouched', () => {
    expect(normalizeInvoiceNumber('NS/SL/26-27/DRAFT')).toBe('NS/SL/26-27/DRAFT')
  })

  it('only normalizes the last segment, not the fiscal-year segment', () => {
    expect(normalizeInvoiceNumber('NS/SL/6-7/9')).toBe('NS/SL/6-7/09')
  })

  // Duplicate-detection relies on normalization collapsing "/6" and "/06" to the
  // same canonical key, so both resolve to a single stored invoice number.
  it('produces identical keys for equivalent unpadded/padded numbers', () => {
    expect(normalizeInvoiceNumber('NS/SL/26-27/6')).toBe(
      normalizeInvoiceNumber('NS/SL/26-27/06')
    )
  })
})

describe('getFiscalYear', () => {
  it('uses current→next year for April onwards', () => {
    expect(getFiscalYear(new Date('2026-04-01T00:00:00'))).toBe('26-27')
    expect(getFiscalYear(new Date('2026-12-31T00:00:00'))).toBe('26-27')
  })

  it('uses previous→current year for Jan–March', () => {
    expect(getFiscalYear(new Date('2027-01-15T00:00:00'))).toBe('26-27')
    expect(getFiscalYear(new Date('2027-03-31T00:00:00'))).toBe('26-27')
  })

  it('zero-pads single-digit fiscal years', () => {
    expect(getFiscalYear(new Date('2009-05-01T00:00:00'))).toBe('09-10')
  })
})

describe('determineSupplyType', () => {
  const gstParty = { taxId: '27AABCU9603R1ZM' } // 15 chars

  it('classifies a party with a 15-char GSTIN as B2B', () => {
    expect(determineSupplyType(gstParty, 1000, false)).toBe('B2B')
    expect(determineSupplyType(gstParty, 500000, true)).toBe('B2B')
  })

  it('classifies large inter-state B2C (> 2.5L) as B2C_LARGE', () => {
    expect(determineSupplyType({ taxId: null }, 250001, true)).toBe('B2C_LARGE')
  })

  it('classifies small or intra-state B2C as B2C_SMALL', () => {
    expect(determineSupplyType({ taxId: null }, 250000, true)).toBe('B2C_SMALL')
    expect(determineSupplyType({ taxId: null }, 500000, false)).toBe('B2C_SMALL')
    expect(determineSupplyType(null, 100, false)).toBe('B2C_SMALL')
  })

  it('does not treat a malformed short taxId as a GSTIN', () => {
    expect(determineSupplyType({ taxId: '27AABCU' }, 100, false)).toBe('B2C_SMALL')
  })
})
