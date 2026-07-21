// Bundled by scripts/build-pdf-harness.mjs (via esbuild) and inlined into the
// WebView harness HTML. This runs INSIDE the WebView, where pdfmake lives, so the
// docDefinition builders execute there — keeping their table-border FUNCTIONS
// intact. (Building in the app and JSON-serializing the docDefinition into the
// WebView silently drops every function, so pdfmake falls back to its default
// "draw all lines" layout — the extra grid lines bug.) The app sends only plain
// JSON data; the WebView turns it into the full docDefinition + renders it.

import { buildInvoiceDocDefinitionForTemplate } from '../../../packages/shared/src/pdf/invoiceTemplates'
import { buildPurchaseBillDocDefinition } from '../../../packages/shared/src/pdf/purchaseBill'
import { buildPurchaseOrderDocDefinition } from '../../../packages/shared/src/pdf/purchaseOrder'
import { buildCreditNoteDocDefinition } from '../../../packages/shared/src/pdf/creditNote'
import { buildChallanDocDefinition } from '../../../packages/shared/src/pdf/challan'
import { buildStatementDocDefinition } from '../../../packages/shared/src/pdf/statement'

// Keyed by builder name; the bridge calls __neuPdfBuilders[name](data).
// 'invoice' also serves quotations + proformas (data.type drives the branch)
// and all five visual templates (data.template drives the dispatch).
;(globalThis as Record<string, unknown>).__neuPdfBuilders = {
  invoice: buildInvoiceDocDefinitionForTemplate,
  purchaseBill: buildPurchaseBillDocDefinition,
  purchaseOrder: buildPurchaseOrderDocDefinition,
  creditNote: buildCreditNoteDocDefinition,
  challan: buildChallanDocDefinition,
  statement: buildStatementDocDefinition,
}
