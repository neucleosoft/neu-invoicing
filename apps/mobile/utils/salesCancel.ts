import { and, eq, inArray, like, sql } from 'drizzle-orm'

import { schema, useDb } from '@/db'

// Mobile-side invoice cancellation, mirroring desktop's sales:cancel and
// sales:cancelWithCreditNote handlers (apps/desktop/electron/main/handlers/sales.ts)
// — same behaviour and same resulting rows, written in mobile's Drizzle idiom so
// the two apps stay byte-compatible for sync. App-local plumbing; no IPC.

type Db = ReturnType<typeof useDb>

// Restock every tracked line of an invoice, APPENDING a reversing stock movement
// (never deleting the original — a deleted movement can't sync). Shared by both
// the plain cancel and the credit-note reversal.
async function restockInvoice(tx: any, id: string, note: string): Promise<void> {
  const lines = await tx
    .select()
    .from(schema.salesInvoiceItem)
    .where(eq(schema.salesInvoiceItem.salesInvoiceId, id))
  if (lines.length === 0) return

  const itemIds = lines.map((l: any) => l.itemId)
  const tracked = await tx
    .select({ id: schema.item.id })
    .from(schema.item)
    .where(and(inArray(schema.item.id, itemIds), eq(schema.item.trackStock, true)))
  const trackedSet = new Set(tracked.map((t: any) => t.id))

  for (const l of lines as any[]) {
    if (!trackedSet.has(l.itemId)) continue
    await tx
      .update(schema.item)
      .set({ currentStock: sql`${schema.item.currentStock} + ${l.quantity}` })
      .where(eq(schema.item.id, l.itemId))
    await tx.insert(schema.stockMovement).values({
      itemId: l.itemId,
      movementType: 'SALE',
      quantity: l.quantity, // positive = goods returned by the cancel
      referenceType: 'INVOICE',
      referenceId: id,
      notes: note,
    })
  }
}

// Plain cancel (UNPAID invoices): reverse what's still owed + restock, then stamp
// cancelledAt. The invoice is HIDDEN from money reads via the notCancelled filter.
// Terminal — there is no restore. Mirrors desktop sales:cancel.
export async function cancelInvoice(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(schema.salesInvoice)
      .where(eq(schema.salesInvoice.id, id))
      .limit(1)
    if (!invoice || invoice.type !== 'INVOICE') throw new Error('Invoice not found')
    if (invoice.cancelledAt) return // idempotent — never reverse twice

    // Paid/part-paid invoices must be reversed with a credit note — their live
    // payment rows would disagree with the recompute engine if the invoice were
    // simply cancelled. Same guard as desktop sales:cancel.
    if ((invoice.amountPaid || 0) > 0) {
      throw new Error('This invoice has a payment against it — reverse it with a credit note instead')
    }

    await tx
      .update(schema.customer)
      .set({ currentBalance: sql`${schema.customer.currentBalance} - ${invoice.balanceDue}` })
      .where(eq(schema.customer.id, invoice.customerId))

    await restockInvoice(tx, id, 'Invoice cancelled — stock returned')

    await tx
      .update(schema.salesInvoice)
      .set({ cancelledAt: new Date() })
      .where(eq(schema.salesInvoice.id, id))
  })
}

// Cancel-with-credit-note (PAID / part-paid invoices): the GST-correct reversal.
// Auto-spawns a full-value credit note (copying the invoice's stored lines + GST),
// reverses the whole sale on the customer ledger (so paid cash becomes a credit we
// owe them), restocks, and marks the invoice REVERSED (NOT cancelledAt — it stays
// visible on the statement beside its note). Mirrors desktop sales:cancelWithCreditNote.
export async function cancelInvoiceWithCreditNote(
  db: Db,
  id: string,
  reason?: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [invoice] = await tx
      .select()
      .from(schema.salesInvoice)
      .where(eq(schema.salesInvoice.id, id))
      .limit(1)
    if (!invoice || invoice.type !== 'INVOICE') throw new Error('Invoice not found')
    if (invoice.cancelledAt) throw new Error('This invoice was already cancelled')
    if (invoice.status === 'REVERSED') return // already reversed — idempotent

    const lines = await tx
      .select()
      .from(schema.salesInvoiceItem)
      .where(eq(schema.salesInvoiceItem.salesInvoiceId, id))

    // Credit-note number CN-YYYY-NNN — same scheme as the manual credit-note screen.
    const year = new Date().getFullYear()
    const prefix = `CN-${year}-`
    const existingNotes = await tx
      .select({ num: schema.creditDebitNote.noteNumber })
      .from(schema.creditDebitNote)
      .where(like(schema.creditDebitNote.noteNumber, `${prefix}%`))
    let max = 0
    for (const r of existingNotes as Array<{ num: string }>) {
      const tail = parseInt(r.num.slice(prefix.length), 10)
      if (!isNaN(tail) && tail > max) max = tail
    }
    const noteNumber = `${prefix}${String(max + 1).padStart(3, '0')}`

    // A full reversal is an exact mirror — copy the invoice's stored header + GST.
    const [note] = await tx
      .insert(schema.creditDebitNote)
      .values({
        // Deterministic id: both devices reversing this invoice offline mint
        // the SAME credit-note row, so sync converges to ONE note instead of
        // double-crediting the customer. Mirrors desktop sales.ts.
        id: `rev-${invoice.id}`,
        noteNumber,
        noteDate: new Date(),
        type: 'CREDIT_NOTE',
        customerId: invoice.customerId,
        referenceInvoiceId: invoice.id,
        reason: reason?.trim() || 'Invoice cancelled',
        subtotal: invoice.subtotal,
        taxAmount: invoice.taxAmount,
        totalAmount: invoice.totalAmount,
        isInterState: invoice.isInterState,
        cgstAmount: invoice.cgstAmount,
        sgstAmount: invoice.sgstAmount,
        igstAmount: invoice.igstAmount,
        status: 'ACTIVE',
      })
      .returning({ id: schema.creditDebitNote.id })

    if (lines.length > 0) {
      await tx.insert(schema.creditDebitNoteItem).values(
        (lines as any[]).map((l) => ({
          creditDebitNoteId: note.id,
          itemId: l.itemId,
          quantity: l.quantity,
          rate: l.rate,
          discount: l.discount,
          taxRate: l.taxRate,
          total: l.total,
          hsnCode: l.hsnCode ?? null,
          taxableAmount: l.taxableAmount,
          cgstRate: l.cgstRate,
          cgstAmount: l.cgstAmount,
          sgstRate: l.sgstRate,
          sgstAmount: l.sgstAmount,
          igstRate: l.igstRate,
          igstAmount: l.igstAmount,
        })),
      )
    }

    // -totalAmount nets off both what they owed AND any cash paid — a paid invoice
    // ends at a negative balance = credit we owe the customer.
    await tx
      .update(schema.customer)
      .set({ currentBalance: sql`${schema.customer.currentBalance} - ${invoice.totalAmount}` })
      .where(eq(schema.customer.id, invoice.customerId))

    await restockInvoice(tx, id, 'Invoice reversed via credit note — stock returned')

    await tx
      .update(schema.salesInvoice)
      .set({ status: 'REVERSED', balanceDue: 0 })
      .where(eq(schema.salesInvoice.id, id))
  })
}
