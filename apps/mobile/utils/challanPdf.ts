// Assembles the ChallanData shape the shared pdfmake builder expects from the
// local DB (delivery challan + its line items + customer + company), then returns
// the builder id + plain data + filename. Mirrors utils/invoicePdf.ts. The company
// logo lives base64 in company.logoPath (mobile stores images as base64 data-URIs),
// which drops straight into the builder's {image} node.

import { eq } from 'drizzle-orm'

import { buildChallanFilename, type ChallanData } from '@neu/shared'
import { schema, useDb } from '@/db'

type Db = ReturnType<typeof useDb>

export interface ChallanPdfPayload {
  // The WebView builds the docDefinition from this plain data (see HiddenPdfWebView).
  builder: string
  data: ChallanData
  filename: string
}

export async function buildChallanPdfPayload(db: Db, id: string): Promise<ChallanPdfPayload | null> {
  const [ch] = await db
    .select()
    .from(schema.deliveryChallan)
    .where(eq(schema.deliveryChallan.id, id))
    .limit(1)
  if (!ch) return null

  const [cust] = await db
    .select()
    .from(schema.customer)
    .where(eq(schema.customer.id, ch.customerId))
    .limit(1)
  const [company] = await db.select().from(schema.company).limit(1)
  const lines = await db
    .select({ line: schema.deliveryChallanItem, prod: schema.item })
    .from(schema.deliveryChallanItem)
    .leftJoin(schema.item, eq(schema.deliveryChallanItem.itemId, schema.item.id))
    .where(eq(schema.deliveryChallanItem.deliveryChallanId, id))

  const data: ChallanData = {
    challanNumber: ch.challanNumber,
    challanDate: ch.challanDate.toISOString(),
    status: ch.status as ChallanData['status'],
    subtotal: ch.subtotal,
    taxAmount: ch.taxAmount,
    totalAmount: ch.totalAmount,
    transportMode: ch.transportMode ?? undefined,
    vehicleNumber: ch.vehicleNumber ?? undefined,
    poNumber: ch.poNumber ?? undefined,
    ewayBillNo: ch.ewayBillNo ?? undefined,
    warrantyPeriod: ch.warrantyPeriod ?? undefined,
    dispatchedThrough: ch.dispatchedThrough ?? undefined,
    notes: ch.notes ?? undefined,
    termsConditions: ch.termsConditions ?? undefined,
    customer: {
      name: cust?.name ?? 'Customer',
      email: cust?.email ?? undefined,
      phone: cust?.phone ?? undefined,
      billingAddress: cust?.billingAddress ?? undefined,
      shippingAddress: cust?.shippingAddress ?? undefined,
      taxId: cust?.taxId ?? undefined,
      stateCode: cust?.stateCode ?? undefined,
      stateName: cust?.stateName ?? undefined,
    },
    items: lines.map(({ line, prod }) => ({
      item: {
        name: prod?.name ?? 'Item',
        unit: prod?.unit ?? undefined,
        hsnCode: prod?.hsnCode ?? undefined,
        skuHsn: prod?.skuHsn ?? undefined,
      },
      quantity: line.quantity,
      rate: line.rate,
      taxRate: line.taxRate,
      discount: line.discount,
      total: line.total,
      hsnCode: line.hsnCode ?? undefined,
      taxableAmount: line.quantity * line.rate - line.discount,
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

  return { builder: 'challan', data, filename: buildChallanFilename(data) }
}
