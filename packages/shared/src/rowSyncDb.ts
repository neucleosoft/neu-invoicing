// Row-sync DB layer — the drizzle half of sync, shared VERBATIM by mobile
// (expo-sqlite) and desktop (libsql). Lifted out of apps/mobile/sync/rowSync.ts
// during the Prisma→Drizzle desktop migration: both apps now run the exact
// same collect / local-index / execute code against the shared schema, so the
// two sides of a sync can never disagree about how a diary is built or applied.
//
// Pure DB mechanics only — Drive IO, auth, activity receipts, and the sync
// flow stay app-specific. Works with ANY async drizzle SQLite driver (both
// expo-sqlite and libsql transactions are `async (tx) => …`).

import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm'

import * as schema from './schema'
import { hlcLowerBound } from './hlc'
import {
  buildDiary,
  reviveRowDates,
  toEpochMs,
  SYNC_DOCUMENT_TABLES,
  SYNC_SINGLE_TABLES,
  type DocumentBundle,
  type SyncDiary,
} from './syncPackets'
import type { ApplyPlan, LocalIndex } from './syncApply'

/** Any async drizzle SQLite database (expo-sqlite, libsql). Structural and
 *  deliberately loose — the same trick paymentLogic's DrizzleTx uses. */
export interface DrizzleDbLike {
  select: (...args: any[]) => any
  insert: (...args: any[]) => any
  update: (...args: any[]) => any
  delete: (...args: any[]) => any
  transaction: (...args: any[]) => any
}

// Push everything changed in this window; peers dedupe/skip what they have.
export const DIARY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export const diaryFileName = (deviceId: string) => `changes-${deviceId}.json`

/**
 * Change-detection fingerprint of a diary's CONTENT. Hashes only the packets
 * — the envelope's generatedAt changes on every collection, so hashing the
 * whole file would report "changed" every tick. Lets the 1-minute auto-sync
 * skip re-uploading an identical diary (a quiet shop day would otherwise
 * rewrite the same Drive file ~1,440 times). FNV-1a run twice with different
 * seeds (~64 bits) — change detection, not cryptography; a collision merely
 * delays a push until the next edit.
 */
export function diaryFingerprint(diary: SyncDiary): string {
  const s = JSON.stringify(diary.packets)
  const fnv = (seed: number): number => {
    let h = seed >>> 0
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h >>> 0
  }
  return `${fnv(0x811c9dc5).toString(36)}-${fnv(0x1234abcd).toString(36)}-${s.length.toString(36)}`
}

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

const tableOf = (name: string): any => (schema as Record<string, any>)[name]

// Rows changed inside the window. Stamped rows key the window on hlc — the
// ratchet's physical part can never jump backwards, so a wall-clock reset
// can't strand edits outside the diary forever. Legacy rows (hlc null: never
// written since the column landed) keep the wall-clock branch; its isNull
// sub-branch only matters for payment rows minted before updatedAt existed.
const changedSince = (table: any, cutoff: Date, hlcCutoff: string) =>
  or(
    gt(table.hlc, hlcCutoff),
    and(isNull(table.hlc), gt(table.updatedAt, cutoff)),
    and(isNull(table.hlc), isNull(table.updatedAt), gt(table.createdAt, cutoff)),
  )

// ── Collect (push side) ──────────────────────────────────────────────────────

export async function collectDiaryDb(db: DrizzleDbLike, deviceId: string, now: number): Promise<SyncDiary> {
  const cutoff = new Date(now - DIARY_WINDOW_MS)
  const hlcCutoff = hlcLowerBound(now - DIARY_WINDOW_MS)

  const singles: Record<string, Record<string, unknown>[]> = {}
  for (const name of SYNC_SINGLE_TABLES) {
    const table = tableOf(name)
    singles[name] = await db.select().from(table).where(changedSince(table, cutoff, hlcCutoff))
  }

  const documents: Record<string, DocumentBundle[]> = {}
  for (const spec of SYNC_DOCUMENT_TABLES) {
    const table = tableOf(spec.table)
    const headers: any[] = await db.select().from(table).where(changedSince(table, cutoff, hlcCutoff))
    if (headers.length === 0) continue
    const ids = headers.map((h) => h.id)
    const childTable = tableOf(spec.childTable)
    const children: any[] = await db.select().from(childTable).where(inArray(childTable[spec.childFk], ids))
    const movements: any[] = spec.movementRef
      ? await db
          .select()
          .from(schema.stockMovement)
          .where(and(eq(schema.stockMovement.referenceType, spec.movementRef), inArray(schema.stockMovement.referenceId, ids)))
      : []
    documents[spec.table] = headers.map((h) => ({
      header: h,
      children: children.filter((c) => c[spec.childFk] === h.id),
      ...(spec.movementRef ? { movements: movements.filter((m) => m.referenceId === h.id) } : {}),
    }))
  }

  return buildDiary({ device: deviceId, now, singles: singles as any, documents })
}

// ── Local index (pull side input) ────────────────────────────────────────────

export async function buildLocalIndexDb(db: DrizzleDbLike): Promise<LocalIndex> {
  const headers: LocalIndex['headers'] = {}
  const numbers: NonNullable<LocalIndex['numbers']> = {}

  const indexTable = async (name: string, numberColumn?: string) => {
    // purchaseBill / previousInvoice rows carry BLOBs — never load those just
    // to build an id→timestamp index (a real archive would be hundreds of MB).
    const rows: any[] =
      name === 'purchaseBill'
        ? await db
            .select({
              id: schema.purchaseBill.id,
              billNumber: schema.purchaseBill.billNumber,
              hlc: schema.purchaseBill.hlc,
              updatedAt: schema.purchaseBill.updatedAt,
              createdAt: schema.purchaseBill.createdAt,
              deletedAt: schema.purchaseBill.deletedAt,
              cancelledAt: schema.purchaseBill.cancelledAt,
              status: schema.purchaseBill.status,
            })
            .from(schema.purchaseBill)
        : name === 'previousInvoice'
          ? await db
              .select({
                id: schema.previousInvoice.id,
                serialNumber: schema.previousInvoice.serialNumber,
                hlc: schema.previousInvoice.hlc,
                updatedAt: schema.previousInvoice.updatedAt,
                createdAt: schema.previousInvoice.createdAt,
                deletedAt: schema.previousInvoice.deletedAt,
              })
              .from(schema.previousInvoice)
          : await db.select().from(tableOf(name))
    headers[name] = {}
    if (numberColumn) numbers[name] = {}
    for (const r of rows) {
      headers[name][r.id] = {
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
        numbers[name][String(num)] = { rowId: r.id, createdAt: toEpochMs(r.createdAt) }
      }
    }
  }

  for (const name of SYNC_SINGLE_TABLES) await indexTable(name)
  for (const spec of SYNC_DOCUMENT_TABLES) await indexTable(spec.table, spec.numberColumn)

  return { headers, numbers }
}

// ── Execute (pull side output) ───────────────────────────────────────────────

export async function executePlanDb(db: DrizzleDbLike, plan: ApplyPlan): Promise<void> {
  if (plan.upserts.length === 0 && plan.localRenumbers.length === 0) return
  await db.transaction(async (tx: any) => {
    // Local renumbers FIRST: the incoming doc that keeps the number cannot be
    // inserted while the local later-created doc still holds it (UNIQUE fires
    // at statement time). $onUpdate auto-bumps updatedAt AND hlc here, so the
    // renumber propagates on the next push.
    for (const r of plan.localRenumbers) {
      const table = tableOf(r.table)
      await tx.update(table).set({ [r.column]: r.to }).where(eq(table.id, r.rowId))
    }

    for (const u of plan.upserts) {
      const table = tableOf(u.table)
      const data = reviveRowDates(u.row)
      // Apply must land the row EXACTLY as the packet says: a legacy packet
      // without hlc lands with hlc null — explicit, so the schema's
      // $defaultFn/$onUpdate can't mint a local stamp for a peer's row.
      if (!('hlc' in data)) data.hlc = null
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
      await tx.insert(table).values(createData).onConflictDoUpdate({ target: table.id, set: updateData })
      if (u.children) {
        const childTable = tableOf(u.children.table)
        await tx.delete(childTable).where(eq(childTable[u.children.fk], u.rowId))
        if (u.children.rows.length) {
          await tx.insert(childTable).values(u.children.rows.map(reviveRowDates))
        }
      }
      if (u.movements) {
        await tx
          .delete(schema.stockMovement)
          .where(
            and(
              eq(schema.stockMovement.referenceType, u.movements.referenceType),
              eq(schema.stockMovement.referenceId, u.movements.referenceId),
            ),
          )
        if (u.movements.rows.length) {
          await tx.insert(schema.stockMovement).values(u.movements.rows.map(reviveRowDates) as any)
        }
      }
    }
  })
}
