// Dashboard metrics — computed ONCE for both apps. These numbers were
// previously written twice (desktop handler + mobile helpers) and drifted
// four ways: mobile forgot `type = 'INVOICE'` (legacy quotation/proforma
// rows that still live in SalesInvoice counted as sales/receivables),
// disagreed on which statuses are "overdue", and used `<` instead of `<=`
// for the low-stock boundary.
// The semantics below are the canonical desktop ones — the set the boss's
// numbers were validated against and the same filters recompute/reports use.

import { and, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm'

import * as schema from './schema'
import type { DrizzleDbLike } from './rowSyncDb'

// Indian SMB fallback: April–March, matching the Company schema default.
export const DEFAULT_FY_START_MONTH = 4

export async function getFiscalYearStartMonthDb(db: DrizzleDbLike): Promise<number> {
  const rows = await db
    .select({ fyStart: schema.company.fiscalYearStart })
    .from(schema.company)
    .limit(1)
  return rows[0]?.fyStart ?? DEFAULT_FY_START_MONTH
}

/** First day of the current fiscal year for a given start month. */
export function fiscalYearStartDate(fyStartMonth: number, today = new Date()): Date {
  const year = today.getMonth() + 1 >= fyStartMonth ? today.getFullYear() : today.getFullYear() - 1
  return new Date(year, fyStartMonth - 1, 1)
}

// Live rows only, real invoices only (the SalesInvoice table still carries
// legacy QUOTATION/PROFORMA rows from before those had their own tables).
const liveInvoice = () =>
  and(
    eq(schema.salesInvoice.type, 'INVOICE'),
    isNull(schema.salesInvoice.deletedAt),
    isNull(schema.salesInvoice.cancelledAt),
  )

/** Money customers still owe — Σ balanceDue of open invoices. */
export async function getTotalReceivablesDb(db: DrizzleDbLike): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`COALESCE(SUM(${schema.salesInvoice.balanceDue}), 0)` })
    .from(schema.salesInvoice)
    .where(and(liveInvoice(), inArray(schema.salesInvoice.status, ['DRAFT', 'PARTIAL', 'OVERDUE'])))
  return rows[0]?.total ?? 0
}

/** Money owed to suppliers — Σ balanceDue of open bills. */
export async function getTotalPayablesDb(db: DrizzleDbLike): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`COALESCE(SUM(${schema.purchaseBill.balanceDue}), 0)` })
    .from(schema.purchaseBill)
    .where(and(
      inArray(schema.purchaseBill.status, ['DRAFT', 'PARTIAL', 'OVERDUE']),
      isNull(schema.purchaseBill.deletedAt),
      isNull(schema.purchaseBill.cancelledAt),
    ))
  return rows[0]?.total ?? 0
}

/** Σ invoice totals since FY start, net of credit/debit notes issued in the
 *  same window (a return reduces sales; a debit note adds). */
export async function getTotalSalesThisFYDb(db: DrizzleDbLike, fyStartMonth: number): Promise<number> {
  const fyStart = fiscalYearStartDate(fyStartMonth)
  const rows = await db
    .select({ total: sql<number>`COALESCE(SUM(${schema.salesInvoice.totalAmount}), 0)` })
    .from(schema.salesInvoice)
    .where(and(liveInvoice(), gte(schema.salesInvoice.invoiceDate, fyStart)))
  const noteRows = await db
    .select({
      netTotal: sql<number>`COALESCE(SUM(CASE WHEN ${schema.creditDebitNote.type} = 'CREDIT_NOTE' THEN -${schema.creditDebitNote.totalAmount} ELSE ${schema.creditDebitNote.totalAmount} END), 0)`,
    })
    .from(schema.creditDebitNote)
    .where(and(
      gte(schema.creditDebitNote.noteDate, fyStart),
      eq(schema.creditDebitNote.status, 'ACTIVE'),
      isNull(schema.creditDebitNote.deletedAt),
      isNull(schema.creditDebitNote.cancelledAt),
    ))
  return (rows[0]?.total ?? 0) + (noteRows[0]?.netTotal ?? 0)
}

/** Open invoices past their due date RIGHT NOW. Status-set on purpose:
 *  DRAFT/PARTIAL — a REVERSED invoice owes nothing, and a manually-OVERDUE
 *  one is already flagged by its own status. */
export async function getOverdueCountDb(db: DrizzleDbLike): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(schema.salesInvoice)
    .where(and(
      liveInvoice(),
      inArray(schema.salesInvoice.status, ['DRAFT', 'PARTIAL']),
      lt(schema.salesInvoice.dueDate, new Date()),
    ))
  return rows[0]?.n ?? 0
}

/** Stock-tracked items AT or below their warning level (<=, so "exactly at
 *  the threshold" already warns). */
export async function getLowStockCountDb(db: DrizzleDbLike): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`COUNT(*)` })
    .from(schema.item)
    .where(and(
      eq(schema.item.trackStock, true),
      sql`${schema.item.currentStock} <= ${schema.item.lowStockWarning}`,
      isNull(schema.item.deletedAt),
    ))
  return rows[0]?.n ?? 0
}

/** Cash + bank on hand. CASH accounts vs everything else, so `total` is
 *  always the sum of ALL live accounts (what both dashboards showed). */
export async function getCashBankTotalsDb(
  db: DrizzleDbLike,
): Promise<{ cash: number; bank: number; total: number }> {
  const rows = await db
    .select({
      type: schema.bankAccount.type,
      total: sql<number>`COALESCE(SUM(${schema.bankAccount.currentBalance}), 0)`,
    })
    .from(schema.bankAccount)
    .where(isNull(schema.bankAccount.deletedAt))
    .groupBy(schema.bankAccount.type)
  let cash = 0
  let bank = 0
  for (const r of rows) {
    if (r.type === 'CASH') cash += r.total
    else bank += r.total
  }
  return { cash, bank, total: cash + bank }
}
