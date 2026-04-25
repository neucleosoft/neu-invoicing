import pdfMake from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'

import { buildClassicPDFDefinition } from './pdfmakeInvoice'
import type { InvoiceData } from './pdfHelpers'

;(pdfMake as any).vfs = (pdfFonts as any).pdfMake?.vfs || pdfFonts

function sanitizeFilePart(value: string) {
  return value.replace(/[^a-z0-9]/gi, '_')
}

function normalizeQuotation(invoice: InvoiceData): InvoiceData {
  return {
    ...invoice,
    type: 'QUOTATION',
    items: invoice.items || [],
  }
}

export function downloadQuotationPDF(invoice: InvoiceData) {
  const quotation = normalizeQuotation(invoice)
  const dd = buildClassicPDFDefinition(quotation)
  const filename = `${sanitizeFilePart(quotation.invoiceNumber)}_quotation_${sanitizeFilePart(quotation.party.name)}.pdf`
  pdfMake.createPdf(dd).download(filename)
}

export function previewQuotationPDF(invoice: InvoiceData) {
  const quotation = normalizeQuotation(invoice)
  const dd = buildClassicPDFDefinition(quotation)
  pdfMake.createPdf(dd).open()
}
