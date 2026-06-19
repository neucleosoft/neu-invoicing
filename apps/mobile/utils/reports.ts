// Business-report aggregations. Mirrors apps/desktop/electron/main/handlers/report.ts
// math, run directly in Drizzle. Five reports: Sales, Stock, Receivables, Payables, Tax.
//
// NOTE: the desktop *renderer* (Reports.tsx) reads field names the handler never
// returns (totalSales/totalTax/invoiceCount, totalTaxCollected/Paid), so the
// desktop page currently shows zeros. We expose the correctly-named fields here
// so the mobile screen shows real numbers — same math, fixed wiring.

import { and, asc, desc, eq, gt, gte, lte, sql, type SQL } from 'drizzle-orm'

import { schema, useDb } from '@/db'
import { notCancelled, notDeleted } from '@/db/softDelete'

type Db = ReturnType<typeof useDb>

export type SalesStatus = '' | 'PAID' | 'PARTIAL' | 'DRAFT'

export interface DateRange {
  startDate: Date | null
  endDate: Date | null
}

export interface SalesReport {
  totalSales: number
  totalTax: number
  invoiceCount: number
  subtotal: number
  discount: number
  amountPaid: number
  balanceDue: number
}

// Sales: sum over salesInvoice WHERE type='INVOICE' (+ optional date range +
// optional status). status is an INCLUSION filter, not an exclusion (picking
// "DRAFT" filters TO drafts) — matches desktop exactly; no DRAFT/CANCELLED skip.
export async function getSalesReport(
  db: Db,
  range: DateRange,
  status: SalesStatus,
): Promise<SalesReport> {
  const conds: SQL[] = [
    eq(schema.salesInvoice.type, 'INVOICE'),
    notDeleted(schema.salesInvoice.deletedAt),
  ]
  if (range.startDate) conds.push(gte(schema.salesInvoice.invoiceDate, range.startDate))
  if (range.endDate) conds.push(lte(schema.salesInvoice.invoiceDate, range.endDate))
  if (status) conds.push(eq(schema.salesInvoice.status, status))

  const rows = await db
    .select({
      subtotal: sql<number>`COALESCE(SUM(${schema.salesInvoice.subtotal}), 0)`,
      discount: sql<number>`COALESCE(SUM(${schema.salesInvoice.discount}), 0)`,
      taxAmount: sql<number>`COALESCE(SUM(${schema.salesInvoice.taxAmount}), 0)`,
      totalAmount: sql<number>`COALESCE(SUM(${schema.salesInvoice.totalAmount}), 0)`,
      amountPaid: sql<number>`COALESCE(SUM(${schema.salesInvoice.amountPaid}), 0)`,
      balanceDue: sql<number>`COALESCE(SUM(${schema.salesInvoice.balanceDue}), 0)`,
      invoiceCount: sql<number>`COUNT(*)`,
    })
    .from(schema.salesInvoice)
    .where(and(...conds))

  const r = rows[0]
  return {
    totalSales: r?.totalAmount ?? 0,
    totalTax: r?.taxAmount ?? 0,
    invoiceCount: r?.invoiceCount ?? 0,
    subtotal: r?.subtotal ?? 0,
    discount: r?.discount ?? 0,
    amountPaid: r?.amountPaid ?? 0,
    balanceDue: r?.balanceDue ?? 0,
  }
}

export interface StockRow {
  id: string
  name: string
  currentStock: number
  lowStockWarning: number
  unit: string
  stockValue: number
  status: 'Low Stock' | 'In Stock'
}

export interface StockSummary {
  items: StockRow[]
  totalStockValue: number
}

// Stock: stock-tracked items only, name asc. Per item: value = currentStock ×
// purchasePrice, status = currentStock <= lowStockWarning ? Low Stock : In Stock.
export async function getStockSummary(db: Db): Promise<StockSummary> {
  const items = await db
    .select()
    .from(schema.item)
    .where(and(eq(schema.item.trackStock, true), notDeleted(schema.item.deletedAt)))
    .orderBy(asc(schema.item.name))

  const rows: StockRow[] = items.map((it) => ({
    id: it.id,
    name: it.name,
    currentStock: it.currentStock,
    lowStockWarning: it.lowStockWarning,
    unit: it.unit,
    stockValue: it.currentStock * it.purchasePrice,
    status: it.currentStock <= it.lowStockWarning ? 'Low Stock' : 'In Stock',
  }))
  return { items: rows, totalStockValue: rows.reduce((s, r) => s + r.stockValue, 0) }
}

export interface PartyBalanceRow {
  id: string
  name: string
  currentBalance: number
}

export interface PartyBalanceReport {
  parties: PartyBalanceRow[]
  total: number
}

// Receivables: customers who owe (currentBalance > 0), highest first.
export async function getReceivables(db: Db): Promise<PartyBalanceReport> {
  const parties = await db
    .select({
      id: schema.customer.id,
      name: schema.customer.name,
      currentBalance: schema.customer.currentBalance,
    })
    .from(schema.customer)
    .where(and(gt(schema.customer.currentBalance, 0), notDeleted(schema.customer.deletedAt)))
    .orderBy(desc(schema.customer.currentBalance))
  return { parties, total: parties.reduce((s, p) => s + p.currentBalance, 0) }
}

// Payables: suppliers you owe (currentBalance > 0), highest first. Display side
// uses Math.abs (desktop keeps it defensively), but the WHERE already excludes <= 0.
export async function getPayables(db: Db): Promise<PartyBalanceReport> {
  const parties = await db
    .select({
      id: schema.supplier.id,
      name: schema.supplier.name,
      currentBalance: schema.supplier.currentBalance,
    })
    .from(schema.supplier)
    .where(and(gt(schema.supplier.currentBalance, 0), notDeleted(schema.supplier.deletedAt)))
    .orderBy(desc(schema.supplier.currentBalance))
  return { parties, total: parties.reduce((s, p) => s + p.currentBalance, 0) }
}

export interface TaxReport {
  taxCollected: number
  taxPaid: number
  netTax: number
}

// Tax: tax collected on sales (salesInvoice.taxAmount, type='INVOICE') minus tax
// paid on purchases (purchaseBill.taxAmount), over the same date range. Desktop
// sums the single taxAmount column (not cgst/sgst/igst separately); we mirror that.
// Status filter does NOT apply to tax (only dates).
export async function getTaxReport(db: Db, range: DateRange): Promise<TaxReport> {
  const sConds: SQL[] = [
    eq(schema.salesInvoice.type, 'INVOICE'),
    notDeleted(schema.salesInvoice.deletedAt),
  ]
  if (range.startDate) sConds.push(gte(schema.salesInvoice.invoiceDate, range.startDate))
  if (range.endDate) sConds.push(lte(schema.salesInvoice.invoiceDate, range.endDate))

  const pConds: SQL[] = [notDeleted(schema.purchaseBill.deletedAt), notCancelled(schema.purchaseBill.cancelledAt)]
  if (range.startDate) pConds.push(gte(schema.purchaseBill.billDate, range.startDate))
  if (range.endDate) pConds.push(lte(schema.purchaseBill.billDate, range.endDate))

  const [salesRows, purchaseRows] = await Promise.all([
    db
      .select({ taxCollected: sql<number>`COALESCE(SUM(${schema.salesInvoice.taxAmount}), 0)` })
      .from(schema.salesInvoice)
      .where(and(...sConds)),
    db
      .select({ taxPaid: sql<number>`COALESCE(SUM(${schema.purchaseBill.taxAmount}), 0)` })
      .from(schema.purchaseBill)
      .where(pConds.length ? and(...pConds) : undefined),
  ])

  const taxCollected = salesRows[0]?.taxCollected ?? 0
  const taxPaid = purchaseRows[0]?.taxPaid ?? 0
  return { taxCollected, taxPaid, netTax: taxCollected - taxPaid }
}
