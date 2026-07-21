import { and, desc, eq, isNull, notInArray } from 'drizzle-orm'

import { computeGstValues } from '@neu/shared'

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
  vendorQuotationRef?: string | null
  billingAddress?: string | null
  shippingAddress?: string | null
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

// Compute the GST split the SAME way desktop / the bill flow does, via the shared
// computeGstValues. For a PO the PARTY is the SUPPLIER (we're buying from them),
// so place-of-supply / inter-state are driven by the supplier's state vs our own
// company's state. HSN falls back to the resolved supplierItem.hsnCode (supplierItem
// has no skuHsn). Returned totals (subtotal/taxAmount/totalAmount) are identical to
// the previous flat computeTotals — discount reduces the taxable base before tax —
// so PO header/line amounts are unchanged; we ADD the CGST/SGST/IGST/cess split.
async function computePoGst(
  tx: any,
  supplierId: string,
  resolved: { supplierItem: any; line: PoLineInput }[],
  docDiscount?: number,
) {
  const [company] = await tx.select().from(schema.company).limit(1)
  const [supplier] = await tx
    .select()
    .from(schema.supplier)
    .where(eq(schema.supplier.id, supplierId))
    .limit(1)
  return computeGstValues({
    company: company
      ? { stateCode: company.stateCode, stateName: company.stateName }
      : null,
    party: {
      taxId: supplier?.taxId,
      stateCode: supplier?.stateCode,
      stateName: supplier?.stateName,
    },
    items: resolved.map(({ supplierItem, line }) => ({
      quantity: line.quantity,
      rate: line.rate,
      discount: line.discount,
      taxRate: line.taxRate,
      hsnCode: line.hsnCode,
      catalogHsnCode: supplierItem?.hsnCode,
    })),
    docDiscount: docDiscount || 0,
  })
}

export async function createPurchaseOrder(db: Db, header: PoHeaderInput, lines: PoLineInput[]): Promise<string> {
  return db.transaction(async (tx) => {
    // Resolve each line to its SupplierItem first — we keep the resolved catalog
    // rows so we can source the HSN fallback (supplierItem.hsnCode) for the GST
    // split below, exactly mirroring how newInvoice.tsx pulls item.hsnCode.
    const resolved: { supplierItem: any; line: PoLineInput }[] = []
    for (const line of lines) {
      const si = await resolveSupplierItem(tx, header.supplierId, line)
      resolved.push({ supplierItem: si, line })
    }

    const gst = await computePoGst(tx, header.supplierId, resolved)

    const [po] = await tx
      .insert(schema.purchaseOrder)
      .values({
        orderNumber: header.orderNumber,
        orderDate: header.orderDate,
        expectedDate: header.expectedDate,
        supplierId: header.supplierId,
        subtotal: gst.subtotal,
        taxAmount: gst.taxAmount,
        totalAmount: gst.totalAmount,
        status: 'DRAFT',
        notes: header.notes,
        termsConditions: header.termsConditions,
        vendorQuotationRef: header.vendorQuotationRef ?? null,
        billingAddress: header.billingAddress ?? null,
        shippingAddress: header.shippingAddress ?? null,
        placeOfSupply: gst.placeOfSupply || null,
        placeOfSupplyName: gst.placeOfSupplyName || null,
        isInterState: gst.isInterState,
        cgstAmount: gst.totalCgst,
        sgstAmount: gst.totalSgst,
        igstAmount: gst.totalIgst,
        cessAmount: gst.totalCess,
      })
      .returning({ id: schema.purchaseOrder.id })

    for (let idx = 0; idx < resolved.length; idx++) {
      const { supplierItem: si, line } = resolved[idx]
      const g = gst.items[idx]
      await tx.insert(schema.purchaseOrderItem).values({
        purchaseOrderId: po.id,
        supplierItemId: si.id,
        quantity: line.quantity,
        receivedQuantity: 0,
        rate: line.rate,
        discount: line.discount,
        taxRate: line.taxRate,
        total: g.total,
        hsnCode: g.hsnCode || null,
        taxableAmount: g.taxableAmount,
        cgstRate: g.cgstRate,
        cgstAmount: g.cgstAmount,
        sgstRate: g.sgstRate,
        sgstAmount: g.sgstAmount,
        igstRate: g.igstRate,
        igstAmount: g.igstAmount,
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

    const resolved: { supplierItem: any; line: PoLineInput }[] = []
    for (const line of lines) {
      const si = await resolveSupplierItem(tx, header.supplierId, line)
      resolved.push({ supplierItem: si, line })
    }

    // Preserve the stored document-level discount through the recompute (desktop
    // can set it; dropping it here would silently inflate the PO total).
    const gst = await computePoGst(tx, header.supplierId, resolved, existing.discount ?? 0)

    await tx.delete(schema.purchaseOrderItem).where(eq(schema.purchaseOrderItem.purchaseOrderId, id))
    await tx
      .update(schema.purchaseOrder)
      .set({
        orderDate: header.orderDate,
        expectedDate: header.expectedDate,
        supplierId: header.supplierId,
        subtotal: gst.subtotal,
        taxAmount: gst.taxAmount,
        totalAmount: gst.totalAmount,
        notes: header.notes,
        termsConditions: header.termsConditions,
        vendorQuotationRef: header.vendorQuotationRef ?? null,
        billingAddress: header.billingAddress ?? null,
        shippingAddress: header.shippingAddress ?? null,
        placeOfSupply: gst.placeOfSupply || null,
        placeOfSupplyName: gst.placeOfSupplyName || null,
        isInterState: gst.isInterState,
        cgstAmount: gst.totalCgst,
        sgstAmount: gst.totalSgst,
        igstAmount: gst.totalIgst,
        cessAmount: gst.totalCess,
      })
      .where(eq(schema.purchaseOrder.id, id))
    for (let idx = 0; idx < resolved.length; idx++) {
      const { supplierItem: si, line } = resolved[idx]
      const g = gst.items[idx]
      await tx.insert(schema.purchaseOrderItem).values({
        purchaseOrderId: id,
        supplierItemId: si.id,
        quantity: line.quantity,
        receivedQuantity: 0,
        rate: line.rate,
        discount: line.discount,
        taxRate: line.taxRate,
        total: g.total,
        hsnCode: g.hsnCode || null,
        taxableAmount: g.taxableAmount,
        cgstRate: g.cgstRate,
        cgstAmount: g.cgstAmount,
        sgstRate: g.sgstRate,
        sgstAmount: g.sgstAmount,
        igstRate: g.igstRate,
        igstAmount: g.igstAmount,
      })
    }
  })
}

// Open POs (status not CLOSED/CANCELLED, not archived) for a supplier — feeds
// the bill form's "Reference PO" picker. Mirrors desktop's
// purchaseOrder:listOpenForSupplier.
export type OpenPoSummary = {
  id: string
  orderNumber: string
  orderDate: Date
  totalAmount: number
}

export async function listOpenPurchaseOrders(
  db: Db,
  supplierId: string,
): Promise<OpenPoSummary[]> {
  return db
    .select({
      id: schema.purchaseOrder.id,
      orderNumber: schema.purchaseOrder.orderNumber,
      orderDate: schema.purchaseOrder.orderDate,
      totalAmount: schema.purchaseOrder.totalAmount,
    })
    .from(schema.purchaseOrder)
    .where(
      and(
        eq(schema.purchaseOrder.supplierId, supplierId),
        notInArray(schema.purchaseOrder.status, ['CLOSED', 'CANCELLED']),
        isNull(schema.purchaseOrder.deletedAt),
      ),
    )
    .orderBy(desc(schema.purchaseOrder.orderDate))
}

// A PO's lines shaped for pre-filling the bill form, catalog name joined in
// for display. Mirrors desktop Purchase.tsx handleSelectPO's mapping.
export async function loadPoLinesForBill(db: Db, poId: string) {
  return db
    .select({
      supplierItemId: schema.purchaseOrderItem.supplierItemId,
      name: schema.supplierItem.name,
      hsnCode: schema.purchaseOrderItem.hsnCode,
      quantity: schema.purchaseOrderItem.quantity,
      rate: schema.purchaseOrderItem.rate,
      discount: schema.purchaseOrderItem.discount,
      taxRate: schema.purchaseOrderItem.taxRate,
    })
    .from(schema.purchaseOrderItem)
    .leftJoin(
      schema.supplierItem,
      eq(schema.purchaseOrderItem.supplierItemId, schema.supplierItem.id),
    )
    .where(eq(schema.purchaseOrderItem.purchaseOrderId, poId))
}

export async function deletePurchaseOrder(db: Db, id: string): Promise<void> {
  // Soft-delete: stamp deletedAt (updatedAt auto-bumps). The header and its line
  // items stay put so a restore brings the whole document back intact.
  await db.update(schema.purchaseOrder).set({ deletedAt: new Date() }).where(eq(schema.purchaseOrder.id, id))
}

export async function restorePurchaseOrder(db: Db, id: string): Promise<void> {
  await db.update(schema.purchaseOrder).set({ deletedAt: null }).where(eq(schema.purchaseOrder.id, id))
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
