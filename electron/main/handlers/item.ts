import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { triggerSyncAfterChange } from '../sync'

export const setupItemHandlers = () => {
  const prisma = getPrisma()

  // Get all items
  ipcMain.handle('item:getAll', async () => {
    try {
      const items = await prisma.item.findMany({
        orderBy: { name: 'asc' }
      })
      return { success: true, data: items }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch items'
      }
    }
  })

  // Get item by ID
  ipcMain.handle('item:getById', async (_, id: string) => {
    try {
      const item = await prisma.item.findUnique({
        where: { id },
        include: {
          stockMovements: {
            orderBy: { createdAt: 'desc' },
            take: 20
          }
        }
      })
      return { success: true, data: item }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch item'
      }
    }
  })

  // Create item
  ipcMain.handle('item:create', async (_, data) => {
    try {
      const item = await prisma.item.create({
        data: {
          name: data.name,
          skuHsn: data.skuHsn,
          hsnCode: data.hsnCode || null,
          type: data.type,
          unit: data.unit || 'pcs',
          salePrice: data.salePrice || 0,
          purchasePrice: data.purchasePrice || 0,
          taxRate: data.taxRate || 0,
          gstType: data.gstType || 'GST',
          trackStock: data.trackStock || false,
          currentStock: data.currentStock || 0,
          lowStockWarning: data.lowStockWarning || 10
        }
      })

      await triggerSyncAfterChange()
      return { success: true, data: item }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create item'
      }
    }
  })

  // Update item
  ipcMain.handle('item:update', async (_, id: string, data) => {
    try {
      const item = await prisma.item.update({
        where: { id },
        data: {
          name: data.name,
          skuHsn: data.skuHsn,
          type: data.type,
          unit: data.unit,
          salePrice: data.salePrice,
          purchasePrice: data.purchasePrice,
          taxRate: data.taxRate,
          trackStock: data.trackStock,
          currentStock: data.currentStock,
          lowStockWarning: data.lowStockWarning
        }
      })

      await triggerSyncAfterChange()
      return { success: true, data: item }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update item'
      }
    }
  })

  // Delete item
  ipcMain.handle('item:delete', async (_, id: string) => {
    try {
      // Check if item is used in any invoices or bills
      const item = await prisma.item.findUnique({
        where: { id },
        include: {
          salesInvoiceItems: { take: 1 },
          purchaseBillItems: { take: 1 }
        }
      })

      if (!item) {
        return { success: false, error: 'Item not found' }
      }

      if (item.salesInvoiceItems.length > 0 || item.purchaseBillItems.length > 0) {
        return {
          success: false,
          error: 'Cannot delete item used in invoices or bills. Delete those records first.'
        }
      }

      await prisma.item.delete({
        where: { id }
      })

      await triggerSyncAfterChange()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete item'
      }
    }
  })

  // Get low stock items
  ipcMain.handle('item:getLowStock', async () => {
    try {
      // Fetch all items that track stock, then filter by comparing fields
      const allItems = await prisma.item.findMany({
        where: {
          trackStock: true
        },
        orderBy: { currentStock: 'asc' }
      })
      // Filter items where currentStock <= lowStockWarning
      const items = allItems.filter(item => item.currentStock <= item.lowStockWarning)
      return { success: true, data: items }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch low stock items'
      }
    }
  })
}
