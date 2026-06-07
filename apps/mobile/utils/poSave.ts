import { eq } from 'drizzle-orm'

import { schema, useDb } from '@/db'

// Purchase Order save logic. A PO is an INTENT to buy — unlike a Purchase Bill,
// it has NO financial or stock side-effects (no supplier balance, no stock
// movement). Those happen later on the Bill. So this is much simpler than
// purchaseSave.ts: resolve/create the supplier-catalog items, compute totals,
// write header + lines. Mirrors desktop purchaseOrder handler.

type Db = ReturnType<typeof useDb>

export type PoLineInput = {
  supplierItemId: string | null
  name: string
  hsnCode: string
  quantity: number
  rate: number
  discount: number
  taxRate: number
}

export type PoHeaderInput = {
  supplierId: string
  orderNumber: string
  orderDate: Date
  expectedDate: Date | null
  notes: string | null
  termsConditions: string | null
}

function normalizeItemName(name: string): string {
  return (name || '').toLowerCase().replace(/[-/.]/g, ' ').replace(/\s+/g, ' ').trim()
}

// Resolve a line to a SupplierItem (find-or-create by normalized name), same as
// the bill flow — so a PO and a bill for the same typed item land on one catalog
// row. Unlike the bill, we do NOT refresh lastPurchasePrice (a PO is a quote we
// got, not a confirmed purchase price).
async function resolveSupplierItem(tx: any, supplierId: string, line: PoLineInput) {
  if (line.supplierItemId) {
    const [si] = await tx
      .select()
      .from(schema.supplierItem)
      .where(eq(schema.supplierItem.id, line.supplierItemId))
      .limit(1)
    if (!si) throw new Error('Supplier item not found')
    return si
  }
  const typed = line.name?.trim()
  if (!typed) throw new Error('Each PO line must have an item')
  const candidates = await tx
    .select()
    .from(schema.supplierItem)
    .where(eq(schema.supplierItem.supplierId, supplierId))
  const target = normalizeItemName(typed)
  const existing = candidates.find((c: any) => normalizeItemName(c.name) === target)
  if (existing) return existing
  const [created] = await tx
    .insert(schema.supplierItem)
    .values({
      supplierId,
      name: typed,
      hsnCode: line.hsnCode || null,
      unit: 'pcs',
      lastPurchasePrice: line.rate || 0,
      defaultTaxRate: line.taxRate || 0,
    })
    .returning()
  return created
}

function computeTotals(lines: { quantity: number; rate: number; discount: number; taxRate: number }[]) {
  let subtotal = 0
  let taxAmount = 0
  for (const l of lines) {
    const t = l.quantity * l.rate - l.discount
    subtotal += t
    taxAmount += (t * l.taxRate) / 100
  }
  return { subtotal, taxAmount, total: subtotal + taxAmount }
}

export async function createPurchaseOrder(db: Db, header: PoHeaderInput, lines: PoLineInput[]): Promise<string> {
  return db.transaction(async (tx) => {
    const resolved: { supplierItemId: string; line: PoLineInput }[] = []
    for (const line of lines) {
      const si = await resolveSupplierItem(tx, header.supplierId, line)
      resolved.push({ supplierItemId: si.id, line })
    }
    const { subtotal, taxAmount, total } = computeTotals(lines)

    const [po] = await tx
      .insert(schema.purchaseOrder)
      .values({
        orderNumber: header.orderNumber,
        orderDate: header.orderDate,
        expectedDate: header.expectedDate,
        supplierId: header.supplierId,
        subtotal,
        taxAmount,
        totalAmount: total,
        status: 'DRAFT',
        notes: header.notes,
        termsConditions: header.termsConditions,
      })
      .returning({ id: schema.purchaseOrder.id })

    for (const { supplierItemId, line } of resolved) {
      const taxable = line.quantity * line.rate - line.discount
      await tx.insert(schema.purchaseOrderItem).values({
        purchaseOrderId: po.id,
        supplierItemId,
        quantity: line.quantity,
        receivedQuantity: 0,
        rate: line.rate,
        discount: line.discount,
        taxRate: line.taxRate,
        total: taxable + (taxable * line.taxRate) / 100,
        hsnCode: line.hsnCode || null,
        taxableAmount: taxable,
      })
    }
    return po.id
  })
}

export async function updatePurchaseOrder(db: Db, id: string, header: PoHeaderInput, lines: PoLineInput[]): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.purchaseOrder)
      .where(eq(schema.purchaseOrder.id, id))
      .limit(1)
    if (!existing) throw new Error('Purchase order not found')

    const resolved: { supplierItemId: string; line: PoLineInput }[] = []
    for (const line of lines) {
      const si = await resolveSupplierItem(tx, header.supplierId, line)
      resolved.push({ supplierItemId: si.id, line })
    }
    const { subtotal, taxAmount, total } = computeTotals(lines)

    await tx.delete(schema.purchaseOrderItem).where(eq(schema.purchaseOrderItem.purchaseOrderId, id))
    await tx
      .update(schema.purchaseOrder)
      .set({
        orderDate: header.orderDate,
        expectedDate: header.expectedDate,
        supplierId: header.supplierId,
        subtotal,
        taxAmount,
        totalAmount: total,
        notes: header.notes,
        termsConditions: header.termsConditions,
      })
      .where(eq(schema.purchaseOrder.id, id))
    for (const { supplierItemId, line } of resolved) {
      const taxable = line.quantity * line.rate - line.discount
      await tx.insert(schema.purchaseOrderItem).values({
        purchaseOrderId: id,
        supplierItemId,
        quantity: line.quantity,
        receivedQuantity: 0,
        rate: line.rate,
        discount: line.discount,
        taxRate: line.taxRate,
        total: taxable + (taxable * line.taxRate) / 100,
        hsnCode: line.hsnCode || null,
        taxableAmount: taxable,
      })
    }
  })
}

export async function deletePurchaseOrder(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(schema.purchaseOrderItem).where(eq(schema.purchaseOrderItem.purchaseOrderId, id))
    await tx.delete(schema.purchaseOrder).where(eq(schema.purchaseOrder.id, id))
  })
}

// Mark received quantities on PO lines, then recompute header status:
// all lines fully received → RECEIVED; some received → PARTIALLY_RECEIVED;
// else unchanged. NO balance/stock effect (that's the Bill). Mirrors desktop.
export async function markPoReceived(
  db: Db,
  id: string,
  lineUpdates: { lineId: string; receivedQuantity: number }[],
): Promise<void> {
  await db.transaction(async (tx) => {
    const items = await tx
      .select()
      .from(schema.purchaseOrderItem)
      .where(eq(schema.purchaseOrderItem.purchaseOrderId, id))
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
    const refreshed = await tx
      .select()
      .from(schema.purchaseOrderItem)
      .where(eq(schema.purchaseOrderItem.purchaseOrderId, id))
    const allReceived = refreshed.every((it: any) => it.receivedQuantity >= it.quantity)
    const anyReceived = refreshed.some((it: any) => it.receivedQuantity > 0)
    const [po] = await tx.select().from(schema.purchaseOrder).where(eq(schema.purchaseOrder.id, id)).limit(1)
    const newStatus = allReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : po.status
    await tx.update(schema.purchaseOrder).set({ status: newStatus }).where(eq(schema.purchaseOrder.id, id))
  })
}
