// Assembles the InvoiceData shape the shared pdfmake builder expects from the
// local DB (invoice + its line items + customer + company), then returns the
// pdfmake docDefinition + filename. The company logo lives base64 in
// company.logoPath (mobile stores images as base64 data-URIs), which drops
// straight into the builder's {image} node.

import { eq } from 'drizzle-orm'

import { buildInvoiceFilename, type InvoiceData } from '@neu/shared'
import { schema, useDb } from '@/db'

type Db = ReturnType<typeof useDb>

export interface PdfPayload {
  // The WebView builds the docDefinition from this plain data (see HiddenPdfWebView).
  builder: string
  data: InvoiceData
  filename: string
}

export async function buildInvoicePdfPayload(db: Db, invoiceId: string): Promise<PdfPayload | null> {
  const [inv] = await db
    .select()
    .from(schema.salesInvoice)
    .where(eq(schema.salesInvoice.id, invoiceId))
    .limit(1)
  if (!inv) return null

  const [cust] = await db
    .select()
    .from(schema.customer)
    .where(eq(schema.customer.id, inv.customerId))
    .limit(1)
  const [company] = await db.select().from(schema.company).limit(1)
  const lines = await db
    .select({ line: schema.salesInvoiceItem, prod: schema.item })
    .from(schema.salesInvoiceItem)
    .leftJoin(schema.item, eq(schema.salesInvoiceItem.itemId, schema.item.id))
    .where(eq(schema.salesInvoiceItem.salesInvoiceId, invoiceId))

  const data: InvoiceData = {
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate.toISOString(),
    dueDate: inv.dueDate ? inv.dueDate.toISOString() : undefined,
    type: inv.type,
    status: inv.status,
    subtotal: inv.subtotal,
    discount: inv.discount,
    taxAmount: inv.taxAmount,
    totalAmount: inv.totalAmount,
    amountPaid: inv.amountPaid,
    balanceDue: inv.balanceDue,
    isInterState: inv.isInterState,
    reverseCharge: inv.reverseCharge,
    cgstAmount: inv.cgstAmount,
    sgstAmount: inv.sgstAmount,
    igstAmount: inv.igstAmount,
    cessAmount: inv.cessAmount,
    placeOfSupply: inv.placeOfSupply ?? undefined,
    placeOfSupplyName: inv.placeOfSupplyName ?? undefined,
    poNumber: inv.poNumber ?? undefined,
    ewayBillNo: inv.ewayBillNo ?? undefined,
    vehicleNumber: inv.vehicleNumber ?? undefined,
    warrantyPeriod: inv.warrantyPeriod ?? undefined,
    dispatchedThrough: inv.dispatchedThrough ?? undefined,
    notes: inv.notes ?? undefined,
    termsConditions: inv.termsConditions ?? undefined,
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
      taxableAmount: line.taxableAmount,
      cgstRate: line.cgstRate,
      cgstAmount: line.cgstAmount,
      sgstRate: line.sgstRate,
      sgstAmount: line.sgstAmount,
      igstRate: line.igstRate,
      igstAmount: line.igstAmount,
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

  return { builder: 'invoice', data, filename: buildInvoiceFilename(data) }
}
