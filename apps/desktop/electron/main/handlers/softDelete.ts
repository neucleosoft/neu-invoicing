// Soft-delete read filter (sync R8). Rows are never removed — they get a
// `deletedAt` timestamp — so every user-facing read of a soft-deletable table
// must hide the deleted ones. We use an explicit reusable fragment rather than a
// global Prisma extension on purpose: too many paths must KEEP seeing deleted
// rows (number generators, the duplicate-number uniqueness check, recompute/
// reverse-effect reads, delete-guards, migrations/backfills), and a global filter
// would silently break those data-integrity-critical paths.
//
//   list/report read:    where: { type: 'INVOICE', ...notDeleted }
//   soft-deletable child: include: { salesInvoices: { ...notDeletedWhere, take: 10 } }
//
// DO NOT spread into: number generators, the challanNumber uniqueness check,
// recompute/reverse reads, delete-guards, or one-time migrations/backfills.
export const notDeleted = { deletedAt: null } as const

// For nested `include` relations whose child is itself a soft-deletable table.
export const notDeletedWhere = { where: { deletedAt: null } } as const

// Cancel read filter (sync R8, Mode B). The 5 money documents are never deleted —
// they get a terminal `cancelledAt` timestamp whose balance/stock effect was
// already reversed. So every NUMBER (reports, GST, statements, recompute) must hide
// cancelled rows, exactly like notDeleted hides archived ones. Separate name so the
// intent is clear and `notCancelled` is greppable. Spread BOTH into a where to
// exclude archived AND cancelled: `where: { ...notDeleted, ...notCancelled }`.
export const notCancelled = { cancelledAt: null } as const
export const notCancelledWhere = { where: { cancelledAt: null } } as const

// Credit-note netting for SALES/TAX SUMMARY reports. Credit notes live in their own
// table, so they're absent from every salesInvoice sum — a return or a reversed sale
// stays counted. This returns the net delta to ADD to a gross sales/tax figure for a
// period: a CREDIT_NOTE subtracts, a DEBIT_NOTE adds (the direction lives in `type`;
// stored amounts are always positive). Period is filtered by the note's own noteDate
// (GST-correct — the credit lands when the note is issued), excluding archived +
// cancelled notes. Do NOT use on receivables/ledgers — those already reflect credit
// notes via currentBalance/balanceDue.
export async function creditNoteNet(
  prisma: any,
  opts: { gte?: Date; lte?: Date; customerId?: string },
): Promise<{ totalAmount: number; taxAmount: number; subtotal: number; cgst: number; sgst: number; igst: number }> {
  const where: any = { ...notDeleted, ...notCancelled, status: 'ACTIVE' }
  if (opts.gte || opts.lte) {
    where.noteDate = {}
    if (opts.gte) where.noteDate.gte = opts.gte
    if (opts.lte) where.noteDate.lte = opts.lte
  }
  if (opts.customerId) where.customerId = opts.customerId
  const rows = await prisma.creditDebitNote.groupBy({
    by: ['type'],
    where,
    _sum: { subtotal: true, taxAmount: true, totalAmount: true, cgstAmount: true, sgstAmount: true, igstAmount: true },
  })
  const sumFor = (t: string) => rows.find((r: any) => r.type === t)?._sum ?? {}
  const cn: any = sumFor('CREDIT_NOTE')
  const dn: any = sumFor('DEBIT_NOTE')
  const d = (k: string) => (dn[k] || 0) - (cn[k] || 0)
  return {
    totalAmount: d('totalAmount'),
    taxAmount: d('taxAmount'),
    subtotal: d('subtotal'),
    cgst: d('cgstAmount'),
    sgst: d('sgstAmount'),
    igst: d('igstAmount'),
  }
}
