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
