import { ipcMain } from 'electron'
import { applyPayment, desc, eq, inArray, reversePayment, type PaymentEffect } from '@neu/shared'
import { getDb, getDbClient, schema } from '../db'

// The money brain now comes from @neu/shared/paymentLogic — the EXACT code
// mobile runs (applyPayment/reversePayment are precise inverses; adjusts
// preserve updatedAt+hlc per the F5 machine-write rule). This file only wires
// it to IPC and keeps the desktop-only legacy backfills.

// One-time data backfill — runs on every launch, no-op once aligned. Old desktop invoices
// stamped `amountPaid` as a column with NO PaymentTransaction row behind it. The recompute
// engine sums payment ROWS, so it can't see that money. This records the MISSING receipt as
// a real PAYMENT_IN row (it does NOT touch currentBalance / amountPaid — those are already
// correct; it only adds the ledger row so the rebuild matches). Additive + deterministic, so
// safe to run automatically on every device. Desktop-only: mobile always wrote a real row.
// (Leaves cancelled/reversed invoices and the ambiguous "PAID with amountPaid 0" cases alone.)
export async function backfillInlinePayments(): Promise<void> {
  const db = getDb()
  try {
    const [invoices, payments] = await Promise.all([
      db
        .select({
          id: schema.salesInvoice.id,
          customerId: schema.salesInvoice.customerId,
          invoiceDate: schema.salesInvoice.invoiceDate,
          amountPaid: schema.salesInvoice.amountPaid,
          status: schema.salesInvoice.status,
          deletedAt: schema.salesInvoice.deletedAt,
          cancelledAt: schema.salesInvoice.cancelledAt,
        })
        .from(schema.salesInvoice)
        .where(eq(schema.salesInvoice.type, 'INVOICE')),
      db
        .select({
          salesInvoiceId: schema.paymentTransaction.salesInvoiceId,
          amount: schema.paymentTransaction.amount,
          deletedAt: schema.paymentTransaction.deletedAt,
          cancelledAt: schema.paymentTransaction.cancelledAt,
        })
        .from(schema.paymentTransaction)
        .where(eq(schema.paymentTransaction.type, 'PAYMENT_IN')),
    ])
    const paidRows = new Map<string, number>()
    for (const p of payments)
      if (p.salesInvoiceId && p.deletedAt == null && p.cancelledAt == null)
        paidRows.set(p.salesInvoiceId, (paidRows.get(p.salesInvoiceId) ?? 0) + p.amount)

    const gaps = invoices
      .filter((inv) => inv.deletedAt == null && inv.cancelledAt == null && inv.status !== 'REVERSED')
      .map((inv) => ({ inv, gap: (inv.amountPaid || 0) - (paidRows.get(inv.id) ?? 0) }))
      .filter(({ gap }) => gap > 0.01)
    if (gaps.length === 0) return

    await db.transaction(async (tx) => {
      for (const { inv, gap } of gaps) {
        await tx.insert(schema.paymentTransaction).values({
          type: 'PAYMENT_IN',
          customerId: inv.customerId,
          amount: gap,
          paymentMode: 'CASH',
          paymentDate: inv.invoiceDate,
          referenceType: 'INVOICE',
          salesInvoiceId: inv.id,
          notes: 'Paid with invoice (backfilled)',
        })
      }
    })
    console.log(`[inlinePaymentBackfill] recorded ${gaps.length} missing payment(s)`)
  } catch (e) {
    console.error('[inlinePaymentBackfill] failed, app continues:', e)
  }
}

// Same backfill, purchase side. Desktop's purchase:create used to stamp `amountPaid`
// on the bill with NO PaymentTransaction row behind it (mobile bills always started
// unpaid, so this is desktop-born data only). Without the row, the recompute engine
// rebuilds those bills as unpaid and inflates the supplier's balance by the paid
// amount — this records the missing PAYMENT_OUT rows so the rebuild sees the money.
// Additive + idempotent, same rules as the sales backfill above.
export async function backfillInlinePurchasePayments(): Promise<void> {
  const db = getDb()
  try {
    const [bills, payments] = await Promise.all([
      db
        .select({
          id: schema.purchaseBill.id,
          supplierId: schema.purchaseBill.supplierId,
          billDate: schema.purchaseBill.billDate,
          amountPaid: schema.purchaseBill.amountPaid,
          deletedAt: schema.purchaseBill.deletedAt,
          cancelledAt: schema.purchaseBill.cancelledAt,
        })
        .from(schema.purchaseBill),
      db
        .select({
          purchaseBillId: schema.paymentTransaction.purchaseBillId,
          amount: schema.paymentTransaction.amount,
          deletedAt: schema.paymentTransaction.deletedAt,
          cancelledAt: schema.paymentTransaction.cancelledAt,
        })
        .from(schema.paymentTransaction)
        .where(eq(schema.paymentTransaction.type, 'PAYMENT_OUT')),
    ])
    const paidRows = new Map<string, number>()
    for (const p of payments)
      if (p.purchaseBillId && p.deletedAt == null && p.cancelledAt == null)
        paidRows.set(p.purchaseBillId, (paidRows.get(p.purchaseBillId) ?? 0) + p.amount)

    const gaps = bills
      .filter((b) => b.deletedAt == null && b.cancelledAt == null)
      .map((b) => ({ b, gap: (b.amountPaid || 0) - (paidRows.get(b.id) ?? 0) }))
      .filter(({ gap }) => gap > 0.01)
    if (gaps.length === 0) return

    await db.transaction(async (tx) => {
      for (const { b, gap } of gaps) {
        await tx.insert(schema.paymentTransaction).values({
          type: 'PAYMENT_OUT',
          supplierId: b.supplierId,
          amount: gap,
          paymentMode: 'CASH',
          paymentDate: b.billDate,
          referenceType: 'BILL',
          purchaseBillId: b.id,
          notes: 'Paid with bill (backfilled)',
        })
      }
    })
    console.log(`[inlinePurchaseBackfill] recorded ${gaps.length} missing payment(s)`)
  } catch (e) {
    console.error('[inlinePurchaseBackfill] failed, app continues:', e)
  }
}

// Stamp legacy payment rows' updatedAt. The migration SQL carries the same
// UPDATE, but users whose DB reaches the column via the `db push` baseline path
// (database.ts fallback) never execute migration SQL — so without this, their
// old rows keep updatedAt NULL and newest-wins sync has nothing to compare.
// Idempotent single statement; new rows are stamped by the client.
export async function backfillPaymentUpdatedAt(): Promise<void> {
  try {
    await getDbClient().execute(
      `UPDATE "PaymentTransaction" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL`,
    )
  } catch (e) {
    console.error('[paymentUpdatedAtBackfill] failed, app continues:', e)
  }
}

export const setupPaymentHandlers = () => {
  const db = getDb()

  // Record payment in (from customer)
  ipcMain.handle('payment:recordPaymentIn', async (_, data) => {
    try {
      if (!data.customerId || !data.amount || data.amount <= 0) {
        return { success: false, error: 'Invalid payment: customerId and positive amount required' }
      }

      const payment = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.paymentTransaction)
          .values({
            type: 'PAYMENT_IN',
            customerId: data.customerId,
            amount: data.amount,
            paymentMode: data.paymentMode || 'CASH',
            paymentDate: new Date(data.paymentDate),
            referenceType: data.referenceType,
            referenceId: data.referenceId,
            salesInvoiceId: data.referenceType === 'INVOICE' ? data.referenceId : null,
            notes: data.notes
          })
          .returning()

        // Shared money brain: party balance + linked-invoice amountPaid/
        // balanceDue/status, updatedAt+hlc preserved on the doc (F5).
        await applyPayment(tx, created as unknown as PaymentEffect)
        return created
      })

      return { success: true, data: payment }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to record payment'
      }
    }
  })

  // Record payment out (to supplier)
  ipcMain.handle('payment:recordPaymentOut', async (_, data) => {
    try {
      if (!data.supplierId || !data.amount || data.amount <= 0) {
        return { success: false, error: 'Invalid payment: supplierId and positive amount required' }
      }

      const payment = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.paymentTransaction)
          .values({
            type: 'PAYMENT_OUT',
            supplierId: data.supplierId,
            amount: data.amount,
            paymentMode: data.paymentMode || 'CASH',
            paymentDate: new Date(data.paymentDate),
            referenceType: data.referenceType,
            referenceId: data.referenceId,
            purchaseBillId: data.referenceType === 'BILL' ? data.referenceId : null,
            notes: data.notes
          })
          .returning()

        await applyPayment(tx, created as unknown as PaymentEffect)
        return created
      })

      return { success: true, data: payment }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to record payment'
      }
    }
  })

  // Get all payments
  ipcMain.handle('payment:getAll', async (_, type?: string) => {
    try {
      const payments: any[] = await db
        .select()
        .from(schema.paymentTransaction)
        .where(type ? eq(schema.paymentTransaction.type, type) : undefined)
        .orderBy(desc(schema.paymentTransaction.paymentDate))

      // Attach customer / supplier / linked bill (with its supplier) the way
      // Prisma's include used to.
      const customerIds = [...new Set(payments.map((p) => p.customerId).filter(Boolean))] as string[]
      const supplierIds = [...new Set(payments.map((p) => p.supplierId).filter(Boolean))] as string[]
      const billIds = [...new Set(payments.map((p) => p.purchaseBillId).filter(Boolean))] as string[]
      const [customers, suppliers, bills] = await Promise.all([
        customerIds.length ? db.select().from(schema.customer).where(inArray(schema.customer.id, customerIds)) : Promise.resolve([]),
        supplierIds.length ? db.select().from(schema.supplier).where(inArray(schema.supplier.id, supplierIds)) : Promise.resolve([]),
        billIds.length
          ? db
              .select({
                bill: schema.purchaseBill,
                supplier: schema.supplier,
              })
              .from(schema.purchaseBill)
              .leftJoin(schema.supplier, eq(schema.purchaseBill.supplierId, schema.supplier.id))
              .where(inArray(schema.purchaseBill.id, billIds))
          : Promise.resolve([]),
      ])
      const customerById = new Map((customers as any[]).map((c) => [c.id, c]))
      const supplierById = new Map((suppliers as any[]).map((s) => [s.id, s]))
      const billById = new Map((bills as any[]).map((r) => [r.bill.id, { ...r.bill, supplier: r.supplier }]))

      const data = payments.map((p) => ({
        ...p,
        customer: p.customerId ? (customerById.get(p.customerId) ?? null) : null,
        supplier: p.supplierId ? (supplierById.get(p.supplierId) ?? null) : null,
        purchaseBill: p.purchaseBillId ? (billById.get(p.purchaseBillId) ?? null) : null,
      }))
      return { success: true, data }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch payments'
      }
    }
  })

  // Update a payment — reverse the original effect, then apply the new values.
  ipcMain.handle('payment:update', async (_, id: string, data) => {
    try {
      const [existing] = await db.select().from(schema.paymentTransaction).where(eq(schema.paymentTransaction.id, id)).limit(1)
      if (!existing) return { success: false, error: 'Payment not found' }
      if (!data.amount || data.amount <= 0) {
        return { success: false, error: 'A positive amount is required' }
      }

      const updated = await db.transaction(async (tx) => {
        await reversePayment(tx, existing as unknown as PaymentEffect)

        const [row] = await tx
          .update(schema.paymentTransaction)
          .set({
            customerId: existing.type === 'PAYMENT_IN' ? data.customerId ?? existing.customerId : existing.customerId,
            supplierId: existing.type === 'PAYMENT_OUT' ? data.supplierId ?? existing.supplierId : existing.supplierId,
            amount: data.amount,
            paymentMode: data.paymentMode || existing.paymentMode,
            paymentDate: data.paymentDate ? new Date(data.paymentDate) : existing.paymentDate,
            notes: data.notes ?? existing.notes,
          })
          .where(eq(schema.paymentTransaction.id, id))
          .returning()

        await applyPayment(tx, row as unknown as PaymentEffect)
        return row
      })

      return { success: true, data: updated }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update payment'
      }
    }
  })

  // Cancel a payment (Mode B): reverse its effect on balances and the linked
  // invoice/bill, then stamp cancelledAt instead of deleting. The row stays on
  // record, marked Cancelled, forever. Terminal — there is no restore.
  ipcMain.handle('payment:cancel', async (_, id: string) => {
    try {
      const [existing] = await db.select().from(schema.paymentTransaction).where(eq(schema.paymentTransaction.id, id)).limit(1)
      if (!existing) return { success: false, error: 'Payment not found' }
      // Already cancelled — never reverse the balance twice (idempotency guard).
      if (existing.cancelledAt) return { success: true }

      await db.transaction(async (tx) => {
        await reversePayment(tx, existing as unknown as PaymentEffect)
        await tx.update(schema.paymentTransaction).set({ cancelledAt: new Date() }).where(eq(schema.paymentTransaction.id, id))
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel payment'
      }
    }
  })
}
