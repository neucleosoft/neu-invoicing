import { ipcMain } from 'electron'
import { and, asc, desc, eq } from '@neu/shared'
import { getDb, schema } from '../db'
import { notDeleted } from './softDelete'

// One-time data backfill — runs on every launch, but writes only what's wrong, so it's a
// no-op once aligned (mirrors migrateLegacySuppliersFromParty). Sets Item.openingStock so
// stock is rebuildable from rows: openingStock = currentStock − Σ(movements). New items set
// it at create; this fixes items that predate the openingStock column. Because it runs in
// the app's startup, EVERY device aligns itself automatically on update — no per-customer
// manual step.
export async function backfillOpeningStock(): Promise<void> {
  const db = getDb()
  try {
    const [items, movements] = await Promise.all([
      db.select({ id: schema.item.id, currentStock: schema.item.currentStock, openingStock: schema.item.openingStock }).from(schema.item),
      db.select({ itemId: schema.stockMovement.itemId, quantity: schema.stockMovement.quantity }).from(schema.stockMovement),
    ])
    const movByItem = new Map<string, number>()
    for (const m of movements) movByItem.set(m.itemId, (movByItem.get(m.itemId) ?? 0) + m.quantity)
    const fixes = items.filter((it) => {
      const needed = it.currentStock - (movByItem.get(it.id) ?? 0)
      return Math.abs(needed - (it.openingStock ?? 0)) > 0.0001
    })
    if (fixes.length === 0) return
    await db.transaction(async (tx) => {
      for (const it of fixes) {
        await tx
          .update(schema.item)
          .set({ openingStock: it.currentStock - (movByItem.get(it.id) ?? 0) })
          .where(eq(schema.item.id, it.id))
      }
    })
    console.log(`[openingStockBackfill] aligned ${fixes.length} item(s)`)
  } catch (e) {
    console.error('[openingStockBackfill] failed, app continues:', e)
  }
}

export const setupItemHandlers = () => {
  const db = getDb()

  // Get all items
  ipcMain.handle('item:getAll', async () => {
    try {
      const items = await db.select().from(schema.item).orderBy(asc(schema.item.name))
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
      const [item] = await db.select().from(schema.item).where(eq(schema.item.id, id)).limit(1)
      if (!item) return { success: true, data: null }
      const stockMovements = await db
        .select()
        .from(schema.stockMovement)
        .where(eq(schema.stockMovement.itemId, id))
        .orderBy(desc(schema.stockMovement.createdAt))
        .limit(20)
      return { success: true, data: { ...item, stockMovements } }
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
      const [item] = await db
        .insert(schema.item)
        .values({
          name: data.name,
          skuHsn: data.skuHsn,
          hsnCode: data.hsnCode || data.skuHsn || null,
          type: data.type,
          unit: data.unit || 'pcs',
          salePrice: data.salePrice || 0,
          purchasePrice: data.purchasePrice || 0,
          taxRate: data.taxRate || 0,
          gstType: data.gstType || 'GST',
          trackStock: data.trackStock || false,
          currentStock: data.currentStock || 0,
          // At birth, the opening stock IS the current stock (no movements yet). This is
          // the anchor recompute replays movements on top of.
          openingStock: data.currentStock || 0,
          lowStockWarning: data.lowStockWarning || 10
        })
        .returning()

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
      const [existing] = await db.select().from(schema.item).where(eq(schema.item.id, id)).limit(1)
      if (!existing) return { success: false, error: 'Item not found' }
      // Editing the stock directly (no movement is written) is treated as adjusting the
      // OPENING stock by the same delta, so currentStock = openingStock + Σ(movements)
      // stays true and recompute keeps matching.
      const stockDelta =
        data.currentStock == null ? 0 : data.currentStock - existing.currentStock

      const [item] = await db
        .update(schema.item)
        .set({
          name: data.name,
          skuHsn: data.skuHsn,
          hsnCode: data.hsnCode || data.skuHsn || null,
          type: data.type,
          unit: data.unit,
          salePrice: data.salePrice,
          purchasePrice: data.purchasePrice,
          taxRate: data.taxRate,
          trackStock: data.trackStock,
          currentStock: data.currentStock,
          openingStock: existing.openingStock + stockDelta,
          lowStockWarning: data.lowStockWarning
        })
        .where(eq(schema.item.id, id))
        .returning()

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
      const [item] = await db.select({ id: schema.item.id }).from(schema.item).where(eq(schema.item.id, id)).limit(1)
      if (!item) {
        return { success: false, error: 'Item not found' }
      }

      // Soft-delete: stamp deletedAt (updatedAt + hlc auto-bump). The row stays
      // put so a restore brings it back intact, and invoice/supplier links survive.
      await db.update(schema.item).set({ deletedAt: new Date() }).where(eq(schema.item.id, id))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete item'
      }
    }
  })

  // Restore item
  ipcMain.handle('item:restore', async (_, id: string) => {
    try {
      const [item] = await db.select({ id: schema.item.id }).from(schema.item).where(eq(schema.item.id, id)).limit(1)
      if (!item) {
        return { success: false, error: 'Item not found' }
      }

      await db.update(schema.item).set({ deletedAt: null }).where(eq(schema.item.id, id))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restore item'
      }
    }
  })

  // Get low stock items
  ipcMain.handle('item:getLowStock', async () => {
    try {
      // Fetch all items that track stock, then filter by comparing fields
      const allItems = await db
        .select()
        .from(schema.item)
        .where(and(eq(schema.item.trackStock, true), notDeleted(schema.item.deletedAt)))
        .orderBy(asc(schema.item.currentStock))
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
