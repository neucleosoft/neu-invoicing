import { and, desc, eq, sql } from 'drizzle-orm'

import { computeGstValues } from '@neu/shared'

import { schema, useDb } from '@/db'

// The whole point of this file is to mirror the desktop purchase handler
// (apps/desktop/electron/main/handlers/purchase.ts) on the mobile DB. A purchase
// bill isn't just a row — saving one resolves/creates supplier-catalog items,
// moves the supplier's balance, and (when an item is linked to something you
// sell) bumps that item's stock + price and logs a stock movement. Editing or
// deleting must reverse all of that. Keeping it here lets new/edit/detail share
// the exact same logic instead of drifting.

type Db = ReturnType<typeof useDb>

// One line the user entered on the bill form. Either it points at an existing
// supplier-catalog row (supplierItemId), or it's a new item identified by name
// that we find-or-create on save — exactly like desktop's resolveSupplierItem.
export type PurchaseLineInput = {
  supplierItemId: string | null
  name: string
  hsnCode: string
  quantity: number
  rate: number
  discount: number
  taxRate: number
}

export type PurchaseHeaderInput = {
  supplierId: string
  billNumber: string
  billDate: Date
  supplierInvoiceNumber: string | null
  supplierInvoiceDate: Date | null
  notes: string | null
  // Only present when a new attachment was picked this session (Phase 4). On
  // edit, `undefined` means "leave the saved attachment untouched". Typed from
  // the table's own insert type so it matches the buffer-mode blob column
  // exactly (hardcoding Uint8Array doesn't line up with Drizzle's inference).
  attachmentData?: typeof schema.purchaseBill.$inferInsert.attachmentData
  attachmentMimeType?: string | null
}

// A line after it's been resolved to a real supplier item + its computed totals.
type NormalizedLine = {
  supplierItemId: string
  hsnCode: string
  quantity: number
  rate: number
  discount: number
  taxRate: number
  taxableAmount: number
  total: number
  linkedItemId: string | null
}

// Must stay in sync with desktop's normalizeItemName: lowercase, treat
// -, /, . as spaces, collapse whitespace. Lets "Tube-Light 36W" and
// "tube light 36w" dedupe to the same catalog row.
function normalizeItemName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[-/.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Resolve a form line to a SupplierItem row, creating one if the user typed a
// new name that doesn't already exist in this supplier's catalog.
async function resolveSupplierItem(
  tx: any,
  supplierId: string,
  line: PurchaseLineInput,
): Promise<typeof schema.supplierItem.$inferSelect> {
  if (line.supplierItemId) {
    const [si] = await tx
      .select()
      .from(schema.supplierItem)
      .where(eq(schema.supplierItem.id, line.supplierItemId))
      .limit(1)
    if (!si) throw new Error('Supplier item not found')
    return si
  }

  const typedName = line.name?.trim()
  if (typedName) {
    // Dedupe against the supplier's existing catalog by normalized name. SQLite's
    // default collation is case-sensitive, so do this match in JS like desktop.
    const candidates = await tx
      .select()
      .from(schema.supplierItem)
      .where(eq(schema.supplierItem.supplierId, supplierId))
    const target = normalizeItemName(typedName)
    const existing = target
      ? candidates.find((c: any) => normalizeItemName(c.name) === target)
      : undefined
    if (existing) return existing

    const [created] = await tx
      .insert(schema.supplierItem)
      .values({
        supplierId,
        name: typedName,
        hsnCode: line.hsnCode || null,
        unit: 'pcs',
        lastPurchasePrice: line.rate || 0,
        defaultTaxRate: line.taxRate || 0,
      })
      .returning()
    return created
  }

  throw new Error('Each purchase line must have an item')
}

// Resolve every line, refresh each supplier item's last price/tax/HSN, and
// compute per-line totals. Mirrors desktop normalizePurchaseItems.
async function normalizePurchaseItems(
  tx: any,
  supplierId: string,
  lines: PurchaseLineInput[],
): Promise<NormalizedLine[]> {
  const out: NormalizedLine[] = []
  for (const line of lines) {
    const si = await resolveSupplierItem(tx, supplierId, line)
    const taxable = line.quantity * line.rate - (line.discount || 0)

    await tx
      .update(schema.supplierItem)
      .set({
        hsnCode: line.hsnCode || si.hsnCode || null,
        lastPurchasePrice: line.rate || 0,
        defaultTaxRate: line.taxRate || 0,
      })
      .where(eq(schema.supplierItem.id, si.id))

    out.push({
      supplierItemId: si.id,
      hsnCode: line.hsnCode || si.hsnCode || '',
      quantity: line.quantity,
      rate: line.rate,
      discount: line.discount || 0,
      taxRate: line.taxRate || 0,
      taxableAmount: taxable,
      total: taxable + (taxable * (line.taxRate || 0)) / 100,
      linkedItemId: si.linkedItemId || null,
    })
  }
  return out
}

// When a supplier item is linked to one of your sellable items, a purchase
// moves that item's stock and refreshes its cost. `increment` is a new/added
// bill; `decrement` reverses an old one (edit/delete). Mirrors desktop
// applyStockUpdates, including writing a StockMovement audit row.
async function applyStockUpdates(
  tx: any,
  items: { linkedItemId: string | null; quantity: number; rate: number }[],
  referenceId: string,
  direction: 'increment' | 'decrement',
): Promise<void> {
  for (const it of items) {
    if (!it.linkedItemId) continue
    const [linked] = await tx
      .select()
      .from(schema.item)
      .where(eq(schema.item.id, it.linkedItemId))
      .limit(1)
    if (!linked) continue

    // A purchase always refreshes the item's cost; it only moves stock for
    // items that track it. Two branches keep the .set() shape statically typed.
    if (linked.trackStock) {
      await tx
        .update(schema.item)
        .set({
          purchasePrice: it.rate,
          currentStock:
            direction === 'increment'
              ? sql`${schema.item.currentStock} + ${it.quantity}`
              : sql`${schema.item.currentStock} - ${it.quantity}`,
        })
        .where(eq(schema.item.id, it.linkedItemId))

      await tx.insert(schema.stockMovement).values({
        itemId: it.linkedItemId,
        movementType: 'PURCHASE',
        quantity: direction === 'increment' ? it.quantity : -it.quantity,
        referenceType: 'BILL',
        referenceId,
      })
    } else {
      await tx
        .update(schema.item)
        .set({ purchasePrice: it.rate })
        .where(eq(schema.item.id, it.linkedItemId))
    }
  }
}

function computeTotals(items: NormalizedLine[]) {
  let subtotal = 0
  let taxAmount = 0
  for (const it of items) {
    const t = it.quantity * it.rate - it.discount
    subtotal += t
    taxAmount += (t * it.taxRate) / 100
  }
  return { subtotal, taxAmount, total: subtotal + taxAmount }
}

// Compute the India GST split (place of supply, inter-state CGST/SGST vs IGST,
// per-line tax) for a purchase bill the SAME way desktop + mobile sales do, via
// the shared computeGstValues. For a purchase the buyer is OUR company and the
// counter-party is the SUPPLIER, so inter-state is decided by the company's
// state vs the supplier's state. Without this, every mobile-entered purchase
// would store 0 for the split and the GST/ITC reports would read zero.
//
// HSN per line is sourced from the already-resolved normalized line (which is
// the typed line's HSN falling back to the SupplierItem catalog's hsnCode).
// SupplierItem has no skuHsn column, so there's no catalogSkuHsn to pass.
async function computePurchaseGst(
  tx: any,
  supplierId: string,
  normalized: NormalizedLine[],
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
    items: normalized.map((it) => ({
      quantity: it.quantity,
      rate: it.rate,
      discount: it.discount,
      taxRate: it.taxRate,
      // Already resolved against the SupplierItem catalog in normalizePurchaseItems.
      catalogHsnCode: it.hsnCode || null,
    })),
  })
}

// Next internal bill number, BILL-YYYY-NNN. Mirrors desktop generateBillNumber:
// take the highest existing number and add one. Single-user mobile, so no race.
export async function generateBillNumber(db: Db): Promise<string> {
  const rows = await db
    .select({ billNumber: schema.purchaseBill.billNumber })
    .from(schema.purchaseBill)
    .orderBy(desc(schema.purchaseBill.billNumber))
    .limit(1)
  const year = new Date().getFullYear()
  const last = rows[0]?.billNumber
  const lastNum = last ? parseInt(last.split('-').pop() || '0', 10) || 0 : 0
  return `BILL-${year}-${String(lastNum + 1).padStart(3, '0')}`
}

export async function createPurchaseBill(
  db: Db,
  header: PurchaseHeaderInput,
  lines: PurchaseLineInput[],
): Promise<string> {
  return db.transaction(async (tx) => {
    const normalized = await normalizePurchaseItems(tx, header.supplierId, lines)
    const { subtotal, taxAmount, total } = computeTotals(normalized)

    // GST split (place of supply, inter-state, per-line CGST/SGST or IGST) from
    // the shared helper. Totals it returns equal computeTotals above (same math,
    // no doc discount), so stored totals/balance behaviour is unchanged — we only
    // ADD the split columns the GST/ITC reports need.
    const gst = await computePurchaseGst(tx, header.supplierId, normalized)

    // New bills start fully unpaid; recording payment is a separate action,
    // exactly like the desktop create form.
    const amountPaid = 0
    const balanceDue = total - amountPaid

    const [bill] = await tx
      .insert(schema.purchaseBill)
      .values({
        billNumber: header.billNumber,
        billDate: header.billDate,
        supplierId: header.supplierId,
        supplierInvoiceNumber: header.supplierInvoiceNumber,
        supplierInvoiceDate: header.supplierInvoiceDate,
        subtotal,
        discount: 0,
        taxAmount,
        totalAmount: total,
        amountPaid,
        balanceDue,
        status: 'DRAFT',
        notes: header.notes,
        placeOfSupply: gst.placeOfSupply || null,
        placeOfSupplyName: gst.placeOfSupplyName || null,
        isInterState: gst.isInterState,
        cgstAmount: gst.totalCgst,
        sgstAmount: gst.totalSgst,
        igstAmount: gst.totalIgst,
        cessAmount: gst.totalCess,
        attachmentData: header.attachmentData ?? null,
        attachmentMimeType: header.attachmentMimeType ?? null,
      })
      .returning({ id: schema.purchaseBill.id })

    for (let idx = 0; idx < normalized.length; idx++) {
      const it = normalized[idx]
      const g = gst.items[idx]
      await tx.insert(schema.purchaseBillItem).values({
        purchaseBillId: bill.id,
        supplierItemId: it.supplierItemId,
        quantity: it.quantity,
        rate: it.rate,
        discount: it.discount,
        taxRate: it.taxRate,
        total: g.total,
        hsnCode: g.hsnCode || null,
        taxableAmount: g.taxableAmount,
        cgstRate: g.cgstRate,
        cgstAmount: g.cgstAmount,
        sgstRate: g.sgstRate,
        sgstAmount: g.sgstAmount,
        igstRate: g.igstRate,
        igstAmount: g.igstAmount,
        cessRate: g.cessRate,
        cessAmount: g.cessAmount,
      })
    }

    await tx
      .update(schema.supplier)
      .set({ currentBalance: sql`${schema.supplier.currentBalance} + ${balanceDue}` })
      .where(eq(schema.supplier.id, header.supplierId))

    await applyStockUpdates(tx, normalized, bill.id, 'increment')
    return bill.id
  })
}

// Load the linked-item / qty / rate of a bill's current lines so we can reverse
// their stock effect before rewriting the bill.
async function loadReversalLines(tx: any, billId: string) {
  const existingItems = await tx
    .select()
    .from(schema.purchaseBillItem)
    .where(eq(schema.purchaseBillItem.purchaseBillId, billId))
  const reversal: { linkedItemId: string | null; quantity: number; rate: number }[] = []
  for (const ei of existingItems) {
    const [si] = await tx
      .select({ linkedItemId: schema.supplierItem.linkedItemId })
      .from(schema.supplierItem)
      .where(eq(schema.supplierItem.id, ei.supplierItemId))
      .limit(1)
    reversal.push({
      linkedItemId: si?.linkedItemId ?? null,
      quantity: ei.quantity,
      rate: ei.rate,
    })
  }
  return reversal
}

export async function updatePurchaseBill(
  db: Db,
  id: string,
  header: PurchaseHeaderInput,
  lines: PurchaseLineInput[],
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.purchaseBill)
      .where(eq(schema.purchaseBill.id, id))
      .limit(1)
    if (!existing) throw new Error('Purchase bill not found')

    // Capture the old lines' stock effect before we touch anything.
    const reversal = await loadReversalLines(tx, id)

    const normalized = await normalizePurchaseItems(tx, header.supplierId, lines)
    const { subtotal, taxAmount, total } = computeTotals(normalized)

    // Recompute the GST split against the (possibly changed) supplier + lines.
    const gst = await computePurchaseGst(tx, header.supplierId, normalized)

    // amountPaid is owned by the payments flow, not the edit form — keep it.
    const amountPaid = existing.amountPaid || 0
    const balanceDue = total - amountPaid
    let status = 'DRAFT'
    if (amountPaid >= total && total > 0) status = 'PAID'
    else if (amountPaid > 0) status = 'PARTIAL'

    // 1. Unwind the old balance off the OLD supplier (supplier may have changed).
    await tx
      .update(schema.supplier)
      .set({ currentBalance: sql`${schema.supplier.currentBalance} - ${existing.balanceDue}` })
      .where(eq(schema.supplier.id, existing.supplierId))

    // 2. Unwind the old stock + remove its movement rows, then drop old lines.
    await applyStockUpdates(tx, reversal, id, 'decrement')
    await tx
      .delete(schema.stockMovement)
      .where(
        and(
          eq(schema.stockMovement.referenceType, 'BILL'),
          eq(schema.stockMovement.referenceId, id),
        ),
      )
    await tx
      .delete(schema.purchaseBillItem)
      .where(eq(schema.purchaseBillItem.purchaseBillId, id))

    // 3. Rewrite the bill header.
    await tx
      .update(schema.purchaseBill)
      .set({
        billDate: header.billDate,
        supplierId: header.supplierId,
        supplierInvoiceNumber: header.supplierInvoiceNumber,
        supplierInvoiceDate: header.supplierInvoiceDate,
        subtotal,
        discount: 0,
        taxAmount,
        totalAmount: total,
        balanceDue,
        status,
        notes: header.notes,
        placeOfSupply: gst.placeOfSupply || null,
        placeOfSupplyName: gst.placeOfSupplyName || null,
        isInterState: gst.isInterState,
        cgstAmount: gst.totalCgst,
        sgstAmount: gst.totalSgst,
        igstAmount: gst.totalIgst,
        cessAmount: gst.totalCess,
        // Only overwrite the attachment when a new one was picked this session.
        ...(header.attachmentData !== undefined
          ? {
              attachmentData: header.attachmentData,
              attachmentMimeType: header.attachmentMimeType ?? null,
            }
          : {}),
      })
      .where(eq(schema.purchaseBill.id, id))

    // 4. Reinsert the new lines.
    for (let idx = 0; idx < normalized.length; idx++) {
      const it = normalized[idx]
      const g = gst.items[idx]
      await tx.insert(schema.purchaseBillItem).values({
        purchaseBillId: id,
        supplierItemId: it.supplierItemId,
        quantity: it.quantity,
        rate: it.rate,
        discount: it.discount,
        taxRate: it.taxRate,
        total: g.total,
        hsnCode: g.hsnCode || null,
        taxableAmount: g.taxableAmount,
        cgstRate: g.cgstRate,
        cgstAmount: g.cgstAmount,
        sgstRate: g.sgstRate,
        sgstAmount: g.sgstAmount,
        igstRate: g.igstRate,
        igstAmount: g.igstAmount,
        cessRate: g.cessRate,
        cessAmount: g.cessAmount,
      })
    }

    // 5. Re-apply the new balance to the (possibly new) supplier + new stock.
    await tx
      .update(schema.supplier)
      .set({ currentBalance: sql`${schema.supplier.currentBalance} + ${balanceDue}` })
      .where(eq(schema.supplier.id, header.supplierId))

    await applyStockUpdates(tx, normalized, id, 'increment')
  })
}

export async function deletePurchaseBill(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [bill] = await tx
      .select()
      .from(schema.purchaseBill)
      .where(eq(schema.purchaseBill.id, id))
      .limit(1)
    if (!bill) throw new Error('Purchase bill not found')

    const reversal = await loadReversalLines(tx, id)

    await tx
      .update(schema.supplier)
      .set({ currentBalance: sql`${schema.supplier.currentBalance} - ${bill.balanceDue}` })
      .where(eq(schema.supplier.id, bill.supplierId))

    await applyStockUpdates(tx, reversal, id, 'decrement')
    await tx
      .delete(schema.stockMovement)
      .where(
        and(
          eq(schema.stockMovement.referenceType, 'BILL'),
          eq(schema.stockMovement.referenceId, id),
        ),
      )
    // Explicitly clear children first — don't rely on FK cascade being enabled.
    await tx
      .delete(schema.purchaseBillItem)
      .where(eq(schema.purchaseBillItem.purchaseBillId, id))
    await tx.delete(schema.purchaseBill).where(eq(schema.purchaseBill.id, id))
  })
}
