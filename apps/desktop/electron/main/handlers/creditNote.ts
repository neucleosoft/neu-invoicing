import { ipcMain } from 'electron'
import { computeGstValues, desc, eq, sql, type DrizzleDbLike } from '@neu/shared'
import { getDb, schema } from '../db'
import { attachCustomerAndItems } from './docLoaders'

// GST split for a note's lines via the shared computeGstValues — the same
// implementation mobile's credit-note screens use. Cess is deliberately NOT
// passed: the CreditDebitNote tables have no cess columns on either platform.
const buildNoteGstValues = async (tx: DrizzleDbLike, customerId: string, items: any[]) => {
  const [customer] = await tx.select().from(schema.customer).where(eq(schema.customer.id, customerId)).limit(1)
  const [company] = await tx.select().from(schema.company).limit(1)
  if (!customer) throw new Error('Customer not found')

  const catalogItems: any[] = []
  for (const item of items) {
    const [row] = await tx.select().from(schema.item).where(eq(schema.item.id, item.itemId)).limit(1)
    catalogItems.push(row ?? null)
  }

  const gst = computeGstValues({
    company: company ? { stateCode: company.stateCode, stateName: company.stateName } : null,
    party: { taxId: customer.taxId, stateCode: customer.stateCode, stateName: customer.stateName },
    items: items.map((item: any, idx: number) => ({
      quantity: item.quantity,
      rate: item.rate,
      discount: item.discount,
      taxRate: item.taxRate,
      hsnCode: item.hsnCode,
      catalogHsnCode: catalogItems[idx]?.hsnCode,
      catalogSkuHsn: catalogItems[idx]?.skuHsn
    }))
  })

  const processedItems = items.map((item: any, idx: number) => {
    const g = gst.items[idx]
    return {
      itemId: item.itemId,
      quantity: item.quantity,
      rate: item.rate,
      discount: item.discount || 0,
      taxRate: item.taxRate || 0,
      total: g.total,
      hsnCode: g.hsnCode,
      taxableAmount: g.taxableAmount,
      cgstRate: g.cgstRate,
      cgstAmount: g.cgstAmount,
      sgstRate: g.sgstRate,
      sgstAmount: g.sgstAmount,
      igstRate: g.igstRate,
      igstAmount: g.igstAmount
    }
  })

  return { gst, processedItems }
}

export const setupCreditNoteHandlers = () => {
  const db = getDb()

  // Load a note with the relations the renderer expects.
  const loadNoteFull = async (id: string) => {
    const [header] = await db.select().from(schema.creditDebitNote).where(eq(schema.creditDebitNote.id, id)).limit(1)
    if (!header) return null
    const [note] = await attachCustomerAndItems(db, [header], schema.creditDebitNoteItem, 'creditDebitNoteId')
    const [referenceInvoice] = header.referenceInvoiceId
      ? await db.select().from(schema.salesInvoice).where(eq(schema.salesInvoice.id, header.referenceInvoiceId)).limit(1)
      : [null]
    return { ...note, referenceInvoice: referenceInvoice ?? null }
  }

  // Get all credit/debit notes
  ipcMain.handle('creditNote:getAll', async (_, type?: string) => {
    try {
      const headers = await db
        .select()
        .from(schema.creditDebitNote)
        .where(type ? eq(schema.creditDebitNote.type, type) : undefined)
        .orderBy(desc(schema.creditDebitNote.noteDate))
      const notes = await attachCustomerAndItems(db, headers, schema.creditDebitNoteItem, 'creditDebitNoteId')
      return { success: true, data: notes }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch credit/debit notes'
      }
    }
  })

  // Get note by ID
  ipcMain.handle('creditNote:getById', async (_, id: string) => {
    try {
      const note = await loadNoteFull(id)
      return { success: true, data: note }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch note'
      }
    }
  })

  // Create credit/debit note
  ipcMain.handle('creditNote:create', async (_, data) => {
    try {
      const createdId = await db.transaction(async (tx) => {
        const { gst, processedItems } = await buildNoteGstValues(tx, data.customerId, data.items)
        const { subtotal, taxAmount, totalAmount, isInterState } = gst

        const [created] = await tx
          .insert(schema.creditDebitNote)
          .values({
            noteNumber: data.noteNumber,
            noteDate: new Date(data.noteDate),
            type: data.type,
            customerId: data.customerId,
            referenceInvoiceId: data.referenceInvoiceId || null,
            reason: data.reason || null,
            subtotal,
            taxAmount,
            totalAmount,
            cgstAmount: gst.totalCgst,
            sgstAmount: gst.totalSgst,
            igstAmount: gst.totalIgst,
            isInterState,
            status: 'ACTIVE',
            notes: data.notes || null,
            termsConditions: data.termsConditions ?? null,
          })
          .returning({ id: schema.creditDebitNote.id })

        if (processedItems.length) {
          await tx
            .insert(schema.creditDebitNoteItem)
            .values(processedItems.map((i: any) => ({ ...i, creditDebitNoteId: created.id })))
        }

        // Update customer balance
        // CREDIT_NOTE: reduces what the customer owes (decrement balance)
        // DEBIT_NOTE: increases what the customer owes (increment balance)
        const sign = data.type === 'CREDIT_NOTE' ? sql`- ${totalAmount}` : sql`+ ${totalAmount}`
        await tx
          .update(schema.customer)
          .set({ currentBalance: sql`${schema.customer.currentBalance} ${sign}` })
          .where(eq(schema.customer.id, data.customerId))

        // Update referenced invoice balanceDue if provided
        if (data.referenceInvoiceId) {
          const [invoice] = await tx.select().from(schema.salesInvoice).where(eq(schema.salesInvoice.id, data.referenceInvoiceId)).limit(1)
          if (invoice) {
            if (data.type === 'CREDIT_NOTE') {
              const newBalanceDue = invoice.balanceDue - totalAmount
              await tx
                .update(schema.salesInvoice)
                .set({
                  balanceDue: newBalanceDue,
                  status: newBalanceDue <= 0 ? 'PAID' : (invoice.amountPaid > 0 ? 'PARTIAL' : invoice.status)
                })
                .where(eq(schema.salesInvoice.id, data.referenceInvoiceId))
            } else {
              const newBalanceDue = invoice.balanceDue + totalAmount
              await tx
                .update(schema.salesInvoice)
                .set({
                  balanceDue: newBalanceDue,
                  status: newBalanceDue > 0 && invoice.status === 'PAID' ? 'PARTIAL' : invoice.status
                })
                .where(eq(schema.salesInvoice.id, data.referenceInvoiceId))
            }
          }
        }

        return created.id
      })

      const note = await loadNoteFull(createdId)
      return { success: true, data: note }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create credit/debit note'
      }
    }
  })

  // Update credit/debit note
  ipcMain.handle('creditNote:update', async (_, id: string, data) => {
    try {
      await db.transaction(async (tx) => {
        const [existingNote] = await tx.select().from(schema.creditDebitNote).where(eq(schema.creditDebitNote.id, id)).limit(1)

        if (!existingNote) {
          throw new Error('Credit/Debit note not found')
        }

        // Reverse old balance changes
        const reverseSign = existingNote.type === 'CREDIT_NOTE' ? sql`+ ${existingNote.totalAmount}` : sql`- ${existingNote.totalAmount}`
        await tx
          .update(schema.customer)
          .set({ currentBalance: sql`${schema.customer.currentBalance} ${reverseSign}` })
          .where(eq(schema.customer.id, existingNote.customerId))

        // Reverse old reference invoice changes
        if (existingNote.referenceInvoiceId) {
          const [oldInvoice] = await tx.select().from(schema.salesInvoice).where(eq(schema.salesInvoice.id, existingNote.referenceInvoiceId)).limit(1)
          if (oldInvoice) {
            const invSign = existingNote.type === 'CREDIT_NOTE' ? sql`+ ${existingNote.totalAmount}` : sql`- ${existingNote.totalAmount}`
            await tx
              .update(schema.salesInvoice)
              .set({ balanceDue: sql`${schema.salesInvoice.balanceDue} ${invSign}` })
              .where(eq(schema.salesInvoice.id, existingNote.referenceInvoiceId))
          }
        }

        const { gst, processedItems } = await buildNoteGstValues(tx, data.customerId, data.items)
        const { subtotal, taxAmount, totalAmount, isInterState } = gst

        // Delete existing items
        await tx.delete(schema.creditDebitNoteItem).where(eq(schema.creditDebitNoteItem.creditDebitNoteId, id))

        await tx
          .update(schema.creditDebitNote)
          .set({
            noteDate: new Date(data.noteDate),
            type: data.type,
            customerId: data.customerId,
            referenceInvoiceId: data.referenceInvoiceId || null,
            reason: data.reason || null,
            subtotal,
            taxAmount,
            totalAmount,
            cgstAmount: gst.totalCgst,
            sgstAmount: gst.totalSgst,
            igstAmount: gst.totalIgst,
            isInterState,
            notes: data.notes || null,
            termsConditions: data.termsConditions ?? null,
          })
          .where(eq(schema.creditDebitNote.id, id))

        if (processedItems.length) {
          await tx
            .insert(schema.creditDebitNoteItem)
            .values(processedItems.map((i: any) => ({ ...i, creditDebitNoteId: id })))
        }

        // Apply new balance changes
        const applySign = data.type === 'CREDIT_NOTE' ? sql`- ${totalAmount}` : sql`+ ${totalAmount}`
        await tx
          .update(schema.customer)
          .set({ currentBalance: sql`${schema.customer.currentBalance} ${applySign}` })
          .where(eq(schema.customer.id, data.customerId))

        // Apply new reference invoice changes
        if (data.referenceInvoiceId) {
          const [newInvoice] = await tx.select().from(schema.salesInvoice).where(eq(schema.salesInvoice.id, data.referenceInvoiceId)).limit(1)
          if (newInvoice) {
            if (data.type === 'CREDIT_NOTE') {
              const newBalanceDue = newInvoice.balanceDue - totalAmount
              await tx
                .update(schema.salesInvoice)
                .set({
                  balanceDue: newBalanceDue,
                  status: newBalanceDue <= 0 ? 'PAID' : (newInvoice.amountPaid > 0 ? 'PARTIAL' : newInvoice.status)
                })
                .where(eq(schema.salesInvoice.id, data.referenceInvoiceId))
            } else {
              const newBalanceDue = newInvoice.balanceDue + totalAmount
              await tx
                .update(schema.salesInvoice)
                .set({
                  balanceDue: newBalanceDue,
                  status: newBalanceDue > 0 && newInvoice.status === 'PAID' ? 'PARTIAL' : newInvoice.status
                })
                .where(eq(schema.salesInvoice.id, data.referenceInvoiceId))
            }
          }
        }
      })

      const note = await loadNoteFull(id)
      return { success: true, data: note }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update credit/debit note'
      }
    }
  })

  // Cancel credit/debit note (Mode B): reverse its balance effect, then stamp
  // cancelledAt instead of deleting. The row + its items stay on record, marked
  // Cancelled, forever. Terminal — there is no restore.
  ipcMain.handle('creditNote:cancel', async (_, id: string) => {
    try {
      const [existingNote] = await db.select().from(schema.creditDebitNote).where(eq(schema.creditDebitNote.id, id)).limit(1)

      if (!existingNote) {
        throw new Error('Credit/Debit note not found')
      }

      // Already cancelled — never reverse the balance twice (idempotency guard).
      if (existingNote.cancelledAt) {
        return { success: true }
      }

      await db.transaction(async (tx) => {
        // Reverse balance changes
        const sign = existingNote.type === 'CREDIT_NOTE' ? sql`+ ${existingNote.totalAmount}` : sql`- ${existingNote.totalAmount}`
        await tx
          .update(schema.customer)
          .set({ currentBalance: sql`${schema.customer.currentBalance} ${sign}` })
          .where(eq(schema.customer.id, existingNote.customerId))

        // Reverse reference invoice changes
        if (existingNote.referenceInvoiceId) {
          const [invoice] = await tx.select().from(schema.salesInvoice).where(eq(schema.salesInvoice.id, existingNote.referenceInvoiceId)).limit(1)
          if (invoice) {
            const invSign = existingNote.type === 'CREDIT_NOTE' ? sql`+ ${existingNote.totalAmount}` : sql`- ${existingNote.totalAmount}`
            await tx
              .update(schema.salesInvoice)
              .set({ balanceDue: sql`${schema.salesInvoice.balanceDue} ${invSign}` })
              .where(eq(schema.salesInvoice.id, existingNote.referenceInvoiceId))
          }
        }

        // CANCEL, not delete: stamp cancelledAt; the note + items stay on record.
        await tx.update(schema.creditDebitNote).set({ cancelledAt: new Date() }).where(eq(schema.creditDebitNote.id, id))
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel credit/debit note'
      }
    }
  })

  // Generate note number
  ipcMain.handle('creditNote:generateNoteNumber', async (_, type: string) => {
    try {
      const prefix = type === 'CREDIT_NOTE' ? 'CN' : 'DN'
      const year = new Date().getFullYear()

      const [lastNote] = await db
        .select({ noteNumber: schema.creditDebitNote.noteNumber })
        .from(schema.creditDebitNote)
        .where(eq(schema.creditDebitNote.type, type))
        .orderBy(desc(schema.creditDebitNote.noteNumber))
        .limit(1)

      const lastNumber = lastNote ? parseInt(lastNote.noteNumber.split('-').pop() || '0') : 0
      const newNoteNumber = `${prefix}-${year}-${String(lastNumber + 1).padStart(3, '0')}`

      return { success: true, data: newNoteNumber }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate note number'
      }
    }
  })
}
