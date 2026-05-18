import { ipcMain } from 'electron'
import { getPrisma } from '../database'

export const setupSupplierItemHandlers = () => {
  const prisma = getPrisma()

  // Get all supplier items, optionally filtered by supplier
  ipcMain.handle('supplierItem:getAll', async (_, supplierId?: string) => {
    try {
      const where = supplierId ? { supplierId } : {}
      const items = await prisma.supplierItem.findMany({
        where,
        include: {
          supplier: { select: { id: true, name: true } },
          linkedItem: { select: { id: true, name: true, currentStock: true, trackStock: true } }
        },
        orderBy: { name: 'asc' }
      })
      return { success: true, data: items }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch supplier items'
      }
    }
  })

  // Get supplier item by ID
  ipcMain.handle('supplierItem:getById', async (_, id: string) => {
    try {
      const item = await prisma.supplierItem.findUnique({
        where: { id },
        include: {
          supplier: true,
          linkedItem: true
        }
      })
      return { success: true, data: item }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch supplier item'
      }
    }
  })

  // Create supplier item
  ipcMain.handle('supplierItem:create', async (_, data) => {
    try {
      const item = await prisma.supplierItem.create({
        data: {
          supplierId: data.supplierId,
          name: data.name,
          hsnCode: data.hsnCode,
          unit: data.unit || 'pcs',
          lastPurchasePrice: data.lastPurchasePrice || 0,
          defaultTaxRate: data.defaultTaxRate || 0,
          linkedItemId: data.linkedItemId || null
        }
      })
      return { success: true, data: item }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create supplier item'
      }
    }
  })

  // Update supplier item
  ipcMain.handle('supplierItem:update', async (_, id: string, data) => {
    try {
      const item = await prisma.supplierItem.update({
        where: { id },
        data: {
          name: data.name,
          hsnCode: data.hsnCode,
          unit: data.unit,
          lastPurchasePrice: data.lastPurchasePrice,
          defaultTaxRate: data.defaultTaxRate,
          linkedItemId: data.linkedItemId ?? null
        }
      })
      return { success: true, data: item }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update supplier item'
      }
    }
  })

  // Delete supplier item
  ipcMain.handle('supplierItem:delete', async (_, id: string) => {
    try {
      // Check if supplier item has been used on any purchase bill
      const linked = await prisma.purchaseBillItem.findFirst({
        where: { supplierItemId: id }
      })
      if (linked) {
        return {
          success: false,
          error: 'Cannot delete: this supplier item is referenced by purchase bills.'
        }
      }
      await prisma.supplierItem.delete({ where: { id } })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete supplier item'
      }
    }
  })
}
