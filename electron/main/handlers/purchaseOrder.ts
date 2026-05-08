import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { triggerSyncAfterChange } from '../sync'

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

const purchaseOrderInclude = {
  supplier: true,
  items: {
    include: {
      supplierItem: { include: { linkedItem: true } },
    },
  },
} as const

async function resolveSupplierItem(tx: any, supplierId: string, item: any) {
  if (item.supplierItemId) {
    const supplierItem = await tx.supplierItem.findUnique({
      where: { id: item.supplierItemId },
      include: { linkedItem: true },
    })
    if (!supplierItem) throw new Error('Supplier item not found')
    return supplierItem
  }

  if (item.itemId) {
    // itemId from the form's per-supplier dropdown — same id-space as supplierItem.id
    const byId = await tx.supplierItem.findFirst({
      where: { id: item.itemId, supplierId },
      include: { linkedItem: true },
    })
    if (byId) return byId
  }

  const extractedName: string = item._extractedName || item.name || ''
  if (!extractedName) {
    throw new Error('Each PO line must have a supplier item')
  }

  // Fuzzy dedupe on the supplier's catalog
  const candidates = await tx.supplierItem.findMany({
    where: { supplierId },
    include: { linkedItem: true },
  })
  const target = normalizeItemName(extractedName)
  const existing = candidates.find((c: any) => normalizeItemName(c.name) === target)
  if (existing) return existing

  return tx.supplierItem.create({
    data: {
      supplierId,
      name: extractedName,
      hsnCode: item.hsnCode || null,
      unit: 'pcs',
      lastPurchasePrice: item.rate || 0,
      defaultTaxRate: item.taxRate || 0,
    },
    include: { linkedItem: true },
  })
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
  const prisma = getPrisma()

  // List all POs (most-recent first)
  ipcMain.handle('purchaseOrder:getAll', async () => {
    try {
      const orders = await prisma.purchaseOrder.findMany({
        include: purchaseOrderInclude,
        orderBy: { orderDate: 'desc' },
      })
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
      const order = await prisma.purchaseOrder.findUnique({
        where: { id },
        include: purchaseOrderInclude,
      })
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
      const order = await prisma.$transaction(async (tx: any) => {
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

        return tx.purchaseOrder.create({
          data: {
            orderNumber: data.orderNumber,
            orderDate: new Date(data.orderDate),
            expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
            supplierId,
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
            items: {
              create: normalizedItems.map((it) => ({
                supplierItemId: it.supplierItemId,
                hsnCode: it.hsnCode,
                quantity: it.quantity,
                rate: it.rate,
                discount: it.discount,
                taxRate: it.taxRate,
                total: it.total,
                taxableAmount: it.taxableAmount,
              })),
            },
          },
          include: purchaseOrderInclude,
        })
      })

      await triggerSyncAfterChange()
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
      const order = await prisma.$transaction(async (tx: any) => {
        const existing = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } })
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
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } })

        return tx.purchaseOrder.update({
          where: { id },
          data: {
            orderDate: new Date(data.orderDate),
            expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
            supplierId,
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
            items: {
              create: normalizedItems.map((it) => ({
                supplierItemId: it.supplierItemId,
                hsnCode: it.hsnCode,
                quantity: it.quantity,
                rate: it.rate,
                discount: it.discount,
                taxRate: it.taxRate,
                total: it.total,
                taxableAmount: it.taxableAmount,
              })),
            },
          },
          include: purchaseOrderInclude,
        })
      })

      await triggerSyncAfterChange()
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
      await prisma.purchaseOrder.delete({ where: { id } })
      await triggerSyncAfterChange()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete purchase order',
      }
    }
  })

  // Auto-numbering: PO-YYYY-NNN
  ipcMain.handle('purchaseOrder:generateOrderNumber', async () => {
    try {
      const last = await prisma.purchaseOrder.findFirst({
        orderBy: { orderNumber: 'desc' },
      })
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

  // Convert a PO into a Purchase Bill. The PO is marked RECEIVED + linked to the
  // new bill so we don't accidentally convert it twice. The frontend opens the
  // bill's edit dialog so the user can attach the supplier's actual invoice.
  ipcMain.handle('purchaseOrder:convertToBill', async (_, id: string) => {
    try {
      const result = await prisma.$transaction(async (tx: any) => {
        const order = await tx.purchaseOrder.findUnique({
          where: { id },
          include: { items: true },
        })
        if (!order) throw new Error('Purchase order not found')
        if (order.convertedBillId) throw new Error('This PO has already been converted to a bill')

        // Auto-number the bill same way purchase:generateBillNumber does
        const lastBill = await tx.purchaseBill.findFirst({ orderBy: { billNumber: 'desc' } })
        const year = new Date().getFullYear()
        const lastNum = lastBill ? parseInt(lastBill.billNumber.split('-').pop() || '0') : 0
        const billNumber = `BILL-${year}-${String(lastNum + 1).padStart(3, '0')}`

        const bill = await tx.purchaseBill.create({
          data: {
            billNumber,
            billDate: new Date(),
            supplierId: order.supplierId,
            subtotal: order.subtotal,
            discount: order.discount,
            taxAmount: order.taxAmount,
            cgstAmount: order.cgstAmount,
            sgstAmount: order.sgstAmount,
            igstAmount: order.igstAmount,
            totalAmount: order.totalAmount,
            balanceDue: order.totalAmount,
            status: 'DRAFT',
            notes: order.notes,
            items: {
              create: order.items.map((it: any) => ({
                supplierItemId: it.supplierItemId,
                hsnCode: it.hsnCode,
                quantity: it.quantity,
                rate: it.rate,
                discount: it.discount,
                taxRate: it.taxRate,
                total: it.total,
                taxableAmount: it.taxableAmount,
              })),
            },
          },
        })

        await tx.purchaseOrder.update({
          where: { id },
          data: { status: 'RECEIVED', convertedBillId: bill.id },
        })

        return bill
      })

      await triggerSyncAfterChange()
      return { success: true, data: result }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to convert PO to bill',
      }
    }
  })
}
