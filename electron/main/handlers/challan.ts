import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { triggerSyncAfterChange } from '../sync'

// Generate fiscal year string (e.g., "26-27" for April 2026 - March 2027)
const getFiscalYear = (): string => {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear() % 100
  if (month >= 4) {
    return `${String(year).padStart(2, '0')}-${String(year + 1).padStart(2, '0')}`
  } else {
    return `${String(year - 1).padStart(2, '0')}-${String(year).padStart(2, '0')}`
  }
}

export const setupChallanHandlers = () => {
  const prisma = getPrisma()

  // Get all delivery challans
  ipcMain.handle('challan:getAll', async () => {
    try {
      const challans = await prisma.deliveryChallan.findMany({
        include: {
          party: true,
          items: {
            include: {
              item: true
            }
          }
        },
        orderBy: { challanDate: 'desc' }
      })
      return { success: true, data: challans }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch challans'
      }
    }
  })

  // Get challan by ID
  ipcMain.handle('challan:getById', async (_, id: string) => {
    try {
      const challan = await prisma.deliveryChallan.findUnique({
        where: { id },
        include: {
          party: true,
          items: {
            include: {
              item: true
            }
          }
        }
      })
      return { success: true, data: challan }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch challan'
      }
    }
  })

  // Create delivery challan
  ipcMain.handle('challan:create', async (_, data) => {
    try {
      const challan = await prisma.$transaction(async (tx: any) => {
        // Calculate totals
        let subtotal = 0
        let taxAmount = 0

        data.items.forEach((item: any) => {
          const itemTotal = item.quantity * item.rate - (item.discount || 0)
          subtotal += itemTotal
          taxAmount += (itemTotal * (item.taxRate || 0)) / 100
        })

        const totalAmount = subtotal + taxAmount

        const created = await tx.deliveryChallan.create({
          data: {
            challanNumber: data.challanNumber,
            challanDate: new Date(data.challanDate),
            partyId: data.partyId,
            subtotal,
            taxAmount,
            totalAmount,
            transportMode: data.transportMode || null,
            vehicleNumber: data.vehicleNumber || null,
            notes: data.notes || null,
            status: 'PENDING',
            items: {
              create: data.items.map((item: any) => {
                const taxableAmount = item.quantity * item.rate - (item.discount || 0)
                return {
                  itemId: item.itemId,
                  quantity: item.quantity,
                  rate: item.rate,
                  discount: item.discount || 0,
                  taxRate: item.taxRate || 0,
                  total: taxableAmount + (taxableAmount * (item.taxRate || 0)) / 100
                }
              })
            }
          },
          include: {
            items: { include: { item: true } },
            party: true
          }
        })

        // Update stock (decrement for tracked items) — challans dispatch goods
        for (const item of data.items) {
          const dbItem = await tx.item.findUnique({ where: { id: item.itemId } })
          if (dbItem && dbItem.trackStock) {
            await tx.item.update({
              where: { id: item.itemId },
              data: {
                currentStock: { decrement: item.quantity }
              }
            })

            await tx.stockMovement.create({
              data: {
                itemId: item.itemId,
                movementType: 'SALE',
                quantity: -item.quantity,
                referenceType: 'CHALLAN',
                referenceId: created.id
              }
            })
          }
        }

        return created
      })

      await triggerSyncAfterChange()
      return { success: true, data: challan }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create delivery challan'
      }
    }
  })

  // Update delivery challan
  ipcMain.handle('challan:update', async (_, id: string, data) => {
    try {
      const existingChallan = await prisma.deliveryChallan.findUnique({
        where: { id },
        include: { items: true }
      })

      if (!existingChallan) {
        throw new Error('Delivery challan not found')
      }

      // Calculate new totals
      let subtotal = 0
      let taxAmount = 0

      data.items.forEach((item: any) => {
        const itemTotal = item.quantity * item.rate - (item.discount || 0)
        subtotal += itemTotal
        taxAmount += (itemTotal * (item.taxRate || 0)) / 100
      })

      const totalAmount = subtotal + taxAmount

      // Delete existing items
      await prisma.deliveryChallanItem.deleteMany({
        where: { deliveryChallanId: id }
      })

      // Update challan with new data
      const challan = await prisma.deliveryChallan.update({
        where: { id },
        data: {
          challanDate: new Date(data.challanDate),
          partyId: data.partyId,
          subtotal,
          taxAmount,
          totalAmount,
          transportMode: data.transportMode || null,
          vehicleNumber: data.vehicleNumber || null,
          notes: data.notes || null,
          status: data.status || existingChallan.status,
          items: {
            create: data.items.map((item: any) => {
              const taxableAmount = item.quantity * item.rate - (item.discount || 0)
              return {
                itemId: item.itemId,
                quantity: item.quantity,
                rate: item.rate,
                discount: item.discount || 0,
                taxRate: item.taxRate || 0,
                total: taxableAmount + (taxableAmount * (item.taxRate || 0)) / 100
              }
            })
          }
        },
        include: {
          items: { include: { item: true } },
          party: true
        }
      })

      await triggerSyncAfterChange()
      return { success: true, data: challan }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update delivery challan'
      }
    }
  })

  // Delete delivery challan
  ipcMain.handle('challan:delete', async (_, id: string) => {
    try {
      await prisma.$transaction(async (tx: any) => {
        // Get the challan with items before deleting
        const challan = await tx.deliveryChallan.findUnique({
          where: { id },
          include: { items: true }
        })

        if (!challan) {
          throw new Error('Delivery challan not found')
        }

        // Reverse stock for each item
        for (const item of challan.items) {
          const dbItem = await tx.item.findUnique({ where: { id: item.itemId } })
          if (dbItem && dbItem.trackStock) {
            await tx.item.update({
              where: { id: item.itemId },
              data: {
                currentStock: { increment: item.quantity }
              }
            })
          }
        }

        // Delete stock movements for this challan
        await tx.stockMovement.deleteMany({
          where: {
            referenceType: 'CHALLAN',
            referenceId: id
          }
        })

        // Delete the challan (items will cascade delete)
        await tx.deliveryChallan.delete({
          where: { id }
        })
      })

      await triggerSyncAfterChange()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete delivery challan'
      }
    }
  })

  // Convert challan to sales invoice
  ipcMain.handle('challan:convertToInvoice', async (_, id: string) => {
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        const challan = await tx.deliveryChallan.findUnique({
          where: { id },
          include: { items: true }
        })

        if (!challan) {
          throw new Error('Delivery challan not found')
        }

        if (challan.status === 'CONVERTED') {
          throw new Error('Challan has already been converted to an invoice')
        }

        // Generate new invoice number (same pattern as sales handler)
        const lastInvoice = await tx.salesInvoice.findFirst({
          where: { type: 'INVOICE' },
          orderBy: { invoiceNumber: 'desc' }
        })

        const company = await tx.company.findFirst()
        const prefix = company?.invoicePrefix || 'INV'
        const year = new Date().getFullYear()
        const lastNumber = lastInvoice ? parseInt(lastInvoice.invoiceNumber.split('-').pop() || '0') : 0
        const newInvoiceNumber = `${prefix}-${year}-${String(lastNumber + 1).padStart(3, '0')}`

        // Create the sales invoice from challan data
        const invoice = await tx.salesInvoice.create({
          data: {
            invoiceNumber: newInvoiceNumber,
            invoiceDate: new Date(),
            type: 'INVOICE',
            partyId: challan.partyId,
            subtotal: challan.subtotal,
            discount: 0,
            taxAmount: challan.taxAmount,
            totalAmount: challan.totalAmount,
            amountPaid: 0,
            balanceDue: challan.totalAmount,
            status: 'DRAFT',
            notes: challan.notes,
            items: {
              create: challan.items.map((item: any) => ({
                itemId: item.itemId,
                quantity: item.quantity,
                rate: item.rate,
                discount: item.discount || 0,
                taxRate: item.taxRate || 0,
                total: item.total
              }))
            }
          },
          include: {
            items: { include: { item: true } },
            party: true
          }
        })

        // Update challan status to CONVERTED
        await tx.deliveryChallan.update({
          where: { id },
          data: {
            status: 'CONVERTED',
            convertedToInvoiceId: invoice.id
          }
        })

        // Update party balance (since it's now an invoice)
        await tx.party.update({
          where: { id: challan.partyId },
          data: {
            currentBalance: { increment: challan.totalAmount }
          }
        })

        // Note: Stock was already decremented when the challan was created,
        // so we do NOT decrement stock again. But we create stock movements
        // with INVOICE reference for the new invoice and remove the CHALLAN ones.
        for (const item of challan.items) {
          const dbItem = await tx.item.findUnique({ where: { id: item.itemId } })
          if (dbItem && dbItem.trackStock) {
            // Update the existing challan stock movement to reference the invoice
            await tx.stockMovement.updateMany({
              where: {
                itemId: item.itemId,
                referenceType: 'CHALLAN',
                referenceId: challan.id
              },
              data: {
                referenceType: 'INVOICE',
                referenceId: invoice.id
              }
            })
          }
        }

        return invoice
      })

      await triggerSyncAfterChange()
      return { success: true, data: result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to convert challan to invoice'
      }
    }
  })

  // Generate challan number
  ipcMain.handle('challan:generateChallanNumber', async () => {
    try {
      const fy = getFiscalYear()
      const prefix = `NS/DC/${fy}/`

      const lastChallan = await prisma.deliveryChallan.findFirst({
        where: { challanNumber: { startsWith: prefix } },
        orderBy: { challanNumber: 'desc' }
      })

      let nextNum = 1
      if (lastChallan) {
        const lastPart = lastChallan.challanNumber.split('/').pop()
        const parsed = parseInt(lastPart || '0')
        if (!isNaN(parsed)) nextNum = parsed + 1
      }

      const newChallanNumber = `${prefix}${String(nextNum).padStart(2, '0')}`
      return { success: true, data: newChallanNumber }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate challan number'
      }
    }
  })
}
