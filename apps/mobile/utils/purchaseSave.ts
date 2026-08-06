import { and, desc, eq, isNull, sql } from 'drizzle-orm'

import {
  applyPurchaseTaxOverride,
  computeGstValues,
  computePaymentStatus,
  reversePayment,
  type PaymentType,
  type PurchaseTaxOverride,
} from '@neu/shared'

import { schema, useDb } from '@/db'

// Tag on the PAYMENT_OUT row auto-created for a bill saved with an up-front
// payment — mirrors desktop's INLINE_PAYMENT_NOTE in handlers/purchase.ts.
const INLINE_PAYMENT_NOTE = 'Paid with bill'

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
  // Optional link back to the originating Purchase Order (mirrors desktop):
  // create closes the PO once a bill exists against it; edit can update or
  // clear the link (null clears, undefined leaves it untouched).
  purchaseOrderId?: string | null
  // Document-level discount subtracted from the grand total AFTER tax
  // (totalAmount = subtotal + tax − discount, mirrors desktop). Separate from
  // the per-line discounts, which reduce each line's taxable base.
  discount?: number
  // Bill-level tax override: a scanned bill that shows tax only at the bottom
  // (every line's taxRate 0) — the total plus, when the bill printed one, its
  // explicit CGST/SGST/IGST breakdown. Goes through the shared
  // applyPurchaseTaxOverride — same rule as desktop. null/undefined = compute
  // tax from the per-line rates as usual.
  taxOverride?: PurchaseTaxOverride | null
  // Up-front payment recorded at save (mirrors desktop's create form). Becomes
  // a real tagged PAYMENT_OUT row; 0/undefined = fully unpaid.
  amountPaid?: number
  paymentMode?: string
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
  taxOverride?: PurchaseTaxOverride | null,
  docDiscount?: number,
) {
  const [company] = await tx.select().from(schema.company).limit(1)
  const [supplier] = await tx
    .select()
    .from(schema.supplier)
    .where(eq(schema.supplier.id, supplierId))
    .limit(1)

  return applyPurchaseTaxOverride(
    computeGstValues({
      // Purchase-side: keep the supplier's paise — never rupee-round their total.
      roundTotalToRupee: false,
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
      docDiscount: docDiscount || 0,
    }),
    taxOverride,
  )
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

    // GST split (place of supply, inter-state, per-line CGST/SGST or IGST) from
    // the shared helper — including the bill-level tax override for scanned
    // bills. Its subtotal/taxAmount/totalAmount ARE the stored totals.
    const gst = await computePurchaseGst(
      tx,
      header.supplierId,
      normalized,
      header.taxOverride,
      header.discount,
    )
    const { subtotal, taxAmount, totalAmount: total } = gst

    const amountPaid = header.amountPaid || 0
    const balanceDue = total - amountPaid

    const [bill] = await tx
      .insert(schema.purchaseBill)
      .values({
        billNumber: header.billNumber,
        billDate: header.billDate,
        supplierId: header.supplierId,
        supplierInvoiceNumber: header.supplierInvoiceNumber,
        supplierInvoiceDate: header.supplierInvoiceDate,
        purchaseOrderId: header.purchaseOrderId ?? null,
        subtotal,
        discount: header.discount || 0,
        taxAmount,
        totalAmount: total,
        amountPaid,
        balanceDue,
        // Same money-derived rule as desktop and the recompute engine.
        status: computePaymentStatus(total, amountPaid),
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

    // Record any up-front payment as a real Payment Out row so it shows in the
    // supplier's ledger AND so the recompute engine (which sums payment ROWS)
    // can see the money. currentBalance was already bumped by the NET balanceDue
    // above, so the row is NOT re-applied — it's the ledger record of that money.
    if (amountPaid > 0) {
      await tx.insert(schema.paymentTransaction).values({
        type: 'PAYMENT_OUT',
        supplierId: header.supplierId,
        amount: amountPaid,
        paymentMode: header.paymentMode || 'CASH',
        paymentDate: header.billDate,
        referenceType: 'BILL',
        purchaseBillId: bill.id,
        notes: INLINE_PAYMENT_NOTE,
      })
    }

    // If this bill references a PO, mark that PO CLOSED now that the financial
    // side is recorded. Future bills referencing the same PO are still allowed
    // (split deliveries) — closing just signals "no more expected." Mirrors
    // desktop purchase:create.
    if (header.purchaseOrderId) {
      await tx
        .update(schema.purchaseOrder)
        .set({ status: 'CLOSED' })
        .where(eq(schema.purchaseOrder.id, header.purchaseOrderId))
    }

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

    // A bill's payment rows carry the supplier they were paid to. Changing the
    // supplier while active payments exist would strand those rows on the old
    // supplier — live balances would diverge from the recompute engine, and a
    // later cancel would corrupt BOTH suppliers. Block it; cancel the payments
    // first (or keep the supplier). Mirrors desktop purchase:update.
    if (header.supplierId !== existing.supplierId) {
      const linked = await tx
        .select({ id: schema.paymentTransaction.id })
        .from(schema.paymentTransaction)
        .where(
          and(
            eq(schema.paymentTransaction.purchaseBillId, id),
            isNull(schema.paymentTransaction.cancelledAt),
            isNull(schema.paymentTransaction.deletedAt),
          ),
        )
        .limit(1)
      if (linked.length > 0) {
        throw new Error('This bill has payments recorded against it — cancel those payments before changing the supplier')
      }
    }

    // Capture the old lines' stock effect before we touch anything.
    const reversal = await loadReversalLines(tx, id)

    const normalized = await normalizePurchaseItems(tx, header.supplierId, lines)

    // Recompute the GST split against the (possibly changed) supplier + lines,
    // honoring the bill-level tax override the same way create does.
    const gst = await computePurchaseGst(
      tx,
      header.supplierId,
      normalized,
      header.taxOverride,
      header.discount,
    )
    const { subtotal, taxAmount, totalAmount: total } = gst

    // amountPaid is owned by the payments flow, not the edit form — keep it.
    const amountPaid = existing.amountPaid || 0
    const balanceDue = total - amountPaid
    // Same money-derived rule as desktop and the recompute engine (a zero-total
    // bill with nothing owed counts as PAID, matching recomputeBillStates).
    const status = computePaymentStatus(total, amountPaid)

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
        // Update or clear the PO link on edit (undefined = leave untouched).
        ...(header.purchaseOrderId !== undefined
          ? { purchaseOrderId: header.purchaseOrderId }
          : {}),
        subtotal,
        discount: header.discount || 0,
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

// Cancel (Mode B): reverse the supplier balance + stock, then stamp cancelledAt.
// applyStockUpdates('decrement') APPENDS the reversing movements; we do NOT delete
// the movement rows or the bill — cancel preserves the whole record (append-only,
// sync-safe). Terminal — there is no restore.
export async function cancelPurchaseBill(db: Db, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [bill] = await tx
      .select()
      .from(schema.purchaseBill)
      .where(eq(schema.purchaseBill.id, id))
      .limit(1)
    if (!bill) throw new Error('Purchase bill not found')
    if (bill.cancelledAt) return // already cancelled — never reverse the balance/stock twice

    const reversal = await loadReversalLines(tx, id)

    // A paid/part-paid bill carries active payment rows. Cancel them FIRST via
    // the exact reverse flow (which restores the bill's amountPaid/balanceDue and
    // the supplier's balance), then reverse the bill's now-full balance. Leaving
    // them active would disagree with the recompute engine, which counts every
    // active payment row against the supplier. Mirrors desktop purchase:cancel.
    const linkedPayments = await tx
      .select()
      .from(schema.paymentTransaction)
      .where(
        and(
          eq(schema.paymentTransaction.purchaseBillId, id),
          isNull(schema.paymentTransaction.cancelledAt),
          isNull(schema.paymentTransaction.deletedAt),
        ),
      )
    for (const p of linkedPayments) {
      await reversePayment(tx, {
        type: p.type as PaymentType,
        amount: p.amount,
        customerId: p.customerId,
        supplierId: p.supplierId,
        salesInvoiceId: p.salesInvoiceId,
        purchaseBillId: p.purchaseBillId,
      })
      await tx
        .update(schema.paymentTransaction)
        .set({ cancelledAt: new Date() })
        .where(eq(schema.paymentTransaction.id, p.id))
    }
    const [freshBill] = linkedPayments.length
      ? await tx
          .select({ balanceDue: schema.purchaseBill.balanceDue })
          .from(schema.purchaseBill)
          .where(eq(schema.purchaseBill.id, id))
          .limit(1)
      : [bill]

    await tx
      .update(schema.supplier)
      .set({ currentBalance: sql`${schema.supplier.currentBalance} - ${freshBill.balanceDue}` })
      .where(eq(schema.supplier.id, bill.supplierId))

    await applyStockUpdates(tx, reversal, id, 'decrement')

    await tx
      .update(schema.purchaseBill)
      .set({ cancelledAt: new Date() })
      .where(eq(schema.purchaseBill.id, id))
  })
}
