import { isNull, type Column } from 'drizzle-orm'

// Soft-delete read filter (sync R8). Rows are never removed — they get a
// `deletedAt` timestamp — so every user-facing read of a soft-deletable table
// must hide the deleted ones. Drizzle has no global query middleware, so the
// filter is added per query; this one tiny helper keeps the intent identical
// everywhere and — crucially — makes it greppable. After wiring, grep
// `notDeleted(` against the list of soft-deletable tables to PROVE no read leaked.
//
//   no existing WHERE:   .where(notDeleted(schema.customer.deletedAt))
//   with other conds:    .where(and(eq(...), notDeleted(schema.salesInvoice.deletedAt)))
//   join lists:          filter the PRIMARY table only — never the name-join,
//                        so a deleted customer still renders its name on old docs.
//
// DO NOT apply to: number generators (must see deleted rows or numbers get
// reused), delete-guards, recompute/reverse reads, historical name look-ups, or
// the future Trash screen (which queries the inverse, deletedAt IS NOT NULL).
export function notDeleted(deletedAt: Column) {
  return isNull(deletedAt)
}
