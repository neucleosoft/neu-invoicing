import { ipcMain } from 'electron'
import { and, desc, eq, inArray, notInArray } from '@neu/shared'
import { getDb, schema } from '../db'
import { notDeleted } from './softDelete'

// Mirrors normalizeItemName in purchase.ts so dedupe behavior is consistent
// across PO and Bill flows. If a PO line references a SupplierItem by id, use
// it directly; otherwise look up by normalized name on the supplier's catalog,
// falling back to creating a new SupplierItem.
function normalizeItemName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[-/.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

type Db = ReturnType<typeof getDb>

// The drizzle replacement for the old purchaseOrderInclude: supplier + items
// (each with supplierItem + its linkedItem) + the bills referencing the PO
// (the frontend uses bills.length to gate edit/close/delete).
async function attachPORelations(db: Db, orders: any[]): Promise<any[]> {
  if (orders.length === 0) return []

  const supplierIds = [...new Set(orders.map((o) => o.supplierId).filter(Boolean))]
  const suppliers = supplierIds.length
    ? await db.select().from(schema.supplier).where(inArray(schema.supplier.id, supplierIds))
    : []
  const supplierById = new Map(suppliers.map((s: any) => [s.id, s]))

  const orderIds = orders.map((o) => o.id)
  const lines: any[] = await db
    .select()
    .from(schema.purchaseOrderItem)
    .where(inArray(schema.purchaseOrderItem.purchaseOrderId, orderIds))

  const supplierItemIds = [...new Set(lines.map((l) => l.supplierItemId).filter(Boolean))]
  const supplierItems: any[] = supplierItemIds.length
    ? await db.select().from(schema.supplierItem).where(inArray(schema.supplierItem.id, supplierItemIds))
    : []
  const linkedItemIds = [...new Set(supplierItems.map((si) => si.linkedItemId).filter(Boolean))]
  const linkedItems: any[] = linkedItemIds.length
    ? await db.select().from(schema.item).where(inArray(schema.item.id, linkedItemIds))
    : []
  const linkedById = new Map(linkedItems.map((i) => [i.id, i]))
  const supplierItemById = new Map(
    supplierItems.map((si) => [si.id, { ...si, linkedItem: si.linkedItemId ? (linkedById.get(si.linkedItemId) ?? null) : null }]),
  )

  const bills: any[] = await db
    .select({
      id: schema.purchaseBill.id,
      billNumber: schema.purchaseBill.billNumber,
      billDate: schema.purchaseBill.billDate,
      totalAmount: schema.purchaseBill.totalAmount,
      status: schema.purchaseBill.status,
      purchaseOrderId: schema.purchaseBill.purchaseOrderId,
    })
    .from(schema.purchaseBill)
    .where(inArray(schema.purchaseBill.purchaseOrderId, orderIds))

  const linesByOrder = new Map<string, any[]>()
  for (const l of lines) {
    const withSupplierItem = { ...l, supplierItem: l.supplierItemId ? (supplierItemById.get(l.supplierItemId) ?? null) : null }
    if (!linesByOrder.has(l.purchaseOrderId)) linesByOrder.set(l.purchaseOrderId, [])
    linesByOrder.get(l.purchaseOrderId)!.push(withSupplierItem)
  }
  const billsByOrder = new Map<string, any[]>()
  for (const b of bills) {
    if (!billsByOrder.has(b.purchaseOrderId)) billsByOrder.set(b.purchaseOrderId, [])
    billsByOrder.get(b.purchaseOrderId)!.push(b)
  }

  return orders.map((o) => ({
    ...o,
    supplier: o.supplierId ? (supplierById.get(o.supplierId) ?? null) : null,
    items: linesByOrder.get(o.id) ?? [],
    bills: billsByOrder.get(o.id) ?? [],
  }))
}

async function resolveSupplierItem(tx: any, supplierId: string, item: any) {
  if (item.supplierItemId) {
    const [supplierItem] = await tx.select().from(schema.supplierItem).where(eq(schema.supplierItem.id, item.supplierItemId)).limit(1)
    if (!supplierItem) throw new Error('Supplier item not found')
    return await withLinkedItem(tx, supplierItem)
  }

  if (item.itemId) {
    // itemId from the form's per-supplier dropdown — same id-space as supplierItem.id
    const [byId] = await tx
      .select()
      .from(schema.supplierItem)
      .where(and(eq(schema.supplierItem.id, item.itemId), eq(schema.supplierItem.supplierId, supplierId)))
      .limit(1)
    if (byId) return await withLinkedItem(tx, byId)
  }

  const extractedName: string = item._extractedName || item.name || ''
  if (!extractedName) {
    throw new Error('Each PO line must have a supplier item')
  }

  // Fuzzy dedupe on the supplier's catalog
  const candidates: any[] = await tx.select().from(schema.supplierItem).where(eq(schema.supplierItem.supplierId, supplierId))
  const target = normalizeItemName(extractedName)
  const existing = candidates.find((c: any) => normalizeItemName(c.name) === target)
  if (existing) return await withLinkedItem(tx, existing)

  const [created] = await tx
    .insert(schema.supplierItem)
    .values({
      supplierId,
      name: extractedName,
      hsnCode: item.hsnCode || null,
      unit: 'pcs',
      lastPurchasePrice: item.rate || 0,
      defaultTaxRate: item.taxRate || 0,
    })
    .returning()
  return { ...created, linkedItem: null }
}

async function withLinkedItem(tx: any, supplierItem: any) {
  if (!supplierItem.linkedItemId) return { ...supplierItem, linkedItem: null }
  const [linked] = await tx.select().from(schema.item).where(eq(schema.item.id, supplierItem.linkedItemId)).limit(1)
  return { ...supplierItem, linkedItem: linked ?? null }
}

async function normalizeOrderItems(tx: any, supplierId: string, items: any[]) {
  const out: any[] = []
  for (const item of items) {
    const supplierItem = await resolveSupplierItem(tx, supplierId, item)
    const taxableAmount = item.quantity * item.rate - (item.discount || 0)
    out.push({
      supplierItemId: supplierItem.id,
      hsnCode: item.hsnCode || supplierItem.hsnCode || supplierItem.linkedItem?.hsnCode || '',
      quantity: item.quantity,
      rate: item.rate,
      discount: item.discount || 0,
      taxRate: item.taxRate || 0,
      total: taxableAmount + (taxableAmount * (item.taxRate || 0)) / 100,
      taxableAmount,
    })
  }
  return out
}

export const setupPurchaseOrderHandlers = () => {
  const db = getDb()

  const loadOrderFull = async (id: string) => {
    const [header] = await db.select().from(schema.purchaseOrder).where(eq(schema.purchaseOrder.id, id)).limit(1)
    if (!header) return null
    const [order] = await attachPORelations(db, [header])
    return order
  }

  // List all POs (most-recent first)
  ipcMain.handle('purchaseOrder:getAll', async () => {
    try {
      const headers = await db.select().from(schema.purchaseOrder).orderBy(desc(schema.purchaseOrder.orderDate))
      const orders = await attachPORelations(db, headers)
      return { success: true, data: orders }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch purchase orders',
      }
    }
  })

  ipcMain.handle('purchaseOrder:getById', async (_, id: string) => {
    try {
      const order = await loadOrderFull(id)
      return { success: true, data: order }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch purchase order',
      }
    }
  })

  ipcMain.handle('purchaseOrder:create', async (_, data) => {
    try {
      const createdId = await db.transaction(async (tx) => {
        const supplierId = data.supplierId
        const normalizedItems = await normalizeOrderItems(tx, supplierId, data.items)

        let subtotal = 0
        let computedTax = 0
        normalizedItems.forEach((item: any) => {
          const itemTotal = item.quantity * item.rate - (item.discount || 0)
          subtotal += itemTotal
          computedTax += (itemTotal * (item.taxRate || 0)) / 100
        })

        // Bill-level tax override (CGST/SGST/IGST entered manually) wins over per-item
        const taxOverrideProvided =
          typeof data.taxAmount === 'number' && Number.isFinite(data.taxAmount) && data.taxAmount >= 0
        const taxAmount = taxOverrideProvided ? data.taxAmount : computedTax
        const totalAmount = subtotal + taxAmount - (data.discount || 0)

        const [order] = await tx
          .insert(schema.purchaseOrder)
          .values({
            orderNumber: data.orderNumber,
            orderDate: new Date(data.orderDate),
            expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
            supplierId,
            billingAddress: data.billingAddress || null,
            shippingAddress: data.shippingAddress || null,
            vendorQuotationRef: data.vendorQuotationRef || null,
            subtotal,
            discount: data.discount || 0,
            taxAmount,
            cgstAmount: data.cgstAmount || 0,
            sgstAmount: data.sgstAmount || 0,
            igstAmount: data.igstAmount || 0,
            totalAmount,
            status: data.status || 'DRAFT',
            notes: data.notes,
            termsConditions: data.termsConditions,
          })
          .returning({ id: schema.purchaseOrder.id })

        if (normalizedItems.length) {
          await tx
            .insert(schema.purchaseOrderItem)
            .values(normalizedItems.map((it) => ({ ...it, purchaseOrderId: order.id })))
        }
        return order.id
      })

      const order = await loadOrderFull(createdId)
      return { success: true, data: order }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create purchase order',
      }
    }
  })

  ipcMain.handle('purchaseOrder:update', async (_, id: string, data) => {
    try {
      await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(schema.purchaseOrder).where(eq(schema.purchaseOrder.id, id)).limit(1)
        if (!existing) throw new Error('Purchase order not found')

        const supplierId = data.supplierId
        const normalizedItems = await normalizeOrderItems(tx, supplierId, data.items)

        let subtotal = 0
        let computedTax = 0
        normalizedItems.forEach((item: any) => {
          const itemTotal = item.quantity * item.rate - (item.discount || 0)
          subtotal += itemTotal
          computedTax += (itemTotal * (item.taxRate || 0)) / 100
        })

        const taxOverrideProvided =
          typeof data.taxAmount === 'number' && Number.isFinite(data.taxAmount) && data.taxAmount >= 0
        const taxAmount = taxOverrideProvided ? data.taxAmount : computedTax
        const totalAmount = subtotal + taxAmount - (data.discount || 0)

        // Wipe + recreate items (same approach as PurchaseBill update)
        await tx.delete(schema.purchaseOrderItem).where(eq(schema.purchaseOrderItem.purchaseOrderId, id))

        await tx
          .update(schema.purchaseOrder)
          .set({
            orderDate: new Date(data.orderDate),
            expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
            supplierId,
            billingAddress: data.billingAddress ?? existing.billingAddress,
            shippingAddress: data.shippingAddress ?? existing.shippingAddress,
            vendorQuotationRef: data.vendorQuotationRef ?? existing.vendorQuotationRef,
            subtotal,
            discount: data.discount || 0,
            taxAmount,
            cgstAmount: data.cgstAmount ?? 0,
            sgstAmount: data.sgstAmount ?? 0,
            igstAmount: data.igstAmount ?? 0,
            totalAmount,
            status: data.status ?? existing.status,
            notes: data.notes,
            termsConditions: data.termsConditions,
          })
          .where(eq(schema.purchaseOrder.id, id))

        if (normalizedItems.length) {
          await tx
            .insert(schema.purchaseOrderItem)
            .values(normalizedItems.map((it) => ({ ...it, purchaseOrderId: id })))
        }
      })

      const order = await loadOrderFull(id)
      return { success: true, data: order }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update purchase order',
      }
    }
  })

  ipcMain.handle('purchaseOrder:delete', async (_, id: string) => {
    try {
      const [order] = await db.select({ id: schema.purchaseOrder.id }).from(schema.purchaseOrder).where(eq(schema.purchaseOrder.id, id)).limit(1)
      if (!order) {
        throw new Error('Purchase order not found')
      }

      // Soft-delete: stamp deletedAt (updatedAt + hlc auto-bump). The header and
      // its line items stay put so a restore brings the whole document back intact.
      await db.update(schema.purchaseOrder).set({ deletedAt: new Date() }).where(eq(schema.purchaseOrder.id, id))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete purchase order',
      }
    }
  })

  ipcMain.handle('purchaseOrder:restore', async (_, id: string) => {
    try {
      const [order] = await db.select({ id: schema.purchaseOrder.id }).from(schema.purchaseOrder).where(eq(schema.purchaseOrder.id, id)).limit(1)
      if (!order) {
        throw new Error('Purchase order not found')
      }

      await db.update(schema.purchaseOrder).set({ deletedAt: null }).where(eq(schema.purchaseOrder.id, id))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restore purchase order',
      }
    }
  })

  // Auto-numbering: PO-YYYY-NNN
  ipcMain.handle('purchaseOrder:generateOrderNumber', async () => {
    try {
      const [last] = await db
        .select({ orderNumber: schema.purchaseOrder.orderNumber })
        .from(schema.purchaseOrder)
        .orderBy(desc(schema.purchaseOrder.orderNumber))
        .limit(1)
      const year = new Date().getFullYear()
      const lastNum = last ? parseInt(last.orderNumber.split('-').pop() || '0') : 0
      return { success: true, data: `PO-${year}-${String(lastNum + 1).padStart(3, '0')}` }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate order number',
      }
    }
  })

  // Mark received quantities for individual lines, then recompute the PO header
  // status. Caller passes [{ lineId, receivedQuantity }, ...]. Lines not listed
  // are left untouched. PO doesn't touch supplier balance or stock — those side
  // effects live on the Bill, not the PO.
  ipcMain.handle(
    'purchaseOrder:markAsReceived',
    async (_, id: string, lineUpdates: Array<{ lineId: string; receivedQuantity: number }>) => {
      try {
        await db.transaction(async (tx) => {
          const [existing] = await tx.select().from(schema.purchaseOrder).where(eq(schema.purchaseOrder.id, id)).limit(1)
          if (!existing) throw new Error('Purchase order not found')
          const items: any[] = await tx
            .select()
            .from(schema.purchaseOrderItem)
            .where(eq(schema.purchaseOrderItem.purchaseOrderId, id))

          // Apply each line update. Clamp received to [0, ordered] so a fat-finger
          // doesn't show "received 1000 of 10."
          const updateMap = new Map(lineUpdates.map((u) => [u.lineId, u.receivedQuantity]))
          for (const line of items) {
            if (!updateMap.has(line.id)) continue
            const requested = updateMap.get(line.id) || 0
            const clamped = Math.max(0, Math.min(requested, line.quantity))
            await tx
              .update(schema.purchaseOrderItem)
              .set({ receivedQuantity: clamped })
              .where(eq(schema.purchaseOrderItem.id, line.id))
          }

          // Re-read items so the status math sees the updated values
          const refreshed: any[] = await tx
            .select()
            .from(schema.purchaseOrderItem)
            .where(eq(schema.purchaseOrderItem.purchaseOrderId, id))
          const allReceived = refreshed.every((it: any) => it.receivedQuantity >= it.quantity)
          const anyReceived = refreshed.some((it: any) => it.receivedQuantity > 0)
          const newStatus = allReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : existing.status

          await tx.update(schema.purchaseOrder).set({ status: newStatus }).where(eq(schema.purchaseOrder.id, id))
        })

        const order = await loadOrderFull(id)
        return { success: true, data: order }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to mark PO as received',
        }
      }
    },
  )

  // Open POs (no bills yet, status not closed/cancelled) for a given supplier.
  // Used by the Purchase Bill form to let users link a new bill to an existing PO.
  ipcMain.handle('purchaseOrder:listOpenForSupplier', async (_, supplierId: string) => {
    try {
      const headers = await db
        .select()
        .from(schema.purchaseOrder)
        .where(and(
          eq(schema.purchaseOrder.supplierId, supplierId),
          notInArray(schema.purchaseOrder.status, ['CLOSED', 'CANCELLED']),
          notDeleted(schema.purchaseOrder.deletedAt),
        ))
        .orderBy(desc(schema.purchaseOrder.orderDate))
      const orders = await attachPORelations(db, headers)
      return { success: true, data: orders }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list open POs',
      }
    }
  })
}
