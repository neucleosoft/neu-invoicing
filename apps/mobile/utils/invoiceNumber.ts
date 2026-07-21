import { desc, like } from 'drizzle-orm'

import { schema, useDb } from '@/db'

// Sequential, FY-scoped invoice numbers — a faithful port of desktop's
// salesDocumentHelpers.ts generateNextInvoiceSeriesNumber. Format: NS/SL/{FY}/{seq}
// e.g. "NS/SL/26-27/05". The old mobile code used `INV-${Date.now()}`, which is
// neither sequential nor FY-scoped and leaks a raw millisecond timestamp onto
// every invoice + PDF. This restores the concept desktop uses.
//
// Why it must match desktop exactly: the two apps share one database, so an
// invoice created on the phone must slot into the same NS/SL/{FY}/NN series the
// desktop maintains, or the numbering collides/forks.

type Db = ReturnType<typeof useDb>

// The series segment for tax invoices. Hardcoded on desktop (NOT read from the
// company record), so mobile mirrors that — no company dependency needed.
const SERIES_CODE = 'SL'
const SERIES_ROOT = 'NS'

// Indian fiscal year runs April–March, written as two-digit "YY-YY".
// April 2026 → "26-27"; February 2026 → "25-26". Mirrors desktop getFiscalYear.
function getFiscalYear(now: Date): string {
  const month = now.getMonth() + 1 // 1-12
  const year = now.getFullYear() % 100 // two-digit
  if (month >= 4) {
    return `${String(year).padStart(2, '0')}-${String(year + 1).padStart(2, '0')}`
  }
  return `${String(year - 1).padStart(2, '0')}-${String(year).padStart(2, '0')}`
}

// Find the highest sequence already used under this FY's prefix and return the
// next one, zero-padded to 2 (matching desktop's padStart(2, '0')).
//
// `now` is injectable so callers/tests can pass a fixed date; defaults to the
// real current date.
export async function generateInvoiceNumber(db: Db, now: Date = new Date()): Promise<string> {
  const fy = getFiscalYear(now)
  const prefix = `${SERIES_ROOT}/${SERIES_CODE}/${fy}/`

  // Lexicographic desc on the zero-padded number is the same trick desktop uses
  // (orderBy invoiceNumber desc): within one FY prefix, "…/10" > "…/09" sorts
  // correctly because the numeric tail is fixed-width-padded.
  const rows = await db
    .select({ invoiceNumber: schema.salesInvoice.invoiceNumber })
    .from(schema.salesInvoice)
    .where(like(schema.salesInvoice.invoiceNumber, `${prefix}%`))
    .orderBy(desc(schema.salesInvoice.invoiceNumber))
    .limit(1)

  let nextNum = 1
  const last = rows[0]?.invoiceNumber
  if (last) {
    const lastPart = last.split('/').pop()
    const parsed = parseInt(lastPart || '0', 10)
    if (!isNaN(parsed)) nextNum = parsed + 1
  }

  return `${prefix}${String(nextNum).padStart(2, '0')}`
}
