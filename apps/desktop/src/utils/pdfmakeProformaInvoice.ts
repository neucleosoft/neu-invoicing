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

export function buildProformaInvoiceFilename(invoice: InvoiceData) {
  const pi = normalizeProformaInvoice(invoice)
  return `${sanitizeFilePart(pi.invoiceNumber)}_proforma_invoice_${sanitizeFilePart(pi.customer.name)}.pdf`
}

export function downloadProformaInvoicePDF(invoice: InvoiceData) {
  const proformaInvoice = normalizeProformaInvoice(invoice)
  const dd = buildClassicPDFDefinition(proformaInvoice)
  pdfMake.createPdf(dd).download(buildProformaInvoiceFilename(proformaInvoice))
}

export function previewProformaInvoicePDF(invoice: InvoiceData) {
  const proformaInvoice = normalizeProformaInvoice(invoice)
  const dd = buildClassicPDFDefinition(proformaInvoice)
  pdfMake.createPdf(dd).open()
}

export function getProformaInvoicePDFBytes(invoice: InvoiceData): Promise<Uint8Array> {
  const proformaInvoice = normalizeProformaInvoice(invoice)
  const dd = buildClassicPDFDefinition(proformaInvoice)
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
