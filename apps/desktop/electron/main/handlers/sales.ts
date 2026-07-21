import { ipcMain } from 'electron'
import { and, desc, eq, isNull, sql } from '@neu/shared'
import { getDb, schema } from '../db'
import { attachCustomerAndItems } from './docLoaders'
import {
  buildSalesDocumentValues,
  derivePaymentStatus,
  generateNextInvoiceNumber,
  normalizeSalesDocumentNumber,
} from './salesDocumentHelpers'

// Marks the single "up-front payment" auto-managed by the invoice form (create + edit),
// so editing the Amount Paid can find and re-sync exactly that row — without touching
// payments the user recorded separately on the Payments screen.
const INLINE_PAYMENT_NOTE = 'Paid with invoice'

export const setupSalesHandlers = () => {
  const db = getDb()

  // Get all sales invoices
  ipcMain.handle('sales:getAll', async () => {
    try {
      const headers = await db
        .select()
        .from(schema.salesInvoice)
        .where(eq(schema.salesInvoice.type, 'INVOICE'))
        .orderBy(desc(schema.salesInvoice.invoiceDate))
      const invoices = await attachCustomerAndItems(db, headers, schema.salesInvoiceItem, 'salesInvoiceId')
      return { success: true, data: invoices }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch invoices'
      }
    }
  })

  // Get invoice by ID
  ipcMain.handle('sales:getById', async (_, id: string) => {
    try {
      const [header] = await db
        .select()
        .from(schema.salesInvoice)
        .where(and(eq(schema.salesInvoice.id, id), eq(schema.salesInvoice.type, 'INVOICE')))
        .limit(1)
      if (!header) return { success: true, data: null }
      const [invoice] = await attachCustomerAndItems(db, [header], schema.salesInvoiceItem, 'salesInvoiceId')
      const payments = await db
        .select()
        .from(schema.paymentTransaction)
        .where(eq(schema.paymentTransaction.salesInvoiceId, id))
      return { success: true, data: { ...invoice, payments } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch invoice'
      }
    }
  })

  // Create invoice
  ipcMain.handle('sales:create', async (_, data) => {
    try {
      // Normalize invoice number — pad last numeric segment to 2 digits
      // so NS/SL/26-27/6 and NS/SL/26-27/06 are treated as the same
      data.invoiceNumber = normalizeSalesDocumentNumber(data.invoiceNumber)

      const created = await db.transaction(async (tx) => {
        // Check for duplicate invoice number
        const [existing] = await tx
          .select({ id: schema.salesInvoice.id })
          .from(schema.salesInvoice)
          .where(eq(schema.salesInvoice.invoiceNumber, data.invoiceNumber))
          .limit(1)
        if (existing) throw new Error(`Invoice number ${data.invoiceNumber} already exists`)

        const values = await buildSalesDocumentValues(tx, data)
        const totalAmount = values.totalAmount
        const amountPaid = data.amountPaid || 0
        const balanceDue = totalAmount - amountPaid

        // Paid-status is DERIVED from the money, never the hand-set dropdown — so the
        // label can't contradict the amount. OVERDUE is the one exception (it's about
        // the due date, not the amount), so we preserve it when chosen.
        const status = data.status === 'OVERDUE'
          ? 'OVERDUE'
          : derivePaymentStatus(totalAmount, amountPaid)

        const [invoice] = await tx
          .insert(schema.salesInvoice)
          .values({
            invoiceNumber: data.invoiceNumber,
            invoiceDate: new Date(data.invoiceDate),
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            type: 'INVOICE',
            customerId: data.customerId,
            subtotal: values.subtotal,
            discount: data.discount || 0,
            taxAmount: values.taxAmount,
            totalAmount,
            amountPaid,
            balanceDue,
            status,
            notes: data.notes,
            termsConditions: data.termsConditions ?? null,
            placeOfSupply: values.placeOfSupply,
            placeOfSupplyName: values.placeOfSupplyName,
            isInterState: values.isInterState,
            reverseCharge: data.reverseCharge || false,
            cgstAmount: values.totalCgst,
            sgstAmount: values.totalSgst,
            igstAmount: values.totalIgst,
            cessAmount: values.totalCess,
            supplyType: values.supplyType,
            ecommerceGstin: data.ecommerceGstin || null,
            poNumber: data.poNumber || null,
            ewayBillNo: data.ewayBillNo || null,
            vehicleNumber: data.vehicleNumber || null,
            warrantyPeriod: data.warrantyPeriod || null,
            dispatchedThrough: data.dispatchedThrough || null,
          })
          .returning()

        if (values.processedItems.length) {
          await tx
            .insert(schema.salesInvoiceItem)
            .values(values.processedItems.map((i: any) => ({ ...i, salesInvoiceId: invoice.id })))
        }

        // Update customer balance
        await tx
          .update(schema.customer)
          .set({ currentBalance: sql`${schema.customer.currentBalance} + ${balanceDue}` })
          .where(eq(schema.customer.id, data.customerId))

        for (const item of data.items) {
          const [dbItem] = await tx.select().from(schema.item).where(eq(schema.item.id, item.itemId)).limit(1)
          if (dbItem && dbItem.trackStock) {
            await tx
              .update(schema.item)
              .set({ currentStock: sql`${schema.item.currentStock} - ${item.quantity}` })
              .where(eq(schema.item.id, item.itemId))

            await tx.insert(schema.stockMovement).values({
              itemId: item.itemId,
              movementType: 'SALE',
              quantity: -item.quantity,
              referenceType: 'INVOICE',
              referenceId: invoice.id
            })
          }
        }

        // Record any up-front payment as a real Payment In row so it shows in the
        // customer's statement/ledger — not just a number stamped on the invoice.
        // currentBalance was already bumped by the NET balanceDue above, so we do
        // NOT re-apply the payment here; this row is the ledger record of that money.
        if (amountPaid > 0) {
          await tx.insert(schema.paymentTransaction).values({
            type: 'PAYMENT_IN',
            customerId: data.customerId,
            amount: amountPaid,
            paymentMode: data.paymentMode || 'CASH',
            paymentDate: new Date(data.invoiceDate),
            referenceType: 'INVOICE',
            salesInvoiceId: invoice.id,
            notes: INLINE_PAYMENT_NOTE,
          })
        }

        return invoice
      })

      const [invoice] = await attachCustomerAndItems(db, [created], schema.salesInvoiceItem, 'salesInvoiceId')
      return { success: true, data: invoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create invoice'
      }
    }
  })

  // Update invoice
  ipcMain.handle('sales:update', async (_, id: string, data) => {
    try {
      // Normalize invoice number
      if (data.invoiceNumber) {
        data.invoiceNumber = normalizeSalesDocumentNumber(data.invoiceNumber)
      }

      const updated = await db.transaction(async (tx) => {
        const [existingInvoice] = await tx.select().from(schema.salesInvoice).where(eq(schema.salesInvoice.id, id)).limit(1)

        if (!existingInvoice || existingInvoice.type !== 'INVOICE') {
          throw new Error('Invoice not found')
        }

        // Check for duplicate if invoice number changed
        if (data.invoiceNumber && data.invoiceNumber !== existingInvoice.invoiceNumber) {
          const [duplicate] = await tx
            .select({ id: schema.salesInvoice.id })
            .from(schema.salesInvoice)
            .where(eq(schema.salesInvoice.invoiceNumber, data.invoiceNumber))
            .limit(1)
          if (duplicate) throw new Error(`Invoice number ${data.invoiceNumber} already exists`)
        }

        const values = await buildSalesDocumentValues(tx, data)
        const totalAmount = values.totalAmount

        // Amount Paid is editable on the form (driven by the Status), so it's the source
        // of truth here. Reversed invoices are terminal — keep their figures frozen.
        const isReversed = existingInvoice.status === 'REVERSED'
        const amountPaid = isReversed
          ? (existingInvoice.amountPaid || 0)
          : (data.amountPaid ?? existingInvoice.amountPaid ?? 0)
        const balanceDue = totalAmount - amountPaid

        // Status follows the money so it can't contradict it; OVERDUE is preserved when
        // chosen (it's about the due date, not the amount); REVERSED stays terminal.
        const status = isReversed
          ? 'REVERSED'
          : data.status === 'OVERDUE'
          ? 'OVERDUE'
          : derivePaymentStatus(totalAmount, amountPaid)

        // Delete existing items
        await tx.delete(schema.salesInvoiceItem).where(eq(schema.salesInvoiceItem.salesInvoiceId, id))

        const [invoice] = await tx
          .update(schema.salesInvoice)
          .set({
            invoiceNumber: data.invoiceNumber,
            invoiceDate: new Date(data.invoiceDate),
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            type: 'INVOICE',
            customerId: data.customerId,
            subtotal: values.subtotal,
            discount: data.discount || 0,
            taxAmount: values.taxAmount,
            totalAmount,
            amountPaid,
            balanceDue,
            status,
            notes: data.notes,
            termsConditions: data.termsConditions ?? null,
            placeOfSupply: values.placeOfSupply,
            placeOfSupplyName: values.placeOfSupplyName,
            isInterState: values.isInterState,
            cgstAmount: values.totalCgst,
            sgstAmount: values.totalSgst,
            igstAmount: values.totalIgst,
            supplyType: values.supplyType,
            poNumber: data.poNumber || null,
            ewayBillNo: data.ewayBillNo || null,
            vehicleNumber: data.vehicleNumber || null,
            warrantyPeriod: data.warrantyPeriod || null,
            dispatchedThrough: data.dispatchedThrough || null,
          })
          .where(eq(schema.salesInvoice.id, id))
          .returning()

        if (values.processedItems.length) {
          await tx
            .insert(schema.salesInvoiceItem)
            .values(values.processedItems.map((i: any) => ({ ...i, salesInvoiceId: id })))
        }

        // Update customer balance — handle customer change correctly
        if (data.customerId !== existingInvoice.customerId) {
          // Customer changed: reverse the old customer's balance, apply to the new customer
          await tx
            .update(schema.customer)
            .set({ currentBalance: sql`${schema.customer.currentBalance} - ${existingInvoice.balanceDue}` })
            .where(eq(schema.customer.id, existingInvoice.customerId))
          await tx
            .update(schema.customer)
            .set({ currentBalance: sql`${schema.customer.currentBalance} + ${balanceDue}` })
            .where(eq(schema.customer.id, data.customerId))
        } else {
          const balanceDiff = balanceDue - existingInvoice.balanceDue
          if (balanceDiff !== 0) {
            await tx
              .update(schema.customer)
              .set({ currentBalance: sql`${schema.customer.currentBalance} + ${balanceDiff}` })
              .where(eq(schema.customer.id, data.customerId))
          }
        }

        // Re-sync the invoice's up-front payment row to match the edited Amount Paid, so
        // the customer's statement always agrees with the invoice. We only touch the row
        // tagged as the inline payment — payments recorded on the Payments screen are left
        // alone. currentBalance is handled by balanceDiff above, so this row is purely the
        // ledger record (we do NOT re-apply it).
        if (!isReversed) {
          const [inlinePayment] = await tx
            .select()
            .from(schema.paymentTransaction)
            .where(and(
              eq(schema.paymentTransaction.salesInvoiceId, id),
              eq(schema.paymentTransaction.type, 'PAYMENT_IN'),
              eq(schema.paymentTransaction.notes, INLINE_PAYMENT_NOTE),
              isNull(schema.paymentTransaction.cancelledAt),
            ))
            .limit(1)
          if (amountPaid > 0) {
            if (inlinePayment) {
              await tx
                .update(schema.paymentTransaction)
                .set({
                  amount: amountPaid,
                  paymentMode: data.paymentMode || inlinePayment.paymentMode,
                  paymentDate: new Date(data.invoiceDate),
                  customerId: data.customerId,
                })
                .where(eq(schema.paymentTransaction.id, inlinePayment.id))
            } else {
              await tx.insert(schema.paymentTransaction).values({
                type: 'PAYMENT_IN',
                customerId: data.customerId,
                amount: amountPaid,
                paymentMode: data.paymentMode || 'CASH',
                paymentDate: new Date(data.invoiceDate),
                referenceType: 'INVOICE',
                salesInvoiceId: id,
                notes: INLINE_PAYMENT_NOTE,
              })
            }
          } else if (inlinePayment) {
            // Marked Unpaid on edit → void the up-front payment (keep the record; a
            // deleted payment can't sync, so we cancel rather than delete).
            await tx
              .update(schema.paymentTransaction)
              .set({ cancelledAt: new Date(), cancelReason: 'Invoice marked unpaid' })
              .where(eq(schema.paymentTransaction.id, inlinePayment.id))
          }
        }

        return invoice
      })

      const [invoice] = await attachCustomerAndItems(db, [updated], schema.salesInvoiceItem, 'salesInvoiceId')
      return { success: true, data: invoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update invoice'
      }
    }
  })

  // Cancel invoice (Mode B): reverse the customer balance + stock (appending a
  // reversing movement), then stamp cancelledAt. Wrapped in a transaction so the
  // reversal is atomic. The invoice, its items, and its movements all stay on
  // record. Terminal — there is no restore.
  ipcMain.handle('sales:cancel', async (_, id: string) => {
    try {
      await db.transaction(async (tx) => {
        const [invoice] = await tx.select().from(schema.salesInvoice).where(eq(schema.salesInvoice.id, id)).limit(1)

        if (!invoice || invoice.type !== 'INVOICE') {
          throw new Error('Invoice not found')
        }

        // Already cancelled — never reverse the balance/stock twice (idempotency guard).
        if (invoice.cancelledAt) {
          return
        }

        // Paid/part-paid invoices must be reversed with a credit note — their live
        // payment rows would disagree with the recompute engine if the invoice were
        // simply cancelled. The UI already routes these to sales:cancelWithCreditNote;
        // this guard makes the rule unconditional.
        if ((invoice.amountPaid || 0) > 0) {
          throw new Error('This invoice has a payment against it — reverse it with a credit note instead')
        }

        await tx
          .update(schema.customer)
          .set({ currentBalance: sql`${schema.customer.currentBalance} - ${invoice.balanceDue}` })
          .where(eq(schema.customer.id, invoice.customerId))

        // Put tracked stock back AND append a "returned" movement per line. We do NOT
        // delete the original movements: cancel preserves the record, and a deleted
        // stockMovement can't sync (the table has no soft-delete column).
        const items = await tx.select().from(schema.salesInvoiceItem).where(eq(schema.salesInvoiceItem.salesInvoiceId, id))
        for (const item of items) {
          const [dbItem] = await tx.select().from(schema.item).where(eq(schema.item.id, item.itemId)).limit(1)
          if (dbItem && dbItem.trackStock) {
            await tx
              .update(schema.item)
              .set({ currentStock: sql`${schema.item.currentStock} + ${item.quantity}` })
              .where(eq(schema.item.id, item.itemId))
            await tx.insert(schema.stockMovement).values({
              itemId: item.itemId,
              movementType: 'SALE',
              quantity: item.quantity, // positive = goods returned by the cancel
              referenceType: 'INVOICE',
              referenceId: id,
              notes: 'Invoice cancelled — stock returned'
            })
          }
        }

        // CANCEL, not delete: stamp cancelledAt; the invoice, its items, and its
        // stock movements all stay on record.
        await tx.update(schema.salesInvoice).set({ cancelledAt: new Date() }).where(eq(schema.salesInvoice.id, id))
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel invoice'
      }
    }
  })

  // Reverse a PAID/part-paid invoice by issuing a full-value credit note — the
  // GST-correct way to undo a sale where money or tax has already moved. Unlike
  // sales:cancel (which HIDES an unpaid invoice), this KEEPS the invoice visible and
  // posts an offsetting credit note, so the customer's statement nets correctly and
  // any payment they made is never orphaned — it becomes a credit we owe them
  // (negative balance), to be adjusted against a future bill. The invoice is marked
  // status 'REVERSED' (NOT cancelledAt) so it stays on the ledger beside its note.
  // One transaction; terminal — there is no restore.
  ipcMain.handle(
    'sales:cancelWithCreditNote',
    async (_, id: string, payload: { noteNumber: string; noteDate?: string; reason?: string }) => {
      try {
        const createdId = await db.transaction(async (tx) => {
          const [invoice] = await tx.select().from(schema.salesInvoice).where(eq(schema.salesInvoice.id, id)).limit(1)

          if (!invoice || invoice.type !== 'INVOICE') {
            throw new Error('Invoice not found')
          }
          if (invoice.cancelledAt) {
            throw new Error('This invoice was already cancelled')
          }
          // Already reversed — never post the note / reverse the balance twice.
          if (invoice.status === 'REVERSED') {
            return null
          }

          const invoiceItems = await tx
            .select()
            .from(schema.salesInvoiceItem)
            .where(eq(schema.salesInvoiceItem.salesInvoiceId, id))

          const [created] = await tx
            .insert(schema.creditDebitNote)
            .values({
              // Deterministic id: both devices reversing this invoice offline
              // mint the SAME credit-note row, so sync converges to ONE note
              // instead of double-crediting the customer.
              id: `rev-${invoice.id}`,
              noteNumber: payload.noteNumber,
              noteDate: payload.noteDate ? new Date(payload.noteDate) : new Date(),
              type: 'CREDIT_NOTE',
              customerId: invoice.customerId,
              referenceInvoiceId: invoice.id,
              reason: payload.reason || 'Invoice cancelled',
              subtotal: invoice.subtotal,
              taxAmount: invoice.taxAmount,
              totalAmount: invoice.totalAmount,
              cgstAmount: invoice.cgstAmount,
              sgstAmount: invoice.sgstAmount,
              igstAmount: invoice.igstAmount,
              isInterState: invoice.isInterState,
              status: 'ACTIVE',
            })
            .returning({ id: schema.creditDebitNote.id })

          // A full reversal is an exact mirror of the invoice, so copy its stored
          // line items + GST split into the note rather than recomputing them.
          if (invoiceItems.length) {
            await tx.insert(schema.creditDebitNoteItem).values(
              invoiceItems.map((it: any) => ({
                creditDebitNoteId: created.id,
                itemId: it.itemId,
                quantity: it.quantity,
                rate: it.rate,
                discount: it.discount || 0,
                taxRate: it.taxRate || 0,
                total: it.total,
                hsnCode: it.hsnCode || '',
                taxableAmount: it.taxableAmount,
                cgstRate: it.cgstRate,
                cgstAmount: it.cgstAmount,
                sgstRate: it.sgstRate,
                sgstAmount: it.sgstAmount,
                igstRate: it.igstRate,
                igstAmount: it.igstAmount,
              })),
            )
          }

          // Reverse the whole sale on the customer ledger: -totalAmount nets off both
          // what they still owed (balanceDue) AND any cash they paid (amountPaid) — a
          // paid invoice ends at a negative balance = credit we owe them.
          await tx
            .update(schema.customer)
            .set({ currentBalance: sql`${schema.customer.currentBalance} - ${invoice.totalAmount}` })
            .where(eq(schema.customer.id, invoice.customerId))

          // Put tracked stock back, appending a reversing movement (never delete —
          // a deleted stockMovement can't sync). Same pattern as sales:cancel.
          for (const item of invoiceItems) {
            const [dbItem] = await tx.select().from(schema.item).where(eq(schema.item.id, item.itemId)).limit(1)
            if (dbItem && dbItem.trackStock) {
              await tx
                .update(schema.item)
                .set({ currentStock: sql`${schema.item.currentStock} + ${item.quantity}` })
                .where(eq(schema.item.id, item.itemId))
              await tx.insert(schema.stockMovement).values({
                itemId: item.itemId,
                movementType: 'SALE',
                quantity: item.quantity, // positive = goods returned by the reversal
                referenceType: 'INVOICE',
                referenceId: id,
                notes: 'Invoice reversed via credit note — stock returned',
              })
            }
          }

          // Mark REVERSED (not cancelledAt): the invoice STAYS on the statement
          // beside its credit note. balanceDue → 0 so it drops out of receivables.
          await tx
            .update(schema.salesInvoice)
            .set({ status: 'REVERSED', balanceDue: 0 })
            .where(eq(schema.salesInvoice.id, id))

          return created.id
        })

        if (!createdId) return { success: true, data: null }

        // Load the note with the relations the renderer expects (items with
        // catalog item, customer, the reversed invoice).
        const [noteHeader] = await db.select().from(schema.creditDebitNote).where(eq(schema.creditDebitNote.id, createdId)).limit(1)
        const [note] = await attachCustomerAndItems(db, [noteHeader], schema.creditDebitNoteItem, 'creditDebitNoteId')
        const [referenceInvoice] = await db.select().from(schema.salesInvoice).where(eq(schema.salesInvoice.id, id)).limit(1)
        return { success: true, data: { ...note, referenceInvoice } }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to reverse invoice',
        }
      }
    }
  )

  // Generate invoice number
  ipcMain.handle('sales:generateInvoiceNumber', async () => {
    try {
      const newInvoiceNumber = await generateNextInvoiceNumber(db)
      return { success: true, data: newInvoiceNumber }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate invoice number'
      }
    }
  })

  // Generate PDF
  ipcMain.handle('sales:generatePDF', async (_, _id: string) => {
    try {
      // PDF generation will be implemented with pdfmake
      // For now, return placeholder
      return {
        success: true,
        message: 'PDF generation not yet implemented'
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate PDF'
      }
    }
  })
}
