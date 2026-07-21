// In-app recompute pass — thin app-facing wrapper. The WHOLE thing now lives
// in @neu/shared: engine math + diff/report in recompute.ts/recomputeReport.ts
// and the drizzle fetch/write shell in recomputeDb.ts (shared verbatim with
// mobile since the Prisma→Drizzle migration).
//
// This is the exact call the sync transport runs after a merge ("recompute
// after merge"). DRY RUN by default: reports what WOULD change and writes
// nothing. SAFETY: recompute is only as honest as the documents — read the
// dry-run diff before ever passing { apply: true }.

import {
  formatRecomputeReport,
  recomputeAllDb,
  type DrizzleDbLike,
  type RecomputeReport,
} from '@neu/shared'

export { formatRecomputeReport }
export type { RecomputeReport }

export const recomputeAll = (db: DrizzleDbLike, opts: { apply?: boolean } = {}): Promise<RecomputeReport> =>
  recomputeAllDb(db, opts)
