// Batched relation loaders — the drizzle replacement for Prisma's `include`
// on sales-side documents. One query per relation level (customers, children,
// catalog items), stitched in memory, so a 500-doc list costs 3 queries
// instead of Prisma's join or 500 lazy loads. Shapes match what the renderer
// always received: doc.customer, doc.items[], doc.items[].item.

import { inArray } from '@neu/shared'
import { getDb, schema } from '../db'

type Db = ReturnType<typeof getDb>

/** Attach `customer` + `items` (each with its catalog `item`) to document
 *  header rows. childTable/fkName: e.g. schema.quotationItem, 'quotationId'. */
export async function attachCustomerAndItems(
  db: Db,
  docs: any[],
  childTable: any,
  fkName: string,
): Promise<any[]> {
  if (docs.length === 0) return []

  const customerIds = [...new Set(docs.map((d) => d.customerId).filter(Boolean))]
  const customers = customerIds.length
    ? await db.select().from(schema.customer).where(inArray(schema.customer.id, customerIds))
    : []
  const customerById = new Map(customers.map((c: any) => [c.id, c]))

  const docIds = docs.map((d) => d.id)
  const children: any[] = await db.select().from(childTable).where(inArray(childTable[fkName], docIds))

  const itemIds = [...new Set(children.map((c) => c.itemId).filter(Boolean))]
  const items = itemIds.length
    ? await db.select().from(schema.item).where(inArray(schema.item.id, itemIds))
    : []
  const itemById = new Map(items.map((i: any) => [i.id, i]))

  const childrenByDoc = new Map<string, any[]>()
  for (const c of children) {
    const withItem = { ...c, item: c.itemId ? (itemById.get(c.itemId) ?? null) : null }
    const key = c[fkName]
    if (!childrenByDoc.has(key)) childrenByDoc.set(key, [])
    childrenByDoc.get(key)!.push(withItem)
  }

  return docs.map((d) => ({
    ...d,
    customer: d.customerId ? (customerById.get(d.customerId) ?? null) : null,
    items: childrenByDoc.get(d.id) ?? [],
  }))
}

// The drizzle replacement for the old purchaseBillInclude / ListInclude:
// supplier + items (each with supplierItem + linkedItem) + the linked PO
// summary; withPayments adds the bill's payment rows (detail view only).
export async function attachBillRelations(db: Db, bills: any[], opts: { withPayments?: boolean } = {}): Promise<any[]> {
  if (bills.length === 0) return []

  const supplierIds = [...new Set(bills.map((b) => b.supplierId).filter(Boolean))]
  const suppliers = supplierIds.length
    ? await db.select().from(schema.supplier).where(inArray(schema.supplier.id, supplierIds))
    : []
  const supplierById = new Map(suppliers.map((s: any) => [s.id, s]))

  const billIds = bills.map((b) => b.id)
  const lines: any[] = await db
    .select()
    .from(schema.purchaseBillItem)
    .where(inArray(schema.purchaseBillItem.purchaseBillId, billIds))

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

  const poIds = [...new Set(bills.map((b) => b.purchaseOrderId).filter(Boolean))]
  const pos: any[] = poIds.length
    ? await db
        .select({
          id: schema.purchaseOrder.id,
          orderNumber: schema.purchaseOrder.orderNumber,
          orderDate: schema.purchaseOrder.orderDate,
          status: schema.purchaseOrder.status,
        })
        .from(schema.purchaseOrder)
        .where(inArray(schema.purchaseOrder.id, poIds))
    : []
  const poById = new Map(pos.map((p) => [p.id, p]))

  const payments: any[] = opts.withPayments
    ? await db.select().from(schema.paymentTransaction).where(inArray(schema.paymentTransaction.purchaseBillId, billIds))
    : []
  const paymentsByBill = new Map<string, any[]>()
  for (const p of payments) {
    if (!paymentsByBill.has(p.purchaseBillId)) paymentsByBill.set(p.purchaseBillId, [])
    paymentsByBill.get(p.purchaseBillId)!.push(p)
  }

  const linesByBill = new Map<string, any[]>()
  for (const l of lines) {
    const withSupplierItem = { ...l, supplierItem: l.supplierItemId ? (supplierItemById.get(l.supplierItemId) ?? null) : null }
    if (!linesByBill.has(l.purchaseBillId)) linesByBill.set(l.purchaseBillId, [])
    linesByBill.get(l.purchaseBillId)!.push(withSupplierItem)
  }

  return bills.map((b) => ({
    ...b,
    supplier: b.supplierId ? (supplierById.get(b.supplierId) ?? null) : null,
    items: linesByBill.get(b.id) ?? [],
    purchaseOrder: b.purchaseOrderId ? (poById.get(b.purchaseOrderId) ?? null) : null,
    ...(opts.withPayments ? { payments: paymentsByBill.get(b.id) ?? [] } : {}),
  }))
}
