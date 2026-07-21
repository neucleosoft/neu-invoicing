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

export function buildQuotationFilename(invoice: InvoiceData) {
  const q = normalizeQuotation(invoice)
  return `${sanitizeFilePart(q.invoiceNumber)}_quotation_${sanitizeFilePart(q.customer.name)}.pdf`
}

export function downloadQuotationPDF(invoice: InvoiceData) {
  const quotation = normalizeQuotation(invoice)
  const dd = buildClassicPDFDefinition(quotation)
  pdfMake.createPdf(dd).download(buildQuotationFilename(quotation))
}

export function previewQuotationPDF(invoice: InvoiceData) {
  const quotation = normalizeQuotation(invoice)
  const dd = buildClassicPDFDefinition(quotation)
  pdfMake.createPdf(dd).open()
}

export function getQuotationPDFBytes(invoice: InvoiceData): Promise<Uint8Array> {
  const quotation = normalizeQuotation(invoice)
  const dd = buildClassicPDFDefinition(quotation)
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(dd).getBuffer((buffer: any) => {
        resolve(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer))
      })
    } catch (err) {
      reject(err)
    }
  })
}
