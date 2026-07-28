// Pure GST computation for a document (sales OR purchase). This is the portable
// twin of the desktop handler `buildSalesDocumentValues` (electron/main/handlers/
// salesDocumentHelpers.ts): same rules, but NO database access and NO async — the
// caller fetches the company/party/catalog rows and passes them in, so the exact
// same math runs on desktop (Node) and mobile (Hermes).
//
// India GST rules encoded here:
//  - Place of supply = the party's state (falls back to the company's state).
//  - Inter-state when the company's state code differs from the place of supply
//    (and a place of supply is known) → tax is IGST; otherwise CGST + SGST, each
//    half the line's tax rate.
//  - supplyType: B2B if the party has a 15-char GSTIN, else B2C_LARGE for an
//    inter-state sale over ₹2.5L, else B2C_SMALL.
//
// No rounding is applied (matches desktop); formatting happens at display time.

export interface GstParty {
  taxId?: string | null
  stateCode?: string | null
  stateName?: string | null
}

export interface GstCompany {
  stateCode?: string | null
  stateName?: string | null
}

export interface GstLineInput {
  quantity: number
  rate: number
  discount?: number
  taxRate?: number
  /** Per-unit cess rate (%), if any. */
  cessRate?: number
  /** Flat cess amount for the line, if any. Takes precedence in the total. */
  cessAmount?: number
  /** Explicit HSN typed on the line. */
  hsnCode?: string | null
  /** Catalog fallbacks, tried in order when the line has no explicit hsnCode. */
  catalogHsnCode?: string | null
  catalogSkuHsn?: string | null
}

export interface GstLineResult {
  taxableAmount: number
  taxRate: number
  hsnCode: string
  /** taxableAmount + this line's full tax (cgst+sgst+igst+cess). */
  total: number
  cgstRate: number
  cgstAmount: number
  sgstRate: number
  sgstAmount: number
  igstRate: number
  igstAmount: number
  cessRate: number
  cessAmount: number
}

export interface GstComputeInput {
  company?: GstCompany | null
  party: GstParty
  items: GstLineInput[]
  /** Document-level discount subtracted from the grand total. */
  docDiscount?: number
  /** Override the derived place of supply (e.g. a manual selection). */
  placeOfSupply?: string
  placeOfSupplyName?: string
  /** Round the grand total to a whole rupee with a Round Off adjustment
   *  (default true — standard for documents WE author). Purchase-side callers
   *  pass false: a supplier's paper bill total keeps its paise so our record
   *  matches their document. */
  roundTotalToRupee?: boolean
}

export interface GstComputeResult {
  placeOfSupply: string
  placeOfSupplyName: string
  isInterState: boolean
  subtotal: number
  taxAmount: number
  totalAmount: number
  totalCgst: number
  totalSgst: number
  totalIgst: number
  totalCess: number
  /** totalAmount − (subtotal + taxAmount − discount): the whole-rupee rounding
   *  adjustment, shown as the "Round Off" line on printed documents. 0 when
   *  roundTotalToRupee is false. */
  roundOff: number
  supplyType: string
  items: GstLineResult[]
}

// Money lives in floats here (legacy schema); every stored/printed amount must
// be a real paise value — floating residue like 2.6973000000000003 must never
// leave this module (it reached production PDFs as ₹8,292.096).
const round2 = (n: number) => Math.round(n * 100) / 100

// B2B when the party carries a full 15-char GSTIN; otherwise B2C, split into
// B2C_LARGE (inter-state and over ₹2.5L, which GSTR-1 reports line-by-line) vs
// B2C_SMALL. Mirrors desktop determineSupplyType exactly.
export function determineSupplyType(
  party: GstParty,
  totalAmount: number,
  isInterState: boolean,
): string {
  const hasGstin = !!party?.taxId && party.taxId.length === 15
  if (hasGstin) return 'B2B'
  if (isInterState && totalAmount > 250000) return 'B2C_LARGE'
  return 'B2C_SMALL'
}

export function computeGstValues(input: GstComputeInput): GstComputeResult {
  const { company, party, items } = input

  const placeOfSupply =
    input.placeOfSupply || party.stateCode || company?.stateCode || ''
  const placeOfSupplyName =
    input.placeOfSupplyName || party.stateName || company?.stateName || ''
  const companyStateCode = company?.stateCode || ''
  const isInterState = companyStateCode !== placeOfSupply && placeOfSupply !== ''

  let subtotal = 0
  let taxAmount = 0
  let totalCgst = 0
  let totalSgst = 0
  let totalIgst = 0
  let totalCess = 0

  const resultItems: GstLineResult[] = items.map((item) => {
    const taxRate = item.taxRate || 0
    const taxableAmount = round2(item.quantity * item.rate - (item.discount || 0))
    subtotal += taxableAmount

    const halfRate = taxRate / 2
    let cgstRate = 0
    let cgstAmount = 0
    let sgstRate = 0
    let sgstAmount = 0
    let igstRate = 0
    let igstAmount = 0
    if (isInterState) {
      igstRate = taxRate
      igstAmount = round2((taxableAmount * taxRate) / 100)
    } else {
      cgstRate = halfRate
      cgstAmount = round2((taxableAmount * halfRate) / 100)
      sgstRate = halfRate
      sgstAmount = cgstAmount
    }

    const cessAmount = round2(item.cessAmount || 0)
    const itemTax = round2(cgstAmount + sgstAmount + igstAmount + cessAmount)

    taxAmount += itemTax
    totalCgst += cgstAmount
    totalSgst += sgstAmount
    totalIgst += igstAmount
    totalCess += cessAmount

    const hsnCode =
      item.hsnCode || item.catalogHsnCode || item.catalogSkuHsn || ''

    return {
      taxableAmount,
      taxRate,
      hsnCode,
      total: round2(taxableAmount + itemTax),
      cgstRate,
      cgstAmount,
      sgstRate,
      sgstAmount,
      igstRate,
      igstAmount,
      cessRate: item.cessRate || 0,
      cessAmount,
    }
  })

  // Sums of 2dp values still carry float noise (0.1+0.2 style) — settle them.
  subtotal = round2(subtotal)
  taxAmount = round2(taxAmount)
  totalCgst = round2(totalCgst)
  totalSgst = round2(totalSgst)
  totalIgst = round2(totalIgst)
  totalCess = round2(totalCess)

  const rawTotal = round2(subtotal + taxAmount - (input.docDiscount || 0))
  const roundToRupee = input.roundTotalToRupee !== false
  const totalAmount = roundToRupee ? Math.round(rawTotal) : rawTotal
  const roundOff = round2(totalAmount - rawTotal)
  const supplyType = determineSupplyType(party, totalAmount, isInterState)

  return {
    placeOfSupply,
    placeOfSupplyName,
    isInterState,
    subtotal,
    taxAmount,
    totalAmount,
    totalCgst,
    totalSgst,
    totalIgst,
    totalCess,
    roundOff,
    supplyType,
    items: resultItems,
  }
}

// A scanned purchase bill often shows tax only as a single bottom-line figure with
// no per-line tax column (the OCR prompt explicitly forbids distributing it across
// lines). Both apps honor that figure through THIS one function so they can never
// disagree: the override REPLACES the computed document-level tax; the doc-level
// CGST/SGST/IGST split comes from the bill's own explicit amounts when present,
// otherwise from the already-decided isInterState; per-line values stay as computed
// (a bottom-line tax cannot be attributed to lines). No override → result unchanged.
export interface PurchaseTaxOverride {
  taxAmount?: number | null
  cgstAmount?: number | null
  sgstAmount?: number | null
  igstAmount?: number | null
}

export function applyPurchaseTaxOverride(
  gst: GstComputeResult,
  override?: PurchaseTaxOverride | null,
): GstComputeResult {
  const tax = override?.taxAmount
  if (typeof tax !== 'number' || !Number.isFinite(tax) || tax < 0) return gst

  const explicitSplit =
    (override?.cgstAmount || 0) + (override?.sgstAmount || 0) + (override?.igstAmount || 0)
  let totalCgst = 0
  let totalSgst = 0
  let totalIgst = 0
  if (explicitSplit > 0) {
    totalCgst = override?.cgstAmount || 0
    totalSgst = override?.sgstAmount || 0
    totalIgst = override?.igstAmount || 0
    // Normalize physically-impossible splits: an intra-state supply cannot carry
    // IGST, and an inter-state one cannot carry CGST/SGST. Desktop's scan flow
    // buckets a bare bottom-line tax under IGST for display, and OCR models
    // sometimes mislabel the same way — re-split by the actual state decision so
    // both apps store the same, legal split. Mixed splits pass through untouched.
    if (!gst.isInterState && totalIgst > 0 && totalCgst === 0 && totalSgst === 0) {
      // Halves must sum back to the exact printed tax — round one side, give
      // the remainder to the other (½ of an odd paise can't round twice).
      totalCgst = round2(tax / 2)
      totalSgst = round2(tax - totalCgst)
      totalIgst = 0
    } else if (gst.isInterState && totalIgst === 0) {
      totalIgst = tax
      totalCgst = 0
      totalSgst = 0
    }
  } else if (gst.isInterState) {
    totalIgst = tax
  } else {
    totalCgst = round2(tax / 2)
    totalSgst = round2(tax - totalCgst)
  }

  // Recover the doc discount the caller passed to computeGstValues, so the
  // override path nets it identically (totalAmount = subtotal + tax − discount).
  // gst.totalAmount may carry a whole-rupee roundOff — strip it first.
  const docDiscount = round2(gst.subtotal + gst.taxAmount - (gst.totalAmount - gst.roundOff))

  return {
    ...gst,
    taxAmount: round2(tax),
    // Purchase overrides mirror the supplier's printed figures: keep paise,
    // never re-round their total to a whole rupee.
    totalAmount: round2(gst.subtotal + tax - docDiscount),
    roundOff: 0,
    totalCgst: round2(totalCgst),
    totalSgst: round2(totalSgst),
    totalIgst: round2(totalIgst),
  }
}
