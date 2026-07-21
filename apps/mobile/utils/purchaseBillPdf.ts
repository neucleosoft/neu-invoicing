// Assembles the PurchaseBillData shape the shared pdfmake builder expects from
// the local DB (purchase bill + its line items + supplier + company), then
// returns the builder name + plain data + filename. Mirrors invoicePdf.ts: the
// company logo lives base64 in company.logoPath (mobile stores images as base64
// data-URIs), which drops straight into the builder's {image} node. Line item
// names/units/HSN come from the supplierItem catalog row, since purchaseBillItem
// only stores the supplierItemId reference.

import { eq } from 'drizzle-orm'

import { buildPurchaseBillFilename, type PurchaseBillData } from '@neu/shared'
import { schema, useDb } from '@/db'

type Db = ReturnType<typeof useDb>

export interface PurchaseBillPdfPayload {
  // The WebView builds the docDefinition from this plain data (see HiddenPdfWebView).
  builder: string
  data: PurchaseBillData
  filename: string
}

export async function buildPurchaseBillPdfPayload(
  db: Db,
  id: string,
): Promise<PurchaseBillPdfPayload | null> {
  const [bill] = await db
    .select()
    .from(schema.purchaseBill)
    .where(eq(schema.purchaseBill.id, id))
    .limit(1)
  if (!bill) return null

  const [sup] = await db
    .select()
    .from(schema.supplier)
    .where(eq(schema.supplier.id, bill.supplierId))
    .limit(1)
  const [company] = await db.select().from(schema.company).limit(1)
  const lines = await db
    .select({ line: schema.purchaseBillItem, cat: schema.supplierItem })
    .from(schema.purchaseBillItem)
    .leftJoin(
      schema.supplierItem,
      eq(schema.purchaseBillItem.supplierItemId, schema.supplierItem.id),
    )
    .where(eq(schema.purchaseBillItem.purchaseBillId, id))

  const data: PurchaseBillData = {
    billNumber: bill.billNumber,
    billDate: bill.billDate.toISOString(),
    supplierInvoiceNumber: bill.supplierInvoiceNumber ?? undefined,
    supplierInvoiceDate: bill.supplierInvoiceDate
      ? bill.supplierInvoiceDate.toISOString()
      : undefined,
    notes: bill.notes ?? undefined,
    totalAmount: bill.totalAmount,
    subtotal: bill.subtotal,
    taxAmount: bill.taxAmount,
    isInterState: bill.isInterState,
    supplier: {
      name: sup?.name ?? 'Supplier',
      taxId: sup?.taxId ?? undefined,
      phone: sup?.phone ?? undefined,
      email: sup?.email ?? undefined,
      billingAddress: sup?.billingAddress ?? undefined,
    },
    items: lines.map(({ line, cat }) => ({
      item: {
        name: cat?.name ?? 'Item',
        unit: cat?.unit ?? undefined,
        hsnCode: cat?.hsnCode ?? undefined,
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
          signatureBase64: company.signaturePath ?? undefined,
        }
      : undefined,
  }

  return { builder: 'purchaseBill', data, filename: buildPurchaseBillFilename(data) }
}
