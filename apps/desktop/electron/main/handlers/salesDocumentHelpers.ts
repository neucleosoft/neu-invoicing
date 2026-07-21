import {
  and,
  computeGstValues,
  createInvoiceFromSource,
  desc,
  eq,
  like,
  type DrizzleDbLike,
  type SourceDoc,
} from '@neu/shared'
import { getDb, schema } from '../db'
import { attachCustomerAndItems } from './docLoaders'

// Paid-status is DERIVED from the money, never hand-set: amountPaid vs total.
// Mirrors the shared computePaymentStatus / desktop computeStatus rule so the
// invoice's label can never contradict what was actually paid. OVERDUE is NOT
// produced here — it's a function of the due date, handled separately at the call site.
export const derivePaymentStatus = (total: number, paid: number): 'PAID' | 'PARTIAL' | 'DRAFT' => {
  if (total - paid <= 0) return 'PAID'
  if (paid > 0) return 'PARTIAL'
  return 'DRAFT'
}

export const normalizeSalesDocumentNumber = (num: string): string => {
  const parts = num.trim().split('/')
  const last = parts[parts.length - 1]
  const parsed = parseInt(last)
  if (!isNaN(parsed)) {
    parts[parts.length - 1] = String(parsed).padStart(2, '0')
  }
  return parts.join('/')
}

const getFiscalYear = (): string => {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear() % 100
  if (month >= 4) {
    return `${String(year).padStart(2, '0')}-${String(year + 1).padStart(2, '0')}`
  } else {
    return `${String(year - 1).padStart(2, '0')}-${String(year).padStart(2, '0')}`
  }
}

// Next number in a NS/<code>/<FY>/NN series for one of the sales-document
// tables. Deleted rows ARE counted on purpose — numbers never get reused.
const nextInSeries = async (db: DrizzleDbLike, table: any, code: string): Promise<string> => {
  const fy = getFiscalYear()
  const prefix = `NS/${code}/${fy}/`
  const rows = await db
    .select({ invoiceNumber: table.invoiceNumber })
    .from(table)
    .where(like(table.invoiceNumber, `${prefix}%`))
    .orderBy(desc(table.invoiceNumber))
    .limit(1)
  let nextNum = 1
  const last = rows[0]?.invoiceNumber
  if (last) {
    const parsed = parseInt(last.split('/').pop() || '0')
    if (!isNaN(parsed)) nextNum = parsed + 1
  }
  return `${prefix}${String(nextNum).padStart(2, '0')}`
}

export const generateNextInvoiceNumber = async (db: DrizzleDbLike): Promise<string> => {
  // Only real invoices share the SL series (quotation/proforma live in their
  // own tables now, but salesInvoice still carries legacy type values).
  const fy = getFiscalYear()
  const prefix = `NS/SL/${fy}/`
  const rows = await db
    .select({ invoiceNumber: schema.salesInvoice.invoiceNumber })
    .from(schema.salesInvoice)
    .where(and(eq(schema.salesInvoice.type, 'INVOICE'), like(schema.salesInvoice.invoiceNumber, `${prefix}%`)))
    .orderBy(desc(schema.salesInvoice.invoiceNumber))
    .limit(1)
  let nextNum = 1
  const last = rows[0]?.invoiceNumber
  if (last) {
    const parsed = parseInt(last.split('/').pop() || '0')
    if (!isNaN(parsed)) nextNum = parsed + 1
  }
  return `${prefix}${String(nextNum).padStart(2, '0')}`
}

export const generateNextQuotationNumber = (db: DrizzleDbLike): Promise<string> =>
  nextInSeries(db, schema.quotation, 'QT')

export const generateNextProformaInvoiceNumber = (db: DrizzleDbLike): Promise<string> =>
  nextInSeries(db, schema.proformaInvoice, 'PI')

export const determineSupplyType = (customer: any, totalAmount: number, isInterState: boolean): string => {
  const hasGstin = customer?.taxId && customer.taxId.length === 15

  if (hasGstin) {
    return 'B2B'
  } else if (isInterState && totalAmount > 250000) {
    return 'B2C_LARGE'
  } else {
    return 'B2C_SMALL'
  }
}

export const buildSalesDocumentValues = async (tx: DrizzleDbLike, data: any) => {
  const [customer] = await tx.select().from(schema.customer).where(eq(schema.customer.id, data.customerId)).limit(1)
  const [company] = await tx.select().from(schema.company).limit(1)

  if (!customer) throw new Error('Customer not found')

  // Fetch each line's catalog item for the HSN fallback chain (typed HSN →
  // item.hsnCode → item.skuHsn) the shared helper applies.
  const catalogItems: any[] = []
  for (const item of data.items) {
    const [row] = await tx.select().from(schema.item).where(eq(schema.item.id, item.itemId)).limit(1)
    catalogItems.push(row ?? null)
  }

  // ONE GST implementation for the whole product: the shared computeGstValues
  // (packages/shared/src/gstCompute.ts) that mobile already uses.
  const gst = computeGstValues({
    company: company ? { stateCode: company.stateCode, stateName: company.stateName } : null,
    party: { taxId: customer.taxId, stateCode: customer.stateCode, stateName: customer.stateName },
    items: data.items.map((item: any, idx: number) => ({
      quantity: item.quantity,
      rate: item.rate,
      discount: item.discount,
      taxRate: item.taxRate,
      cessRate: item.cessRate,
      cessAmount: item.cessAmount,
      hsnCode: item.hsnCode,
      catalogHsnCode: catalogItems[idx]?.hsnCode,
      catalogSkuHsn: catalogItems[idx]?.skuHsn
    })),
    docDiscount: data.discount || 0,
    placeOfSupply: data.placeOfSupply,
    placeOfSupplyName: data.placeOfSupplyName
  })

  const processedItems = data.items.map((item: any, idx: number) => {
    const g = gst.items[idx]
    return {
      itemId: item.itemId,
      quantity: item.quantity,
      rate: item.rate,
      discount: item.discount || 0,
      taxRate: item.taxRate || 0,
      total: g.total,
      hsnCode: g.hsnCode,
      taxableAmount: g.taxableAmount,
      cgstRate: g.cgstRate,
      cgstAmount: g.cgstAmount,
      sgstRate: g.sgstRate,
      sgstAmount: g.sgstAmount,
      igstRate: g.igstRate,
      igstAmount: g.igstAmount,
      cessRate: g.cessRate,
      cessAmount: g.cessAmount
    }
  })

  return {
    customer,
    placeOfSupply: gst.placeOfSupply,
    placeOfSupplyName: gst.placeOfSupplyName,
    isInterState: gst.isInterState,
    subtotal: gst.subtotal,
    taxAmount: gst.taxAmount,
    totalAmount: gst.totalAmount,
    totalCgst: gst.totalCgst,
    totalSgst: gst.totalSgst,
    totalIgst: gst.totalIgst,
    totalCess: gst.totalCess,
    supplyType: gst.supplyType,
    processedItems
  }
}

// Load a freshly-created invoice the way Prisma's include used to return it
// (items with catalog item + customer) — the renderer's post-convert shape.
const loadInvoiceFull = async (db: ReturnType<typeof getDb>, invoiceId: string) => {
  const [header] = await db.select().from(schema.salesInvoice).where(eq(schema.salesInvoice.id, invoiceId)).limit(1)
  if (!header) throw new Error('Converted invoice not found')
  const [full] = await attachCustomerAndItems(db, [header], schema.salesInvoiceItem, 'salesInvoiceId')
  return full
}

// Convert a source document into a real invoice through the SHARED
// createInvoiceFromSource (the exact code mobile runs — deterministic
// `conv-<sourceId>` id, balance bump, stock decrement + SALE movements).
const convertSourceDocument = async (
  sourceTable: any,
  childTable: any,
  fkName: string,
  sourceId: string,
  ref: { convertedFromQuotationId: string } | { convertedFromProformaId: string },
) => {
  const db = getDb()
  const invoiceId = await db.transaction(async (tx) => {
    const [source] = await tx.select().from(sourceTable).where(eq(sourceTable.id, sourceId)).limit(1)
    if (!source) throw new Error('Invalid source document')
    const lines: any[] = await tx.select().from(childTable).where(eq(childTable[fkName], sourceId))
    const doc: SourceDoc = { ...(source as any), lines }
    return createInvoiceFromSource(tx as any, doc, ref)
  })
  return loadInvoiceFull(db, invoiceId)
}

export const convertQuotationToInvoice = (quoteId: string) =>
  convertSourceDocument(schema.quotation, schema.quotationItem, 'quotationId', quoteId, {
    convertedFromQuotationId: quoteId,
  })

export const convertProformaInvoiceToInvoice = (proformaInvoiceId: string) =>
  convertSourceDocument(schema.proformaInvoice, schema.proformaInvoiceItem, 'proformaInvoiceId', proformaInvoiceId, {
    convertedFromProformaId: proformaInvoiceId,
  })
