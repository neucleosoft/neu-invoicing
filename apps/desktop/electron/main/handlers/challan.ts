import { ipcMain } from 'electron'
import { computeGstValues } from '@neu/shared'
import { getPrisma } from '../database'

// GST split for a challan's lines via the shared computeGstValues — same
// engine as invoices and the mobile challan form. Totals are identical to the
// old flat computation; this additionally yields the CGST/SGST/IGST split the
// challan columns store since 2026-07-14.
const buildChallanGst = async (tx: any, data: any) => {
  const customer = await tx.customer.findUnique({ where: { id: data.customerId } })
  const company = await tx.company.findFirst()
  const catalogItems: any[] = []
  for (const item of data.items) {
    catalogItems.push(await tx.item.findUnique({ where: { id: item.itemId } }))
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

export const setupChallanHandlers = () => {
  const prisma = getPrisma()

  // Get all delivery challans
  ipcMain.handle('challan:getAll', async () => {
    try {
      const challans = await prisma.deliveryChallan.findMany({
        include: {
          customer: true,
          items: {
            include: {
              item: true
            }
          }
        },
        orderBy: { challanDate: 'desc' }
      })
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
      const challan = await prisma.deliveryChallan.findUnique({
        where: { id },
        include: {
          customer: true,
          items: {
            include: {
              item: true
            }
          }
        }
      })
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

      const challan = await prisma.$transaction(async (tx: any) => {
        // Check for duplicate challan number
        const existing = await tx.deliveryChallan.findUnique({ where: { challanNumber: data.challanNumber } })
        if (existing) throw new Error(`Challan number ${data.challanNumber} already exists`)

        const gst = await buildChallanGst(tx, data)

        const created = await tx.deliveryChallan.create({
          data: {
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
            items: {
              create: data.items.map((item: any, idx: number) => {
                const g = gst.items[idx]
                return {
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
                  cessAmount: g.cessAmount
                }
              })
            }
          },
          include: {
            items: { include: { item: true } },
            customer: true
          }
        })

        // Update stock (decrement for tracked items) — challans dispatch goods
        for (const item of data.items) {
          const dbItem = await tx.item.findUnique({ where: { id: item.itemId } })
          if (dbItem && dbItem.trackStock) {
            await tx.item.update({
              where: { id: item.itemId },
              data: {
                currentStock: { decrement: item.quantity }
              }
            })

            await tx.stockMovement.create({
              data: {
                itemId: item.itemId,
                movementType: 'SALE',
                quantity: -item.quantity,
                referenceType: 'CHALLAN',
                referenceId: created.id
              }
            })
          }
        }

        return created
      })

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

      const existingChallan = await prisma.deliveryChallan.findUnique({
        where: { id },
        include: { items: true }
      })

      if (!existingChallan) {
        throw new Error('Delivery challan not found')
      }

      // Check for duplicate if challan number changed
      if (data.challanNumber && data.challanNumber !== existingChallan.challanNumber) {
        const duplicate = await prisma.deliveryChallan.findUnique({ where: { challanNumber: data.challanNumber } })
        if (duplicate) throw new Error(`Challan number ${data.challanNumber} already exists`)
      }

      const gst = await buildChallanGst(prisma, data)

      // Delete existing items
      await prisma.deliveryChallanItem.deleteMany({
        where: { deliveryChallanId: id }
      })

      // Update challan with new data
      const challan = await prisma.deliveryChallan.update({
        where: { id },
        data: {
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
          items: {
            create: data.items.map((item: any, idx: number) => {
              const g = gst.items[idx]
              return {
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
                cessAmount: g.cessAmount
              }
            })
          }
        },
        include: {
          items: { include: { item: true } },
          customer: true
        }
      })

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
      await prisma.$transaction(async (tx: any) => {
        const challan = await tx.deliveryChallan.findUnique({
          where: { id },
          include: { items: true }
        })

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
        for (const item of challan.items) {
          const dbItem = await tx.item.findUnique({ where: { id: item.itemId } })
          if (dbItem && dbItem.trackStock) {
            await tx.item.update({
              where: { id: item.itemId },
              data: {
                currentStock: { increment: item.quantity }
              }
            })
            await tx.stockMovement.create({
              data: {
                itemId: item.itemId,
                movementType: 'SALE',
                quantity: item.quantity, // positive = goods returned by the cancel
                referenceType: 'CHALLAN',
                referenceId: id,
                notes: 'Challan cancelled — stock returned'
              }
            })
          }
        }

        // CANCEL, not delete: stamp cancelledAt; the challan, its items, and its
        // stock movements all stay on record.
        await tx.deliveryChallan.update({
          where: { id },
          data: { cancelledAt: new Date() }
        })
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
      const result = await prisma.$transaction(async (tx: any) => {
        const challan = await tx.deliveryChallan.findUnique({
          where: { id },
          include: { items: true }
        })

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

        // Generate new invoice number (same pattern as sales handler)
        const lastInvoice = await tx.salesInvoice.findFirst({
          where: { type: 'INVOICE' },
          orderBy: { invoiceNumber: 'desc' }
        })

        const company = await tx.company.findFirst()
        const prefix = company?.invoicePrefix || 'INV'
        const year = new Date().getFullYear()
        const lastNumber = lastInvoice ? parseInt(lastInvoice.invoiceNumber.split('-').pop() || '0') : 0
        const newInvoiceNumber = `${prefix}-${year}-${String(lastNumber + 1).padStart(3, '0')}`

        // Create the sales invoice from challan data
        const invoice = await tx.salesInvoice.create({
          data: {
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
            items: {
              create: challan.items.map((item: any) => ({
                itemId: item.itemId,
                quantity: item.quantity,
                rate: item.rate,
                discount: item.discount || 0,
                taxRate: item.taxRate || 0,
                total: item.total,
                taxableAmount: item.quantity * item.rate - (item.discount || 0)
              }))
            }
          },
          include: {
            items: { include: { item: true } },
            customer: true
          }
        })

        // Update challan status to CONVERTED
        await tx.deliveryChallan.update({
          where: { id },
          data: {
            status: 'CONVERTED',
            convertedToInvoiceId: invoice.id
          }
        })

        // Update customer balance (since it's now an invoice)
        await tx.customer.update({
          where: { id: challan.customerId },
          data: {
            currentBalance: { increment: challan.totalAmount }
          }
        })

        // Note: Stock was already decremented when the challan was created,
        // so we do NOT decrement stock again. But we create stock movements
        // with INVOICE reference for the new invoice and remove the CHALLAN ones.
        for (const item of challan.items) {
          const dbItem = await tx.item.findUnique({ where: { id: item.itemId } })
          if (dbItem && dbItem.trackStock) {
            // Update the existing challan stock movement to reference the invoice
            await tx.stockMovement.updateMany({
              where: {
                itemId: item.itemId,
                referenceType: 'CHALLAN',
                referenceId: challan.id
              },
              data: {
                referenceType: 'INVOICE',
                referenceId: invoice.id
              }
            })
          }
        }

        return invoice
      })

      return { success: true, data: result }
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

      const lastChallan = await prisma.deliveryChallan.findFirst({
        where: { challanNumber: { startsWith: prefix } },
        orderBy: { challanNumber: 'desc' }
      })

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
