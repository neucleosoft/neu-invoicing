import { describe, it, expect } from 'vitest'
import {
  computeTaxableAmount,
  calculateItemGst,
  calculateInvoiceTotals
} from '../electron/main/handlers/salesLogic'

describe('computeTaxableAmount', () => {
  it('multiplies quantity by rate', () => {
    expect(computeTaxableAmount(3, 100)).toBe(300)
  })

  it('subtracts the line discount', () => {
    expect(computeTaxableAmount(2, 500, 100)).toBe(900)
  })

  it('defaults discount to zero when omitted', () => {
    expect(computeTaxableAmount(1, 250)).toBe(250)
  })
})

describe('calculateItemGst', () => {
  it('splits into equal CGST/SGST halves for intra-state supply', () => {
    const gst = calculateItemGst(1000, 18, false)
    expect(gst).toEqual({
      cgstRate: 9,
      cgstAmount: 90,
      sgstRate: 9,
      sgstAmount: 90,
      igstRate: 0,
      igstAmount: 0
    })
  })

  it('applies the full rate as IGST for inter-state supply', () => {
    const gst = calculateItemGst(1000, 18, true)
    expect(gst).toEqual({
      cgstRate: 0,
      cgstAmount: 0,
      sgstRate: 0,
      sgstAmount: 0,
      igstRate: 18,
      igstAmount: 180
    })
  })

  it('returns all zeros when the tax rate is zero', () => {
    const gst = calculateItemGst(1000, 0, false)
    expect(gst.cgstAmount).toBe(0)
    expect(gst.sgstAmount).toBe(0)
    expect(gst.igstAmount).toBe(0)
  })

  it('treats a missing tax rate as zero', () => {
    // @ts-expect-error exercising the runtime `taxRate || 0` guard
    const gst = calculateItemGst(1000, undefined, true)
    expect(gst.igstAmount).toBe(0)
  })

  it('handles fractional taxable amounts', () => {
    const gst = calculateItemGst(333.33, 18, false)
    expect(gst.cgstAmount).toBeCloseTo(29.9997, 4)
    expect(gst.sgstAmount).toBeCloseTo(29.9997, 4)
  })
})

describe('calculateInvoiceTotals', () => {
  it('computes subtotal, tax and total for a single intra-state line', () => {
    const totals = calculateInvoiceTotals(
      [{ quantity: 2, rate: 500, taxRate: 18 }],
      { isInterState: false }
    )
    expect(totals).toEqual({
      subtotal: 1000,
      taxAmount: 180,
      totalCgst: 90,
      totalSgst: 90,
      totalIgst: 0,
      totalAmount: 1180
    })
  })

  it('aggregates multiple lines and applies line + invoice discounts', () => {
    const totals = calculateInvoiceTotals(
      [
        { quantity: 2, rate: 500, discount: 100, taxRate: 18 },
        { quantity: 1, rate: 1000, taxRate: 12 }
      ],
      { isInterState: false, discount: 200 }
    )
    expect(totals.subtotal).toBe(1900)
    expect(totals.taxAmount).toBe(282)
    expect(totals.totalCgst).toBe(141)
    expect(totals.totalSgst).toBe(141)
    expect(totals.totalIgst).toBe(0)
    // 1900 + 282 - 200
    expect(totals.totalAmount).toBe(1982)
  })

  it('routes tax to IGST for inter-state invoices', () => {
    const totals = calculateInvoiceTotals(
      [{ quantity: 3, rate: 100, taxRate: 5 }],
      { isInterState: true }
    )
    expect(totals.totalCgst).toBe(0)
    expect(totals.totalSgst).toBe(0)
    expect(totals.totalIgst).toBe(15)
    expect(totals.taxAmount).toBe(15)
    expect(totals.totalAmount).toBe(315)
  })

  it('returns zeros for an empty line list', () => {
    const totals = calculateInvoiceTotals([], { isInterState: false })
    expect(totals).toEqual({
      subtotal: 0,
      taxAmount: 0,
      totalCgst: 0,
      totalSgst: 0,
      totalIgst: 0,
      totalAmount: 0
    })
  })

  it('subtracts an invoice discount even with no items', () => {
    const totals = calculateInvoiceTotals([], { isInterState: false, discount: 50 })
    expect(totals.totalAmount).toBe(-50)
  })
})
