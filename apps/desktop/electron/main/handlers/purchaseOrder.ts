import { ipcMain } from 'electron'
import { getPrisma } from '../database'
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

const purchaseOrderInclude = {
  supplier: true,
  items: {
    include: {
      supplierItem: { include: { linkedItem: true } },
    },
  },
  // Bills referencing this PO. The frontend uses .length to decide whether the PO
  // can be edited/closed/deleted, and to surface "X bills against this PO" hints.
  bills: { select: { id: true, billNumber: true, billDate: true, totalAmount: true, status: true } },
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
      const order = await prisma.purchaseOrder.findUnique({ where: { id } })

      if (!order) {
        throw new Error('Purchase order not found')
      }

      // Soft-delete: stamp deletedAt (updatedAt auto-bumps). The header and its
      // line items stay put so a restore brings the whole document back intact.
      await prisma.purchaseOrder.update({
        where: { id },
        data: { deletedAt: new Date() },
      })

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
      const order = await prisma.purchaseOrder.findUnique({ where: { id } })

      if (!order) {
        throw new Error('Purchase order not found')
      }

      await prisma.purchaseOrder.update({
        where: { id },
        data: { deletedAt: null },
      })

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

  // Mark received quantities for individual lines, then recompute the PO header
  // status. Caller passes [{ lineId, receivedQuantity }, ...]. Lines not listed
  // are left untouched. PO doesn't touch supplier balance or stock — those side
  // effects live on the Bill, not the PO.
  ipcMain.handle(
    'purchaseOrder:markAsReceived',
    async (_, id: string, lineUpdates: Array<{ lineId: string; receivedQuantity: number }>) => {
      try {
        const order = await prisma.$transaction(async (tx: any) => {
          const existing = await tx.purchaseOrder.findUnique({
            where: { id },
            include: { items: true },
          })
          if (!existing) throw new Error('Purchase order not found')

          // Apply each line update. Clamp received to [0, ordered] so a fat-finger
          // doesn't show "received 1000 of 10."
          const updateMap = new Map(lineUpdates.map((u) => [u.lineId, u.receivedQuantity]))
          for (const line of existing.items) {
            if (!updateMap.has(line.id)) continue
            const requested = updateMap.get(line.id) || 0
            const clamped = Math.max(0, Math.min(requested, line.quantity))
            await tx.purchaseOrderItem.update({
              where: { id: line.id },
              data: { receivedQuantity: clamped },
            })
          }

          // Re-read items so the status math sees the updated values
          const refreshed = await tx.purchaseOrder.findUnique({
            where: { id },
            include: { items: true },
          })
          const allReceived = refreshed.items.every((it: any) => it.receivedQuantity >= it.quantity)
          const anyReceived = refreshed.items.some((it: any) => it.receivedQuantity > 0)
          const newStatus = allReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : refreshed.status

          return tx.purchaseOrder.update({
            where: { id },
            data: { status: newStatus },
            include: purchaseOrderInclude,
          })
        })

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
      const orders = await prisma.purchaseOrder.findMany({
        where: {
          supplierId,
          status: { notIn: ['CLOSED', 'CANCELLED'] },
          ...notDeleted,
        },
        include: purchaseOrderInclude,
        orderBy: { orderDate: 'desc' },
      })
      return { success: true, data: orders }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to list open POs',
      }
    }
  })
}
