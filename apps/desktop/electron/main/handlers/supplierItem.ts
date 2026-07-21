import { ipcMain } from 'electron'
import { asc, eq } from '@neu/shared'
import { getDb, schema } from '../db'

export const setupSupplierItemHandlers = () => {
  const db = getDb()

  // Get all supplier items, optionally filtered by supplier
  ipcMain.handle('supplierItem:getAll', async (_, supplierId?: string) => {
    try {
      const rows = await db
        .select({
          item: schema.supplierItem,
          supplier: { id: schema.supplier.id, name: schema.supplier.name },
          linkedItem: {
            id: schema.item.id,
            name: schema.item.name,
            currentStock: schema.item.currentStock,
            trackStock: schema.item.trackStock,
          },
        })
        .from(schema.supplierItem)
        .leftJoin(schema.supplier, eq(schema.supplierItem.supplierId, schema.supplier.id))
        .leftJoin(schema.item, eq(schema.supplierItem.linkedItemId, schema.item.id))
        .where(supplierId ? eq(schema.supplierItem.supplierId, supplierId) : undefined)
        .orderBy(asc(schema.supplierItem.name))
      const items = rows.map((r: any) => ({
        ...r.item,
        supplier: r.supplier,
        linkedItem: r.linkedItem?.id ? r.linkedItem : null,
      }))
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
      const [row] = await db
        .select({
          item: schema.supplierItem,
          supplier: schema.supplier,
          linkedItem: schema.item,
        })
        .from(schema.supplierItem)
        .leftJoin(schema.supplier, eq(schema.supplierItem.supplierId, schema.supplier.id))
        .leftJoin(schema.item, eq(schema.supplierItem.linkedItemId, schema.item.id))
        .where(eq(schema.supplierItem.id, id))
        .limit(1)
      const item = row ? { ...row.item, supplier: row.supplier, linkedItem: row.linkedItem } : null
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
      const [item] = await db
        .insert(schema.supplierItem)
        .values({
          supplierId: data.supplierId,
          name: data.name,
          hsnCode: data.hsnCode,
          unit: data.unit || 'pcs',
          lastPurchasePrice: data.lastPurchasePrice || 0,
          defaultTaxRate: data.defaultTaxRate || 0,
          linkedItemId: data.linkedItemId || null
        })
        .returning()
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
      const [item] = await db
        .update(schema.supplierItem)
        .set({
          name: data.name,
          hsnCode: data.hsnCode,
          unit: data.unit,
          lastPurchasePrice: data.lastPurchasePrice,
          defaultTaxRate: data.defaultTaxRate,
          linkedItemId: data.linkedItemId ?? null
        })
        .where(eq(schema.supplierItem.id, id))
        .returning()
      return { success: true, data: item }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update supplier item'
      }
    }
  })

  // Delete supplier item (soft)
  ipcMain.handle('supplierItem:delete', async (_, id: string) => {
    try {
      const [supplierItem] = await db.select({ id: schema.supplierItem.id }).from(schema.supplierItem).where(eq(schema.supplierItem.id, id)).limit(1)
      if (!supplierItem) {
        throw new Error('Supplier item not found')
      }

      // Soft-delete: stamp deletedAt (updatedAt + hlc auto-bump). The row stays
      // put so a restore brings the catalog entry back intact.
      await db.update(schema.supplierItem).set({ deletedAt: new Date() }).where(eq(schema.supplierItem.id, id))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete supplier item'
      }
    }
  })

  // Restore supplier item
  ipcMain.handle('supplierItem:restore', async (_, id: string) => {
    try {
      const [supplierItem] = await db.select({ id: schema.supplierItem.id }).from(schema.supplierItem).where(eq(schema.supplierItem.id, id)).limit(1)
      if (!supplierItem) {
        throw new Error('Supplier item not found')
      }

      await db.update(schema.supplierItem).set({ deletedAt: null }).where(eq(schema.supplierItem.id, id))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restore supplier item'
      }
    }
  })
}
