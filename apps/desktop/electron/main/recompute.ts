// In-app recompute pass — the shared engine, wired to this app's Prisma database.
//
// Fetches every raw row, hands them to the SHARED diff plumbing
// (packages/shared/src/recomputeReport.ts → recompute.ts), and writes the rebuilt
// numbers back on { apply: true }. Everything except the Prisma fetch/write lives
// in @neu/shared, so desktop and mobile compute — and REPORT — identically.
//
// This is the exact call the sync transport runs after a merge ("recompute after
// merge"). DRY RUN by default: reports what WOULD change and writes nothing.
//
// SAFETY: recompute is only as honest as the documents. If a document lies (e.g.
// an invoice marked unpaid that was really paid), the rebuild faithfully
// reproduces the lie. Always read the dry-run diff and fix dirty documents BEFORE
// you ever pass { apply: true }.

import type { PrismaClient } from '@prisma/client'
import {
  RECOMPUTE_EPS as EPS,
  benignStatus,
  formatRecomputeReport,
  round2,
  runRecomputeDiff,
  type RecomputeReport,
} from '@neu/shared'

export { formatRecomputeReport }
export type { RecomputeReport }

export async function recomputeAll(
  prisma: PrismaClient,
  opts: { apply?: boolean } = {},
): Promise<RecomputeReport> {
  const apply = opts.apply === true

  // updatedAt is fetched so every write below can PRESERVE it explicitly:
  // recompute is a machine correction of derived columns, not a content edit.
  // Letting @updatedAt auto-bump here would hijack sync's newest-edit-wins —
  // a rebuilt balance would outrank a real human edit from the other device.
  const [customers, suppliers, invoices, bills, payments, notes] = await Promise.all([
    prisma.customer.findMany({ select: { id: true, name: true, currentBalance: true, openingBalance: true, updatedAt: true } }),
    prisma.supplier.findMany({ select: { id: true, name: true, currentBalance: true, openingBalance: true, updatedAt: true } }),
    prisma.salesInvoice.findMany({ where: { type: 'INVOICE' }, select: { id: true, invoiceNumber: true, customerId: true, totalAmount: true, amountPaid: true, balanceDue: true, status: true, deletedAt: true, cancelledAt: true, updatedAt: true } }),
    prisma.purchaseBill.findMany({ select: { id: true, billNumber: true, supplierId: true, totalAmount: true, amountPaid: true, balanceDue: true, status: true, deletedAt: true, cancelledAt: true, updatedAt: true } }),
    prisma.paymentTransaction.findMany({ select: { type: true, customerId: true, supplierId: true, salesInvoiceId: true, purchaseBillId: true, amount: true, deletedAt: true, cancelledAt: true } }),
    prisma.creditDebitNote.findMany({ select: { type: true, customerId: true, referenceInvoiceId: true, totalAmount: true, status: true, deletedAt: true, cancelledAt: true } }),
  ])

  // Stock needs the openingStock column, which an old DB may not have migrated yet. Guard it.
  let items: { id: string; name: string; currentStock: number; openingStock: number; updatedAt: Date }[] = []
  let movements: { itemId: string; quantity: number }[] = []
  let stockAvailable = true
  try {
    ;[items, movements] = await Promise.all([
      prisma.item.findMany({ select: { id: true, name: true, currentStock: true, openingStock: true, updatedAt: true } }),
      prisma.stockMovement.findMany({ select: { itemId: true, quantity: true } }),
    ])
  } catch {
    stockAvailable = false
  }

  // Bank journals (P3) — same guard: the BankTransaction table may not exist
  // on a DB that hasn't run the migration yet; empty arrays keep the section quiet.
  let bankAccounts: { id: string; name: string; currentBalance: number; updatedAt: Date }[] = []
  let bankTxns: { bankAccountId: string; amount: number; deletedAt: Date | null }[] = []
  try {
    ;[bankAccounts, bankTxns] = await Promise.all([
      prisma.bankAccount.findMany({ select: { id: true, name: true, currentBalance: true, updatedAt: true } }),
      prisma.bankTransaction.findMany({ select: { bankAccountId: true, amount: true, deletedAt: true } }),
    ])
  } catch {
    bankAccounts = []
    bankTxns = []
  }

  // --- shared engine + diff (packages/shared) ---------------------------------------
  const { custBal, supBal, invState, billState, stock, bankBal, sections, totalChanges } = runRecomputeDiff({
    customers, suppliers, invoices, bills, payments, notes, stockAvailable, items, movements, bankAccounts, bankTxns,
  })

  // --- write back (only on apply) --------------------------------------------------
  if (apply && totalChanges > 0) {
    const ops = []
    for (const c of customers) {
      const v = custBal.get(c.id) ?? 0
      if (Math.abs(v - c.currentBalance) > EPS) ops.push(prisma.customer.update({ where: { id: c.id }, data: { currentBalance: round2(v), updatedAt: c.updatedAt } }))
    }
    for (const s of suppliers) {
      const v = supBal.get(s.id) ?? 0
      if (Math.abs(v - s.currentBalance) > EPS) ops.push(prisma.supplier.update({ where: { id: s.id }, data: { currentBalance: round2(v), updatedAt: s.updatedAt } }))
    }
    for (const i of invoices) {
      const st = invState.get(i.id)
      if (!st) continue
      const moneyMoved = Math.abs(st.amountPaid - i.amountPaid) > EPS || Math.abs(st.balanceDue - i.balanceDue) > EPS
      const statusMoved = st.status !== i.status && !benignStatus(i.status, st.status)
      if (moneyMoved || statusMoved) ops.push(prisma.salesInvoice.update({ where: { id: i.id }, data: { amountPaid: round2(st.amountPaid), balanceDue: round2(st.balanceDue), status: st.status, updatedAt: i.updatedAt } }))
    }
    for (const b of bills) {
      const st = billState.get(b.id)
      if (!st) continue
      const moneyMoved = Math.abs(st.amountPaid - b.amountPaid) > EPS || Math.abs(st.balanceDue - b.balanceDue) > EPS
      if (moneyMoved || st.status !== b.status) ops.push(prisma.purchaseBill.update({ where: { id: b.id }, data: { amountPaid: round2(st.amountPaid), balanceDue: round2(st.balanceDue), status: st.status, updatedAt: b.updatedAt } }))
    }
    if (stockAvailable) {
      for (const it of items) {
        const v = stock.get(it.id) ?? 0
        if (Math.abs(v - it.currentStock) > EPS) ops.push(prisma.item.update({ where: { id: it.id }, data: { currentStock: round2(v), updatedAt: it.updatedAt } }))
      }
    }
    for (const a of bankAccounts) {
      const v = bankBal.get(a.id) ?? 0
      if (Math.abs(v - a.currentBalance) > EPS) ops.push(prisma.bankAccount.update({ where: { id: a.id }, data: { currentBalance: round2(v), updatedAt: a.updatedAt } }))
    }
    await prisma.$transaction(ops)
  }

  return { applied: apply, stockAvailable, sections, totalChanges }
}
