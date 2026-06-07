import { eq } from 'drizzle-orm'
import {
  applyPayment,
  reversePayment,
  type PaymentEffect,
  type PaymentType,
} from '@neu/shared'

import { schema, useDb } from '@/db'

// Mobile-side transaction wrappers around the SHARED payment logic
// (packages/shared/src/paymentLogic.ts). The shared file holds the balance math
// (applyPayment / reversePayment) so mobile and the future Drizzle-desktop run
// the exact same effect; THIS file is the mobile-only glue that opens a
// transaction (needs useDb) and writes the PaymentTransaction row. Same split as
// purchaseSave.ts: shared brain, app-local plumbing.

type Db = ReturnType<typeof useDb>

// What the create/edit form collects. The screen routes counterPartyId into
// customerId (IN) or supplierId (OUT) before calling these.
export type PaymentInput = {
  type: PaymentType
  customerId: string | null
  supplierId: string | null
  amount: number
  paymentMode: string
  paymentDate: Date
  notes: string | null
  // Optional links — the standalone Payments screen leaves these null and only
  // moves the party's overall balance. Kept so the invoice-inline path can pass
  // a salesInvoiceId through the same util.
  salesInvoiceId?: string | null
  purchaseBillId?: string | null
}

function toEffect(p: {
  type: PaymentType
  amount: number
  customerId: string | null
  supplierId: string | null
  salesInvoiceId?: string | null
  purchaseBillId?: string | null
}): PaymentEffect {
  return {
    type: p.type,
    amount: p.amount,
    customerId: p.customerId,
    supplierId: p.supplierId,
    salesInvoiceId: p.salesInvoiceId ?? null,
    purchaseBillId: p.purchaseBillId ?? null,
  }
}

// Create a payment: insert the row, then apply its balance effect — atomically.
export async function createPayment(db: Db, input: PaymentInput): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.paymentTransaction)
      .values({
        type: input.type,
        customerId: input.customerId,
        supplierId: input.supplierId,
        amount: input.amount,
        paymentMode: input.paymentMode,
        paymentDate: input.paymentDate,
        salesInvoiceId: input.salesInvoiceId ?? null,
        purchaseBillId: input.purchaseBillId ?? null,
        notes: input.notes,
      })
      .returning({ id: schema.paymentTransaction.id })

    await applyPayment(tx, toEffect(input))
    return row.id
  })
}

// Update a payment: reverse the OLD effect, rewrite the row, apply the NEW effect.
// The old row is loaded fresh so we reverse exactly what was applied. Mirrors
// desktop payment:update.
export async function updatePayment(
  db: Db,
  id: string,
  input: PaymentInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.paymentTransaction)
      .where(eq(schema.paymentTransaction.id, id))
      .limit(1)
    if (!existing) throw new Error('Payment not found')

    // Reverse using the ORIGINAL row's values (type/party/links don't change on
    // edit for a given payment — only amount/mode/date/notes do).
    await reversePayment(tx, {
      type: existing.type as PaymentType,
      amount: existing.amount,
      customerId: existing.customerId,
      supplierId: existing.supplierId,
      salesInvoiceId: existing.salesInvoiceId,
      purchaseBillId: existing.purchaseBillId,
    })

    await tx
      .update(schema.paymentTransaction)
      .set({
        amount: input.amount,
        paymentMode: input.paymentMode,
        paymentDate: input.paymentDate,
        notes: input.notes,
      })
      .where(eq(schema.paymentTransaction.id, id))

    // Apply the new amount against the SAME party/links the row already had.
    await applyPayment(tx, {
      type: existing.type as PaymentType,
      amount: input.amount,
      customerId: existing.customerId,
      supplierId: existing.supplierId,
      salesInvoiceId: existing.salesInvoiceId,
      purchaseBillId: existing.purchaseBillId,
    })
  })
}

// Delete a payment: reverse its effect, then remove the row.
export async function deletePayment(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.paymentTransaction)
      .where(eq(schema.paymentTransaction.id, id))
      .limit(1)
    if (!existing) throw new Error('Payment not found')

    await reversePayment(tx, {
      type: existing.type as PaymentType,
      amount: existing.amount,
      customerId: existing.customerId,
      supplierId: existing.supplierId,
      salesInvoiceId: existing.salesInvoiceId,
      purchaseBillId: existing.purchaseBillId,
    })
    await tx
      .delete(schema.paymentTransaction)
      .where(eq(schema.paymentTransaction.id, id))
  })
}
