// Maps a computed LedgerData (customer ledger, supplier ledger, or date-sliced
// customer statement) onto the shared `statement` pdfmake builder's StatementData
// shape, then returns the { builder, data, filename } payload the HiddenPdfWebView
// expects. The one shared builder powers all three docs — they differ only by the
// `title` and the party put in the `customer` field (even for a supplier, the
// builder's letterhead reads from `customer`, so the supplier's details go there).
//
// The company logo lives base64 in company.logoPath (mobile stores images as
// base64 data-URIs), which drops straight into the builder's {image} node.

import {
  buildStatementFilename,
  type StatementData,
  type StatementLine,
} from '@neu/shared'
import { schema, useDb } from '@/db'
import type { LedgerData } from '@/utils/ledger'

type Db = ReturnType<typeof useDb>

export interface StatementPdfOptions {
  ledger: LedgerData
  party: {
    name: string
    email?: string
    phone?: string
    billingAddress?: string
    taxId?: string
  }
  title: string
  fromDate?: string
  toDate?: string
}

export interface StatementPdfPayload {
  builder: 'statement'
  data: StatementData
  filename: string
}

export async function buildStatementPdfPayload(
  db: Db,
  opts: StatementPdfOptions,
): Promise<StatementPdfPayload> {
  const [company] = await db.select().from(schema.company).limit(1)

  const lines: StatementLine[] = opts.ledger.rows.map((row) => ({
    date: row.date.toISOString(),
    // StatementLine.type is NOT rendered; the ledger union ('BILL') is wider than
    // the statement union, so cast the type across as-is.
    type: row.type as StatementLine['type'],
    number: row.number,
    particulars: row.particulars,
    debit: row.debit,
    credit: row.credit,
    balance: row.balance,
  }))

  // Default the period to the first/last visible row's date when no explicit
  // range was passed (all-time ledgers have no caller-supplied window). With no
  // rows at all, fall back to '' — the builder's formatDate handles empty input.
  const firstRowDate = opts.ledger.rows[0]?.date.toISOString() ?? ''
  const lastRowDate = opts.ledger.rows[opts.ledger.rows.length - 1]?.date.toISOString() ?? ''

  const data: StatementData = {
    customer: opts.party,
    company: company
      ? {
          name: company.name,
          address: company.address ?? undefined,
          phone: company.phone ?? undefined,
          email: company.email ?? undefined,
          taxId: company.taxId ?? undefined,
          logoBase64: company.logoPath ?? undefined,
        }
      : undefined,
    fromDate: opts.fromDate ?? firstRowDate,
    toDate: opts.toDate ?? lastRowDate,
    openingBalance: opts.ledger.openingBalance,
    lines,
    totalDebit: opts.ledger.totalDebit,
    totalCredit: opts.ledger.totalCredit,
    closingBalance: opts.ledger.closingBalance,
    title: opts.title,
  }

  return { builder: 'statement', data, filename: buildStatementFilename(data) }
}
