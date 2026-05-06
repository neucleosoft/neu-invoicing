import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { triggerSyncAfterChange } from '../sync'

export const setupSupplierHandlers = () => {
  const prisma = getPrisma()

  // Get all suppliers
  ipcMain.handle('supplier:getAll', async () => {
    try {
      const suppliers = await prisma.supplier.findMany({
        orderBy: { name: 'asc' }
      })
      return { success: true, data: suppliers }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch suppliers'
      }
    }
  })

  // Get supplier by ID (with recent purchase bills + supplier item catalog)
  ipcMain.handle('supplier:getById', async (_, id: string) => {
    try {
      const supplier = await prisma.supplier.findUnique({
        where: { id },
        include: {
          purchaseBills: {
            orderBy: { billDate: 'desc' },
            take: 10
          },
          supplierItems: {
            orderBy: { name: 'asc' }
          }
        }
      })
      return { success: true, data: supplier }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch supplier'
      }
    }
  })

  // Create supplier
  ipcMain.handle('supplier:create', async (_, data) => {
    try {
      const supplier = await prisma.supplier.create({
        data: {
          name: data.name,
          phone: data.phone,
          email: data.email,
          billingAddress: data.billingAddress,
          shippingAddress: data.shippingAddress,
          taxId: data.taxId,
          openingBalance: data.openingBalance || 0,
          currentBalance: data.openingBalance || 0,
          stateCode: data.stateCode,
          stateName: data.stateName,
          gstType: data.gstType || 'REGULAR',
          legalName: data.legalName,
          tradeName: data.tradeName,
          gstStatus: data.gstStatus,
          city: data.city,
          district: data.district,
          pincode: data.pincode,
          fetchedFromGst: data.fetchedFromGst || false,
          lastGstFetch: data.lastGstFetch
        }
      })

      await triggerSyncAfterChange()
      return { success: true, data: supplier }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create supplier'
      }
    }
  })

  // Update supplier
  ipcMain.handle('supplier:update', async (_, id: string, data) => {
    try {
      const supplier = await prisma.supplier.update({
        where: { id },
        data: {
          name: data.name,
          phone: data.phone,
          email: data.email,
          billingAddress: data.billingAddress,
          shippingAddress: data.shippingAddress,
          taxId: data.taxId,
          stateCode: data.stateCode,
          stateName: data.stateName,
          gstType: data.gstType,
          legalName: data.legalName,
          tradeName: data.tradeName,
          gstStatus: data.gstStatus,
          city: data.city,
          district: data.district,
          pincode: data.pincode,
          fetchedFromGst: data.fetchedFromGst,
          lastGstFetch: data.lastGstFetch
        }
      })

      await triggerSyncAfterChange()
      return { success: true, data: supplier }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update supplier'
      }
    }
  })

  // Delete supplier
  ipcMain.handle('supplier:delete', async (_, id: string) => {
    try {
      const supplier = await prisma.supplier.findUnique({
        where: { id },
        include: {
          purchaseBills: { take: 1 },
          // Without this guard, the FK's ON DELETE SET NULL would silently orphan PAYMENT_OUT rows.
          payments: { take: 1 }
        }
      })

      if (!supplier) {
        return { success: false, error: 'Supplier not found' }
      }

      if (supplier.purchaseBills.length > 0) {
        return {
          success: false,
          error: 'Cannot delete supplier with existing purchase bills. Delete those records first.'
        }
      }

      if (supplier.payments.length > 0) {
        return {
          success: false,
          error: 'Cannot delete supplier with recorded payments. Delete those records first.'
        }
      }

      await prisma.supplier.delete({
        where: { id }
      })

      await triggerSyncAfterChange()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete supplier'
      }
    }
  })
}
