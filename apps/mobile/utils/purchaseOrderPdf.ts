// Assembles the PurchaseOrderData shape the shared pdfmake builder expects from
// the local DB (purchaseOrder + its line items + supplier + company), then
// returns the builder name + plain data + filename. PO direction is supplier-side:
// items come from purchaseOrderItem joined to supplierItem for name/unit/hsnCode.
// The company logo lives base64 in company.logoPath (mobile stores images as
// base64 data-URIs), which drops straight into the builder's {image} node.

import { eq } from 'drizzle-orm'

import { buildPurchaseOrderFilename, type PurchaseOrderData } from '@neu/shared'
import { schema, useDb } from '@/db'

type Db = ReturnType<typeof useDb>

export interface PurchaseOrderPdfPayload {
  // The WebView builds the docDefinition from this plain data (see HiddenPdfWebView).
  builder: 'purchaseOrder'
  data: PurchaseOrderData
  filename: string
}

export async function buildPurchaseOrderPdfPayload(
  db: Db,
  id: string,
): Promise<PurchaseOrderPdfPayload | null> {
  const [po] = await db
    .select()
    .from(schema.purchaseOrder)
    .where(eq(schema.purchaseOrder.id, id))
    .limit(1)
  if (!po) return null

  const [sup] = await db
    .select()
    .from(schema.supplier)
    .where(eq(schema.supplier.id, po.supplierId))
    .limit(1)
  const [company] = await db.select().from(schema.company).limit(1)
  const lines = await db
    .select({ line: schema.purchaseOrderItem, prod: schema.supplierItem })
    .from(schema.purchaseOrderItem)
    .leftJoin(
      schema.supplierItem,
      eq(schema.purchaseOrderItem.supplierItemId, schema.supplierItem.id),
    )
    .where(eq(schema.purchaseOrderItem.purchaseOrderId, id))

  const data: PurchaseOrderData = {
    orderNumber: po.orderNumber,
    orderDate: po.orderDate.toISOString(),
    expectedDate: po.expectedDate ? po.expectedDate.toISOString() : undefined,
    notes: po.notes ?? undefined,
    termsConditions: po.termsConditions ?? undefined,
    totalAmount: po.totalAmount,
    subtotal: po.subtotal,
    taxAmount: po.taxAmount,
    billingAddress: po.billingAddress ?? undefined,
    shippingAddress: po.shippingAddress ?? undefined,
    vendorQuotationRef: po.vendorQuotationRef ?? undefined,
    isInterState: po.isInterState,
    supplier: {
      name: sup?.name ?? 'Supplier',
      taxId: sup?.taxId ?? undefined,
      phone: sup?.phone ?? undefined,
      email: sup?.email ?? undefined,
      billingAddress: sup?.billingAddress ?? undefined,
    },
    items: lines.map(({ line, prod }) => ({
      item: {
        name: prod?.name ?? 'Item',
        unit: prod?.unit ?? undefined,
        hsnCode: prod?.hsnCode ?? undefined,
      },
      quantity: line.quantity,
      rate: line.rate,
      taxRate: line.taxRate,
      discount: line.discount,
      total: line.total,
      hsnCode: line.hsnCode ?? undefined,
      taxableAmount: line.taxableAmount,
    })),
    company: company
      ? {
          name: company.name,
          address: company.address ?? undefined,
          phone: company.phone ?? undefined,
          email: company.email ?? undefined,
          taxId: company.taxId ?? undefined,
          bankDetails: company.bankDetails ?? undefined,
          currency: company.currency ?? undefined,
          termsConditions: company.termsConditions ?? undefined,
          stateCode: company.stateCode ?? undefined,
          stateName: company.stateName ?? undefined,
          logoBase64: company.logoPath ?? undefined,
        }
      : undefined,
  }

  return { builder: 'purchaseOrder', data, filename: buildPurchaseOrderFilename(data) }
}
