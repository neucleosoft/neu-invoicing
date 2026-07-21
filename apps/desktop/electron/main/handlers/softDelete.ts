// Soft-delete read filter (sync R8) — drizzle idiom, the exact mirror of
// apps/mobile/db/softDelete.ts since the Prisma→Drizzle migration. Rows are
// never removed — they get a `deletedAt` timestamp — so every user-facing
// read of a soft-deletable table must hide the deleted ones. Drizzle has no
// global query middleware, so the filter is added per query; these tiny
// helpers keep the intent identical everywhere and — crucially — greppable.
//
//   no existing WHERE:   .where(notDeleted(schema.customer.deletedAt))
//   with other conds:    .where(and(eq(...), notDeleted(schema.salesInvoice.deletedAt)))
//
// DO NOT apply to: number generators (must see deleted rows or numbers get
// reused), delete-guards, recompute/reverse reads, historical name look-ups,
// or one-time migrations/backfills.

import { and, creditDebitNote, gte, isNull, lte, sql, type Column, type DrizzleDbLike } from '@neu/shared'

export function notDeleted(deletedAt: Column) {
  return isNull(deletedAt)
}

// Cancel read filter (sync R8, Mode B). The 5 money documents are never
// deleted — they get a terminal `cancelledAt` timestamp whose balance/stock
// effect was already reversed. Every NUMBER (reports, GST, statements,
// recompute) must hide cancelled rows, exactly like notDeleted hides
// archived ones. Separate name so `notCancelled(` stays greppable.
export function notCancelled(cancelledAt: Column) {
  return isNull(cancelledAt)
}

// Credit-note netting for SALES/TAX SUMMARY reports. Credit notes live in
// their own table, so they're absent from every salesInvoice sum — a return
// or a reversed sale stays counted. This returns the net delta to ADD to a
// gross sales/tax figure for a period: a CREDIT_NOTE subtracts, a DEBIT_NOTE
// adds (the direction lives in `type`; stored amounts are always positive).
// Period is filtered by the note's own noteDate (GST-correct), excluding
// archived + cancelled notes. Do NOT use on receivables/ledgers — those
// already reflect credit notes via currentBalance/balanceDue.
export async function creditNoteNet(
  db: DrizzleDbLike,
  opts: { gte?: Date; lte?: Date; customerId?: string },
): Promise<{ totalAmount: number; taxAmount: number; subtotal: number; cgst: number; sgst: number; igst: number }> {
  const conds = [
    notDeleted(creditDebitNote.deletedAt),
    notCancelled(creditDebitNote.cancelledAt),
    sql`${creditDebitNote.status} = 'ACTIVE'`,
  ]
  if (opts.gte) conds.push(gte(creditDebitNote.noteDate, opts.gte))
  if (opts.lte) conds.push(lte(creditDebitNote.noteDate, opts.lte))
  if (opts.customerId) conds.push(sql`${creditDebitNote.customerId} = ${opts.customerId}`)

  const rows: {
    type: string
    subtotal: number
    taxAmount: number
    totalAmount: number
    cgstAmount: number
    sgstAmount: number
    igstAmount: number
  }[] = await db
    .select({
      type: creditDebitNote.type,
      subtotal: sql<number>`coalesce(sum(${creditDebitNote.subtotal}), 0)`,
      taxAmount: sql<number>`coalesce(sum(${creditDebitNote.taxAmount}), 0)`,
      totalAmount: sql<number>`coalesce(sum(${creditDebitNote.totalAmount}), 0)`,
      cgstAmount: sql<number>`coalesce(sum(${creditDebitNote.cgstAmount}), 0)`,
      sgstAmount: sql<number>`coalesce(sum(${creditDebitNote.sgstAmount}), 0)`,
      igstAmount: sql<number>`coalesce(sum(${creditDebitNote.igstAmount}), 0)`,
    })
    .from(creditDebitNote)
    .where(and(...conds))
    .groupBy(creditDebitNote.type)

  const sumFor = (t: string) => rows.find((r) => r.type === t)
  const cn = sumFor('CREDIT_NOTE')
  const dn = sumFor('DEBIT_NOTE')
  const d = (k: 'totalAmount' | 'taxAmount' | 'subtotal' | 'cgstAmount' | 'sgstAmount' | 'igstAmount') =>
    (dn?.[k] || 0) - (cn?.[k] || 0)
  return {
    totalAmount: d('totalAmount'),
    taxAmount: d('taxAmount'),
    subtotal: d('subtotal'),
    cgst: d('cgstAmount'),
    sgst: d('sgstAmount'),
    igst: d('igstAmount'),
  }
}
