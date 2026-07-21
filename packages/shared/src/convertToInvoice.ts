import { desc, eq, like, sql } from 'drizzle-orm'

import {
  customer,
  item,
  salesInvoice,
  salesInvoiceItem,
  stockMovement,
} from './schema'

// Shared "convert a source document (quotation / proforma) into a real tax
// invoice". Lives in @neu/shared so mobile uses it today and the future
// Drizzle-desktop imports the same logic instead of reimplementing the
// balance+stock side-effects. Mirrors desktop createInvoiceFromSourceDocument
// (salesDocumentHelpers.ts).
//
// The source document is NOT mutated (matches desktop — a quote/proforma can
// seed multiple invoices; there is no convertedToInvoiceId on those tables).
//
// Effect, in one transaction:
//   1. generate a fresh NS/SL/{FY}/NN invoice number
//   2. insert a SalesInvoice (type INVOICE) copying the source's lines + totals
//   3. bump customer.currentBalance by the invoice total (fully unpaid)
//   4. for each stock-tracked line: decrement stock + log a SALE stockMovement

import type { DrizzleTx } from './paymentLogic'

// A source line as read from quotationItem / proformaInvoiceItem (same shape).
// The GST-split fields are optional: pass the full source line through and the
// new invoice line keeps the split; omit them and they default like a fresh line.
export interface SourceLine {
  itemId: string
  quantity: number
  rate: number
  discount: number
  taxRate: number
  total: number
  hsnCode?: string | null
  taxableAmount?: number
  cgstRate?: number | null
  cgstAmount?: number | null
  sgstRate?: number | null
  sgstAmount?: number | null
  igstRate?: number | null
  igstAmount?: number | null
  cessRate?: number | null
  cessAmount?: number | null
}

export interface SourceDoc {
  /** Source doc's primary key — seeds the new invoice's deterministic id. */
  id: string
  customerId: string
  subtotal: number
  discount: number
  taxAmount: number
  totalAmount: number
  notes?: string | null
  termsConditions?: string | null
  placeOfSupply?: string | null
  placeOfSupplyName?: string | null
  isInterState?: boolean
  reverseCharge?: boolean
  cgstAmount?: number
  sgstAmount?: number
  igstAmount?: number
  cessAmount?: number
  supplyType?: string | null
  ecommerceGstin?: string | null
  poNumber?: string | null
  ewayBillNo?: string | null
  vehicleNumber?: string | null
  warrantyPeriod?: string | null
  dispatchedThrough?: string | null
  lines: SourceLine[]
}

// Which source the invoice was converted from (sets the right back-reference
// column on the new invoice).
export type ConvertSource =
  | { convertedFromQuotationId: string }
  | { convertedFromProformaId: string }

function getFiscalYear(now: Date): string {
  const month = now.getMonth() + 1
  const year = now.getFullYear() % 100
  if (month >= 4) {
    return `${String(year).padStart(2, '0')}-${String(year + 1).padStart(2, '0')}`
  }
  return `${String(year - 1).padStart(2, '0')}-${String(year).padStart(2, '0')}`
}

// Next NS/SL/{FY}/NN invoice number — must match utils/invoiceNumber.ts exactly
// (same series the manual invoice form uses, so converted invoices slot into the
// same counter).
async function nextInvoiceNumber(tx: DrizzleTx, now: Date): Promise<string> {
  const fy = getFiscalYear(now)
  const prefix = `NS/SL/${fy}/`
  const rows = await tx
    .select({ invoiceNumber: salesInvoice.invoiceNumber })
    .from(salesInvoice)
    .where(like(salesInvoice.invoiceNumber, `${prefix}%`))
    .orderBy(desc(salesInvoice.invoiceNumber))
    .limit(1)
  let n = 1
  const last = rows[0]?.invoiceNumber
  if (last) {
    const parsed = parseInt(last.split('/').pop() || '0', 10)
    if (!isNaN(parsed)) n = parsed + 1
  }
  return `${prefix}${String(n).padStart(2, '0')}`
}

// `tx` must support insert too — widen the structural type locally.
interface FullTx extends DrizzleTx {
  insert: (...args: any[]) => any
}

export async function createInvoiceFromSource(
  tx: FullTx,
  source: SourceDoc,
  ref: ConvertSource,
  now: Date = new Date(),
): Promise<string> {
  const invoiceNumber = await nextInvoiceNumber(tx, now)

  const [created] = await tx
    .insert(salesInvoice)
    .values({
      // Deterministic id: both devices converting this source doc offline
      // mint the SAME invoice row — sync converges to one invoice, not two.
      id: `conv-${source.id}`,
      invoiceNumber,
      invoiceDate: now,
      type: 'INVOICE',
      customerId: source.customerId,
      subtotal: source.subtotal,
      discount: source.discount ?? 0,
      taxAmount: source.taxAmount,
      totalAmount: source.totalAmount,
      amountPaid: 0,
      balanceDue: source.totalAmount,
      status: 'DRAFT',
      notes: source.notes ?? null,
      termsConditions: source.termsConditions ?? null,
      placeOfSupply: source.placeOfSupply ?? null,
      placeOfSupplyName: source.placeOfSupplyName ?? null,
      isInterState: source.isInterState ?? false,
      reverseCharge: source.reverseCharge ?? false,
      cgstAmount: source.cgstAmount ?? 0,
      sgstAmount: source.sgstAmount ?? 0,
      igstAmount: source.igstAmount ?? 0,
      cessAmount: source.cessAmount ?? 0,
      supplyType: source.supplyType ?? null,
      ecommerceGstin: source.ecommerceGstin ?? null,
      poNumber: source.poNumber ?? null,
      ewayBillNo: source.ewayBillNo ?? null,
      vehicleNumber: source.vehicleNumber ?? null,
      warrantyPeriod: source.warrantyPeriod ?? null,
      dispatchedThrough: source.dispatchedThrough ?? null,
      ...('convertedFromQuotationId' in ref
        ? { convertedFromQuotationId: ref.convertedFromQuotationId }
        : { convertedFromProformaId: ref.convertedFromProformaId }),
    })
    .returning({ id: salesInvoice.id })

  for (const l of source.lines) {
    await tx.insert(salesInvoiceItem).values({
      salesInvoiceId: created.id,
      itemId: l.itemId,
      quantity: l.quantity,
      rate: l.rate,
      discount: l.discount,
      taxRate: l.taxRate,
      total: l.total,
      hsnCode: l.hsnCode ?? null,
      taxableAmount: l.taxableAmount ?? l.quantity * l.rate - l.discount,
      cgstRate: l.cgstRate ?? 0,
      cgstAmount: l.cgstAmount ?? 0,
      sgstRate: l.sgstRate ?? 0,
      sgstAmount: l.sgstAmount ?? 0,
      igstRate: l.igstRate ?? 0,
      igstAmount: l.igstAmount ?? 0,
      cessRate: l.cessRate ?? 0,
      cessAmount: l.cessAmount ?? 0,
    })
  }

  // Customer now owes the full invoice (unpaid).
  await tx
    .update(customer)
    .set({ currentBalance: sql`${customer.currentBalance} + ${source.totalAmount}` })
    .where(eq(customer.id, source.customerId))

  // Decrement stock for tracked items + log a SALE movement.
  for (const l of source.lines) {
    const rows = await tx
      .select({ trackStock: item.trackStock })
      .from(item)
      .where(eq(item.id, l.itemId))
      .limit(1)
    if (rows[0]?.trackStock) {
      await tx
        .update(item)
        .set({ currentStock: sql`${item.currentStock} - ${l.quantity}` })
        .where(eq(item.id, l.itemId))
      await tx.insert(stockMovement).values({
        itemId: l.itemId,
        movementType: 'SALE',
        quantity: -l.quantity,
        referenceType: 'INVOICE',
        referenceId: created.id,
      })
    }
  }

  return created.id
}
