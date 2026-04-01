import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { triggerSyncAfterChange } from '../sync'

export const setupCreditNoteHandlers = () => {
  const prisma = getPrisma()

  // Get all credit/debit notes
  ipcMain.handle('creditNote:getAll', async (_, type?: string) => {
    try {
      const where = type ? { type: type as any } : {}
      const notes = await prisma.creditDebitNote.findMany({
        where,
        include: {
          party: true,
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
          party: true,
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
        // Get party and company details for GST calculation
        const party = await tx.party.findUnique({ where: { id: data.partyId } })
        const company = await tx.company.findFirst()

        if (!party) throw new Error('Party not found')

        const companyStateCode = company?.stateCode || ''
        const partyStateCode = party.stateCode || ''
        const isInterState = companyStateCode !== partyStateCode && partyStateCode !== ''

        // Calculate totals with GST components
        let subtotal = 0
        let taxAmount = 0
        let totalCgst = 0
        let totalSgst = 0
        let totalIgst = 0

        const processedItems: any[] = []
        for (const item of data.items) {
          const itemTaxableAmount = item.quantity * item.rate - (item.discount || 0)
          subtotal += itemTaxableAmount

          const dbItem = await tx.item.findUnique({ where: { id: item.itemId } })

          const halfRate = (item.taxRate || 0) / 2
          let gstComponents
          if (isInterState) {
            gstComponents = {
              cgstRate: 0, cgstAmount: 0, sgstRate: 0, sgstAmount: 0,
              igstRate: item.taxRate || 0, igstAmount: (itemTaxableAmount * (item.taxRate || 0)) / 100
            }
          } else {
            gstComponents = {
              cgstRate: halfRate, cgstAmount: (itemTaxableAmount * halfRate) / 100,
              sgstRate: halfRate, sgstAmount: (itemTaxableAmount * halfRate) / 100,
              igstRate: 0, igstAmount: 0
            }
          }

          const itemTax = gstComponents.cgstAmount + gstComponents.sgstAmount + gstComponents.igstAmount
          taxAmount += itemTax
          totalCgst += gstComponents.cgstAmount
          totalSgst += gstComponents.sgstAmount
          totalIgst += gstComponents.igstAmount

          processedItems.push({
            itemId: item.itemId,
            quantity: item.quantity,
            rate: item.rate,
            discount: item.discount || 0,
            taxRate: item.taxRate || 0,
            total: itemTaxableAmount + itemTax,
            hsnCode: item.hsnCode || dbItem?.hsnCode || '',
            taxableAmount: itemTaxableAmount,
            cgstRate: gstComponents.cgstRate,
            cgstAmount: gstComponents.cgstAmount,
            sgstRate: gstComponents.sgstRate,
            sgstAmount: gstComponents.sgstAmount,
            igstRate: gstComponents.igstRate,
            igstAmount: gstComponents.igstAmount
          })
        }

        const totalAmount = subtotal + taxAmount

        const created = await tx.creditDebitNote.create({
          data: {
            noteNumber: data.noteNumber,
            noteDate: new Date(data.noteDate),
            type: data.type,
            partyId: data.partyId,
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
            items: {
              create: processedItems
            }
          },
          include: {
            items: { include: { item: true } },
            party: true,
            referenceInvoice: true
          }
        })

        // Update party balance
        // CREDIT_NOTE: reduces what the party owes (decrement balance)
        // DEBIT_NOTE: increases what the party owes (increment balance)
        if (data.type === 'CREDIT_NOTE') {
          await tx.party.update({
            where: { id: data.partyId },
            data: { currentBalance: { decrement: totalAmount } }
          })
        } else {
          await tx.party.update({
            where: { id: data.partyId },
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

      await triggerSyncAfterChange()
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
          await tx.party.update({
            where: { id: existingNote.partyId },
            data: { currentBalance: { increment: existingNote.totalAmount } }
          })
        } else {
          await tx.party.update({
            where: { id: existingNote.partyId },
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

        // Get party and company for GST recalculation
        const party = await tx.party.findUnique({ where: { id: data.partyId } })
        const company = await tx.company.findFirst()
        const companyStateCode = company?.stateCode || ''
        const partyStateCode = party?.stateCode || ''
        const isInterState = companyStateCode !== partyStateCode && partyStateCode !== ''

        // Calculate new totals with GST components
        let subtotal = 0
        let taxAmount = 0
        let totalCgst = 0
        let totalSgst = 0
        let totalIgst = 0

        const processedItems: any[] = []
        for (const item of data.items) {
          const itemTaxableAmount = item.quantity * item.rate - (item.discount || 0)
          subtotal += itemTaxableAmount

          const dbItem = await tx.item.findUnique({ where: { id: item.itemId } })

          const halfRate = (item.taxRate || 0) / 2
          let gstComponents
          if (isInterState) {
            gstComponents = {
              cgstRate: 0, cgstAmount: 0, sgstRate: 0, sgstAmount: 0,
              igstRate: item.taxRate || 0, igstAmount: (itemTaxableAmount * (item.taxRate || 0)) / 100
            }
          } else {
            gstComponents = {
              cgstRate: halfRate, cgstAmount: (itemTaxableAmount * halfRate) / 100,
              sgstRate: halfRate, sgstAmount: (itemTaxableAmount * halfRate) / 100,
              igstRate: 0, igstAmount: 0
            }
          }

          const itemTax = gstComponents.cgstAmount + gstComponents.sgstAmount + gstComponents.igstAmount
          taxAmount += itemTax
          totalCgst += gstComponents.cgstAmount
          totalSgst += gstComponents.sgstAmount
          totalIgst += gstComponents.igstAmount

          processedItems.push({
            itemId: item.itemId,
            quantity: item.quantity,
            rate: item.rate,
            discount: item.discount || 0,
            taxRate: item.taxRate || 0,
            total: itemTaxableAmount + itemTax,
            hsnCode: item.hsnCode || dbItem?.hsnCode || '',
            taxableAmount: itemTaxableAmount,
            cgstRate: gstComponents.cgstRate,
            cgstAmount: gstComponents.cgstAmount,
            sgstRate: gstComponents.sgstRate,
            sgstAmount: gstComponents.sgstAmount,
            igstRate: gstComponents.igstRate,
            igstAmount: gstComponents.igstAmount
          })
        }

        const totalAmount = subtotal + taxAmount

        // Delete existing items
        await tx.creditDebitNoteItem.deleteMany({
          where: { creditDebitNoteId: id }
        })

        const updated = await tx.creditDebitNote.update({
          where: { id },
          data: {
            noteDate: new Date(data.noteDate),
            type: data.type,
            partyId: data.partyId,
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
            items: {
              create: processedItems
            }
          },
          include: {
            items: { include: { item: true } },
            party: true,
            referenceInvoice: true
          }
        })

        // Apply new balance changes
        if (data.type === 'CREDIT_NOTE') {
          await tx.party.update({
            where: { id: data.partyId },
            data: { currentBalance: { decrement: totalAmount } }
          })
        } else {
          await tx.party.update({
            where: { id: data.partyId },
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

      await triggerSyncAfterChange()
      return { success: true, data: note }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update credit/debit note'
      }
    }
  })

  // Delete credit/debit note
  ipcMain.handle('creditNote:delete', async (_, id: string) => {
    try {
      const existingNote = await prisma.creditDebitNote.findUnique({
        where: { id },
        include: { items: true }
      })

      if (!existingNote) {
        throw new Error('Credit/Debit note not found')
      }

      await prisma.$transaction(async (tx: any) => {
        // Reverse balance changes
        if (existingNote.type === 'CREDIT_NOTE') {
          await tx.party.update({
            where: { id: existingNote.partyId },
            data: { currentBalance: { increment: existingNote.totalAmount } }
          })
        } else {
          await tx.party.update({
            where: { id: existingNote.partyId },
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

        // Delete the note (items will cascade delete)
        await tx.creditDebitNote.delete({
          where: { id }
        })
      })

      await triggerSyncAfterChange()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete credit/debit note'
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
