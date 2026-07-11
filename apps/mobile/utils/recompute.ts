// In-app recompute pass — the shared engine, wired to this app's Drizzle database.
//
// This is the MOBILE twin of apps/desktop/electron/main/recompute.ts. The engine
// math AND the dry-run diff/report plumbing live in @neu/shared
// (recompute.ts + recomputeReport.ts) — only the fetch and write here are
// app-specific, so desktop and mobile compute and REPORT identically and can't
// disagree after a sync merge.
//
// DRY RUN by default: reports what WOULD change, writes nothing. With
// { apply: true } it writes the rebuilt numbers back in one transaction.
//
// SAFETY: recompute is only as honest as the documents. If a document lies (e.g.
// an invoice marked unpaid that was really paid), the rebuild faithfully
// reproduces the lie. Always read the dry-run diff and fix dirty documents BEFORE
// you ever pass { apply: true }.

import { eq } from 'drizzle-orm'
import {
  RECOMPUTE_EPS as EPS,
  benignStatus,
  formatRecomputeReport,
  round2,
  runRecomputeDiff,
  type RecomputeReport,
} from '@neu/shared'

import { schema, useDb } from '@/db'

type Db = ReturnType<typeof useDb>

export { formatRecomputeReport }
export type { RecomputeReport }

export async function recomputeAll(
  db: Db,
  opts: { apply?: boolean } = {},
): Promise<RecomputeReport> {
  const apply = opts.apply === true

  // updatedAt is fetched so every write below can PRESERVE it explicitly:
  // recompute is a machine correction of derived columns, not a content edit.
  // Letting $onUpdate auto-bump here would hijack sync's newest-edit-wins —
  // a rebuilt balance would outrank a real human edit from the other device.
  const [customers, suppliers, invoices, bills, payments, notes] = await Promise.all([
    db.select({ id: schema.customer.id, name: schema.customer.name, currentBalance: schema.customer.currentBalance, openingBalance: schema.customer.openingBalance, updatedAt: schema.customer.updatedAt }).from(schema.customer),
    db.select({ id: schema.supplier.id, name: schema.supplier.name, currentBalance: schema.supplier.currentBalance, openingBalance: schema.supplier.openingBalance, updatedAt: schema.supplier.updatedAt }).from(schema.supplier),
    db.select({ id: schema.salesInvoice.id, invoiceNumber: schema.salesInvoice.invoiceNumber, customerId: schema.salesInvoice.customerId, totalAmount: schema.salesInvoice.totalAmount, amountPaid: schema.salesInvoice.amountPaid, balanceDue: schema.salesInvoice.balanceDue, status: schema.salesInvoice.status, deletedAt: schema.salesInvoice.deletedAt, cancelledAt: schema.salesInvoice.cancelledAt, updatedAt: schema.salesInvoice.updatedAt }).from(schema.salesInvoice).where(eq(schema.salesInvoice.type, 'INVOICE')),
    db.select({ id: schema.purchaseBill.id, billNumber: schema.purchaseBill.billNumber, supplierId: schema.purchaseBill.supplierId, totalAmount: schema.purchaseBill.totalAmount, amountPaid: schema.purchaseBill.amountPaid, balanceDue: schema.purchaseBill.balanceDue, status: schema.purchaseBill.status, deletedAt: schema.purchaseBill.deletedAt, cancelledAt: schema.purchaseBill.cancelledAt, updatedAt: schema.purchaseBill.updatedAt }).from(schema.purchaseBill),
    db.select({ type: schema.paymentTransaction.type, customerId: schema.paymentTransaction.customerId, supplierId: schema.paymentTransaction.supplierId, salesInvoiceId: schema.paymentTransaction.salesInvoiceId, purchaseBillId: schema.paymentTransaction.purchaseBillId, amount: schema.paymentTransaction.amount, deletedAt: schema.paymentTransaction.deletedAt, cancelledAt: schema.paymentTransaction.cancelledAt }).from(schema.paymentTransaction),
    db.select({ type: schema.creditDebitNote.type, customerId: schema.creditDebitNote.customerId, referenceInvoiceId: schema.creditDebitNote.referenceInvoiceId, totalAmount: schema.creditDebitNote.totalAmount, status: schema.creditDebitNote.status, deletedAt: schema.creditDebitNote.deletedAt, cancelledAt: schema.creditDebitNote.cancelledAt }).from(schema.creditDebitNote),
  ])

  // Stock needs the openingStock column, which an old DB may not have migrated yet. Guard it.
  let items: { id: string; name: string; currentStock: number; openingStock: number; updatedAt: Date }[] = []
  let movements: { itemId: string; quantity: number }[] = []
  let stockAvailable = true
  try {
    ;[items, movements] = await Promise.all([
      db.select({ id: schema.item.id, name: schema.item.name, currentStock: schema.item.currentStock, openingStock: schema.item.openingStock, updatedAt: schema.item.updatedAt }).from(schema.item),
      db.select({ itemId: schema.stockMovement.itemId, quantity: schema.stockMovement.quantity }).from(schema.stockMovement),
    ])
  } catch {
    stockAvailable = false
  }

  // --- shared engine + diff (packages/shared) ---------------------------------------
  const { custBal, supBal, invState, billState, stock, sections, totalChanges } = runRecomputeDiff({
    customers, suppliers, invoices, bills, payments, notes, stockAvailable, items, movements,
  })

  // --- write back (only on apply) --------------------------------------------------
  if (apply && totalChanges > 0) {
    await db.transaction(async (tx) => {
      for (const c of customers) {
        const v = custBal.get(c.id) ?? 0
        if (Math.abs(v - c.currentBalance) > EPS) await tx.update(schema.customer).set({ currentBalance: round2(v), updatedAt: c.updatedAt }).where(eq(schema.customer.id, c.id))
      }
      for (const s of suppliers) {
        const v = supBal.get(s.id) ?? 0
        if (Math.abs(v - s.currentBalance) > EPS) await tx.update(schema.supplier).set({ currentBalance: round2(v), updatedAt: s.updatedAt }).where(eq(schema.supplier.id, s.id))
      }
      for (const i of invoices) {
        const st = invState.get(i.id)
        if (!st) continue
        const moneyMoved = Math.abs(st.amountPaid - i.amountPaid) > EPS || Math.abs(st.balanceDue - i.balanceDue) > EPS
        const statusMoved = st.status !== i.status && !benignStatus(i.status, st.status)
        if (moneyMoved || statusMoved) await tx.update(schema.salesInvoice).set({ amountPaid: round2(st.amountPaid), balanceDue: round2(st.balanceDue), status: st.status, updatedAt: i.updatedAt }).where(eq(schema.salesInvoice.id, i.id))
      }
      for (const b of bills) {
        const st = billState.get(b.id)
        if (!st) continue
        const moneyMoved = Math.abs(st.amountPaid - b.amountPaid) > EPS || Math.abs(st.balanceDue - b.balanceDue) > EPS
        if (moneyMoved || st.status !== b.status) await tx.update(schema.purchaseBill).set({ amountPaid: round2(st.amountPaid), balanceDue: round2(st.balanceDue), status: st.status, updatedAt: b.updatedAt }).where(eq(schema.purchaseBill.id, b.id))
      }
      if (stockAvailable) {
        for (const it of items) {
          const v = stock.get(it.id) ?? 0
          if (Math.abs(v - it.currentStock) > EPS) await tx.update(schema.item).set({ currentStock: round2(v), updatedAt: it.updatedAt }).where(eq(schema.item.id, it.id))
        }
      }
    })
  }

  return { applied: apply, stockAvailable, sections, totalChanges }
}
