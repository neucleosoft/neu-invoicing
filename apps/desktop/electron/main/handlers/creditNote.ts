import { ipcMain } from 'electron'
import { computeGstValues } from '@neu/shared'
import { getPrisma } from '../database'

// GST split for a note's lines via the shared computeGstValues — the same
// implementation mobile's credit-note screens use; this file used to hand-roll
// the identical math twice (create + update). Cess is deliberately NOT passed:
// the CreditDebitNote tables have no cess columns on either platform, and the
// old loops excluded it too.
const buildNoteGstValues = async (tx: any, customerId: string, items: any[]) => {
  const customer = await tx.customer.findUnique({ where: { id: customerId } })
  const company = await tx.company.findFirst()
  if (!customer) throw new Error('Customer not found')

  const catalogItems: any[] = []
  for (const item of items) {
    catalogItems.push(await tx.item.findUnique({ where: { id: item.itemId } }))
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
  const prisma = getPrisma()

  // Get all credit/debit notes
  ipcMain.handle('creditNote:getAll', async (_, type?: string) => {
    try {
      const where = type ? { type: type as any } : {}
      const notes = await prisma.creditDebitNote.findMany({
        where,
        include: {
          customer: true,
          items: {
            include: {
              item: true
            }
          }
        },
        orderBy: { noteDate: 'desc' }
      })
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
      const note = await prisma.creditDebitNote.findUnique({
        where: { id },
        include: {
          customer: true,
          items: {
            include: {
              item: true
            }
          },
          referenceInvoice: true
        }
      })
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
      const note = await prisma.$transaction(async (tx: any) => {
        const { gst, processedItems } = await buildNoteGstValues(tx, data.customerId, data.items)
        const { subtotal, taxAmount, totalAmount, isInterState } = gst
        const totalCgst = gst.totalCgst
        const totalSgst = gst.totalSgst
        const totalIgst = gst.totalIgst

        const created = await tx.creditDebitNote.create({
          data: {
            noteNumber: data.noteNumber,
            noteDate: new Date(data.noteDate),
            type: data.type,
            customerId: data.customerId,
            referenceInvoiceId: data.referenceInvoiceId || null,
            reason: data.reason || null,
            subtotal,
            taxAmount,
            totalAmount,
            cgstAmount: totalCgst,
            sgstAmount: totalSgst,
            igstAmount: totalIgst,
            isInterState,
            status: 'ACTIVE',
            notes: data.notes || null,
            termsConditions: data.termsConditions ?? null,
            items: {
              create: processedItems
            }
          },
          include: {
            items: { include: { item: true } },
            customer: true,
            referenceInvoice: true
          }
        })

        // Update customer balance
        // CREDIT_NOTE: reduces what the customer owes (decrement balance)
        // DEBIT_NOTE: increases what the customer owes (increment balance)
        if (data.type === 'CREDIT_NOTE') {
          await tx.customer.update({
            where: { id: data.customerId},
            data: { currentBalance: { decrement: totalAmount } }
          })
        } else {
          await tx.customer.update({
            where: { id: data.customerId},
            data: { currentBalance: { increment: totalAmount } }
          })
        }

        // Update referenced invoice balanceDue if provided
        if (data.referenceInvoiceId) {
          const invoice = await tx.salesInvoice.findUnique({
            where: { id: data.referenceInvoiceId }
          })
          if (invoice) {
            if (data.type === 'CREDIT_NOTE') {
              const newBalanceDue = invoice.balanceDue - totalAmount
              await tx.salesInvoice.update({
                where: { id: data.referenceInvoiceId },
                data: {
                  balanceDue: newBalanceDue,
                  status: newBalanceDue <= 0 ? 'PAID' : (invoice.amountPaid > 0 ? 'PARTIAL' : invoice.status)
                }
              })
            } else {
              const newBalanceDue = invoice.balanceDue + totalAmount
              await tx.salesInvoice.update({
                where: { id: data.referenceInvoiceId },
                data: {
                  balanceDue: newBalanceDue,
                  status: newBalanceDue > 0 && invoice.status === 'PAID' ? 'PARTIAL' : invoice.status
                }
              })
            }
          }
        }

        return created
      })

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
      const note = await prisma.$transaction(async (tx: any) => {
        const existingNote = await tx.creditDebitNote.findUnique({
          where: { id },
          include: { items: true }
        })

        if (!existingNote) {
          throw new Error('Credit/Debit note not found')
        }

        // Reverse old balance changes
        if (existingNote.type === 'CREDIT_NOTE') {
          await tx.customer.update({
            where: { id: existingNote.customerId},
            data: { currentBalance: { increment: existingNote.totalAmount } }
          })
        } else {
          await tx.customer.update({
            where: { id: existingNote.customerId},
            data: { currentBalance: { decrement: existingNote.totalAmount } }
          })
        }

        // Reverse old reference invoice changes
        if (existingNote.referenceInvoiceId) {
          const oldInvoice = await tx.salesInvoice.findUnique({
            where: { id: existingNote.referenceInvoiceId }
          })
          if (oldInvoice) {
            if (existingNote.type === 'CREDIT_NOTE') {
              await tx.salesInvoice.update({
                where: { id: existingNote.referenceInvoiceId },
                data: { balanceDue: { increment: existingNote.totalAmount } }
              })
            } else {
              await tx.salesInvoice.update({
                where: { id: existingNote.referenceInvoiceId },
                data: { balanceDue: { decrement: existingNote.totalAmount } }
              })
            }
          }
        }

        const { gst, processedItems } = await buildNoteGstValues(tx, data.customerId, data.items)
        const { subtotal, taxAmount, totalAmount, isInterState } = gst
        const totalCgst = gst.totalCgst
        const totalSgst = gst.totalSgst
        const totalIgst = gst.totalIgst

        // Delete existing items
        await tx.creditDebitNoteItem.deleteMany({
          where: { creditDebitNoteId: id }
        })

        const updated = await tx.creditDebitNote.update({
          where: { id },
          data: {
            noteDate: new Date(data.noteDate),
            type: data.type,
            customerId: data.customerId,
            referenceInvoiceId: data.referenceInvoiceId || null,
            reason: data.reason || null,
            subtotal,
            taxAmount,
            totalAmount,
            cgstAmount: totalCgst,
            sgstAmount: totalSgst,
            igstAmount: totalIgst,
            isInterState,
            notes: data.notes || null,
            termsConditions: data.termsConditions ?? null,
            items: {
              create: processedItems
            }
          },
          include: {
            items: { include: { item: true } },
            customer: true,
            referenceInvoice: true
          }
        })

        // Apply new balance changes
        if (data.type === 'CREDIT_NOTE') {
          await tx.customer.update({
            where: { id: data.customerId},
            data: { currentBalance: { decrement: totalAmount } }
          })
        } else {
          await tx.customer.update({
            where: { id: data.customerId},
            data: { currentBalance: { increment: totalAmount } }
          })
        }

        // Apply new reference invoice changes
        if (data.referenceInvoiceId) {
          const newInvoice = await tx.salesInvoice.findUnique({
            where: { id: data.referenceInvoiceId }
          })
          if (newInvoice) {
            if (data.type === 'CREDIT_NOTE') {
              const newBalanceDue = newInvoice.balanceDue - totalAmount
              await tx.salesInvoice.update({
                where: { id: data.referenceInvoiceId },
                data: {
                  balanceDue: newBalanceDue,
                  status: newBalanceDue <= 0 ? 'PAID' : (newInvoice.amountPaid > 0 ? 'PARTIAL' : newInvoice.status)
                }
              })
            } else {
              const newBalanceDue = newInvoice.balanceDue + totalAmount
              await tx.salesInvoice.update({
                where: { id: data.referenceInvoiceId },
                data: {
                  balanceDue: newBalanceDue,
                  status: newBalanceDue > 0 && newInvoice.status === 'PAID' ? 'PARTIAL' : newInvoice.status
                }
              })
            }
          }
        }

        return updated
      })

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
      const existingNote = await prisma.creditDebitNote.findUnique({
        where: { id }
      })

      if (!existingNote) {
        throw new Error('Credit/Debit note not found')
      }

      // Already cancelled — never reverse the balance twice (idempotency guard).
      if (existingNote.cancelledAt) {
        return { success: true }
      }

      await prisma.$transaction(async (tx: any) => {
        // Reverse balance changes
        if (existingNote.type === 'CREDIT_NOTE') {
          await tx.customer.update({
            where: { id: existingNote.customerId},
            data: { currentBalance: { increment: existingNote.totalAmount } }
          })
        } else {
          await tx.customer.update({
            where: { id: existingNote.customerId},
            data: { currentBalance: { decrement: existingNote.totalAmount } }
          })
        }

        // Reverse reference invoice changes
        if (existingNote.referenceInvoiceId) {
          const invoice = await tx.salesInvoice.findUnique({
            where: { id: existingNote.referenceInvoiceId }
          })
          if (invoice) {
            if (existingNote.type === 'CREDIT_NOTE') {
              await tx.salesInvoice.update({
                where: { id: existingNote.referenceInvoiceId },
                data: { balanceDue: { increment: existingNote.totalAmount } }
              })
            } else {
              await tx.salesInvoice.update({
                where: { id: existingNote.referenceInvoiceId },
                data: { balanceDue: { decrement: existingNote.totalAmount } }
              })
            }
          }
        }

        // CANCEL, not delete: stamp cancelledAt; the note + items stay on record.
        await tx.creditDebitNote.update({
          where: { id },
          data: { cancelledAt: new Date() }
        })
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

      const lastNote = await prisma.creditDebitNote.findFirst({
        where: { type },
        orderBy: { noteNumber: 'desc' }
      })

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
