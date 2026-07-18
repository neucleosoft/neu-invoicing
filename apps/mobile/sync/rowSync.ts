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
  hlcLowerBound,
  hlcPhysicalMs,
  parseDiary,
  planApply,
  reviveRowDates,
  toEpochMs,
  SYNC_DOCUMENT_TABLES,
  SYNC_SINGLE_TABLES,
  TRIPWIRE_THRESHOLD,
  type ApplyPlan,
  type DocumentBundle,
  type LocalIndex,
  type SyncPacket,
} from '@neu/shared'

import { schema, useDb } from '@/db'
import { recomputeAll } from '@/utils/recompute'

import { appendSyncActivity } from './activityLog'
import { withDbFileLock } from './dbFileLock'
import { getDeviceId } from './deviceId'
import { getMobileHlcClock } from './hlc'
import {
  listDriveImages,
  pushBillImages,
  pushPreviousInvoiceFiles,
  sweepMissingPhotosIfDue,
} from './imageStore'

type Db = ReturnType<typeof useDb>

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

// Push everything changed in this window; peers dedupe/skip what they have.
const DIARY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const diaryFileName = (deviceId: string) => `changes-${deviceId}.json`

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

async function collectDiary(db: Db, deviceId: string, now: number) {
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

async function buildLocalIndex(db: Db): Promise<LocalIndex> {
  const headers: LocalIndex['headers'] = {}
  const numbers: NonNullable<LocalIndex['numbers']> = {}

  const indexTable = async (name: string, numberColumn?: string) => {
    // purchaseBill / previousInvoice rows carry BLOBs — never load those just
    // to build an id→timestamp index (a real archive would OOM the phone).
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

async function executePlan(db: Db, plan: ApplyPlan): Promise<void> {
  if (plan.upserts.length === 0 && plan.localRenumbers.length === 0) return
  await db.transaction(async (tx) => {
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

// One sync at a time — the AutoSync ticker and the manual Settings button can
// both fire; overlapping transactions help nobody, and skipped runs are free
// (the diary model means the next run covers everything).
let inFlight = false

export async function rowSyncNow(
  db: Db,
  accessToken: string,
  opts: { confirmRemovals?: boolean } = {},
): Promise<RowSyncResult> {
  if (inFlight) return { success: false, error: 'Sync is already running.' }
  inFlight = true
  try {
    const deviceId = await getDeviceId()
    const now = Date.now()

    // PULL first, so renumbers/merges ride the push below.
    const { packets, newerVersion } = await downloadPeerDiaries(accessToken, diaryFileName(deviceId))
    if (newerVersion) {
      return { success: false, error: 'The other device runs a newer app version — update this one to keep syncing.' }
    }

    // P1: feed every peer HLC stamp into the ratchet BEFORE planning or
    // stamping anything, so edits made after this pull order above everything
    // just seen. A peer whose clock reads far in the future gets a receipt —
    // ordering stays safe (that's the point of HLC) but the user should know.
    const clock = getMobileHlcClock()
    const nextHlc = clock ? () => clock.next() : undefined
    let maxPeerPt = 0
    for (const p of packets) {
      clock?.observe(p.row?.hlc)
      const pt = hlcPhysicalMs(p.row?.hlc)
      if (pt != null && pt > maxPeerPt) maxPeerPt = pt
    }
    if (maxPeerPt > now + 60 * 60 * 1000) {
      await appendSyncActivity([{
        kind: 'CLOCK_SKEW',
        detail: `Another device's clock looks ~${Math.round((maxPeerPt - now) / 3_600_000)}h ahead of this one — sync stays ordered (HLC), but check that device's date & time.`,
      }])
    }

    let applied = 0
    let skipped = 0
    let localRenumbers = 0
    let removalsApplied = 0
    let recomputeChanges = 0
    let log: RowSyncResult['log'] = []
    if (packets.length > 0) {
      const local = await buildLocalIndex(db)
      const plan = planApply(packets, local, now, nextHlc)

      // D6 tripwire: a pull that wants to remove many live rows pauses for a
      // human before ANYTHING is applied or pushed.
      if (plan.incomingRemovals >= TRIPWIRE_THRESHOLD && !opts.confirmRemovals) {
        await appendSyncActivity([{ kind: 'TRIPWIRE_PAUSED', detail: `Incoming sync wanted to remove ${plan.incomingRemovals} records — paused for confirmation` }])
        return { success: false, needsConfirmation: true, removalsPending: plan.incomingRemovals }
      }

      // Merge + recompute hold the DB-file lock as ONE unit — a concurrent
      // backup/ladder snapshot must never capture a half-merged ledger.
      await withDbFileLock(async () => {
        await executePlan(db, plan)

        // Recompute ONLY when the merge changed rows. A no-op sync must not
        // silently rewrite numbers that pre-date sync — legacy drift is surfaced
        // by the explicit Data Health flow, reviewed by a human, not applied as
        // a side effect of an empty pull. (openingStock backfill already ran at
        // app start, before any sync can.)
        if (plan.upserts.length > 0 || plan.localRenumbers.length > 0) {
          const recompute = await recomputeAll(db, { apply: true })
          recomputeChanges = recompute.totalChanges
        }
      })
      applied = plan.upserts.length
      skipped = plan.skipped.length
      localRenumbers = plan.localRenumbers.length
      removalsApplied = plan.incomingRemovals
      log = plan.log
      await appendSyncActivity(plan.log)
    }

    // PUSH: rewrite this device's whole 30-day diary (stateless, idempotent).
    const diary = await collectDiary(db, deviceId, now)
    await uploadOwnDiary(accessToken, deviceId, JSON.stringify(diary))

    // S4 image split: photos of the changed bills ride as their own Drive
    // files, once each — best-effort, never fails the sync.
    const changedBillIds = diary.packets
      .filter((p) => p.table === 'purchaseBill')
      .map((p) => p.rowId)
    const changedPrevInvIds = diary.packets
      .filter((p) => p.table === 'previousInvoice')
      .map((p) => p.rowId)
    let photosPushed = 0
    if (changedBillIds.length > 0 || changedPrevInvIds.length > 0) {
      const images = await listDriveImages(accessToken)
      photosPushed =
        (await pushBillImages(db, accessToken, changedBillIds, images)) +
        (await pushPreviousInvoiceFiles(db, accessToken, changedPrevInvIds, images))
    }
    photosPushed += await sweepMissingPhotosIfDue(db, accessToken)

    return {
      success: true,
      photosPushed,
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
  } finally {
    inFlight = false
  }
}
