// In-app recompute pass — thin app-facing wrapper. The WHOLE thing now lives
// in @neu/shared: engine math + diff/report in recompute.ts/recomputeReport.ts
// and the drizzle fetch/write shell in recomputeDb.ts (shared verbatim with
// desktop since the Prisma→Drizzle migration). This file only pins the app's
// Db type onto the shared function so call sites keep their signature.
//
// DRY RUN by default; { apply: true } writes back in one transaction. Read
// the dry-run diff before ever applying — recompute is only as honest as the
// documents it rebuilds from.

import {
  formatRecomputeReport,
  recomputeAllDb,
  type RecomputeReport,
} from '@neu/shared'

import { useDb } from '@/db'

type Db = ReturnType<typeof useDb>

export { formatRecomputeReport }
export type { RecomputeReport }

export const recomputeAll = (db: Db, opts: { apply?: boolean } = {}): Promise<RecomputeReport> =>
  recomputeAllDb(db, opts)
