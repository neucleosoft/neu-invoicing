import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { triggerSyncAfterChange } from '../sync'

export const setupPurchaseHandlers = () => {
  const prisma = getPrisma()

  // Get all purchase bills
  ipcMain.handle('purchase:getAll', async () => {
    try {
      const bills = await prisma.purchaseBill.findMany({
        include: {
          party: true,
          items: {
            include: {
              item: true
            }
          }
        },
        orderBy: { billDate: 'desc' }
      })
      return { success: true, data: bills }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch bills'
      }
    }
  })

  // Get bill by ID
  ipcMain.handle('purchase:getById', async (_, id: string) => {
    try {
      const bill = await prisma.purchaseBill.findUnique({
        where: { id },
        include: {
          party: true,
          items: {
            include: {
              item: true
            }
          },
          payments: true
        }
      })
      return { success: true, data: bill }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch bill'
      }
    }
  })

  // Create purchase bill
  ipcMain.handle('purchase:create', async (_, data) => {
    try {
      const bill = await prisma.$transaction(async (tx: any) => {
        // Calculate totals
        let subtotal = 0
        let taxAmount = 0

        data.items.forEach((item: any) => {
          const itemTotal = item.quantity * item.rate - (item.discount || 0)
          subtotal += itemTotal
          taxAmount += (itemTotal * (item.taxRate || 0)) / 100
        })

        const totalAmount = subtotal + taxAmount - (data.discount || 0)
        const balanceDue = totalAmount - (data.amountPaid || 0)

        // Determine status
        let status = 'DRAFT'
        if (data.amountPaid >= totalAmount) {
          status = 'PAID'
        } else if (data.amountPaid > 0) {
          status = 'PARTIAL'
        }

        const created = await tx.purchaseBill.create({
          data: {
            billNumber: data.billNumber,
            billDate: new Date(data.billDate),
            partyId: data.partyId,
            subtotal,
            discount: data.discount || 0,
            taxAmount,
            totalAmount,
            amountPaid: data.amountPaid || 0,
            balanceDue,
            status: status as any,
            notes: data.notes,
            items: {
              create: data.items.map((item: any) => {
                const taxableAmount = item.quantity * item.rate - (item.discount || 0)
                return {
                  itemId: item.itemId,
                  hsnCode: item.hsnCode || '',
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

        // Update party balance (increment = we owe the supplier more)
        await tx.party.update({
          where: { id: data.partyId },
          data: { currentBalance: { increment: balanceDue } }
        })

        // Update stock and purchase price
        for (const item of data.items) {
          const dbItem = await tx.item.findUnique({ where: { id: item.itemId } })
          if (dbItem) {
            const updateData: any = { purchasePrice: item.rate }

            if (dbItem.trackStock) {
              updateData.currentStock = { increment: item.quantity }
            }

            await tx.item.update({
              where: { id: item.itemId },
              data: updateData
            })

            if (dbItem.trackStock) {
              await tx.stockMovement.create({
                data: {
                  itemId: item.itemId,
                  movementType: 'PURCHASE',
                  quantity: item.quantity,
                  referenceType: 'BILL',
                  referenceId: created.id
                }
              })
            }
          }
        }

        return created
      })

      await triggerSyncAfterChange()
      return { success: true, data: bill }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create purchase bill'
      }
    }
  })

  // Update purchase bill
  ipcMain.handle('purchase:update', async (_, id: string, data) => {
    try {
      // Get the existing bill
      const existingBill = await prisma.purchaseBill.findUnique({
        where: { id },
        include: { items: true }
      })

      if (!existingBill) {
        throw new Error('Purchase bill not found')
      }

      // Calculate new totals
      let subtotal = 0
      let taxAmount = 0

      data.items.forEach((item: any) => {
        const itemTotal = item.quantity * item.rate - (item.discount || 0)
        subtotal += itemTotal
        taxAmount += (itemTotal * (item.taxRate || 0)) / 100
      })

      const totalAmount = subtotal + taxAmount - (data.discount || 0)
      const balanceDue = totalAmount - (existingBill.amountPaid || 0)

      // Determine status
      let status = existingBill.status
      if (existingBill.amountPaid >= totalAmount) {
        status = 'PAID'
      } else if ((existingBill.amountPaid || 0) > 0) {
        status = 'PARTIAL'
      } else {
        status = 'DRAFT'
      }

      // Delete existing items
      await prisma.purchaseBillItem.deleteMany({
        where: { purchaseBillId: id }
      })

      // Update bill with new data
      const bill = await prisma.purchaseBill.update({
        where: { id },
        data: {
          billDate: new Date(data.billDate),
          partyId: data.partyId,
          subtotal,
          discount: data.discount || 0,
          taxAmount,
          totalAmount,
          balanceDue,
          status: status as any,
          notes: data.notes,
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
          items: {
            include: {
              item: true
            }
          },
          party: true
        }
      })

      // Update party balance if amount or party changed
      if (data.partyId !== existingBill.partyId) {
        // Party changed: reverse old party's balance, apply to new party
        await prisma.party.update({
          where: { id: existingBill.partyId },
          data: { currentBalance: { decrement: existingBill.balanceDue } }
        })
        await prisma.party.update({
          where: { id: data.partyId },
          data: { currentBalance: { increment: balanceDue } }
        })
      } else {
        const balanceDiff = balanceDue - existingBill.balanceDue
        if (balanceDiff !== 0) {
          await prisma.party.update({
            where: { id: data.partyId },
            data: { currentBalance: { increment: balanceDiff } }
          })
        }
      }

      await triggerSyncAfterChange()
      return { success: true, data: bill }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update purchase bill'
      }
    }
  })

  // Delete purchase bill
  ipcMain.handle('purchase:delete', async (_, id: string) => {
    try {
      // Get the bill with items before deleting
      const bill = await prisma.purchaseBill.findUnique({
        where: { id },
        include: {
          items: true
        }
      })

      if (!bill) {
        throw new Error('Purchase bill not found')
      }

      // Reverse party balance (decrement = we no longer owe the supplier)
      await prisma.party.update({
        where: { id: bill.partyId },
        data: {
          currentBalance: {
            decrement: bill.balanceDue
          }
        }
      })

      // Reverse stock for each item
      for (const item of bill.items) {
        const dbItem = await prisma.item.findUnique({ where: { id: item.itemId } })
        if (dbItem && dbItem.trackStock) {
          await prisma.item.update({
            where: { id: item.itemId },
            data: {
              currentStock: {
                decrement: item.quantity
              }
            }
          })
        }
      }

      // Delete stock movements for this bill
      await prisma.stockMovement.deleteMany({
        where: {
          referenceType: 'BILL',
          referenceId: id
        }
      })

      // Delete the bill (items will cascade delete)
      await prisma.purchaseBill.delete({
        where: { id }
      })

      await triggerSyncAfterChange()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete purchase bill'
      }
    }
  })

  // Generate bill number
  ipcMain.handle('purchase:generateBillNumber', async () => {
    try {
      const lastBill = await prisma.purchaseBill.findFirst({
        orderBy: { billNumber: 'desc' }
      })

      const year = new Date().getFullYear()
      const lastNumber = lastBill ? parseInt(lastBill.billNumber.split('-').pop() || '0') : 0
      const newBillNumber = `BILL-${year}-${String(lastNumber + 1).padStart(3, '0')}`

      return { success: true, data: newBillNumber }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate bill number'
      }
    }
  })
}
