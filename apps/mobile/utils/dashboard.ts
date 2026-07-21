// Dashboard query helpers used by the dashboard screen. The metric MATH
// (receivables, payables, FY sales, overdue, low stock, cash & bank) lives in
// @neu/shared/dashboardDb — the same code desktop's dashboard:getMetrics
// handler runs, so the two dashboards can never disagree again. This file
// keeps the screen-facing names plus the display-only helpers (monthly trend
// bars, recent-invoice rows) that have no desktop twin.

import {
  getCashBankTotalsDb,
  getFiscalYearStartMonthDb,
  getLowStockCountDb,
  getOverdueCountDb,
  getTotalPayablesDb,
  getTotalReceivablesDb,
  getTotalSalesThisFYDb,
} from '@neu/shared'
import { and, desc, eq, gte } from 'drizzle-orm'

import { schema, useDb } from '@/db'
import { notCancelled, notDeleted } from '@/db/softDelete'

// Reuse useDb's inferred return type so callers and helpers stay in sync.
type Db = ReturnType<typeof useDb>

export const getFiscalYearStartMonth = (db: Db) => getFiscalYearStartMonthDb(db)

export const getTotalReceivables = (db: Db) => getTotalReceivablesDb(db)

export const getTotalInvoicedThisFY = (db: Db, fyStartMonth: number) =>
  getTotalSalesThisFYDb(db, fyStartMonth)

export const getOverdueCount = (db: Db) => getOverdueCountDb(db)

export const getLowStockCount = (db: Db) => getLowStockCountDb(db)

export const getTotalPayables = (db: Db) => getTotalPayablesDb(db)

export const getCashBankTotals = (db: Db) => getCashBankTotalsDb(db)

export type MonthlySales = { label: string; total: number }

// Invoiced totals per calendar month for the last N months (active REAL
// invoices only — legacy quotation/proforma rows in SalesInvoice excluded) —
// feeds the dashboard trend bars. Grouped in JS: month buckets from epoch-ms
// dates are timezone-dependent, so SQL strftime would need the same
// local-time care anyway.
export async function getMonthlySales(db: Db, months: number): Promise<MonthlySales[]> {
  const start = new Date()
  start.setDate(1)
  start.setHours(0, 0, 0, 0)
  start.setMonth(start.getMonth() - (months - 1))

  const rows = await db
    .select({
      invoiceDate: schema.salesInvoice.invoiceDate,
      totalAmount: schema.salesInvoice.totalAmount,
    })
    .from(schema.salesInvoice)
    .where(
      and(
        eq(schema.salesInvoice.type, 'INVOICE'),
        gte(schema.salesInvoice.invoiceDate, start),
        notDeleted(schema.salesInvoice.deletedAt),
        notCancelled(schema.salesInvoice.cancelledAt),
      ),
    )

  const out: MonthlySales[] = []
  const cursor = new Date(start)
  for (let i = 0; i < months; i++) {
    out.push({ label: cursor.toLocaleString(undefined, { month: 'short' }), total: 0 })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  for (const r of rows) {
    const d = new Date(r.invoiceDate)
    const idx = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth())
    if (idx >= 0 && idx < months) out[idx].total += r.totalAmount
  }
  return out
}

export type RecentInvoice = typeof schema.salesInvoice.$inferSelect & {
  customerName: string | null
}

// Top N invoices by invoiceDate desc, joined with their customer for the name.
// Same shape as the rows in the Invoices tab — same display pattern reused.
export async function getRecentInvoices(
  db: Db,
  limit: number,
): Promise<RecentInvoice[]> {
  const rows = await db
    .select({
      invoice: schema.salesInvoice,
      customerName: schema.customer.name,
    })
    .from(schema.salesInvoice)
    .leftJoin(
      schema.customer,
      eq(schema.salesInvoice.customerId, schema.customer.id),
    )
    .where(
      and(
        eq(schema.salesInvoice.type, 'INVOICE'),
        notDeleted(schema.salesInvoice.deletedAt),
        notCancelled(schema.salesInvoice.cancelledAt),
      ),
    )
    .orderBy(desc(schema.salesInvoice.invoiceDate))
    .limit(limit)
  return rows.map((r) => ({ ...r.invoice, customerName: r.customerName }))
}
