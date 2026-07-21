import { ipcMain } from 'electron'
import { and, computeGstValues, desc, eq, like, sql, type DrizzleDbLike } from '@neu/shared'
import { getDb, schema } from '../db'
import { attachCustomerAndItems } from './docLoaders'

// GST split for a challan's lines via the shared computeGstValues — same
// engine as invoices and the mobile challan form. Totals are identical to the
// old flat computation; this additionally yields the CGST/SGST/IGST split the
// challan columns store since 2026-07-14.
const buildChallanGst = async (tx: DrizzleDbLike, data: any) => {
  const [customer] = await tx.select().from(schema.customer).where(eq(schema.customer.id, data.customerId)).limit(1)
  const [company] = await tx.select().from(schema.company).limit(1)
  const catalogItems: any[] = []
  for (const item of data.items) {
    const [row] = await tx.select().from(schema.item).where(eq(schema.item.id, item.itemId)).limit(1)
    catalogItems.push(row ?? null)
  }
  return computeGstValues({
    company: company ? { stateCode: company.stateCode, stateName: company.stateName } : null,
    party: customer
      ? { taxId: customer.taxId, stateCode: customer.stateCode, stateName: customer.stateName }
      : {},
    items: data.items.map((item: any, idx: number) => ({
      quantity: item.quantity,
      rate: item.rate,
      discount: item.discount,
      taxRate: item.taxRate,
      hsnCode: item.hsnCode,
      catalogHsnCode: catalogItems[idx]?.hsnCode,
      catalogSkuHsn: catalogItems[idx]?.skuHsn,
    })),
  })
}

// Generate fiscal year string (e.g., "26-27" for April 2026 - March 2027)
const getFiscalYear = (): string => {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear() % 100
  if (month >= 4) {
    return `${String(year).padStart(2, '0')}-${String(year + 1).padStart(2, '0')}`
  } else {
    return `${String(year - 1).padStart(2, '0')}-${String(year).padStart(2, '0')}`
  }
}

// Normalize challan number — pad last numeric segment to 2 digits
// NS/DC/26-27/6 → NS/DC/26-27/06, NS/DC/26-27/06 stays NS/DC/26-27/06
const normalizeChallanNumber = (num: string): string => {
  const parts = num.trim().split('/')
  const last = parts[parts.length - 1]
  const parsed = parseInt(last)
  if (!isNaN(parsed)) {
    parts[parts.length - 1] = String(parsed).padStart(2, '0')
  }
  return parts.join('/')
}

// Shape a challan line from the shared GST result (create + update use this).
const challanLine = (item: any, g: any) => ({
  itemId: item.itemId,
  quantity: item.quantity,
  rate: item.rate,
  discount: item.discount || 0,
  taxRate: item.taxRate || 0,
  hsnCode: g.hsnCode || null,
  total: g.total,
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

export const setupChallanHandlers = () => {
  const db = getDb()

  // Get all delivery challans
  ipcMain.handle('challan:getAll', async () => {
    try {
      const headers = await db.select().from(schema.deliveryChallan).orderBy(desc(schema.deliveryChallan.challanDate))
      const challans = await attachCustomerAndItems(db, headers, schema.deliveryChallanItem, 'deliveryChallanId')
      return { success: true, data: challans }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch challans'
      }
    }
  })

  // Get challan by ID
  ipcMain.handle('challan:getById', async (_, id: string) => {
    try {
      const [header] = await db.select().from(schema.deliveryChallan).where(eq(schema.deliveryChallan.id, id)).limit(1)
      if (!header) return { success: true, data: null }
      const [challan] = await attachCustomerAndItems(db, [header], schema.deliveryChallanItem, 'deliveryChallanId')
      return { success: true, data: challan }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch challan'
      }
    }
  })

  // Create delivery challan
  ipcMain.handle('challan:create', async (_, data) => {
    try {
      // Normalize challan number — pad last numeric segment to 2 digits
      data.challanNumber = normalizeChallanNumber(data.challanNumber)

      const created = await db.transaction(async (tx) => {
        // Check for duplicate challan number
        const [existing] = await tx
          .select({ id: schema.deliveryChallan.id })
          .from(schema.deliveryChallan)
          .where(eq(schema.deliveryChallan.challanNumber, data.challanNumber))
          .limit(1)
        if (existing) throw new Error(`Challan number ${data.challanNumber} already exists`)

        const gst = await buildChallanGst(tx, data)

        const [challan] = await tx
          .insert(schema.deliveryChallan)
          .values({
            challanNumber: data.challanNumber,
            challanDate: new Date(data.challanDate),
            customerId: data.customerId,
            subtotal: gst.subtotal,
            taxAmount: gst.taxAmount,
            totalAmount: gst.totalAmount,
            transportMode: data.transportMode || null,
            vehicleNumber: data.vehicleNumber || null,
            notes: data.notes || null,
            termsConditions: data.termsConditions ?? null,
            status: data.status || 'NON_RETURNABLE',
            poNumber: data.poNumber || null,
            ewayBillNo: data.ewayBillNo || null,
            warrantyPeriod: data.warrantyPeriod || null,
            dispatchedThrough: data.dispatchedThrough || null,
            placeOfSupply: gst.placeOfSupply || null,
            placeOfSupplyName: gst.placeOfSupplyName || null,
            isInterState: gst.isInterState,
            cgstAmount: gst.totalCgst,
            sgstAmount: gst.totalSgst,
            igstAmount: gst.totalIgst,
            cessAmount: gst.totalCess,
          })
          .returning()

        if (data.items.length) {
          await tx.insert(schema.deliveryChallanItem).values(
            data.items.map((item: any, idx: number) => ({
              ...challanLine(item, gst.items[idx]),
              deliveryChallanId: challan.id,
            })),
          )
        }

        // Update stock (decrement for tracked items) — challans dispatch goods
        for (const item of data.items) {
          const [dbItem] = await tx.select().from(schema.item).where(eq(schema.item.id, item.itemId)).limit(1)
          if (dbItem && dbItem.trackStock) {
            await tx
              .update(schema.item)
              .set({ currentStock: sql`${schema.item.currentStock} - ${item.quantity}` })
              .where(eq(schema.item.id, item.itemId))

            await tx.insert(schema.stockMovement).values({
              itemId: item.itemId,
              movementType: 'SALE',
              quantity: -item.quantity,
              referenceType: 'CHALLAN',
              referenceId: challan.id
            })
          }
        }

        return challan
      })

      const [challan] = await attachCustomerAndItems(db, [created], schema.deliveryChallanItem, 'deliveryChallanId')
      return { success: true, data: challan }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create delivery challan'
      }
    }
  })

  // Update delivery challan
  ipcMain.handle('challan:update', async (_, id: string, data) => {
    try {
      // Normalize challan number if provided
      if (data.challanNumber) {
        data.challanNumber = normalizeChallanNumber(data.challanNumber)
      }

      const [existingChallan] = await db.select().from(schema.deliveryChallan).where(eq(schema.deliveryChallan.id, id)).limit(1)
      if (!existingChallan) {
        throw new Error('Delivery challan not found')
      }

      // Check for duplicate if challan number changed
      if (data.challanNumber && data.challanNumber !== existingChallan.challanNumber) {
        const [duplicate] = await db
          .select({ id: schema.deliveryChallan.id })
          .from(schema.deliveryChallan)
          .where(eq(schema.deliveryChallan.challanNumber, data.challanNumber))
          .limit(1)
        if (duplicate) throw new Error(`Challan number ${data.challanNumber} already exists`)
      }

      const gst = await buildChallanGst(db, data)

      const updated = await db.transaction(async (tx) => {
        // Delete existing items
        await tx.delete(schema.deliveryChallanItem).where(eq(schema.deliveryChallanItem.deliveryChallanId, id))

        // Update challan with new data
        const [challan] = await tx
          .update(schema.deliveryChallan)
          .set({
            challanNumber: data.challanNumber || existingChallan.challanNumber,
            challanDate: new Date(data.challanDate),
            customerId: data.customerId,
            subtotal: gst.subtotal,
            taxAmount: gst.taxAmount,
            totalAmount: gst.totalAmount,
            transportMode: data.transportMode || null,
            vehicleNumber: data.vehicleNumber || null,
            notes: data.notes || null,
            termsConditions: data.termsConditions ?? null,
            status: data.status || existingChallan.status,
            poNumber: data.poNumber || null,
            ewayBillNo: data.ewayBillNo || null,
            warrantyPeriod: data.warrantyPeriod || null,
            dispatchedThrough: data.dispatchedThrough || null,
            placeOfSupply: gst.placeOfSupply || null,
            placeOfSupplyName: gst.placeOfSupplyName || null,
            isInterState: gst.isInterState,
            cgstAmount: gst.totalCgst,
            sgstAmount: gst.totalSgst,
            igstAmount: gst.totalIgst,
            cessAmount: gst.totalCess,
          })
          .where(eq(schema.deliveryChallan.id, id))
          .returning()

        if (data.items.length) {
          await tx.insert(schema.deliveryChallanItem).values(
            data.items.map((item: any, idx: number) => ({
              ...challanLine(item, gst.items[idx]),
              deliveryChallanId: id,
            })),
          )
        }
        return challan
      })

      const [challan] = await attachCustomerAndItems(db, [updated], schema.deliveryChallanItem, 'deliveryChallanId')
      return { success: true, data: challan }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update delivery challan'
      }
    }
  })

  // Cancel delivery challan (Mode B): return the dispatched stock by APPENDING a
  // reversing movement (never deleting the originals), then stamp cancelledAt.
  // Terminal — there is no restore.
  ipcMain.handle('challan:cancel', async (_, id: string) => {
    try {
      await db.transaction(async (tx) => {
        const [challan] = await tx.select().from(schema.deliveryChallan).where(eq(schema.deliveryChallan.id, id)).limit(1)

        if (!challan) {
          throw new Error('Delivery challan not found')
        }

        // Already cancelled — never reverse the stock twice (idempotency guard).
        if (challan.cancelledAt) {
          return
        }

        // A converted challan's stock was carried into its invoice — cancel the
        // invoice instead, not the challan.
        if (challan.status === 'CONVERTED') {
          throw new Error('This challan was converted to an invoice — cancel the invoice instead.')
        }

        // Put tracked stock back AND append a "returned" movement per line. We do
        // NOT delete the original movements: cancel preserves the record, and a
        // deleted stockMovement can't sync (the table has no soft-delete column).
        const items = await tx.select().from(schema.deliveryChallanItem).where(eq(schema.deliveryChallanItem.deliveryChallanId, id))
        for (const item of items) {
          const [dbItem] = await tx.select().from(schema.item).where(eq(schema.item.id, item.itemId)).limit(1)
          if (dbItem && dbItem.trackStock) {
            await tx
              .update(schema.item)
              .set({ currentStock: sql`${schema.item.currentStock} + ${item.quantity}` })
              .where(eq(schema.item.id, item.itemId))
            await tx.insert(schema.stockMovement).values({
              itemId: item.itemId,
              movementType: 'SALE',
              quantity: item.quantity, // positive = goods returned by the cancel
              referenceType: 'CHALLAN',
              referenceId: id,
              notes: 'Challan cancelled — stock returned'
            })
          }
        }

        // CANCEL, not delete: stamp cancelledAt; the challan, its items, and its
        // stock movements all stay on record.
        await tx.update(schema.deliveryChallan).set({ cancelledAt: new Date() }).where(eq(schema.deliveryChallan.id, id))
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel delivery challan'
      }
    }
  })

  // Convert challan to sales invoice
  ipcMain.handle('challan:convertToInvoice', async (_, id: string) => {
    try {
      const createdId = await db.transaction(async (tx) => {
        const [challan] = await tx.select().from(schema.deliveryChallan).where(eq(schema.deliveryChallan.id, id)).limit(1)

        if (!challan) {
          throw new Error('Delivery challan not found')
        }

        if (challan.status === 'CONVERTED') {
          throw new Error('Challan has already been converted to an invoice')
        }

        // Returnable challans dispatch goods that come back (repair, job-work, etc.)
        // — they aren't a sale, so blocking the invoice conversion prevents
        // accidentally double-counting revenue.
        if (challan.status === 'RETURNABLE') {
          throw new Error('Returnable challans cannot be converted to an invoice')
        }

        const challanItems = await tx
          .select()
          .from(schema.deliveryChallanItem)
          .where(eq(schema.deliveryChallanItem.deliveryChallanId, id))

        // Generate new invoice number (same pattern as sales handler)
        const [lastInvoice] = await tx
          .select({ invoiceNumber: schema.salesInvoice.invoiceNumber })
          .from(schema.salesInvoice)
          .where(eq(schema.salesInvoice.type, 'INVOICE'))
          .orderBy(desc(schema.salesInvoice.invoiceNumber))
          .limit(1)

        const [company] = await tx.select().from(schema.company).limit(1)
        const prefix = company?.invoicePrefix || 'INV'
        const year = new Date().getFullYear()
        const lastNumber = lastInvoice ? parseInt(lastInvoice.invoiceNumber.split('-').pop() || '0') : 0
        const newInvoiceNumber = `${prefix}-${year}-${String(lastNumber + 1).padStart(3, '0')}`

        // Create the sales invoice from challan data
        const [invoice] = await tx
          .insert(schema.salesInvoice)
          .values({
            // Deterministic id: both devices converting this challan offline
            // mint the SAME invoice row, so sync converges to one invoice
            // instead of billing the customer twice.
            id: `conv-${challan.id}`,
            invoiceNumber: newInvoiceNumber,
            invoiceDate: new Date(),
            type: 'INVOICE',
            customerId: challan.customerId,
            subtotal: challan.subtotal,
            discount: 0,
            taxAmount: challan.taxAmount,
            totalAmount: challan.totalAmount,
            amountPaid: 0,
            balanceDue: challan.totalAmount,
            status: 'DRAFT',
            notes: challan.notes,
            // Mirror mobile's convert: carry the challan's terms onto the
            // invoice and stamp each line's taxable base.
            termsConditions: challan.termsConditions ?? null,
          })
          .returning({ id: schema.salesInvoice.id })

        if (challanItems.length) {
          await tx.insert(schema.salesInvoiceItem).values(
            challanItems.map((item: any) => ({
              salesInvoiceId: invoice.id,
              itemId: item.itemId,
              quantity: item.quantity,
              rate: item.rate,
              discount: item.discount || 0,
              taxRate: item.taxRate || 0,
              total: item.total,
              taxableAmount: item.quantity * item.rate - (item.discount || 0)
            })),
          )
        }

        // Update challan status to CONVERTED
        await tx
          .update(schema.deliveryChallan)
          .set({ status: 'CONVERTED', convertedToInvoiceId: invoice.id })
          .where(eq(schema.deliveryChallan.id, id))

        // Update customer balance (since it's now an invoice)
        await tx
          .update(schema.customer)
          .set({ currentBalance: sql`${schema.customer.currentBalance} + ${challan.totalAmount}` })
          .where(eq(schema.customer.id, challan.customerId))

        // Note: Stock was already decremented when the challan was created,
        // so we do NOT decrement stock again. But we retarget the CHALLAN
        // stock movements to reference the new invoice.
        for (const item of challanItems) {
          const [dbItem] = await tx.select().from(schema.item).where(eq(schema.item.id, item.itemId)).limit(1)
          if (dbItem && dbItem.trackStock) {
            await tx
              .update(schema.stockMovement)
              .set({ referenceType: 'INVOICE', referenceId: invoice.id })
              .where(and(
                eq(schema.stockMovement.itemId, item.itemId),
                eq(schema.stockMovement.referenceType, 'CHALLAN'),
                eq(schema.stockMovement.referenceId, challan.id),
              ))
          }
        }

        return invoice.id
      })

      const [header] = await db.select().from(schema.salesInvoice).where(eq(schema.salesInvoice.id, createdId)).limit(1)
      const [invoice] = await attachCustomerAndItems(db, [header], schema.salesInvoiceItem, 'salesInvoiceId')
      return { success: true, data: invoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to convert challan to invoice'
      }
    }
  })

  // Generate challan number
  ipcMain.handle('challan:generateChallanNumber', async () => {
    try {
      const fy = getFiscalYear()
      const prefix = `NS/DC/${fy}/`

      const [lastChallan] = await db
        .select({ challanNumber: schema.deliveryChallan.challanNumber })
        .from(schema.deliveryChallan)
        .where(like(schema.deliveryChallan.challanNumber, `${prefix}%`))
        .orderBy(desc(schema.deliveryChallan.challanNumber))
        .limit(1)

      let nextNum = 1
      if (lastChallan) {
        const lastPart = lastChallan.challanNumber.split('/').pop()
        const parsed = parseInt(lastPart || '0')
        if (!isNaN(parsed)) nextNum = parsed + 1
      }

      const newChallanNumber = `${prefix}${String(nextNum).padStart(2, '0')}`
      return { success: true, data: newChallanNumber }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate challan number'
      }
    }
  })
}
