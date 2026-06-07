import { desc, like } from 'drizzle-orm'

import { schema, useDb } from '@/db'

// Sequential FY-scoped document numbers for the NS series (NS/{CODE}/{FY}/NN).
// Quotation = QT, Proforma = PI, Challan = DC — same algorithm as the invoice
// number generator (utils/invoiceNumber.ts), parameterized by series code +
// which table/column to scan. Mirrors desktop salesDocumentHelpers.ts.

type Db = ReturnType<typeof useDb>

function getFiscalYear(now: Date): string {
  const month = now.getMonth() + 1
  const year = now.getFullYear() % 100
  if (month >= 4) {
    return `${String(year).padStart(2, '0')}-${String(year + 1).padStart(2, '0')}`
  }
  return `${String(year - 1).padStart(2, '0')}-${String(year).padStart(2, '0')}`
}

// Generic NS-series generator. `column` is the number column to scan
// (quotation.invoiceNumber, proformaInvoice.invoiceNumber, deliveryChallan.challanNumber).
async function nextNsNumber(
  db: Db,
  seriesCode: string,
  table: any,
  column: any,
  now: Date,
): Promise<string> {
  const fy = getFiscalYear(now)
  const prefix = `NS/${seriesCode}/${fy}/`
  const rows = await db
    .select({ num: column })
    .from(table)
    .where(like(column, `${prefix}%`))
    .orderBy(desc(column))
    .limit(1)
  let n = 1
  const last = rows[0]?.num as string | undefined
  if (last) {
    const parsed = parseInt(last.split('/').pop() || '0', 10)
    if (!isNaN(parsed)) n = parsed + 1
  }
  return `${prefix}${String(n).padStart(2, '0')}`
}

export function generateQuotationNumber(db: Db, now: Date = new Date()): Promise<string> {
  return nextNsNumber(db, 'QT', schema.quotation, schema.quotation.invoiceNumber, now)
}

export function generateProformaNumber(db: Db, now: Date = new Date()): Promise<string> {
  return nextNsNumber(db, 'PI', schema.proformaInvoice, schema.proformaInvoice.invoiceNumber, now)
}

export function generateChallanNumber(db: Db, now: Date = new Date()): Promise<string> {
  return nextNsNumber(db, 'DC', schema.deliveryChallan, schema.deliveryChallan.challanNumber, now)
}
