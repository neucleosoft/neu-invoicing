import { eq, sql } from 'drizzle-orm'

import {
  customer,
  purchaseBill,
  salesInvoice,
  supplier,
} from './schema'

// ─────────────────────────────────────────────────────────────────────────────
// Shared payment logic — the "money brain".
//
// This lives in @neu/shared (not in either app) on purpose: mobile uses it today,
// and when desktop migrates from Prisma to Drizzle it will import the SAME file
// instead of re-implementing it. That's only possible because both sides speak
// Drizzle — these functions are written against Drizzle table objects + a Drizzle
// transaction handle, which either app can supply.
//
// It mirrors the desktop Prisma handler (apps/desktop/electron/main/handlers/
// payment.ts) exactly: applyPayment and reversePayment are precise INVERSES, and
// create/update/delete are all built from them:
//   create  = applyPayment
//   update  = reversePayment(old) → write new row → applyPayment(new)
//   delete  = reversePayment(old) → delete row
// Getting the inverse exactly right is the whole game: if reverse doesn't undo
// apply byte-for-byte, balances drift and every ledger/report built on them lies.
// ─────────────────────────────────────────────────────────────────────────────

export type PaymentType = 'PAYMENT_IN' | 'PAYMENT_OUT'

// The fields of a payment that drive balance effects. A subset of the
// PaymentTransaction row — enough to apply/reverse without depending on how the
// row was loaded.
export interface PaymentEffect {
  type: PaymentType
  amount: number
  customerId?: string | null
  supplierId?: string | null
  // Optional links: when set, the specific invoice/bill is ticked off too
  // (amountPaid / balanceDue / status). The standalone Payments screen leaves
  // these null and only moves the party's overall balance.
  salesInvoiceId?: string | null
  purchaseBillId?: string | null
}

// A minimal structural type for "a Drizzle transaction handle". We avoid
// importing a concrete DB type so this file stays app-agnostic — both
// expo-sqlite (mobile) and better-sqlite/node (future desktop) transactions
// satisfy this shape.
export interface DrizzleTx {
  select: (...args: any[]) => any
  update: (...args: any[]) => any
}

// Recompute an invoice/bill status from its total and amount paid.
// Pure arithmetic — no DB — so it's also safe to call from UI for previews.
// Mirrors desktop payment.ts computeStatus.
export function computePaymentStatus(
  total: number,
  paid: number,
): 'PAID' | 'PARTIAL' | 'DRAFT' {
  if (total - paid <= 0) return 'PAID'
  if (paid > 0) return 'PARTIAL'
  return 'DRAFT'
}

// Update a linked sales invoice's amountPaid / balanceDue / status by `delta`
// (positive when applying a PAYMENT_IN, negative when reversing it).
async function adjustInvoicePaid(tx: DrizzleTx, invoiceId: string, delta: number) {
  const rows = await tx
    .select({
      amountPaid: salesInvoice.amountPaid,
      totalAmount: salesInvoice.totalAmount,
    })
    .from(salesInvoice)
    .where(eq(salesInvoice.id, invoiceId))
    .limit(1)
  const inv = rows[0]
  if (!inv) return
  const paid = inv.amountPaid + delta
  await tx
    .update(salesInvoice)
    .set({
      amountPaid: paid,
      balanceDue: inv.totalAmount - paid,
      status: computePaymentStatus(inv.totalAmount, paid),
    })
    .where(eq(salesInvoice.id, invoiceId))
}

// Same, for a linked purchase bill.
async function adjustBillPaid(tx: DrizzleTx, billId: string, delta: number) {
  const rows = await tx
    .select({
      amountPaid: purchaseBill.amountPaid,
      totalAmount: purchaseBill.totalAmount,
    })
    .from(purchaseBill)
    .where(eq(purchaseBill.id, billId))
    .limit(1)
  const bill = rows[0]
  if (!bill) return
  const paid = bill.amountPaid + delta
  await tx
    .update(purchaseBill)
    .set({
      amountPaid: paid,
      balanceDue: bill.totalAmount - paid,
      status: computePaymentStatus(bill.totalAmount, paid),
    })
    .where(eq(purchaseBill.id, billId))
}

// Apply a payment's effect: reduce the party's balance and, if linked, credit the
// invoice/bill. `decrement` for BOTH directions is intentional and correct:
//   PAYMENT_IN  → customer paid us → they owe less → decrement customer balance
//   PAYMENT_OUT → we paid supplier → we owe less   → decrement supplier balance
// (Mirrors desktop applyPayment. The comment there calls out the same thing.)
export async function applyPayment(tx: DrizzleTx, p: PaymentEffect): Promise<void> {
  if (p.type === 'PAYMENT_IN') {
    if (p.customerId) {
      await tx
        .update(customer)
        .set({ currentBalance: sql`${customer.currentBalance} - ${p.amount}` })
        .where(eq(customer.id, p.customerId))
    }
    if (p.salesInvoiceId) {
      await adjustInvoicePaid(tx, p.salesInvoiceId, p.amount)
    }
  } else {
    if (p.supplierId) {
      await tx
        .update(supplier)
        .set({ currentBalance: sql`${supplier.currentBalance} - ${p.amount}` })
        .where(eq(supplier.id, p.supplierId))
    }
    if (p.purchaseBillId) {
      await adjustBillPaid(tx, p.purchaseBillId, p.amount)
    }
  }
}

// Reverse a payment's effect — the EXACT inverse of applyPayment. Used on delete,
// and before an update re-applies the new values. Every sign here is flipped from
// applyPayment; if these two ever disagree, balances corrupt silently.
export async function reversePayment(tx: DrizzleTx, p: PaymentEffect): Promise<void> {
  if (p.type === 'PAYMENT_IN') {
    if (p.customerId) {
      await tx
        .update(customer)
        .set({ currentBalance: sql`${customer.currentBalance} + ${p.amount}` })
        .where(eq(customer.id, p.customerId))
    }
    if (p.salesInvoiceId) {
      await adjustInvoicePaid(tx, p.salesInvoiceId, -p.amount)
    }
  } else {
    if (p.supplierId) {
      await tx
        .update(supplier)
        .set({ currentBalance: sql`${supplier.currentBalance} + ${p.amount}` })
        .where(eq(supplier.id, p.supplierId))
    }
    if (p.purchaseBillId) {
      await adjustBillPaid(tx, p.purchaseBillId, -p.amount)
    }
  }
}
