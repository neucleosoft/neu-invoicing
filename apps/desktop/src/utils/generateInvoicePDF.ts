// All five invoice templates now render through pdfmake. Classic keeps the
// local builder (pdfmakeInvoice.ts, pending the C.3 shared unification);
// modern/minimal/elegant/bold come from the SHARED builders
// (packages/shared/src/pdf/invoiceTemplates.ts) — the same blueprints the
// mobile app renders, so a "modern" invoice matches across devices. The old
// jsPDF pixel-coordinate templates are gone: flow-based layouts paginate
// long invoices instead of overflowing a hand-measured page.

import pdfMake from 'pdfmake/build/pdfmake'
import { buildInvoiceDocDefinitionForTemplate, buildInvoiceFilename } from '@neu/shared'
import {
  downloadClassicPDF,
  getClassicPDFBytes,
  buildClassicPDFFilename,
  buildClassicPDFDefinition,
} from './pdfmakeInvoice'
import {
  downloadQuotationPDF,
  previewQuotationPDF,
  getQuotationPDFBytes,
  buildQuotationFilename,
} from './pdfmakeQuotation'
import {
  downloadProformaInvoicePDF,
  previewProformaInvoicePDF,
  getProformaInvoicePDFBytes,
  buildProformaInvoiceFilename,
} from './pdfmakeProformaInvoice'
import type { InvoiceData, InvoiceTemplate } from './pdfHelpers'

// Re-export so existing imports in Sales.tsx, Settings.tsx, etc. don't break
export type { InvoiceData, InvoiceTemplate } from './pdfHelpers'
export { TEMPLATE_INFO } from './pdfHelpers'

// pdfmake fonts are registered by the pdfmakeInvoice import's module
// side-effect, so this pdfMake instance is ready to use.

const buildTemplateDD = (invoice: InvoiceData, template: InvoiceTemplate) =>
  buildInvoiceDocDefinitionForTemplate(invoice as any, template)

const getPdfBytes = (dd: any): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(dd).getBuffer((buffer: any) => {
        resolve(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer))
      })
    } catch (err) {
      reject(err)
    }
  })

export function downloadInvoicePDF(invoice: InvoiceData, template: InvoiceTemplate = 'classic') {
  if (invoice.type === 'QUOTATION') {
    downloadQuotationPDF(invoice)
    return
  }
  if (invoice.type === 'PROFORMA_INVOICE') {
    downloadProformaInvoicePDF(invoice)
    return
  }
  if (template === 'classic') {
    downloadClassicPDF(invoice)
    return
  }
  if (!invoice.items) invoice.items = []
  pdfMake.createPdf(buildTemplateDD(invoice, template)).download(buildInvoiceFilename(invoice as any))
}

export async function getInvoicePDFBytes(
  invoice: InvoiceData,
  template: InvoiceTemplate = 'classic'
): Promise<{ bytes: Uint8Array; filename: string }> {
  if (!invoice.items) invoice.items = []

  // Quotation/Proforma always use the pdfmake Classic layout regardless of template.
  if (invoice.type === 'QUOTATION') {
    return { bytes: await getQuotationPDFBytes(invoice), filename: buildQuotationFilename(invoice) }
  }
  if (invoice.type === 'PROFORMA_INVOICE') {
    return {
      bytes: await getProformaInvoicePDFBytes(invoice),
      filename: buildProformaInvoiceFilename(invoice),
    }
  }

  if (template === 'classic') {
    return { bytes: await getClassicPDFBytes(invoice), filename: buildClassicPDFFilename(invoice) }
  }

  return {
    bytes: await getPdfBytes(buildTemplateDD(invoice, template)),
    filename: buildInvoiceFilename(invoice as any),
  }
}

export function previewInvoicePDF(invoice: InvoiceData, template: InvoiceTemplate = 'classic') {
  if (invoice.type === 'QUOTATION') {
    previewQuotationPDF(invoice)
    return
  }
  if (invoice.type === 'PROFORMA_INVOICE') {
    previewProformaInvoicePDF(invoice)
    return
  }
  if (!invoice.items) invoice.items = []
  const dd = template === 'classic' ? buildClassicPDFDefinition(invoice) : buildTemplateDD(invoice, template)
  pdfMake.createPdf(dd).open()
}
