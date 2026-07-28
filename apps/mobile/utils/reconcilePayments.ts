// Payment reconciliation — the human-decision half of Data Health.
//
// Problem class: invoices whose STORED paid-state (status/amountPaid, often
// set by hand in old app versions) claims more money than the linked payment
// rows can prove. The recompute engine would "fix" these by downgrading the
// status; the human answer is usually the opposite — the money WAS received
// and never entered. This module finds those gaps and, for the invoices the
// user confirms, records the missing amount as a real linked PAYMENT_IN.
//
// Real payment rows sync to every device (unlike recompute repairs, which
// stay local by design), so one confirmed pass here converges the fleet.

import { and, eq, inArray, isNull, ne, sql } from 'drizzle-orm'

import { schema, useDb } from '@/db'

type Db = ReturnType<typeof useDb>

const round2 = (n: number) => Math.round(n * 100) / 100

export interface UnbackedInvoice {
  id: string
  invoiceNumber: string
  customerId: string | null
  customerName: string
  invoiceDate: Date
  totalAmount: number
  /** What the stored status/amountPaid claims was paid. */
  claimed: number
  /** What linked payments + credit notes actually prove. */
  covered: number
  /** claimed − covered: the amount with no payment record behind it. */
  gap: number
  storedBalanceDue: number
}

/** Live invoices whose claimed paid-state exceeds linked payment coverage. */
export async function findUnbackedInvoices(db: Db): Promise<UnbackedInvoice[]> {
  const invoices = await db
    .select({
      id: schema.salesInvoice.id,
      invoiceNumber: schema.salesInvoice.invoiceNumber,
      customerId: schema.salesInvoice.customerId,
      customerName: schema.customer.name,
      invoiceDate: schema.salesInvoice.invoiceDate,
      totalAmount: schema.salesInvoice.totalAmount,
      amountPaid: schema.salesInvoice.amountPaid,
      balanceDue: schema.salesInvoice.balanceDue,
      status: schema.salesInvoice.status,
    })
    .from(schema.salesInvoice)
    .leftJoin(schema.customer, eq(schema.salesInvoice.customerId, schema.customer.id))
    .where(
      and(
        eq(schema.salesInvoice.type, 'INVOICE'),
        ne(schema.salesInvoice.status, 'REVERSED'),
        isNull(schema.salesInvoice.deletedAt),
        isNull(schema.salesInvoice.cancelledAt),
      ),
    )
  if (invoices.length === 0) return []

  const ids = invoices.map((i) => i.id)

  const paymentSums = await db
    .select({
      salesInvoiceId: schema.paymentTransaction.salesInvoiceId,
      total: sql<number>`COALESCE(SUM(${schema.paymentTransaction.amount}), 0)`,
    })
    .from(schema.paymentTransaction)
    .where(
      and(
        inArray(schema.paymentTransaction.salesInvoiceId, ids),
        eq(schema.paymentTransaction.type, 'PAYMENT_IN'),
        isNull(schema.paymentTransaction.deletedAt),
        isNull(schema.paymentTransaction.cancelledAt),
      ),
    )
    .groupBy(schema.paymentTransaction.salesInvoiceId)

  const noteSums = await db
    .select({
      referenceInvoiceId: schema.creditDebitNote.referenceInvoiceId,
      total: sql<number>`COALESCE(SUM(${schema.creditDebitNote.totalAmount}), 0)`,
    })
    .from(schema.creditDebitNote)
    .where(
      and(
        inArray(schema.creditDebitNote.referenceInvoiceId, ids),
        eq(schema.creditDebitNote.type, 'CREDIT_NOTE'),
        eq(schema.creditDebitNote.status, 'ACTIVE'),
        isNull(schema.creditDebitNote.deletedAt),
        isNull(schema.creditDebitNote.cancelledAt),
      ),
    )
    .groupBy(schema.creditDebitNote.referenceInvoiceId)

  const paidBy = new Map(paymentSums.map((p) => [p.salesInvoiceId, p.total]))
  const notedBy = new Map(noteSums.map((n) => [n.referenceInvoiceId, n.total]))

  const out: UnbackedInvoice[] = []
  for (const inv of invoices) {
    const claimed = inv.status === 'PAID' ? inv.totalAmount : inv.amountPaid
    const covered = (paidBy.get(inv.id) ?? 0) + (notedBy.get(inv.id) ?? 0)
    const gap = round2(claimed - covered)
    if (gap > 0.01) {
      out.push({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        customerId: inv.customerId,
        customerName: inv.customerName ?? '(no customer)',
        invoiceDate: inv.invoiceDate,
        totalAmount: inv.totalAmount,
        claimed: round2(claimed),
        covered: round2(covered),
        gap,
        storedBalanceDue: inv.balanceDue,
      })
    }
  }
  out.sort((a, b) => (a.invoiceNumber < b.invoiceNumber ? -1 : 1))
  return out
}

/** Record the missing linked payment for each confirmed invoice, and settle
 *  the invoice's stored figures to exactly what it now proves. NOT the
 *  applyPayment increment path on purpose: stored amountPaid may already
 *  include the gap (that's the whole problem), so figures are SET, not added. */
export async function applyReconciliation(db: Db, rows: UnbackedInvoice[]): Promise<number> {
  if (rows.length === 0) return 0
  await db.transaction(async (tx) => {
    for (const r of rows) {
      await tx.insert(schema.paymentTransaction).values({
        type: 'PAYMENT_IN',
        customerId: r.customerId,
        supplierId: null,
        amount: r.gap,
        paymentMode: 'CASH',
        paymentDate: r.invoiceDate,
        salesInvoiceId: r.id,
        referenceType: 'INVOICE',
        notes: 'Reconciled: recorded to match invoice status',
      })

      const newBalanceDue = round2(Math.max(0, r.totalAmount - r.claimed))
      const newStatus = newBalanceDue <= 0.005 ? 'PAID' : r.claimed > 0 ? 'PARTIAL' : 'DRAFT'
      await tx
        .update(schema.salesInvoice)
        .set({ amountPaid: r.claimed, balanceDue: newBalanceDue, status: newStatus })
        .where(eq(schema.salesInvoice.id, r.id))

      // Customer balance holds the sum of open dues; only move it by however
      // much this invoice's stored due actually changed (usually zero — a
      // stored-PAID invoice was already excluded from the balance).
      const balanceDelta = round2(newBalanceDue - r.storedBalanceDue)
      if (r.customerId && Math.abs(balanceDelta) > 0.005) {
        await tx
          .update(schema.customer)
          .set({ currentBalance: sql`${schema.customer.currentBalance} + ${balanceDelta}` })
          .where(eq(schema.customer.id, r.customerId))
      }
    }
  })
  return rows.length
}
