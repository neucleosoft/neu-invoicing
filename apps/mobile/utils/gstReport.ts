// GST return aggregations — GSTR-1 (outward), GSTR-2 (inward), GSTR-3B (monthly
// summary), GSTR-9 (annual), and HSN summary. Mirrors apps/desktop/electron/main/
// handlers/gstReport.ts, re-implemented in Drizzle. On-screen only — the desktop
// GSTN/Excel/JSON export paths are out of scope.
//
// Key conventions, lifted verbatim from desktop:
//  - taxable value of a document = subtotal − discount (invoice-level).
//  - "registered" party = taxId present AND exactly 15 chars (a GSTIN).
//  - branching (CGST/SGST vs IGST) happens at data-entry time; the reports just
//    SUM all four columns — an inter-state doc has igst set and cgst/sgst = 0.
//  - B2C-Large = inter-state AND total > ₹2.5 lakh; classification is an ordered
//    first-match chain.

import { and, eq, gte, inArray, lte } from 'drizzle-orm'

import { schema, useDb } from '@/db'
import { notCancelled, notDeleted } from '@/db/softDelete'

type Db = ReturnType<typeof useDb>

export interface GstRange {
  start: Date
  end: Date
}

// A registered party carries a 15-char GSTIN.
const isRegistered = (taxId: string | null): boolean => !!taxId && taxId.length === 15

// ---- shared section-total shape ------------------------------------------------
export interface SectionTotals {
  count: number
  taxableValue: number
  igst: number
  cgst: number
  sgst: number
  cess: number
}

// One normalized document feeding a section total.
interface GstDoc {
  taxableValue: number
  igst: number
  cgst: number
  sgst: number
  cess: number
}

const emptyTotals = (): SectionTotals => ({
  count: 0,
  taxableValue: 0,
  igst: 0,
  cgst: 0,
  sgst: 0,
  cess: 0,
})

function totalDocs(docs: GstDoc[]): SectionTotals {
  const t = emptyTotals()
  for (const d of docs) {
    t.count += 1
    t.taxableValue += d.taxableValue
    t.igst += d.igst
    t.cgst += d.cgst
    t.sgst += d.sgst
    t.cess += d.cess
  }
  return t
}

// One document behind a section total — feeds the drill-down list (tap a
// section to see which docs are inside it). Mirrors desktop's per-section
// invoice lists.
export interface GstDocDetail {
  id: string
  number: string
  date: Date
  partyName: string
  totalAmount: number
}

// ---- raw fetch shapes ----------------------------------------------------------
interface InvoiceRow {
  id: string
  invoiceNumber: string
  invoiceDate: Date
  customerName: string | null
  placeOfSupply: string | null
  reverseCharge: boolean
  taxId: string | null
  isInterState: boolean
  supplyType: string
  subtotal: number
  discount: number
  taxAmount: number
  totalAmount: number
  igstAmount: number
  cgstAmount: number
  sgstAmount: number
  cessAmount: number
}

interface BillRow {
  id: string
  billNumber: string
  billDate: Date
  supplierName: string | null
  taxId: string | null
  reverseCharge: boolean
  itcEligibility: string
  subtotal: number
  discount: number
  taxAmount: number
  totalAmount: number
  igstAmount: number
  cgstAmount: number
  sgstAmount: number
  cessAmount: number
}

interface NoteRow {
  id: string
  noteNumber: string
  noteDate: Date
  customerName: string | null
  taxId: string | null
  type: string
  isInterState: boolean
  subtotal: number
  totalAmount: number
  igstAmount: number
  cgstAmount: number
  sgstAmount: number
}

async function fetchInvoices(db: Db, range: GstRange): Promise<InvoiceRow[]> {
  const rows = await db
    .select({
      id: schema.salesInvoice.id,
      invoiceNumber: schema.salesInvoice.invoiceNumber,
      invoiceDate: schema.salesInvoice.invoiceDate,
      customerName: schema.customer.name,
      placeOfSupply: schema.salesInvoice.placeOfSupply,
      reverseCharge: schema.salesInvoice.reverseCharge,
      taxId: schema.customer.taxId,
      isInterState: schema.salesInvoice.isInterState,
      supplyType: schema.salesInvoice.supplyType,
      subtotal: schema.salesInvoice.subtotal,
      discount: schema.salesInvoice.discount,
      taxAmount: schema.salesInvoice.taxAmount,
      totalAmount: schema.salesInvoice.totalAmount,
      igstAmount: schema.salesInvoice.igstAmount,
      cgstAmount: schema.salesInvoice.cgstAmount,
      sgstAmount: schema.salesInvoice.sgstAmount,
      cessAmount: schema.salesInvoice.cessAmount,
    })
    .from(schema.salesInvoice)
    .leftJoin(schema.customer, eq(schema.salesInvoice.customerId, schema.customer.id))
    .where(
      and(
        eq(schema.salesInvoice.type, 'INVOICE'),
        gte(schema.salesInvoice.invoiceDate, range.start),
        lte(schema.salesInvoice.invoiceDate, range.end),
        notDeleted(schema.salesInvoice.deletedAt),
        notCancelled(schema.salesInvoice.cancelledAt),
      ),
    )
  return rows
}

async function fetchBills(db: Db, range: GstRange): Promise<BillRow[]> {
  return db
    .select({
      id: schema.purchaseBill.id,
      billNumber: schema.purchaseBill.billNumber,
      billDate: schema.purchaseBill.billDate,
      supplierName: schema.supplier.name,
      taxId: schema.supplier.taxId,
      reverseCharge: schema.purchaseBill.reverseCharge,
      itcEligibility: schema.purchaseBill.itcEligibility,
      subtotal: schema.purchaseBill.subtotal,
      discount: schema.purchaseBill.discount,
      taxAmount: schema.purchaseBill.taxAmount,
      totalAmount: schema.purchaseBill.totalAmount,
      igstAmount: schema.purchaseBill.igstAmount,
      cgstAmount: schema.purchaseBill.cgstAmount,
      sgstAmount: schema.purchaseBill.sgstAmount,
      cessAmount: schema.purchaseBill.cessAmount,
    })
    .from(schema.purchaseBill)
    .leftJoin(schema.supplier, eq(schema.purchaseBill.supplierId, schema.supplier.id))
    .where(
      and(
        gte(schema.purchaseBill.billDate, range.start),
        lte(schema.purchaseBill.billDate, range.end),
        notDeleted(schema.purchaseBill.deletedAt),
        notCancelled(schema.purchaseBill.cancelledAt),
      ),
    )
}

// Active credit/debit notes in range, with the customer's GSTIN, for GSTR-1 CDN sections.
async function fetchNotes(db: Db, range: GstRange): Promise<NoteRow[]> {
  return db
    .select({
      id: schema.creditDebitNote.id,
      noteNumber: schema.creditDebitNote.noteNumber,
      noteDate: schema.creditDebitNote.noteDate,
      customerName: schema.customer.name,
      taxId: schema.customer.taxId,
      type: schema.creditDebitNote.type,
      isInterState: schema.creditDebitNote.isInterState,
      subtotal: schema.creditDebitNote.subtotal,
      totalAmount: schema.creditDebitNote.totalAmount,
      igstAmount: schema.creditDebitNote.igstAmount,
      cgstAmount: schema.creditDebitNote.cgstAmount,
      sgstAmount: schema.creditDebitNote.sgstAmount,
    })
    .from(schema.creditDebitNote)
    .leftJoin(schema.customer, eq(schema.creditDebitNote.customerId, schema.customer.id))
    .where(
      and(
        eq(schema.creditDebitNote.status, 'ACTIVE'),
        gte(schema.creditDebitNote.noteDate, range.start),
        lte(schema.creditDebitNote.noteDate, range.end),
        notDeleted(schema.creditDebitNote.deletedAt),
        notCancelled(schema.creditDebitNote.cancelledAt),
      ),
    )
}

// Invoice → normalized doc. taxable = subtotal − discount; tax columns as stored.
const invToDoc = (inv: InvoiceRow): GstDoc => ({
  taxableValue: inv.subtotal - (inv.discount || 0),
  igst: inv.igstAmount || 0,
  cgst: inv.cgstAmount || 0,
  sgst: inv.sgstAmount || 0,
  cess: inv.cessAmount || 0,
})

const billToDoc = (b: BillRow): GstDoc => ({
  taxableValue: b.subtotal - (b.discount || 0),
  igst: b.igstAmount || 0,
  cgst: b.cgstAmount || 0,
  sgst: b.sgstAmount || 0,
  cess: b.cessAmount || 0,
})

const noteToDoc = (n: NoteRow): GstDoc => ({
  taxableValue: n.subtotal || 0,
  igst: n.igstAmount || 0,
  cgst: n.cgstAmount || 0,
  sgst: n.sgstAmount || 0,
  cess: 0,
})

// ===============================================================================
// GSTR-1 (outward supplies)
// ===============================================================================
export type Gstr1SectionKey = 'b2b' | 'b2cl' | 'b2cs' | 'cdnr' | 'cdnur' | 'exp' | 'nilExempt'

export const GSTR1_SECTION_NAMES: Record<Gstr1SectionKey, string> = {
  b2b: 'B2B (Registered)',
  b2cl: 'B2C Large (Inter-state > ₹2.5L)',
  b2cs: 'B2C Small',
  cdnr: 'Credit/Debit Notes (Registered)',
  cdnur: 'Credit/Debit Notes (Unregistered)',
  exp: 'Exports',
  nilExempt: 'Nil-rated / Exempt',
}

export interface Gstr1Data {
  sections: Record<Gstr1SectionKey, SectionTotals>
  // Drill-down: the documents behind each section total.
  sectionDocs: Record<Gstr1SectionKey, GstDocDetail[]>
  docSummary: {
    totalInvoices: number
    totalValue: number
    totalTaxableValue: number
    totalTax: number
    totalIgst: number
    totalCgst: number
    totalSgst: number
    totalCess: number
  }
  hsnSummary: HsnRow[]
}

// Ordered first-match classification (matches desktop exactly).
function classifyInvoice(inv: InvoiceRow): Gstr1SectionKey {
  const hasGstin = isRegistered(inv.taxId)
  if (inv.totalAmount < 0) return hasGstin ? 'cdnr' : 'cdnur'
  if (inv.supplyType === 'EXPORT') return 'exp'
  if (inv.supplyType === 'NIL_EXEMPT') return 'nilExempt'
  if (hasGstin) return 'b2b'
  if (inv.isInterState && inv.totalAmount > 250000) return 'b2cl'
  return 'b2cs'
}

export async function getGSTR1(db: Db, range: GstRange): Promise<Gstr1Data> {
  const [invoices, notes, hsnSummary] = await Promise.all([
    fetchInvoices(db, range),
    fetchNotes(db, range),
    getHSNSummary(db, range),
  ])

  const buckets: Record<Gstr1SectionKey, GstDoc[]> = {
    b2b: [],
    b2cl: [],
    b2cs: [],
    cdnr: [],
    cdnur: [],
    exp: [],
    nilExempt: [],
  }
  const sectionDocs: Record<Gstr1SectionKey, GstDocDetail[]> = {
    b2b: [],
    b2cl: [],
    b2cs: [],
    cdnr: [],
    cdnur: [],
    exp: [],
    nilExempt: [],
  }

  for (const inv of invoices) {
    const key = classifyInvoice(inv)
    buckets[key].push(invToDoc(inv))
    sectionDocs[key].push({
      id: inv.id,
      number: inv.invoiceNumber,
      date: inv.invoiceDate,
      partyName: inv.customerName ?? 'Unknown',
      totalAmount: inv.totalAmount,
    })
  }
  // Mobile keeps credit/debit notes in a separate table (desktop relied on
  // negative-total invoices). Route them into the CDN sections by registration.
  for (const n of notes) {
    const key = isRegistered(n.taxId) ? 'cdnr' : 'cdnur'
    buckets[key].push(noteToDoc(n))
    sectionDocs[key].push({
      id: n.id,
      number: n.noteNumber,
      date: n.noteDate,
      partyName: n.customerName ?? 'Unknown',
      totalAmount: n.totalAmount,
    })
  }

  const sections = {} as Record<Gstr1SectionKey, SectionTotals>
  ;(Object.keys(buckets) as Gstr1SectionKey[]).forEach((k) => {
    sections[k] = totalDocs(buckets[k])
  })

  // Document summary over ALL invoices in range (not notes).
  const docSummary = {
    totalInvoices: invoices.length,
    totalValue: invoices.reduce((s, i) => s + i.totalAmount, 0),
    totalTaxableValue: invoices.reduce((s, i) => s + (i.subtotal - (i.discount || 0)), 0),
    totalTax: invoices.reduce((s, i) => s + i.taxAmount, 0),
    totalIgst: invoices.reduce((s, i) => s + (i.igstAmount || 0), 0),
    totalCgst: invoices.reduce((s, i) => s + (i.cgstAmount || 0), 0),
    totalSgst: invoices.reduce((s, i) => s + (i.sgstAmount || 0), 0),
    totalCess: invoices.reduce((s, i) => s + (i.cessAmount || 0), 0),
  }

  return { sections, sectionDocs, docSummary, hsnSummary }
}

// ---- GSTN portal file (GSTR-1) --------------------------------------------------
// Assembles the invoice-level detail shape the SHARED toGSTNGstr1 consumes
// (identical to what desktop's getGSTR1 feeds it), so both apps emit the same
// portal file. Items are loaded in one inArray query and grouped per invoice.
export async function getGstr1PortalData(
  db: Db,
  range: GstRange,
  startDateIso: string,
): Promise<any> {
  const [invoices, notes, hsnSummary] = await Promise.all([
    fetchInvoices(db, range),
    fetchNotes(db, range),
    getHSNSummary(db, range),
  ])

  const invIds = invoices.map((i) => i.id)
  const items = invIds.length
    ? await db
        .select({
          salesInvoiceId: schema.salesInvoiceItem.salesInvoiceId,
          quantity: schema.salesInvoiceItem.quantity,
          rate: schema.salesInvoiceItem.rate,
          discount: schema.salesInvoiceItem.discount,
          taxRate: schema.salesInvoiceItem.taxRate,
          taxableAmount: schema.salesInvoiceItem.taxableAmount,
          igstAmount: schema.salesInvoiceItem.igstAmount,
          cgstAmount: schema.salesInvoiceItem.cgstAmount,
          sgstAmount: schema.salesInvoiceItem.sgstAmount,
          cessAmount: schema.salesInvoiceItem.cessAmount,
        })
        .from(schema.salesInvoiceItem)
        .where(inArray(schema.salesInvoiceItem.salesInvoiceId, invIds))
    : []
  const itemsByInvoice = new Map<string, typeof items>()
  for (const it of items) {
    const list = itemsByInvoice.get(it.salesInvoiceId) ?? []
    list.push(it)
    itemsByInvoice.set(it.salesInvoiceId, list)
  }

  const toDetail = (inv: InvoiceRow) => ({
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    totalAmount: inv.totalAmount,
    isInterState: inv.isInterState,
    placeOfSupply: inv.placeOfSupply,
    reverseCharge: inv.reverseCharge,
    customer: { taxId: inv.taxId },
    items: itemsByInvoice.get(inv.id) ?? [],
  })

  const grouped: Record<'b2b' | 'b2cl' | 'b2cs', any[]> = { b2b: [], b2cl: [], b2cs: [] }
  for (const inv of invoices) {
    const key = classifyInvoice(inv)
    if (key === 'b2b' || key === 'b2cl' || key === 'b2cs') grouped[key].push(toDetail(inv))
  }

  // Credit/debit notes with their item-level rate detail — the shared builder
  // routes registered ones into cdnr, qualifying unregistered ones into cdnur,
  // and nets the small unregistered ones into b2cs.
  const noteIds = notes.map((n) => n.id)
  const noteItems = noteIds.length
    ? await db
        .select({
          creditDebitNoteId: schema.creditDebitNoteItem.creditDebitNoteId,
          quantity: schema.creditDebitNoteItem.quantity,
          rate: schema.creditDebitNoteItem.rate,
          discount: schema.creditDebitNoteItem.discount,
          taxRate: schema.creditDebitNoteItem.taxRate,
          taxableAmount: schema.creditDebitNoteItem.taxableAmount,
          igstAmount: schema.creditDebitNoteItem.igstAmount,
          cgstAmount: schema.creditDebitNoteItem.cgstAmount,
          sgstAmount: schema.creditDebitNoteItem.sgstAmount,
        })
        .from(schema.creditDebitNoteItem)
        .where(inArray(schema.creditDebitNoteItem.creditDebitNoteId, noteIds))
    : []
  const itemsByNote = new Map<string, typeof noteItems>()
  for (const it of noteItems) {
    const list = itemsByNote.get(it.creditDebitNoteId) ?? []
    list.push(it)
    itemsByNote.set(it.creditDebitNoteId, list)
  }
  const noteDetail = notes.map((n) => ({
    noteNumber: n.noteNumber,
    noteDate: n.noteDate,
    noteType: n.type,
    totalAmount: n.totalAmount,
    isInterState: n.isInterState,
    customer: { taxId: n.taxId },
    items: itemsByNote.get(n.id) ?? [],
  }))

  return {
    sections: {
      b2b: { invoices: grouped.b2b },
      b2cl: { invoices: grouped.b2cl },
      b2cs: { invoices: grouped.b2cs },
      cdnr: { notes: noteDetail.filter((n) => isRegistered(n.customer.taxId)) },
      cdnur: { notes: noteDetail.filter((n) => !isRegistered(n.customer.taxId)) },
    },
    hsnSummary,
    docSummary: {
      totalInvoices: invoices.length,
      totalValue: invoices.reduce((s, i) => s + i.totalAmount, 0),
    },
    period: { startDate: startDateIso },
  }
}

// ===============================================================================
// HSN summary (item-level, grouped by HSN code)
// ===============================================================================
export interface HsnRow {
  hsnCode: string
  description: string
  uqc: string
  totalQuantity: number
  totalValue: number
  taxableValue: number
  igstAmount: number
  cgstAmount: number
  sgstAmount: number
  cessAmount: number
}

export async function getHSNSummary(db: Db, range: GstRange): Promise<HsnRow[]> {
  const invoices = await db
    .select({ id: schema.salesInvoice.id })
    .from(schema.salesInvoice)
    .where(
      and(
        eq(schema.salesInvoice.type, 'INVOICE'),
        gte(schema.salesInvoice.invoiceDate, range.start),
        lte(schema.salesInvoice.invoiceDate, range.end),
        notDeleted(schema.salesInvoice.deletedAt),
        notCancelled(schema.salesInvoice.cancelledAt),
      ),
    )
  const invIds = invoices.map((i) => i.id)
  if (invIds.length === 0) return []

  const lines = await db
    .select({
      hsnLine: schema.salesInvoiceItem.hsnCode,
      hsnItem: schema.item.hsnCode,
      name: schema.item.name,
      unit: schema.item.unit,
      quantity: schema.salesInvoiceItem.quantity,
      rate: schema.salesInvoiceItem.rate,
      discount: schema.salesInvoiceItem.discount,
      total: schema.salesInvoiceItem.total,
      taxableAmount: schema.salesInvoiceItem.taxableAmount,
      igstAmount: schema.salesInvoiceItem.igstAmount,
      cgstAmount: schema.salesInvoiceItem.cgstAmount,
      sgstAmount: schema.salesInvoiceItem.sgstAmount,
      cessAmount: schema.salesInvoiceItem.cessAmount,
    })
    .from(schema.salesInvoiceItem)
    .leftJoin(schema.item, eq(schema.salesInvoiceItem.itemId, schema.item.id))
    .where(inArray(schema.salesInvoiceItem.salesInvoiceId, invIds))

  const map = new Map<string, HsnRow>()
  for (const l of lines) {
    const key = l.hsnLine || l.hsnItem || 'NA'
    let row = map.get(key)
    if (!row) {
      row = {
        hsnCode: key,
        description: l.name || '',
        uqc: l.unit || 'NOS',
        totalQuantity: 0,
        totalValue: 0,
        taxableValue: 0,
        igstAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        cessAmount: 0,
      }
      map.set(key, row)
    }
    const taxable = l.taxableAmount || l.quantity * l.rate - (l.discount || 0)
    row.totalQuantity += l.quantity
    row.totalValue += l.total
    row.taxableValue += taxable
    row.igstAmount += l.igstAmount || 0
    row.cgstAmount += l.cgstAmount || 0
    row.sgstAmount += l.sgstAmount || 0
    row.cessAmount += l.cessAmount || 0
  }
  return Array.from(map.values())
}

// ===============================================================================
// GSTR-2 (inward supplies)
// ===============================================================================
export type Gstr2SectionKey = 'b2b' | 'rcm' | 'nilExempt'

export const GSTR2_SECTION_NAMES: Record<Gstr2SectionKey, string> = {
  b2b: 'B2B (Registered)',
  rcm: 'Reverse Charge',
  nilExempt: 'Nil-rated / Exempt / Unregistered',
}

export interface Gstr2Data {
  sections: Record<Gstr2SectionKey, SectionTotals>
  // Drill-down: the bills behind each section total.
  sectionDocs: Record<Gstr2SectionKey, GstDocDetail[]>
  // Inward (purchase-side) HSN summary.
  hsnSummary: HsnRow[]
  eligibleITC: { igst: number; cgst: number; sgst: number; cess: number }
  ineligibleITC: { igst: number; cgst: number; sgst: number; cess: number }
  docSummary: {
    totalBills: number
    totalValue: number
    totalTaxableValue: number
    totalTax: number
  }
}

export async function getGSTR2(db: Db, range: GstRange): Promise<Gstr2Data> {
  const [bills, hsnSummary] = await Promise.all([
    fetchBills(db, range),
    getPurchaseHSNSummary(db, range),
  ])

  const buckets: Record<Gstr2SectionKey, GstDoc[]> = { b2b: [], rcm: [], nilExempt: [] }
  const sectionDocs: Record<Gstr2SectionKey, GstDocDetail[]> = { b2b: [], rcm: [], nilExempt: [] }
  for (const b of bills) {
    const key: Gstr2SectionKey = b.reverseCharge ? 'rcm' : isRegistered(b.taxId) ? 'b2b' : 'nilExempt'
    buckets[key].push(billToDoc(b))
    sectionDocs[key].push({
      id: b.id,
      number: b.billNumber,
      date: b.billDate,
      partyName: b.supplierName ?? 'Unknown',
      totalAmount: b.totalAmount,
    })
  }
  const sections = {} as Record<Gstr2SectionKey, SectionTotals>
  ;(Object.keys(buckets) as Gstr2SectionKey[]).forEach((k) => {
    sections[k] = totalDocs(buckets[k])
  })

  const sumITC = (rows: BillRow[]) => ({
    igst: rows.reduce((s, b) => s + (b.igstAmount || 0), 0),
    cgst: rows.reduce((s, b) => s + (b.cgstAmount || 0), 0),
    sgst: rows.reduce((s, b) => s + (b.sgstAmount || 0), 0),
    cess: rows.reduce((s, b) => s + (b.cessAmount || 0), 0),
  })
  const eligibleITC = sumITC(bills.filter((b) => b.itcEligibility === 'ELIGIBLE'))
  const ineligibleITC = sumITC(bills.filter((b) => b.itcEligibility === 'INELIGIBLE'))

  return {
    sections,
    sectionDocs,
    hsnSummary,
    eligibleITC,
    ineligibleITC,
    docSummary: {
      totalBills: bills.length,
      totalValue: bills.reduce((s, b) => s + b.totalAmount, 0),
      totalTaxableValue: bills.reduce((s, b) => s + (b.subtotal - (b.discount || 0)), 0),
      totalTax: bills.reduce((s, b) => s + b.taxAmount, 0),
    },
  }
}

// ===============================================================================
// GSTR-3B (monthly summary return)
// ===============================================================================
export interface Gstr3bData {
  outward: {
    interState: { taxableValue: number; igst: number }
    intraState: { taxableValue: number; cgst: number; sgst: number }
    total: { taxableValue: number; igst: number; cgst: number; sgst: number }
  }
  inwardRCM: { taxableValue: number; igst: number; cgst: number; sgst: number; cess: number }
  itc: {
    eligible: { igst: number; cgst: number; sgst: number; cess: number }
    ineligible: { igst: number; cgst: number; sgst: number; cess: number }
    net: { igst: number; cgst: number; sgst: number; cess: number }
  }
  taxLiability: {
    output: { igst: number; cgst: number; sgst: number; cess: number }
    netPayable: { igst: number; cgst: number; sgst: number; cess: number }
    totalPayable: number
  }
}

export async function getGSTR3B(db: Db, range: GstRange): Promise<Gstr3bData> {
  const [invoices, bills] = await Promise.all([fetchInvoices(db, range), fetchBills(db, range)])

  // 3.1 Outward — branch on isInterState.
  const interState = { taxableValue: 0, igst: 0 }
  const intraState = { taxableValue: 0, cgst: 0, sgst: 0 }
  for (const inv of invoices) {
    const taxable = inv.subtotal - (inv.discount || 0)
    if (inv.isInterState) {
      interState.taxableValue += taxable
      interState.igst += inv.igstAmount || 0
    } else {
      intraState.taxableValue += taxable
      intraState.cgst += inv.cgstAmount || 0
      intraState.sgst += inv.sgstAmount || 0
    }
  }

  // 3.2 Inward RCM (reverse-charge purchases).
  const rcm = bills.filter((b) => b.reverseCharge)
  const inwardRCM = {
    taxableValue: rcm.reduce((s, b) => s + (b.subtotal - (b.discount || 0)), 0),
    igst: rcm.reduce((s, b) => s + (b.igstAmount || 0), 0),
    cgst: rcm.reduce((s, b) => s + (b.cgstAmount || 0), 0),
    sgst: rcm.reduce((s, b) => s + (b.sgstAmount || 0), 0),
    cess: rcm.reduce((s, b) => s + (b.cessAmount || 0), 0),
  }

  // 4 ITC — eligible minus ineligible (net can go negative).
  const sumITC = (rows: BillRow[]) => ({
    igst: rows.reduce((s, b) => s + (b.igstAmount || 0), 0),
    cgst: rows.reduce((s, b) => s + (b.cgstAmount || 0), 0),
    sgst: rows.reduce((s, b) => s + (b.sgstAmount || 0), 0),
    cess: rows.reduce((s, b) => s + (b.cessAmount || 0), 0),
  })
  const eligible = sumITC(bills.filter((b) => b.itcEligibility === 'ELIGIBLE'))
  const ineligible = sumITC(bills.filter((b) => b.itcEligibility === 'INELIGIBLE'))
  const net = {
    igst: eligible.igst - ineligible.igst,
    cgst: eligible.cgst - ineligible.cgst,
    sgst: eligible.sgst - ineligible.sgst,
    cess: eligible.cess - ineligible.cess,
  }

  // 6 Output tax INCLUDES reverse-charge tax; net payable clamps at 0.
  const output = {
    igst: invoices.reduce((s, i) => s + (i.igstAmount || 0), 0) + inwardRCM.igst,
    cgst: invoices.reduce((s, i) => s + (i.cgstAmount || 0), 0) + inwardRCM.cgst,
    sgst: invoices.reduce((s, i) => s + (i.sgstAmount || 0), 0) + inwardRCM.sgst,
    cess: invoices.reduce((s, i) => s + (i.cessAmount || 0), 0) + inwardRCM.cess,
  }
  const netPayable = {
    igst: Math.max(0, output.igst - net.igst),
    cgst: Math.max(0, output.cgst - net.cgst),
    sgst: Math.max(0, output.sgst - net.sgst),
    cess: Math.max(0, output.cess - net.cess),
  }

  return {
    outward: {
      interState,
      intraState,
      total: {
        taxableValue: interState.taxableValue + intraState.taxableValue,
        igst: interState.igst,
        cgst: intraState.cgst,
        sgst: intraState.sgst,
      },
    },
    inwardRCM,
    itc: { eligible, ineligible, net },
    taxLiability: {
      output,
      netPayable,
      totalPayable: netPayable.igst + netPayable.cgst + netPayable.sgst + netPayable.cess,
    },
  }
}

// ===============================================================================
// GSTR-9 (annual return)
// ===============================================================================
interface AnnualBucket {
  taxableValue: number
  cgst: number
  sgst: number
  igst: number
  cess: number
}
const emptyAnnual = (): AnnualBucket => ({ taxableValue: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 })

export interface Gstr9Data {
  outward: {
    b2b: AnnualBucket
    b2c: AnnualBucket
    exports: AnnualBucket
    exemptNilRated: { value: number }
    total: AnnualBucket
  }
  inward: { fromRegistered: AnnualBucket; fromUnregistered: AnnualBucket; total: AnnualBucket }
  itcClaimed: { igst: number; cgst: number; sgst: number; cess: number }
  // Part V (mirrors desktop): nothing recorded through cash yet; through-ITC
  // equals the claimed ITC.
  taxPaid: {
    throughCash: { igst: number; cgst: number; sgst: number; cess: number }
    throughITC: { igst: number; cgst: number; sgst: number; cess: number }
  }
  docSummary: {
    totalSalesInvoices: number
    totalPurchaseBills: number
    totalSalesValue: number
    totalPurchaseValue: number
  }
  hsnSummary: HsnRow[]
}

export async function getGSTR9(db: Db, range: GstRange): Promise<Gstr9Data> {
  const [invoices, bills, hsnSummary] = await Promise.all([
    fetchInvoices(db, range),
    fetchBills(db, range),
    getHSNSummary(db, range),
  ])

  const out = {
    b2b: emptyAnnual(),
    b2c: emptyAnnual(),
    exports: emptyAnnual(),
    exemptNilRated: { value: 0 },
    total: emptyAnnual(),
  }
  for (const inv of invoices) {
    const taxable = inv.subtotal - (inv.discount || 0)
    const add = (b: AnnualBucket) => {
      b.taxableValue += taxable
      b.cgst += inv.cgstAmount || 0
      b.sgst += inv.sgstAmount || 0
      b.igst += inv.igstAmount || 0
      b.cess += inv.cessAmount || 0
    }
    if (inv.supplyType === 'EXPORT') {
      out.exports.taxableValue += taxable
      out.exports.igst += inv.igstAmount || 0
    } else if (inv.supplyType === 'NIL_EXEMPT') {
      // Value-only bucket (mirrors desktop's exemptNilRated); folds into total.
      out.exemptNilRated.value += inv.totalAmount
    } else if (isRegistered(inv.taxId)) {
      add(out.b2b)
    } else {
      add(out.b2c)
    }
    add(out.total)
  }

  const inw = { fromRegistered: emptyAnnual(), fromUnregistered: emptyAnnual(), total: emptyAnnual() }
  for (const b of bills) {
    const taxable = b.subtotal - (b.discount || 0)
    const add = (bk: AnnualBucket) => {
      bk.taxableValue += taxable
      bk.cgst += b.cgstAmount || 0
      bk.sgst += b.sgstAmount || 0
      bk.igst += b.igstAmount || 0
      bk.cess += b.cessAmount || 0
    }
    if (isRegistered(b.taxId)) add(inw.fromRegistered)
    else add(inw.fromUnregistered)
    add(inw.total)
  }

  const eligible = bills.filter((b) => b.itcEligibility === 'ELIGIBLE')
  const itcClaimed = {
    igst: eligible.reduce((s, b) => s + (b.igstAmount || 0), 0),
    cgst: eligible.reduce((s, b) => s + (b.cgstAmount || 0), 0),
    sgst: eligible.reduce((s, b) => s + (b.sgstAmount || 0), 0),
    cess: eligible.reduce((s, b) => s + (b.cessAmount || 0), 0),
  }

  return {
    outward: out,
    inward: inw,
    itcClaimed,
    taxPaid: {
      throughCash: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
      throughITC: { ...itcClaimed },
    },
    docSummary: {
      totalSalesInvoices: invoices.length,
      totalPurchaseBills: bills.length,
      totalSalesValue: invoices.reduce((s, i) => s + i.totalAmount, 0),
      totalPurchaseValue: bills.reduce((s, b) => s + b.totalAmount, 0),
    },
    hsnSummary,
  }
}

// Purchase-side (inward) HSN summary — same grouping as getHSNSummary but over
// purchase bill lines, with names/units from the supplier catalog. Fills the
// "inward HSN" gap vs desktop's GSTR-2 depth.
export async function getPurchaseHSNSummary(db: Db, range: GstRange): Promise<HsnRow[]> {
  const bills = await db
    .select({ id: schema.purchaseBill.id })
    .from(schema.purchaseBill)
    .where(
      and(
        gte(schema.purchaseBill.billDate, range.start),
        lte(schema.purchaseBill.billDate, range.end),
        notDeleted(schema.purchaseBill.deletedAt),
        notCancelled(schema.purchaseBill.cancelledAt),
      ),
    )
  const billIds = bills.map((b) => b.id)
  if (billIds.length === 0) return []

  const lines = await db
    .select({
      hsnLine: schema.purchaseBillItem.hsnCode,
      hsnItem: schema.supplierItem.hsnCode,
      name: schema.supplierItem.name,
      unit: schema.supplierItem.unit,
      quantity: schema.purchaseBillItem.quantity,
      rate: schema.purchaseBillItem.rate,
      discount: schema.purchaseBillItem.discount,
      total: schema.purchaseBillItem.total,
      taxableAmount: schema.purchaseBillItem.taxableAmount,
      igstAmount: schema.purchaseBillItem.igstAmount,
      cgstAmount: schema.purchaseBillItem.cgstAmount,
      sgstAmount: schema.purchaseBillItem.sgstAmount,
      cessAmount: schema.purchaseBillItem.cessAmount,
    })
    .from(schema.purchaseBillItem)
    .leftJoin(schema.supplierItem, eq(schema.purchaseBillItem.supplierItemId, schema.supplierItem.id))
    .where(inArray(schema.purchaseBillItem.purchaseBillId, billIds))

  const map = new Map<string, HsnRow>()
  for (const l of lines) {
    const key = l.hsnLine || l.hsnItem || 'NA'
    let row = map.get(key)
    if (!row) {
      row = {
        hsnCode: key,
        description: l.name || '',
        uqc: l.unit || 'NOS',
        totalQuantity: 0,
        totalValue: 0,
        taxableValue: 0,
        igstAmount: 0,
        cgstAmount: 0,
        sgstAmount: 0,
        cessAmount: 0,
      }
      map.set(key, row)
    }
    const taxable = l.taxableAmount || l.quantity * l.rate - (l.discount || 0)
    row.totalQuantity += l.quantity
    row.totalValue += l.total
    row.taxableValue += taxable
    row.igstAmount += l.igstAmount || 0
    row.cgstAmount += l.cgstAmount || 0
    row.sgstAmount += l.sgstAmount || 0
    row.cessAmount += l.cessAmount || 0
  }
  return Array.from(map.values())
}
