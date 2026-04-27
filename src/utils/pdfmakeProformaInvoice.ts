import pdfMake from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'

import { buildClassicPDFDefinition } from './pdfmakeInvoice'
import type { InvoiceData } from './pdfHelpers'

;(pdfMake as any).vfs = (pdfFonts as any).pdfMake?.vfs || pdfFonts

function sanitizeFilePart(value: string) {
  return value.replace(/[^a-z0-9]/gi, '_')
}

function normalizeProformaInvoice(invoice: InvoiceData): InvoiceData {
  return {
    ...invoice,
    type: 'PROFORMA_INVOICE',
    items: invoice.items || [],
  }
}

export function downloadProformaInvoicePDF(invoice: InvoiceData) {
  const proformaInvoice = normalizeProformaInvoice(invoice)
  const dd = buildClassicPDFDefinition(proformaInvoice)
  const filename = `${sanitizeFilePart(proformaInvoice.invoiceNumber)}_proforma_invoice_${sanitizeFilePart(proformaInvoice.party.name)}.pdf`
  pdfMake.createPdf(dd).download(filename)
}

export function previewProformaInvoicePDF(invoice: InvoiceData) {
  const proformaInvoice = normalizeProformaInvoice(invoice)
  const dd = buildClassicPDFDefinition(proformaInvoice)
  pdfMake.createPdf(dd).open()
}
