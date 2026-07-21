// Assembles the CreditNoteData shape the shared pdfmake builder expects from the
// local DB (note + its line items + customer + company + optional referenced
// invoice), then returns the builder name + plain data + filename. The SAME
// builder produces Credit Note AND Debit Note — branched on `type`, which we
// pass straight through from the row. The company logo lives base64 in
// company.logoPath (mobile stores images as base64 data-URIs), which drops
// straight into the builder's {image} node.

import { eq } from 'drizzle-orm'

import { buildCreditNoteFilename, type CreditNoteData } from '@neu/shared'
import { schema, useDb } from '@/db'

type Db = ReturnType<typeof useDb>

export interface CreditNotePdfPayload {
  // The WebView builds the docDefinition from this plain data (see HiddenPdfWebView).
  builder: 'creditNote'
  data: CreditNoteData
  filename: string
}

export async function buildCreditNotePdfPayload(
  db: Db,
  id: string,
): Promise<CreditNotePdfPayload | null> {
  const [note] = await db
    .select()
    .from(schema.creditDebitNote)
    .where(eq(schema.creditDebitNote.id, id))
    .limit(1)
  if (!note) return null

  const [cust] = await db
    .select()
    .from(schema.customer)
    .where(eq(schema.customer.id, note.customerId))
    .limit(1)
  const [company] = await db.select().from(schema.company).limit(1)
  const lines = await db
    .select({ line: schema.creditDebitNoteItem, prod: schema.item })
    .from(schema.creditDebitNoteItem)
    .leftJoin(schema.item, eq(schema.creditDebitNoteItem.itemId, schema.item.id))
    .where(eq(schema.creditDebitNoteItem.creditDebitNoteId, id))

  let referenceInvoice: CreditNoteData['referenceInvoice']
  if (note.referenceInvoiceId) {
    const [inv] = await db
      .select()
      .from(schema.salesInvoice)
      .where(eq(schema.salesInvoice.id, note.referenceInvoiceId))
      .limit(1)
    if (inv) {
      referenceInvoice = {
        invoiceNumber: inv.invoiceNumber,
        invoiceDate: inv.invoiceDate.toISOString(),
        totalAmount: inv.totalAmount,
      }
    }
  }

  const data: CreditNoteData = {
    noteNumber: note.noteNumber,
    noteDate: note.noteDate.toISOString(),
    type: note.type === 'DEBIT_NOTE' ? 'DEBIT_NOTE' : 'CREDIT_NOTE',
    reason: note.reason ?? undefined,
    notes: note.notes ?? undefined,
    termsConditions: note.termsConditions ?? undefined,
    totalAmount: note.totalAmount,
    subtotal: note.subtotal,
    taxAmount: note.taxAmount,
    isInterState: note.isInterState,
    customer: {
      name: cust?.name ?? 'Customer',
      taxId: cust?.taxId ?? undefined,
      phone: cust?.phone ?? undefined,
      email: cust?.email ?? undefined,
      billingAddress: cust?.billingAddress ?? undefined,
      shippingAddress: cust?.shippingAddress ?? undefined,
    },
    referenceInvoice,
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

  return { builder: 'creditNote', data, filename: buildCreditNoteFilename(data) }
}
