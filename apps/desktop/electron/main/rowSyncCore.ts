// Row-sync core — the electron-free half of desktop's sync plumbing: Prisma
// fetches (collect + local index) and mechanical plan execution. Split from
// rowSync.ts so the sandbox runner (scripts/) can drive the REAL code path
// against throwaway database copies without pulling in electron. rowSync.ts
// keeps the Drive IO, auth, and IPC shell.

import {
  buildDiary,
  hlcLowerBound,
  reviveRowDates,
  toEpochMs,
  SYNC_DOCUMENT_TABLES,
  SYNC_SINGLE_TABLES,
  type ApplyPlan,
  type DocumentBundle,
  type LocalIndex,
} from '@neu/shared'

// Push everything changed in this window; peers dedupe/skip what they have.
export const DIARY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export const diaryFileName = (deviceId: string) => `changes-${deviceId}.json`

export interface RowSyncResult {
  success: boolean
  error?: string
  /** D6 tripwire: the pull wants to remove this many live rows — nothing was
   *  applied or pushed; re-run with confirmRemovals after the user agrees. */
  needsConfirmation?: boolean
  removalsPending?: number
  pushedPackets?: number
  applied?: number
  skipped?: number
  localRenumbers?: number
  removalsApplied?: number
  recomputeChanges?: number
  photosPushed?: number
  log?: { kind: string; table: string; rowId: string; detail: string }[]
}

// Rows changed inside the window. Stamped rows key the window on hlc — the
// ratchet's physical part can never jump backwards, so a wall-clock reset
// can't strand edits outside the diary (with updatedAt alone, a clock fixed
// after a >30-day-backwards reset left those edits stamped out of the window
// FOREVER — never pushed). Legacy rows (hlc null: never written since the
// column landed) keep the wall-clock branch. The `updatedAt: null` sub-branch
// exists only for paymentTransaction (nullable for legacy rows) — Prisma
// REJECTS a null filter on non-nullable columns, so every other table gets
// the plain comparison. (Caught by the two-device sandbox, 2026-07-11.)
const changedSince = (cutoff: Date, nullableUpdatedAt: boolean, hlcCutoff: string) => ({
  OR: [
    { hlc: { gt: hlcCutoff } },
    ...(nullableUpdatedAt
      ? [
          { hlc: null, updatedAt: { gt: cutoff } },
          { hlc: null, updatedAt: null, createdAt: { gt: cutoff } },
        ]
      : [{ hlc: null, updatedAt: { gt: cutoff } }]),
  ],
})

// ── Collect (push side) ──────────────────────────────────────────────────────

export async function collectDiary(prisma: any, deviceId: string, now: number) {
  const cutoff = new Date(now - DIARY_WINDOW_MS)
  const hlcCutoff = hlcLowerBound(now - DIARY_WINDOW_MS)

  const singles: Record<string, Record<string, unknown>[]> = {}
  for (const table of SYNC_SINGLE_TABLES) {
    singles[table] = await prisma[table].findMany({
      where: changedSince(cutoff, table === 'paymentTransaction', hlcCutoff),
    })
  }

  const documents: Record<string, DocumentBundle[]> = {}
  for (const spec of SYNC_DOCUMENT_TABLES) {
    const headers = await prisma[spec.table].findMany({ where: changedSince(cutoff, false, hlcCutoff) })
    if (headers.length === 0) continue
    const ids = headers.map((h: any) => h.id)
    const children = await prisma[spec.childTable].findMany({ where: { [spec.childFk]: { in: ids } } })
    const movements = spec.movementRef
      ? await prisma.stockMovement.findMany({ where: { referenceType: spec.movementRef, referenceId: { in: ids } } })
      : []
    documents[spec.table] = headers.map((h: any) => ({
      header: h,
      children: children.filter((c: any) => c[spec.childFk] === h.id),
      ...(spec.movementRef
        ? { movements: movements.filter((m: any) => m.referenceId === h.id) }
        : {}),
    }))
  }

  return buildDiary({ device: deviceId, now, singles: singles as any, documents })
}

// ── Local index (pull side input) ────────────────────────────────────────────

export async function buildLocalIndex(prisma: any): Promise<LocalIndex> {
  const headers: LocalIndex['headers'] = {}
  const numbers: NonNullable<LocalIndex['numbers']> = {}

  const indexTable = async (table: string, numberColumn?: string) => {
    // purchaseBill / previousInvoice rows carry BLOBs — never load those just
    // to build an id→timestamp index (a full archive would be hundreds of MB).
    const rows =
      table === 'purchaseBill'
        ? await prisma.purchaseBill.findMany({
            select: { id: true, billNumber: true, hlc: true, updatedAt: true, createdAt: true, deletedAt: true, cancelledAt: true, status: true },
          })
        : table === 'previousInvoice'
          ? await prisma.previousInvoice.findMany({
              select: { id: true, serialNumber: true, hlc: true, updatedAt: true, createdAt: true, deletedAt: true },
            })
          : await prisma[table].findMany()
    headers[table] = {}
    if (numberColumn) numbers[table] = {}
    for (const r of rows) {
      headers[table][r.id] = {
        // Same fallback the collector uses when stamping packets: a legacy
        // null updatedAt compares as createdAt, so an unchanged row is
        // NOT_NEWER instead of re-applying on every sync.
        updatedAt: toEpochMs(r.updatedAt) ?? toEpochMs(r.createdAt),
        hlc: r.hlc ?? null,
        createdAt: toEpochMs(r.createdAt),
        deletedAt: toEpochMs(r.deletedAt),
        cancelledAt: toEpochMs(r.cancelledAt),
        status: r.status ?? null,
      }
      const num = numberColumn ? r[numberColumn] : null
      if (numberColumn && num != null) {
        numbers[table][String(num)] = { rowId: r.id, createdAt: toEpochMs(r.createdAt) }
      }
    }
  }

  for (const table of SYNC_SINGLE_TABLES) await indexTable(table)
  for (const spec of SYNC_DOCUMENT_TABLES) await indexTable(spec.table, spec.numberColumn)

  return { headers, numbers }
}

// ── Execute (pull side output) ───────────────────────────────────────────────

export async function executePlan(prisma: any, plan: ApplyPlan, nextHlc?: () => string | null): Promise<void> {
  if (plan.upserts.length === 0 && plan.localRenumbers.length === 0) return
  await prisma.$transaction(async (tx: any) => {
    // Local renumbers FIRST: the incoming doc that keeps the number cannot be
    // inserted while the local later-created doc still holds it (UNIQUE fires
    // at statement time). @updatedAt auto-bumps here, and the hlc stamp is
    // explicit (not left to the client extension) so the renumber propagates
    // on the next push even when this runs without the extension (sandbox).
    for (const r of plan.localRenumbers) {
      const data: Record<string, unknown> = { [r.column]: r.to }
      const stamp = nextHlc?.()
      if (stamp) data.hlc = stamp
      await tx[r.table].update({ where: { id: r.rowId }, data })
    }

    for (const u of plan.upserts) {
      const data = reviveRowDates(u.row)
      let createData = data
      let updateData = data
      // previousInvoice's NOT-NULL fileData is stripped from packets: inserts
      // get the empty-blob sentinel ("on Drive, not fetched yet"); updates
      // must NEVER touch fileData, or a packet would wipe a fetched file.
      if (u.table === 'previousInvoice' && !('fileData' in data)) {
        createData = { ...data, fileData: Buffer.alloc(0) }
      }
      if (u.table === 'previousInvoice' && 'fileData' in updateData) {
        const { fileData: _dropped, ...rest } = updateData
        updateData = rest
      }
      await tx[u.table].upsert({ where: { id: u.rowId }, create: createData, update: updateData })
      if (u.children) {
        await tx[u.children.table].deleteMany({ where: { [u.children.fk]: u.rowId } })
        if (u.children.rows.length) {
          await tx[u.children.table].createMany({ data: u.children.rows.map(reviveRowDates) })
        }
      }
      if (u.movements) {
        await tx.stockMovement.deleteMany({
          where: { referenceType: u.movements.referenceType, referenceId: u.movements.referenceId },
        })
        if (u.movements.rows.length) {
          await tx.stockMovement.createMany({ data: u.movements.rows.map(reviveRowDates) })
        }
      }
    }
  }, {
    // A first big pull can be hundreds of doc packets; Prisma's default 5s
    // interactive-transaction timeout would wedge sync at exactly the data
    // volume where it matters.
    maxWait: 10_000,
    timeout: 120_000,
  })
}
