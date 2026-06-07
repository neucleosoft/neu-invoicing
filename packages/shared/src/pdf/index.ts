// Shared pdfmake document-definition builders. Each builder returns a plain
// pdfmake docDefinition object with zero platform dependencies; the consuming
// app feeds it to its own pdfmake instance (desktop directly, mobile via a
// hidden WebView). Helpers stay internal to the builders.

export type { PDFDocumentData, InvoiceData } from './types'

// Invoice builder also produces Quotation + Proforma (branched on data.type).
export { buildInvoiceDocDefinition, buildInvoiceFilename } from './invoice'

export { buildPurchaseBillDocDefinition, buildPurchaseBillFilename, type PurchaseBillData } from './purchaseBill'
export { buildPurchaseOrderDocDefinition, buildPurchaseOrderFilename, type PurchaseOrderData } from './purchaseOrder'
export { buildCreditNoteDocDefinition, buildCreditNoteFilename, type CreditNoteData } from './creditNote'
export { buildChallanDocDefinition, buildChallanFilename, type ChallanData } from './challan'
export {
  buildStatementDocDefinition,
  buildStatementFilename,
  type StatementData,
  type StatementLine,
} from './statement'
