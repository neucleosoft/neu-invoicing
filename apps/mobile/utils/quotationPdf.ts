// Assembles the InvoiceData shape the shared pdfmake builder expects from the
// local DB (quotation + its line items + customer + company), then returns the
// pdfmake docDefinition + filename. Quotation reuses the SAME shared 'invoice'
// builder as the sales invoice — it branches on data.type === 'QUOTATION'.
// The company logo lives base64 in company.logoPath (mobile stores images as
// base64 data-URIs), which drops straight into the builder's {image} node.

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

export async function buildQuotationPdfPayload(db: Db, quotationId: string): Promise<PdfPayload | null> {
  const [quote] = await db
    .select()
    .from(schema.quotation)
    .where(eq(schema.quotation.id, quotationId))
    .limit(1)
  if (!quote) return null

  const [cust] = await db
    .select()
    .from(schema.customer)
    .where(eq(schema.customer.id, quote.customerId))
    .limit(1)
  const [company] = await db.select().from(schema.company).limit(1)
  const lines = await db
    .select({ line: schema.quotationItem, prod: schema.item })
    .from(schema.quotationItem)
    .leftJoin(schema.item, eq(schema.quotationItem.itemId, schema.item.id))
    .where(eq(schema.quotationItem.quotationId, quotationId))

  const data: InvoiceData = {
    invoiceNumber: quote.invoiceNumber,
    invoiceDate: quote.invoiceDate.toISOString(),
    // The invoice builder labels dueDate "Expiry Date" for quote-like docs.
    dueDate: quote.dueDate ? quote.dueDate.toISOString() : undefined,
    deliveryTime: quote.deliveryTime ? quote.deliveryTime.toISOString() : undefined,
    type: 'QUOTATION',
    status: quote.status,
    subtotal: quote.subtotal,
    discount: quote.discount,
    taxAmount: quote.taxAmount,
    totalAmount: quote.totalAmount,
    // Quotations have no payments — they aren't a receivable yet.
    amountPaid: 0,
    balanceDue: 0,
    isInterState: quote.isInterState,
    reverseCharge: quote.reverseCharge,
    cgstAmount: quote.cgstAmount,
    sgstAmount: quote.sgstAmount,
    igstAmount: quote.igstAmount,
    cessAmount: quote.cessAmount,
    placeOfSupply: quote.placeOfSupply ?? undefined,
    placeOfSupplyName: quote.placeOfSupplyName ?? undefined,
    notes: quote.notes ?? undefined,
    termsConditions: quote.termsConditions ?? undefined,
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
