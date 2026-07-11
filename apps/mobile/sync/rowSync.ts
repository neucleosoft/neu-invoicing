// Row-level sync ("Sync now") — mobile plumbing around the shared sync brain.
//
// The MOBILE twin of apps/desktop/electron/main/rowSync.ts: the intelligence
// (diary format, merge rules, recompute) lives in @neu/shared; this file is
// only the Drizzle fetches, the Drive REST diary IO, and the mechanical plan
// execution. Same stateless model: push rewrites this device's whole 30-day
// diary; pull reads the peers' diaries in full and planApply skips the rest.
// Re-running Sync now is always harmless.

import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm'
import {
  buildDiary,
  parseDiary,
  planApply,
  reviveRowDates,
  toEpochMs,
  SYNC_DOCUMENT_TABLES,
  SYNC_SINGLE_TABLES,
  type ApplyPlan,
  type DocumentBundle,
  type LocalIndex,
  type SyncPacket,
} from '@neu/shared'

import { schema, useDb } from '@/db'
import { recomputeAll } from '@/utils/recompute'

import { getDeviceId } from './deviceId'

type Db = ReturnType<typeof useDb>

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

// Push everything changed in this window; peers dedupe/skip what they have.
const DIARY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const diaryFileName = (deviceId: string) => `changes-${deviceId}.json`

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

const tableOf = (name: string): any => (schema as Record<string, any>)[name]

// Rows changed inside the window. The isNull branch only matters for legacy
// payment rows minted before the updatedAt column existed.
const changedSince = (table: any, cutoff: Date) =>
  or(gt(table.updatedAt, cutoff), and(isNull(table.updatedAt), gt(table.createdAt, cutoff)))

// ── Collect (push side) ──────────────────────────────────────────────────────

async function collectDiary(db: Db, deviceId: string, now: number) {
  const cutoff = new Date(now - DIARY_WINDOW_MS)

  const singles: Record<string, Record<string, unknown>[]> = {}
  for (const name of SYNC_SINGLE_TABLES) {
    const table = tableOf(name)
    singles[name] = await db.select().from(table).where(changedSince(table, cutoff))
  }

  const documents: Record<string, DocumentBundle[]> = {}
  for (const spec of SYNC_DOCUMENT_TABLES) {
    const table = tableOf(spec.table)
    const headers: any[] = await db.select().from(table).where(changedSince(table, cutoff))
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

async function buildLocalIndex(db: Db): Promise<LocalIndex> {
  const headers: LocalIndex['headers'] = {}
  const numbers: NonNullable<LocalIndex['numbers']> = {}

  const indexTable = async (name: string, numberColumn?: string) => {
    // purchaseBill rows carry the scanned-bill BLOB — never load those just to
    // build an id→timestamp index (a real archive would OOM the phone).
    const rows: any[] =
      name === 'purchaseBill'
        ? await db
            .select({
              id: schema.purchaseBill.id,
              billNumber: schema.purchaseBill.billNumber,
              updatedAt: schema.purchaseBill.updatedAt,
              createdAt: schema.purchaseBill.createdAt,
              deletedAt: schema.purchaseBill.deletedAt,
              cancelledAt: schema.purchaseBill.cancelledAt,
              status: schema.purchaseBill.status,
            })
            .from(schema.purchaseBill)
        : await db.select().from(tableOf(name))
    headers[name] = {}
    if (numberColumn) numbers[name] = {}
    for (const r of rows) {
      headers[name][r.id] = {
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
        numbers[name][String(num)] = { rowId: r.id, createdAt: toEpochMs(r.createdAt) }
      }
    }
  }

  for (const name of SYNC_SINGLE_TABLES) await indexTable(name)
  for (const spec of SYNC_DOCUMENT_TABLES) await indexTable(spec.table, spec.numberColumn)

  return { headers, numbers }
}

// ── Execute (pull side output) ───────────────────────────────────────────────

async function executePlan(db: Db, plan: ApplyPlan): Promise<void> {
  if (plan.upserts.length === 0 && plan.localRenumbers.length === 0) return
  await db.transaction(async (tx) => {
    // Local renumbers FIRST: the incoming doc that keeps the number cannot be
    // inserted while the local later-created doc still holds it (UNIQUE fires
    // at statement time). $onUpdate(now) auto-bumps updatedAt here, so the
    // renumber propagates on the next push.
    for (const r of plan.localRenumbers) {
      const table = tableOf(r.table)
      await tx.update(table).set({ [r.column]: r.to }).where(eq(table.id, r.rowId))
    }

    for (const u of plan.upserts) {
      const table = tableOf(u.table)
      const data = reviveRowDates(u.row)
      await tx.insert(table).values(data).onConflictDoUpdate({ target: table.id, set: data })
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

// ── Drive diary IO ───────────────────────────────────────────────────────────

async function uploadOwnDiary(accessToken: string, deviceId: string, json: string): Promise<void> {
  const name = diaryFileName(deviceId)
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name='${name}' and trashed=false`,
    fields: 'files(id)',
    pageSize: '1',
  })
  const listRes = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!listRes.ok) throw new Error(`Drive list failed (${listRes.status}): ${await listRes.text()}`)
  const files = ((await listRes.json()) as { files?: { id: string }[] }).files ?? []

  let fileId = files[0]?.id
  if (!fileId) {
    const createRes = await fetch(DRIVE_FILES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: ['appDataFolder'] }),
    })
    if (!createRes.ok) throw new Error(`Drive create failed (${createRes.status}): ${await createRes.text()}`)
    fileId = ((await createRes.json()) as { id: string }).id
  }

  // Diaries are small JSON — a plain string PATCH is fine (no streaming needed).
  const uploadRes = await fetch(`${DRIVE_UPLOAD_URL}/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: json,
  })
  if (!uploadRes.ok) throw new Error(`Diary upload failed (${uploadRes.status}): ${await uploadRes.text()}`)
}

async function downloadPeerDiaries(
  accessToken: string,
  ownName: string,
): Promise<{ packets: SyncPacket[]; newerVersion: boolean }> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name contains 'changes-' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: '100',
  })
  const listRes = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!listRes.ok) throw new Error(`Drive list failed (${listRes.status}): ${await listRes.text()}`)
  const files = ((await listRes.json()) as { files?: { id: string; name: string }[] }).files ?? []

  const packets: SyncPacket[] = []
  let newerVersion = false
  for (const f of files) {
    if (!f.name || f.name === ownName || !f.name.startsWith('changes-')) continue
    const res = await fetch(`${DRIVE_FILES_URL}/${f.id}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) continue // an unreadable peer diary must not kill the sync
    const parsed = parseDiary(await res.text())
    if (!parsed.ok) {
      if (parsed.error === 'NEWER_VERSION') newerVersion = true
      continue // MALFORMED: skip a half-written diary
    }
    packets.push(...parsed.diary.packets)
  }
  return { packets, newerVersion }
}

// ── The whole flow ───────────────────────────────────────────────────────────

export async function rowSyncNow(db: Db, accessToken: string): Promise<RowSyncResult> {
  try {
    const deviceId = await getDeviceId()
    const now = Date.now()

    // PULL first, so renumbers/merges ride the push below.
    const { packets, newerVersion } = await downloadPeerDiaries(accessToken, diaryFileName(deviceId))
    if (newerVersion) {
      return { success: false, error: 'The other device runs a newer app version — update this one to keep syncing.' }
    }

    let applied = 0
    let skipped = 0
    let localRenumbers = 0
    let removalsApplied = 0
    let recomputeChanges = 0
    let log: RowSyncResult['log'] = []
    if (packets.length > 0) {
      const local = await buildLocalIndex(db)
      const plan = planApply(packets, local, now)
      await executePlan(db, plan)
      applied = plan.upserts.length
      skipped = plan.skipped.length
      localRenumbers = plan.localRenumbers.length
      removalsApplied = plan.incomingRemovals
      log = plan.log

      // Recompute ONLY when the merge changed rows. A no-op sync must not
      // silently rewrite numbers that pre-date sync — legacy drift is surfaced
      // by the explicit Data Health flow, reviewed by a human, not applied as
      // a side effect of an empty pull. (openingStock backfill already ran at
      // app start, before any sync can.)
      if (plan.upserts.length > 0 || plan.localRenumbers.length > 0) {
        const recompute = await recomputeAll(db, { apply: true })
        recomputeChanges = recompute.totalChanges
      }
    }

    // PUSH: rewrite this device's whole 30-day diary (stateless, idempotent).
    const diary = await collectDiary(db, deviceId, now)
    await uploadOwnDiary(accessToken, deviceId, JSON.stringify(diary))

    return {
      success: true,
      pushedPackets: diary.packets.length,
      applied,
      skipped,
      localRenumbers,
      removalsApplied,
      recomputeChanges,
      log,
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Sync failed' }
  }
}
