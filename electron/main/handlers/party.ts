import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { triggerSyncAfterChange } from '../sync'

export const setupPartyHandlers = () => {
  const prisma = getPrisma()

  // Get all parties
  ipcMain.handle('party:getAll', async (_, type?: string) => {
    try {
      const where = type ? { type: type as any } : {}
      const parties = await prisma.party.findMany({
        where,
        orderBy: { name: 'asc' }
      })
      return { success: true, data: parties }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch parties'
      }
    }
  })

  // Get party by ID
  ipcMain.handle('party:getById', async (_, id: string) => {
    try {
      const party = await prisma.party.findUnique({
        where: { id },
        include: {
          salesInvoices: {
            orderBy: { invoiceDate: 'desc' },
            take: 10
          },
          purchaseBills: {
            orderBy: { billDate: 'desc' },
            take: 10
          }
        }
      })
      return { success: true, data: party }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch party'
      }
    }
  })

  // Create party
  ipcMain.handle('party:create', async (_, data) => {
    try {
      const party = await prisma.party.create({
        data: {
          name: data.name,
          type: data.type,
          phone: data.phone,
          email: data.email,
          billingAddress: data.billingAddress,
          shippingAddress: data.shippingAddress,
          taxId: data.taxId,
          openingBalance: data.openingBalance || 0,
          currentBalance: data.openingBalance || 0,
          // GST-specific fields
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
      return { success: true, data: party }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create party'
      }
    }
  })

  // Update party
  ipcMain.handle('party:update', async (_, id: string, data) => {
    try {
      const party = await prisma.party.update({
        where: { id },
        data: {
          name: data.name,
          type: data.type,
          phone: data.phone,
          email: data.email,
          billingAddress: data.billingAddress,
          shippingAddress: data.shippingAddress,
          taxId: data.taxId,
          // GST-specific fields
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
      return { success: true, data: party }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update party'
      }
    }
  })

  // Delete party
  ipcMain.handle('party:delete', async (_, id: string) => {
    try {
      // Check if party has related records
      const party = await prisma.party.findUnique({
        where: { id },
        include: {
          salesInvoices: { take: 1 },
          purchaseBills: { take: 1 },
          payments: { take: 1 }
        }
      })

      if (!party) {
        return { success: false, error: 'Party not found' }
      }

      if (party.salesInvoices.length > 0 || party.purchaseBills.length > 0 || party.payments.length > 0) {
        return {
          success: false,
          error: 'Cannot delete party with existing invoices, bills, or payments. Delete those records first.'
        }
      }

      await prisma.party.delete({
        where: { id }
      })

      await triggerSyncAfterChange()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete party'
      }
    }
  })

  // Get party ledger
  ipcMain.handle('party:getLedger', async (_, id: string) => {
    try {
      const party = await prisma.party.findUnique({
        where: { id },
        include: {
          salesInvoices: {
            orderBy: { invoiceDate: 'desc' }
          },
          purchaseBills: {
            orderBy: { billDate: 'desc' }
          },
          payments: {
            orderBy: { paymentDate: 'desc' }
          }
        }
      })

      return { success: true, data: party }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch ledger'
      }
    }
  })
}
