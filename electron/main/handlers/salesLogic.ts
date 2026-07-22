// Pure, side-effect-free helpers for sales-invoice logic.
// Extracted from sales.ts so the number/normalization, supply-type and
// GST/total calculations can be unit-tested without the Electron/Prisma boundary.

// Normalize invoice number — pad last numeric segment to 2 digits
// NS/SL/26-27/6 → NS/SL/26-27/06, NS/SL/26-27/06 stays NS/SL/26-27/06
export const normalizeInvoiceNumber = (num: string): string => {
  const parts = num.trim().split('/')
  const last = parts[parts.length - 1]
  const parsed = parseInt(last)
  if (!isNaN(parsed)) {
    parts[parts.length - 1] = String(parsed).padStart(2, '0')
  }
  return parts.join('/')
}

// Generate fiscal year string (e.g., "26-27" for April 2026 - March 2027)
export const getFiscalYear = (now: Date = new Date()): string => {
  const month = now.getMonth() + 1 // 1-12
  const year = now.getFullYear() % 100 // last 2 digits
  if (month >= 4) {
    // April onwards = current year to next year
    return `${String(year).padStart(2, '0')}-${String(year + 1).padStart(2, '0')}`
  } else {
    // Jan-March = previous year to current year
    return `${String(year - 1).padStart(2, '0')}-${String(year).padStart(2, '0')}`
  }
}

// Determine supply type based on party GSTIN
export const determineSupplyType = (
  party: { taxId?: string | null } | null | undefined,
  totalAmount: number,
  isInterState: boolean
): string => {
  const hasGstin = party?.taxId && party.taxId.length === 15

  if (hasGstin) {
    return 'B2B'
  } else if (isInterState && totalAmount > 250000) {
    return 'B2C_LARGE'
  } else {
    return 'B2C_SMALL'
  }
}

// Taxable amount for a single line: quantity × rate, less any line discount.
export const computeTaxableAmount = (
  quantity: number,
  rate: number,
  discount = 0
): number => {
  return quantity * rate - discount
}

export interface GstComponents {
  cgstRate: number
  cgstAmount: number
  sgstRate: number
  sgstAmount: number
  igstRate: number
  igstAmount: number
}

// Split a line's GST into CGST/SGST (intra-state) or IGST (inter-state).
export const calculateItemGst = (
  taxableAmount: number,
  taxRate: number,
  isInterState: boolean
): GstComponents => {
  const rate = taxRate || 0
  if (isInterState) {
    return {
      cgstRate: 0,
      cgstAmount: 0,
      sgstRate: 0,
      sgstAmount: 0,
      igstRate: rate,
      igstAmount: (taxableAmount * rate) / 100
    }
  }
  const halfRate = rate / 2
  return {
    cgstRate: halfRate,
    cgstAmount: (taxableAmount * halfRate) / 100,
    sgstRate: halfRate,
    sgstAmount: (taxableAmount * halfRate) / 100,
    igstRate: 0,
    igstAmount: 0
  }
}

export interface InvoiceLineInput {
  quantity: number
  rate: number
  discount?: number
  taxRate?: number
}

export interface InvoiceTotals {
  subtotal: number
  taxAmount: number
  totalCgst: number
  totalSgst: number
  totalIgst: number
  totalAmount: number
}

// Aggregate the taxable subtotal and GST totals across all lines, then apply
// the invoice-level discount. Mirrors the accumulation done in the handlers.
export const calculateInvoiceTotals = (
  items: InvoiceLineInput[],
  opts: { isInterState: boolean; discount?: number }
): InvoiceTotals => {
  let subtotal = 0
  let taxAmount = 0
  let totalCgst = 0
  let totalSgst = 0
  let totalIgst = 0

  for (const item of items) {
    const taxable = computeTaxableAmount(item.quantity, item.rate, item.discount || 0)
    subtotal += taxable

    const gst = calculateItemGst(taxable, item.taxRate || 0, opts.isInterState)
    taxAmount += gst.cgstAmount + gst.sgstAmount + gst.igstAmount
    totalCgst += gst.cgstAmount
    totalSgst += gst.sgstAmount
    totalIgst += gst.igstAmount
  }

  const totalAmount = subtotal + taxAmount - (opts.discount || 0)

  return { subtotal, taxAmount, totalCgst, totalSgst, totalIgst, totalAmount }
}
