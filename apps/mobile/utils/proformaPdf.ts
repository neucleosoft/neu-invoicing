// Assembles the InvoiceData shape the shared pdfmake builder expects from the
// local DB (proforma invoice + its line items + customer + company), then
// returns the pdfmake docDefinition + filename. Proforma reuses the SAME shared
// 'invoice' builder as the sales invoice — it branches on
// data.type === 'PROFORMA_INVOICE'. The company logo lives base64 in
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

export async function buildProformaPdfPayload(db: Db, proformaId: string): Promise<PdfPayload | null> {
  const [doc] = await db
    .select()
    .from(schema.proformaInvoice)
    .where(eq(schema.proformaInvoice.id, proformaId))
    .limit(1)
  if (!doc) return null

  const [cust] = await db
    .select()
    .from(schema.customer)
    .where(eq(schema.customer.id, doc.customerId))
    .limit(1)
  const [company] = await db.select().from(schema.company).limit(1)
  const lines = await db
    .select({ line: schema.proformaInvoiceItem, prod: schema.item })
    .from(schema.proformaInvoiceItem)
    .leftJoin(schema.item, eq(schema.proformaInvoiceItem.itemId, schema.item.id))
    .where(eq(schema.proformaInvoiceItem.proformaInvoiceId, proformaId))

  const data: InvoiceData = {
    invoiceNumber: doc.invoiceNumber,
    invoiceDate: doc.invoiceDate.toISOString(),
    // The invoice builder labels dueDate "Expiry Date" for quote-like docs.
    dueDate: doc.dueDate ? doc.dueDate.toISOString() : undefined,
    deliveryTime: doc.deliveryTime ? doc.deliveryTime.toISOString() : undefined,
    type: 'PROFORMA_INVOICE',
    status: doc.status,
    subtotal: doc.subtotal,
    discount: doc.discount,
    taxAmount: doc.taxAmount,
    totalAmount: doc.totalAmount,
    // Proforma invoices have no payments — they aren't a receivable yet.
    amountPaid: 0,
    balanceDue: 0,
    isInterState: doc.isInterState,
    reverseCharge: doc.reverseCharge,
    cgstAmount: doc.cgstAmount,
    sgstAmount: doc.sgstAmount,
    igstAmount: doc.igstAmount,
    cessAmount: doc.cessAmount,
    placeOfSupply: doc.placeOfSupply ?? undefined,
    placeOfSupplyName: doc.placeOfSupplyName ?? undefined,
    notes: doc.notes ?? undefined,
    termsConditions: doc.termsConditions ?? undefined,
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
