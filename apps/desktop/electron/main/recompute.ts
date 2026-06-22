// In-app recompute pass — the shared engine, wired to this app's Prisma database.
//
// Fetches every raw row, rebuilds all running numbers with the SHARED engine
// (packages/shared/src/recompute.ts), and compares them to what's stored. DRY RUN by
// default: it reports what WOULD change and writes nothing. With { apply: true } it writes
// the rebuilt numbers back in one transaction.
//
// This is the exact call the sync transport runs after a merge ("recompute after merge").
// Building + proving it here, in isolation, de-risks that step.
//
// SAFETY: recompute is only as honest as the documents. If a document lies (e.g. an invoice
// marked unpaid that was really paid), the rebuild faithfully reproduces the lie. Always read
// the dry-run diff and fix dirty documents BEFORE you ever pass { apply: true }.

import type { PrismaClient } from '@prisma/client'
import {
  recomputeCustomerBalances,
  recomputeSupplierBalances,
  recomputeInvoiceStates,
  recomputeBillStates,
  recomputeStock,
  type RParty,
  type RInvoice,
  type RBill,
  type RPayment,
  type RNote,
  type RItem,
  type RMovement,
} from '@neu/shared'

const EPS = 0.01 // float tolerance for money/qty
const round2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => `₹${(n ?? 0).toFixed(2)}`

export interface Change {
  id: string
  name: string
  stored: number | string
  rebuilt: number | string
}
export interface RecomputeSection {
  title: string
  checked: number
  changes: Change[]
}
export interface RecomputeReport {
  applied: boolean
  stockAvailable: boolean
  sections: RecomputeSection[]
  totalChanges: number
}

// Compare stored vs rebuilt over a set of rows; collect only the ones that differ.
// `benign` lets a section ignore a difference that's expected and not real drift
// (e.g. status OVERDUE → DRAFT, since OVERDUE is a display-only label the engine drops).
function diff<T>(
  title: string,
  rows: T[],
  labelOf: (r: T) => { id: string; name: string },
  storedOf: (r: T) => number | string,
  rebuiltOf: (r: T) => number | string,
  isMoney: boolean,
  benign?: (stored: number | string, rebuilt: number | string) => boolean,
): RecomputeSection {
  const changes: Change[] = []
  for (const r of rows) {
    const stored = storedOf(r)
    const rebuilt = rebuiltOf(r)
    const differs = isMoney
      ? Math.abs((stored as number) - (rebuilt as number)) > EPS
      : stored !== rebuilt
    if (differs && !benign?.(stored, rebuilt)) {
      const { id, name } = labelOf(r)
      changes.push({ id, name, stored, rebuilt })
    }
  }
  return { title, checked: rows.length, changes }
}

// OVERDUE is derived at display time from the due date, not stored truth — the engine
// normalises it back to DRAFT. So a stored OVERDUE rebuilding to DRAFT is not drift.
const benignStatus = (stored: number | string, rebuilt: number | string) =>
  stored === 'OVERDUE' && rebuilt === 'DRAFT'

export async function recomputeAll(
  prisma: PrismaClient,
  opts: { apply?: boolean } = {},
): Promise<RecomputeReport> {
  const apply = opts.apply === true

  const [customers, suppliers, invoices, bills, payments, notes] = await Promise.all([
    prisma.customer.findMany({ select: { id: true, name: true, currentBalance: true, openingBalance: true } }),
    prisma.supplier.findMany({ select: { id: true, name: true, currentBalance: true, openingBalance: true } }),
    prisma.salesInvoice.findMany({ where: { type: 'INVOICE' }, select: { id: true, invoiceNumber: true, customerId: true, totalAmount: true, amountPaid: true, balanceDue: true, status: true, deletedAt: true, cancelledAt: true } }),
    prisma.purchaseBill.findMany({ select: { id: true, billNumber: true, supplierId: true, totalAmount: true, amountPaid: true, balanceDue: true, status: true, deletedAt: true, cancelledAt: true } }),
    prisma.paymentTransaction.findMany({ select: { type: true, customerId: true, supplierId: true, salesInvoiceId: true, purchaseBillId: true, amount: true, deletedAt: true, cancelledAt: true } }),
    prisma.creditDebitNote.findMany({ select: { type: true, customerId: true, referenceInvoiceId: true, totalAmount: true, status: true, deletedAt: true, cancelledAt: true } }),
  ])

  // Stock needs the openingStock column, which an old DB may not have migrated yet. Guard it.
  let items: { id: string; name: string; currentStock: number; openingStock: number }[] = []
  let movements: { itemId: string; quantity: number }[] = []
  let stockAvailable = true
  try {
    ;[items, movements] = await Promise.all([
      prisma.item.findMany({ select: { id: true, name: true, currentStock: true, openingStock: true } }),
      prisma.stockMovement.findMany({ select: { itemId: true, quantity: true } }),
    ])
  } catch {
    stockAvailable = false
  }

  // --- run the shared engine -------------------------------------------------------
  const custBal = recomputeCustomerBalances(customers as RParty[], invoices as RInvoice[], payments as RPayment[], notes as RNote[])
  const supBal = recomputeSupplierBalances(suppliers as RParty[], bills as RBill[], payments as RPayment[])
  const invState = recomputeInvoiceStates(invoices as RInvoice[], payments as RPayment[], notes as RNote[])
  const billState = recomputeBillStates(bills as RBill[], payments as RPayment[])
  const stock = stockAvailable ? recomputeStock(items as RItem[], movements as RMovement[]) : new Map<string, number>()

  // --- diff stored vs rebuilt ------------------------------------------------------
  const sections: RecomputeSection[] = [
    diff('Customer balance', customers, (c) => ({ id: c.id, name: c.name || c.id }), (c) => c.currentBalance, (c) => custBal.get(c.id) ?? 0, true),
    diff('Supplier balance', suppliers, (s) => ({ id: s.id, name: s.name || s.id }), (s) => s.currentBalance, (s) => supBal.get(s.id) ?? 0, true),
    diff('Invoice amountPaid', invoices, (i) => ({ id: i.id, name: i.invoiceNumber || i.id }), (i) => i.amountPaid, (i) => invState.get(i.id)?.amountPaid ?? 0, true),
    diff('Invoice balanceDue', invoices, (i) => ({ id: i.id, name: i.invoiceNumber || i.id }), (i) => i.balanceDue, (i) => invState.get(i.id)?.balanceDue ?? 0, true),
    diff('Invoice status', invoices, (i) => ({ id: i.id, name: i.invoiceNumber || i.id }), (i) => i.status, (i) => invState.get(i.id)?.status ?? i.status, false, benignStatus),
    diff('Bill amountPaid', bills, (b) => ({ id: b.id, name: b.billNumber || b.id }), (b) => b.amountPaid, (b) => billState.get(b.id)?.amountPaid ?? 0, true),
    diff('Bill balanceDue', bills, (b) => ({ id: b.id, name: b.billNumber || b.id }), (b) => b.balanceDue, (b) => billState.get(b.id)?.balanceDue ?? 0, true),
    diff('Bill status', bills, (b) => ({ id: b.id, name: b.billNumber || b.id }), (b) => b.status, (b) => billState.get(b.id)?.status ?? b.status, false),
  ]
  if (stockAvailable) {
    sections.push(diff('Item stock', items, (it) => ({ id: it.id, name: it.name || it.id }), (it) => it.currentStock, (it) => stock.get(it.id) ?? 0, true))
  }
  const totalChanges = sections.reduce((s, sec) => s + sec.changes.length, 0)

  // --- write back (only on apply) --------------------------------------------------
  if (apply && totalChanges > 0) {
    const ops = []
    for (const c of customers) {
      const v = custBal.get(c.id) ?? 0
      if (Math.abs(v - c.currentBalance) > EPS) ops.push(prisma.customer.update({ where: { id: c.id }, data: { currentBalance: round2(v) } }))
    }
    for (const s of suppliers) {
      const v = supBal.get(s.id) ?? 0
      if (Math.abs(v - s.currentBalance) > EPS) ops.push(prisma.supplier.update({ where: { id: s.id }, data: { currentBalance: round2(v) } }))
    }
    for (const i of invoices) {
      const st = invState.get(i.id)
      if (!st) continue
      const moneyMoved = Math.abs(st.amountPaid - i.amountPaid) > EPS || Math.abs(st.balanceDue - i.balanceDue) > EPS
      const statusMoved = st.status !== i.status && !benignStatus(i.status, st.status)
      if (moneyMoved || statusMoved) ops.push(prisma.salesInvoice.update({ where: { id: i.id }, data: { amountPaid: round2(st.amountPaid), balanceDue: round2(st.balanceDue), status: st.status } }))
    }
    for (const b of bills) {
      const st = billState.get(b.id)
      if (!st) continue
      const moneyMoved = Math.abs(st.amountPaid - b.amountPaid) > EPS || Math.abs(st.balanceDue - b.balanceDue) > EPS
      if (moneyMoved || st.status !== b.status) ops.push(prisma.purchaseBill.update({ where: { id: b.id }, data: { amountPaid: round2(st.amountPaid), balanceDue: round2(st.balanceDue), status: st.status } }))
    }
    if (stockAvailable) {
      for (const it of items) {
        const v = stock.get(it.id) ?? 0
        if (Math.abs(v - it.currentStock) > EPS) ops.push(prisma.item.update({ where: { id: it.id }, data: { currentStock: round2(v) } }))
      }
    }
    await prisma.$transaction(ops)
  }

  return { applied: apply, stockAvailable, sections, totalChanges }
}

export function formatRecomputeReport(r: RecomputeReport): string {
  const lines: string[] = []
  lines.push(`=== Recompute ${r.applied ? 'APPLY' : 'DRY RUN'} ===`)
  if (!r.stockAvailable) lines.push(`(item stock skipped — openingStock column not on this DB yet)`)
  const fmt = (v: number | string) => (typeof v === 'number' ? money(v) : v)
  for (const s of r.sections) {
    const verb = r.applied ? 'changed' : 'would change'
    lines.push(`\n${s.title}: ${s.checked} checked · ${s.changes.length} ${verb}`)
    for (const c of s.changes.slice(0, 25)) lines.push(`   ✗ ${c.name}: ${fmt(c.stored)} → ${fmt(c.rebuilt)}`)
    if (s.changes.length > 25) lines.push(`   … and ${s.changes.length - 25} more`)
  }
  const tail = r.applied ? `${r.totalChanges} rows written` : `${r.totalChanges} differences (dry run — nothing written)`
  lines.push(`\n--- ${tail} ---`)
  return lines.join('\n')
}
