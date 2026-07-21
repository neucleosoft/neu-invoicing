// Recompute DB shell — the drizzle fetch/write half of the recompute pass,
// shared VERBATIM by mobile (expo-sqlite) and desktop (libsql). The engine
// math and the dry-run diff/report live in ./recompute + ./recomputeReport;
// this file only loads the rows and (on apply) writes the rebuilt numbers
// back in one transaction.
//
// DRY RUN by default: reports what WOULD change, writes nothing. With
// { apply: true } it writes the rebuilt numbers back in one transaction.
//
// SAFETY: recompute is only as honest as the documents. If a document lies
// (e.g. an invoice marked unpaid that was really paid), the rebuild
// faithfully reproduces the lie. Always read the dry-run diff and fix dirty
// documents BEFORE you ever pass { apply: true }.

import { eq } from 'drizzle-orm'

import * as schema from './schema'
import {
  RECOMPUTE_EPS as EPS,
  benignStatus,
  round2,
  runRecomputeDiff,
  type RecomputeReport,
} from './recomputeReport'
import type { DrizzleDbLike } from './rowSyncDb'

export async function recomputeAllDb(
  db: DrizzleDbLike,
  opts: { apply?: boolean } = {},
): Promise<RecomputeReport> {
  const apply = opts.apply === true

  // updatedAt AND hlc are fetched so every write below can PRESERVE them
  // explicitly: recompute is a machine correction of derived columns, not a
  // content edit. Letting $onUpdate auto-bump either would hijack sync's
  // newest-edit-wins — a rebuilt balance would outrank a real human edit
  // from the other device.
  const [customers, suppliers, invoices, bills, payments, notes] = await Promise.all([
    db.select({ id: schema.customer.id, name: schema.customer.name, currentBalance: schema.customer.currentBalance, openingBalance: schema.customer.openingBalance, updatedAt: schema.customer.updatedAt, hlc: schema.customer.hlc }).from(schema.customer),
    db.select({ id: schema.supplier.id, name: schema.supplier.name, currentBalance: schema.supplier.currentBalance, openingBalance: schema.supplier.openingBalance, updatedAt: schema.supplier.updatedAt, hlc: schema.supplier.hlc }).from(schema.supplier),
    db.select({ id: schema.salesInvoice.id, invoiceNumber: schema.salesInvoice.invoiceNumber, customerId: schema.salesInvoice.customerId, totalAmount: schema.salesInvoice.totalAmount, amountPaid: schema.salesInvoice.amountPaid, balanceDue: schema.salesInvoice.balanceDue, status: schema.salesInvoice.status, deletedAt: schema.salesInvoice.deletedAt, cancelledAt: schema.salesInvoice.cancelledAt, updatedAt: schema.salesInvoice.updatedAt, hlc: schema.salesInvoice.hlc }).from(schema.salesInvoice).where(eq(schema.salesInvoice.type, 'INVOICE')),
    db.select({ id: schema.purchaseBill.id, billNumber: schema.purchaseBill.billNumber, supplierId: schema.purchaseBill.supplierId, totalAmount: schema.purchaseBill.totalAmount, amountPaid: schema.purchaseBill.amountPaid, balanceDue: schema.purchaseBill.balanceDue, status: schema.purchaseBill.status, deletedAt: schema.purchaseBill.deletedAt, cancelledAt: schema.purchaseBill.cancelledAt, updatedAt: schema.purchaseBill.updatedAt, hlc: schema.purchaseBill.hlc }).from(schema.purchaseBill),
    db.select({ type: schema.paymentTransaction.type, customerId: schema.paymentTransaction.customerId, supplierId: schema.paymentTransaction.supplierId, salesInvoiceId: schema.paymentTransaction.salesInvoiceId, purchaseBillId: schema.paymentTransaction.purchaseBillId, amount: schema.paymentTransaction.amount, deletedAt: schema.paymentTransaction.deletedAt, cancelledAt: schema.paymentTransaction.cancelledAt }).from(schema.paymentTransaction),
    db.select({ type: schema.creditDebitNote.type, customerId: schema.creditDebitNote.customerId, referenceInvoiceId: schema.creditDebitNote.referenceInvoiceId, totalAmount: schema.creditDebitNote.totalAmount, status: schema.creditDebitNote.status, deletedAt: schema.creditDebitNote.deletedAt, cancelledAt: schema.creditDebitNote.cancelledAt }).from(schema.creditDebitNote),
  ])

  // Stock needs the openingStock column, which an old DB may not have migrated yet. Guard it.
  let items: { id: string; name: string; currentStock: number; openingStock: number; updatedAt: Date; hlc: string | null }[] = []
  let movements: { itemId: string; quantity: number }[] = []
  let stockAvailable = true
  try {
    ;[items, movements] = await Promise.all([
      db.select({ id: schema.item.id, name: schema.item.name, currentStock: schema.item.currentStock, openingStock: schema.item.openingStock, updatedAt: schema.item.updatedAt, hlc: schema.item.hlc }).from(schema.item),
      db.select({ itemId: schema.stockMovement.itemId, quantity: schema.stockMovement.quantity }).from(schema.stockMovement),
    ])
  } catch {
    stockAvailable = false
  }

  // Bank journals (P3) — same guard: the BankTransaction table may not exist
  // on a DB that hasn't run its migration yet; empty arrays keep it quiet.
  let bankAccounts: { id: string; name: string; currentBalance: number; updatedAt: Date; hlc: string | null }[] = []
  let bankTxns: { bankAccountId: string; amount: number; deletedAt: Date | null }[] = []
  try {
    ;[bankAccounts, bankTxns] = await Promise.all([
      db.select({ id: schema.bankAccount.id, name: schema.bankAccount.name, currentBalance: schema.bankAccount.currentBalance, updatedAt: schema.bankAccount.updatedAt, hlc: schema.bankAccount.hlc }).from(schema.bankAccount),
      db.select({ bankAccountId: schema.bankTransaction.bankAccountId, amount: schema.bankTransaction.amount, deletedAt: schema.bankTransaction.deletedAt }).from(schema.bankTransaction),
    ])
  } catch {
    bankAccounts = []
    bankTxns = []
  }

  // --- shared engine + diff --------------------------------------------------------
  const { custBal, supBal, invState, billState, stock, bankBal, sections, totalChanges } = runRecomputeDiff({
    customers, suppliers, invoices, bills, payments, notes, stockAvailable, items, movements, bankAccounts, bankTxns,
  })

  // --- write back (only on apply) --------------------------------------------------
  if (apply && totalChanges > 0) {
    await db.transaction(async (tx: any) => {
      for (const c of customers) {
        const v = custBal.get(c.id) ?? 0
        if (Math.abs(v - c.currentBalance) > EPS) await tx.update(schema.customer).set({ currentBalance: round2(v), updatedAt: c.updatedAt, hlc: c.hlc }).where(eq(schema.customer.id, c.id))
      }
      for (const s of suppliers) {
        const v = supBal.get(s.id) ?? 0
        if (Math.abs(v - s.currentBalance) > EPS) await tx.update(schema.supplier).set({ currentBalance: round2(v), updatedAt: s.updatedAt, hlc: s.hlc }).where(eq(schema.supplier.id, s.id))
      }
      for (const i of invoices) {
        const st = invState.get(i.id)
        if (!st) continue
        const moneyMoved = Math.abs(st.amountPaid - i.amountPaid) > EPS || Math.abs(st.balanceDue - i.balanceDue) > EPS
        const statusMoved = st.status !== i.status && !benignStatus(i.status, st.status)
        if (moneyMoved || statusMoved) await tx.update(schema.salesInvoice).set({ amountPaid: round2(st.amountPaid), balanceDue: round2(st.balanceDue), status: st.status, updatedAt: i.updatedAt, hlc: i.hlc }).where(eq(schema.salesInvoice.id, i.id))
      }
      for (const b of bills) {
        const st = billState.get(b.id)
        if (!st) continue
        const moneyMoved = Math.abs(st.amountPaid - b.amountPaid) > EPS || Math.abs(st.balanceDue - b.balanceDue) > EPS
        if (moneyMoved || st.status !== b.status) await tx.update(schema.purchaseBill).set({ amountPaid: round2(st.amountPaid), balanceDue: round2(st.balanceDue), status: st.status, updatedAt: b.updatedAt, hlc: b.hlc }).where(eq(schema.purchaseBill.id, b.id))
      }
      if (stockAvailable) {
        for (const it of items) {
          const v = stock.get(it.id) ?? 0
          if (Math.abs(v - it.currentStock) > EPS) await tx.update(schema.item).set({ currentStock: round2(v), updatedAt: it.updatedAt, hlc: it.hlc }).where(eq(schema.item.id, it.id))
        }
      }
      for (const a of bankAccounts) {
        const v = bankBal.get(a.id) ?? 0
        if (Math.abs(v - a.currentBalance) > EPS) await tx.update(schema.bankAccount).set({ currentBalance: round2(v), updatedAt: a.updatedAt, hlc: a.hlc }).where(eq(schema.bankAccount.id, a.id))
      }
    })
  }

  return { applied: apply, stockAvailable, sections, totalChanges }
}
