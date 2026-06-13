import type { SQLiteDatabase } from 'expo-sqlite'

// One-time data repair: convert legacy ISO-8601 text dates to Unix-ms integers.
//
// Until 2026-06, the shared schema's date type wrote ISO text while Prisma (the
// desktop) writes integer milliseconds — so a desktop-born DB that was then
// edited on the phone holds BOTH dialects in the same column. SQLite orders all
// numbers before all text, so any SQL date sort/range over mixed rows is wrong,
// and sync's newest-edit-wins can't be built on such a column.
//
// This runs on every boot right after migrations. It only touches values that
// are text AND date-shaped (the GLOB filters out digit-string ms, which are a
// consistent dialect in mobile-born text-affinity columns and compare fine).
// julianday() parses ISO-8601 including the trailing Z; the IS NOT NULL guard
// means unparseable text is left alone rather than nulled. Each UPDATE is
// independent so one missing column (an old backup mid-upgrade) can't block
// the rest — whatever is skipped gets retried on the next launch.

const EPOCH_JULIAN_DAY = 2440587.5
const MS_PER_DAY = 86400000.0

// Every date column in the shared schema, by physical table name.
const DATE_COLUMNS: Record<string, string[]> = {
  Company: ['createdAt', 'updatedAt'],
  Party: ['lastGstFetch', 'createdAt', 'updatedAt'],
  Supplier: ['lastGstFetch', 'createdAt', 'updatedAt'],
  Item: ['createdAt', 'updatedAt'],
  SupplierItem: ['createdAt', 'updatedAt'],
  SalesInvoice: ['invoiceDate', 'dueDate', 'createdAt', 'updatedAt'],
  SalesInvoiceItem: ['createdAt'],
  Quotation: ['invoiceDate', 'dueDate', 'deliveryTime', 'createdAt', 'updatedAt'],
  QuotationItem: ['createdAt'],
  ProformaInvoice: ['invoiceDate', 'dueDate', 'deliveryTime', 'createdAt', 'updatedAt'],
  ProformaInvoiceItem: ['createdAt'],
  PurchaseOrder: ['orderDate', 'expectedDate', 'createdAt', 'updatedAt'],
  PurchaseOrderItem: ['createdAt'],
  PurchaseBill: ['billDate', 'supplierInvoiceDate', 'createdAt', 'updatedAt'],
  PurchaseBillItem: ['createdAt'],
  PaymentTransaction: ['paymentDate', 'createdAt'],
  StockMovement: ['createdAt'],
  SyncMetadata: ['lastSyncTimestamp', 'cloudFileModifiedTime', 'updatedAt'],
  Settings: ['createdAt', 'updatedAt'],
  DeliveryChallan: ['challanDate', 'createdAt', 'updatedAt'],
  DeliveryChallanItem: ['createdAt'],
  CreditDebitNote: ['noteDate', 'createdAt', 'updatedAt'],
  CreditDebitNoteItem: ['createdAt'],
  BankAccount: ['createdAt', 'updatedAt'],
  GstCache: ['fetchedAt', 'createdAt', 'updatedAt'],
  PreviousInvoice: ['invoiceDate', 'createdAt', 'updatedAt'],
  PreviousInvoiceItem: ['createdAt'],
}

export async function repairLegacyTextDates(sqlite: SQLiteDatabase): Promise<void> {
  let repaired = 0
  try {
    const tables = await sqlite.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    )
    const present = new Set(tables.map((t) => t.name))

    for (const [table, cols] of Object.entries(DATE_COLUMNS)) {
      if (!present.has(table)) continue
      for (const col of cols) {
        try {
          const res = await sqlite.runAsync(
            `UPDATE "${table}"
             SET "${col}" = CAST(ROUND((julianday("${col}") - ${EPOCH_JULIAN_DAY}) * ${MS_PER_DAY}) AS INTEGER)
             WHERE typeof("${col}") = 'text'
               AND "${col}" GLOB '[0-9][0-9][0-9][0-9]-*'
               AND julianday("${col}") IS NOT NULL`,
          )
          repaired += res.changes
        } catch (e) {
          console.warn(`[dateRepair] ${table}.${col} skipped:`, e)
        }
      }
    }
    if (repaired > 0) {
      console.log(`[dateRepair] converted ${repaired} legacy text dates to epoch ms`)
    }
  } catch (e) {
    // Reads stay tolerant of mixed dialects, so a failed repair degrades
    // gracefully — never block app launch on it.
    console.error('[dateRepair] failed, app continues:', e)
  }
}
