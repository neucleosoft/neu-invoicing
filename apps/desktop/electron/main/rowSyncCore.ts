// Row-sync core — the electron-free half of desktop's sync plumbing: Prisma
// fetches (collect + local index) and mechanical plan execution. Split from
// rowSync.ts so the sandbox runner (scripts/) can drive the REAL code path
// against throwaway database copies without pulling in electron. rowSync.ts
// keeps the Drive IO, auth, and IPC shell.

import {
  buildDiary,
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
  pushedPackets?: number
  applied?: number
  skipped?: number
  localRenumbers?: number
  removalsApplied?: number
  recomputeChanges?: number
  log?: { kind: string; table: string; rowId: string; detail: string }[]
}

// Rows changed inside the window. The `updatedAt: null` branch exists only for
// paymentTransaction (its updatedAt is nullable for legacy rows) — Prisma
// REJECTS a null filter on non-nullable columns, so every other table gets the
// plain comparison. (Caught by the two-device sandbox, 2026-07-11.)
const changedSince = (cutoff: Date, nullableUpdatedAt: boolean) =>
  nullableUpdatedAt
    ? { OR: [{ updatedAt: { gt: cutoff } }, { updatedAt: null, createdAt: { gt: cutoff } }] }
    : { updatedAt: { gt: cutoff } }

// ── Collect (push side) ──────────────────────────────────────────────────────

export async function collectDiary(prisma: any, deviceId: string, now: number) {
  const cutoff = new Date(now - DIARY_WINDOW_MS)

  const singles: Record<string, Record<string, unknown>[]> = {}
  for (const table of SYNC_SINGLE_TABLES) {
    singles[table] = await prisma[table].findMany({
      where: changedSince(cutoff, table === 'paymentTransaction'),
    })
  }

  const documents: Record<string, DocumentBundle[]> = {}
  for (const spec of SYNC_DOCUMENT_TABLES) {
    const headers = await prisma[spec.table].findMany({ where: changedSince(cutoff, false) })
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
    // purchaseBill rows carry the scanned-bill BLOB — never load those just to
    // build an id→timestamp index (a full archive would be hundreds of MB).
    const rows =
      table === 'purchaseBill'
        ? await prisma.purchaseBill.findMany({
            select: { id: true, billNumber: true, updatedAt: true, createdAt: true, deletedAt: true, cancelledAt: true, status: true },
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

export async function executePlan(prisma: any, plan: ApplyPlan): Promise<void> {
  if (plan.upserts.length === 0 && plan.localRenumbers.length === 0) return
  await prisma.$transaction(async (tx: any) => {
    // Local renumbers FIRST: the incoming doc that keeps the number cannot be
    // inserted while the local later-created doc still holds it (UNIQUE fires
    // at statement time). @updatedAt auto-bumps here, so the renumber
    // propagates on the next push.
    for (const r of plan.localRenumbers) {
      await tx[r.table].update({ where: { id: r.rowId }, data: { [r.column]: r.to } })
    }

    for (const u of plan.upserts) {
      const data = reviveRowDates(u.row)
      await tx[u.table].upsert({ where: { id: u.rowId }, create: data, update: data })
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
