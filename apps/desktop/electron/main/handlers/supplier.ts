import { ipcMain } from 'electron'
import { getPrisma } from '../database'

// Idempotent migration: copy legacy `Party` rows with type='SUPPLIER' into the
// Supplier table, then delete the originals when safe. Skips any Party row
// whose name or GSTIN already matches an existing Supplier. Refuses to delete
// a Party row with sales-side relations (would break FKs) — copies and leaves.
// Called once on app start; subsequent runs are no-ops because nothing matches.
export async function migrateLegacySuppliersFromParty(): Promise<void> {
  const prisma = getPrisma()
  try {
    const legacyRows = await prisma.customer.findMany({
      where: { type: 'SUPPLIER' },
      include: {
        salesInvoices: { select: { id: true }, take: 1 },
        quotations: { select: { id: true }, take: 1 },
        proformaInvoices: { select: { id: true }, take: 1 },
        payments: { select: { id: true }, take: 1 },
        deliveryChallans: { select: { id: true }, take: 1 },
        creditDebitNotes: { select: { id: true }, take: 1 },
      },
    })
    if (legacyRows.length === 0) return

    let created = 0, skipped = 0, kept = 0, deleted = 0
    for (const row of legacyRows) {
      try {
        const dupes = await prisma.supplier.findMany({
          where: {
            OR: [
              { name: { equals: row.name } },
              ...(row.taxId ? [{ taxId: row.taxId }] : []),
            ],
          },
          take: 1,
        })

        if (dupes.length === 0) {
          await prisma.supplier.create({
            data: {
              name: row.name,
              phone: row.phone,
              email: row.email,
              billingAddress: row.billingAddress,
              shippingAddress: row.shippingAddress,
              taxId: row.taxId,
              openingBalance: row.openingBalance,
              currentBalance: row.currentBalance,
              stateCode: row.stateCode,
              stateName: row.stateName,
              gstType: row.gstType,
              legalName: row.legalName,
              tradeName: row.tradeName,
              gstStatus: row.gstStatus,
              city: row.city,
              district: row.district,
              pincode: row.pincode,
              fetchedFromGst: row.fetchedFromGst,
              lastGstFetch: row.lastGstFetch,
            },
          })
          created++
        } else {
          skipped++
        }

        const hasRelations =
          row.salesInvoices.length +
            row.quotations.length +
            row.proformaInvoices.length +
            row.payments.length +
            row.deliveryChallans.length +
            row.creditDebitNotes.length >
          0
        if (hasRelations) {
          kept++
        } else {
          await prisma.customer.delete({ where: { id: row.id } })
          deleted++
        }
      } catch (err) {
        console.error(`Legacy supplier migration: failed on "${row.name}"`, err)
      }
    }

    if (created > 0 || deleted > 0) {
      console.log(
        `[migrate-suppliers] scanned=${legacyRows.length} created=${created} skippedDup=${skipped} kept=${kept} deleted=${deleted}`,
      )
    }
  } catch (err) {
    console.error('Legacy supplier migration failed:', err)
  }
}

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

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete supplier'
      }
    }
  })
}
