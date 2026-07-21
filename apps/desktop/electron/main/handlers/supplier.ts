import { ipcMain } from 'electron'
import { asc, desc, eq, or } from '@neu/shared'
import { getDb, schema } from '../db'

const asDate = (v: unknown): Date | null =>
  v == null ? null : v instanceof Date ? v : new Date(v as string)

// Idempotent migration: copy legacy `Party` rows with type='SUPPLIER' into the
// Supplier table, then delete the originals when safe. Skips any Party row
// whose name or GSTIN already matches an existing Supplier. Refuses to delete
// a Party row with sales-side relations (would break FKs) — copies and leaves.
// Called once on app start; subsequent runs are no-ops because nothing matches.
export async function migrateLegacySuppliersFromParty(): Promise<void> {
  const db = getDb()
  try {
    const legacyRows = await db
      .select()
      .from(schema.customer)
      .where(eq(schema.customer.type, 'SUPPLIER'))
    if (legacyRows.length === 0) return

    // FK fan-in check: any sales-side row referencing the Party id means the
    // original must be kept (copied but not deleted).
    const hasAnyRelation = async (partyId: string): Promise<boolean> => {
      const refs: { table: any; col: any }[] = [
        { table: schema.salesInvoice, col: schema.salesInvoice.customerId },
        { table: schema.quotation, col: schema.quotation.customerId },
        { table: schema.proformaInvoice, col: schema.proformaInvoice.customerId },
        { table: schema.paymentTransaction, col: schema.paymentTransaction.customerId },
        { table: schema.deliveryChallan, col: schema.deliveryChallan.customerId },
        { table: schema.creditDebitNote, col: schema.creditDebitNote.customerId },
      ]
      for (const { table, col } of refs) {
        const [hit] = await db.select({ id: table.id }).from(table).where(eq(col, partyId)).limit(1)
        if (hit) return true
      }
      return false
    }

    let created = 0, skipped = 0, kept = 0, deleted = 0
    for (const row of legacyRows) {
      try {
        const dupes = await db
          .select({ id: schema.supplier.id })
          .from(schema.supplier)
          .where(
            row.taxId
              ? or(eq(schema.supplier.name, row.name), eq(schema.supplier.taxId, row.taxId))
              : eq(schema.supplier.name, row.name),
          )
          .limit(1)

        if (dupes.length === 0) {
          await db.insert(schema.supplier).values({
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
          })
          created++
        } else {
          skipped++
        }

        if (await hasAnyRelation(row.id)) {
          kept++
        } else {
          // Hard delete on purpose: this is the one-time legacy cleanup, not a
          // user-facing archive.
          await db.delete(schema.customer).where(eq(schema.customer.id, row.id))
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
  const db = getDb()

  // Get all suppliers
  ipcMain.handle('supplier:getAll', async () => {
    try {
      const suppliers = await db.select().from(schema.supplier).orderBy(asc(schema.supplier.name))
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
      const [supplier] = await db.select().from(schema.supplier).where(eq(schema.supplier.id, id)).limit(1)
      if (!supplier) return { success: true, data: null }
      const [purchaseBills, supplierItems] = await Promise.all([
        db
          .select()
          .from(schema.purchaseBill)
          .where(eq(schema.purchaseBill.supplierId, id))
          .orderBy(desc(schema.purchaseBill.billDate))
          .limit(10),
        db
          .select()
          .from(schema.supplierItem)
          .where(eq(schema.supplierItem.supplierId, id))
          .orderBy(asc(schema.supplierItem.name)),
      ])
      return { success: true, data: { ...supplier, purchaseBills, supplierItems } }
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
      const [supplier] = await db
        .insert(schema.supplier)
        .values({
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
          lastGstFetch: asDate(data.lastGstFetch),
        })
        .returning()

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
      const [supplier] = await db
        .update(schema.supplier)
        .set({
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
          lastGstFetch: asDate(data.lastGstFetch),
        })
        .where(eq(schema.supplier.id, id))
        .returning()

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
      const [supplier] = await db.select({ id: schema.supplier.id }).from(schema.supplier).where(eq(schema.supplier.id, id)).limit(1)
      if (!supplier) {
        return { success: false, error: 'Supplier not found' }
      }

      // Soft-delete: stamp deletedAt (updatedAt + hlc auto-bump). The row stays
      // put so a restore brings the supplier back intact.
      await db.update(schema.supplier).set({ deletedAt: new Date() }).where(eq(schema.supplier.id, id))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete supplier'
      }
    }
  })

  // Restore supplier
  ipcMain.handle('supplier:restore', async (_, id: string) => {
    try {
      const [supplier] = await db.select({ id: schema.supplier.id }).from(schema.supplier).where(eq(schema.supplier.id, id)).limit(1)
      if (!supplier) {
        return { success: false, error: 'Supplier not found' }
      }

      await db.update(schema.supplier).set({ deletedAt: null }).where(eq(schema.supplier.id, id))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restore supplier'
      }
    }
  })
}
