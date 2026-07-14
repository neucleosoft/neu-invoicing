// Drizzle query helpers used by the dashboard screen. Each function takes a
// db instance (obtained via useDb() at the call site) and returns a Promise.
// Split out of the screen so the screen file stays focused on layout, and
// future dashboards (or a "/reports" screen) can reuse these aggregates.
//
// Mirrors apps/desktop/electron/main/handlers/dashboard.ts in intent.

import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  lt,
  ne,
  sql,
} from 'drizzle-orm'

import { schema, useDb } from '@/db'
import { notCancelled, notDeleted } from '@/db/softDelete'

// Reuse useDb's inferred return type so callers and helpers stay in sync.
type Db = ReturnType<typeof useDb>

// Indian SMB fallback. Most businesses use April-March; desktop's Company
// schema defaults `fiscalYearStart` to 4 for the same reason.
const DEFAULT_FY_START_MONTH = 4

// Reads the company's preferred FY start month. Falls back to April if the
// company row doesn't exist or the column is null.
export async function getFiscalYearStartMonth(db: Db): Promise<number> {
  const rows = await db
    .select({ fyStart: schema.company.fiscalYearStart })
    .from(schema.company)
    .limit(1)
  return rows[0]?.fyStart ?? DEFAULT_FY_START_MONTH
}

// Sum of balanceDue across unpaid invoices — money customers still owe.
export async function getTotalReceivables(db: Db): Promise<number> {
  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${schema.salesInvoice.balanceDue}), 0)`,
    })
    .from(schema.salesInvoice)
    .where(
      and(
        ne(schema.salesInvoice.status, 'PAID'),
        notDeleted(schema.salesInvoice.deletedAt),
        notCancelled(schema.salesInvoice.cancelledAt),
      ),
    )
  return rows[0]?.total ?? 0
}

// Sum of totalAmount for invoices issued since the start of the current FY.
// "Current FY" is calendar-year-aware: if today is March (before April),
// the FY started April 1 of the PREVIOUS calendar year.
export async function getTotalInvoicedThisFY(
  db: Db,
  fyStartMonth: number,
): Promise<number> {
  const today = new Date()
  const year =
    today.getMonth() + 1 < fyStartMonth
      ? today.getFullYear() - 1
      : today.getFullYear()
  const fyStartDate = new Date(year, fyStartMonth - 1, 1)
  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${schema.salesInvoice.totalAmount}), 0)`,
    })
    .from(schema.salesInvoice)
    .where(
      and(
        gte(schema.salesInvoice.invoiceDate, fyStartDate),
        notDeleted(schema.salesInvoice.deletedAt),
        notCancelled(schema.salesInvoice.cancelledAt),
      ),
    )
  // Net out credit/debit notes issued this FY (a return reduces what you invoiced).
  const noteRows = await db
    .select({
      netTotal: sql<number>`COALESCE(SUM(CASE WHEN ${schema.creditDebitNote.type} = 'CREDIT_NOTE' THEN -${schema.creditDebitNote.totalAmount} ELSE ${schema.creditDebitNote.totalAmount} END), 0)`,
    })
    .from(schema.creditDebitNote)
    .where(
      and(
        gte(schema.creditDebitNote.noteDate, fyStartDate),
        eq(schema.creditDebitNote.status, 'ACTIVE'),
        notDeleted(schema.creditDebitNote.deletedAt),
        notCancelled(schema.creditDebitNote.cancelledAt),
      ),
    )
  return (rows[0]?.total ?? 0) + (noteRows[0]?.netTotal ?? 0)
}

// Count of unpaid invoices whose dueDate is strictly before today.
export async function getOverdueCount(db: Db): Promise<number> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const rows = await db
    .select({ count: count() })
    .from(schema.salesInvoice)
    .where(
      and(
        ne(schema.salesInvoice.status, 'PAID'),
        isNotNull(schema.salesInvoice.dueDate),
        lt(schema.salesInvoice.dueDate, today),
        notDeleted(schema.salesInvoice.deletedAt),
        notCancelled(schema.salesInvoice.cancelledAt),
      ),
    )
  return rows[0]?.count ?? 0
}

// Count of stock-tracked items whose currentStock has dropped below the
// per-item warning threshold. The column-to-column comparison is expressed
// via raw sql template because drizzle's `lt` helper takes a column + value.
export async function getLowStockCount(db: Db): Promise<number> {
  const rows = await db
    .select({ count: count() })
    .from(schema.item)
    .where(
      and(
        eq(schema.item.trackStock, true),
        sql`${schema.item.currentStock} < ${schema.item.lowStockWarning}`,
        notDeleted(schema.item.deletedAt),
      ),
    )
  return rows[0]?.count ?? 0
}

// Money owed TO suppliers — sum of unpaid bill balances, the mirror image of
// getTotalReceivables (bill-derived, so cancelled bills don't distort it).
export async function getTotalPayables(db: Db): Promise<number> {
  const rows = await db
    .select({
      total: sql<number>`COALESCE(SUM(${schema.purchaseBill.balanceDue}), 0)`,
    })
    .from(schema.purchaseBill)
    .where(
      and(
        ne(schema.purchaseBill.status, 'PAID'),
        notDeleted(schema.purchaseBill.deletedAt),
        notCancelled(schema.purchaseBill.cancelledAt),
      ),
    )
  return rows[0]?.total ?? 0
}

// Cash + bank on hand — Σ active account balances, same math as the Cash &
// Bank screen's summary cards (and desktop cashBank:getTotalBalance).
export async function getCashBankTotals(
  db: Db,
): Promise<{ cash: number; bank: number; total: number }> {
  const rows = await db
    .select({
      type: schema.bankAccount.type,
      total: sql<number>`COALESCE(SUM(${schema.bankAccount.currentBalance}), 0)`,
    })
    .from(schema.bankAccount)
    .where(notDeleted(schema.bankAccount.deletedAt))
    .groupBy(schema.bankAccount.type)
  let cash = 0
  let bank = 0
  for (const r of rows) {
    if (r.type === 'CASH') cash += r.total
    else bank += r.total
  }
  return { cash, bank, total: cash + bank }
}

export type MonthlySales = { label: string; total: number }

// Invoiced totals per calendar month for the last N months (active invoices
// only) — feeds the dashboard trend bars. Grouped in JS: month buckets from
// epoch-ms dates are timezone-dependent, so SQL strftime would need the same
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
    .where(and(notDeleted(schema.salesInvoice.deletedAt), notCancelled(schema.salesInvoice.cancelledAt)))
    .orderBy(desc(schema.salesInvoice.invoiceDate))
    .limit(limit)
  return rows.map((r) => ({ ...r.invoice, customerName: r.customerName }))
}
