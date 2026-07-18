// Row-level sync ("Sync now") — desktop shell around the shared sync brain.
//
// The intelligence lives in @neu/shared (syncPackets = diary format,
// syncApply = merge rules, rowSyncDb = the drizzle collect/index/execute,
// recomputeDb = totals rebuild — since the Prisma→Drizzle migration BOTH
// apps run the same DB code); THIS file is only the Drive diary IO, auth,
// and the IPC handler. Mobile has the exact twin in apps/mobile/sync/rowSync.ts.
//
// The diary model is STATELESS and idempotent: every push rewrites this
// device's whole diary with everything that changed in the last 30 days
// (D11's trim, for free); every pull reads the peers' diaries in full and
// lets planApply skip what's older-or-equal. No baselines to corrupt, and
// re-running Sync now is always harmless.
//
// Flow: PULL peers' diaries → planApply → execute plan in ONE transaction →
// recomputeAll({apply}) — only when the merge changed rows → PUSH own diary
// (so renumbered/merged state propagates immediately).

import { ipcMain } from 'electron'
import { google } from 'googleapis'
import Store from 'electron-store'
import { Readable } from 'stream'
import {
  and,
  billImageFileName,
  buildLocalIndexDb,
  collectDiaryDb,
  diaryFileName,
  eq,
  executePlanDb,
  hlcPhysicalMs,
  inArray,
  isNotNull,
  lte,
  parseDiary,
  planApply,
  previousInvoiceFileName,
  toEpochMs,
  TRIPWIRE_THRESHOLD,
  type RowSyncResult,
  type SyncPacket,
} from '@neu/shared'
import { getAppHlcClock } from './hlcStamp'
import { getOAuth2Client, isAuthError } from './auth'
import { getDb, schema, type DesktopDb } from './db'
import { withDbFileLock } from './dbLock'
import { recomputeAll } from './recompute'
import { getDeviceId } from './sync'

const store = new Store()

export type { RowSyncResult }

// ── Sync activity log (device-local, capped) ────────────────────────────────
// Every conflict / renumber / sticky event / tripwire pause gets a receipt the
// user can read in Settings (D5: quiet resolution + full receipts, no popups).

const ACTIVITY_LOG_KEY = 'sync_activity_log'
const ACTIVITY_LOG_CAP = 100

export interface SyncActivityEntry {
  at: number
  kind: string
  table?: string
  rowId?: string
  detail: string
}

const appendActivity = (entries: Omit<SyncActivityEntry, 'at'>[]) => {
  if (entries.length === 0) return
  const existing = (store.get(ACTIVITY_LOG_KEY) as SyncActivityEntry[] | undefined) ?? []
  // Dedupe against everything still in the log: with auto-sync ticking every
  // few minutes, a sticky-skip or tripwire pause would otherwise re-log on
  // EVERY pull for as long as the stale packet sits in the peer's 30-day diary.
  const seen = new Set(existing.map((e) => `${e.kind}|${e.table}|${e.rowId}|${e.detail}`))
  const fresh = entries.filter((e) => !seen.has(`${e.kind}|${e.table}|${e.rowId}|${e.detail}`))
  if (fresh.length === 0) return
  const now = Date.now()
  const next = [...fresh.map((e) => ({ at: now, ...e })), ...existing].slice(0, ACTIVITY_LOG_CAP)
  store.set(ACTIVITY_LOG_KEY, next)
}

export const getSyncActivity = (): SyncActivityEntry[] =>
  ((store.get(ACTIVITY_LOG_KEY) as SyncActivityEntry[] | undefined) ?? [])

// ── Auto-sync status ─────────────────────────────────────────────────────────

const LAST_ROW_SYNC_KEY = 'last_row_sync_at'
// Set when an AUTO tick hit the tripwire: the user must press the manual Sync
// button (which owns the confirm dialog) to resolve it. Cleared on any
// successful completed sync.
const PENDING_REMOVALS_KEY = 'row_sync_pending_removals'

export const getRowSyncStatus = (): { lastSyncAt: number | null; pendingRemovals: number | null } => ({
  lastSyncAt: (store.get(LAST_ROW_SYNC_KEY) as number | undefined) ?? null,
  pendingRemovals: (store.get(PENDING_REMOVALS_KEY) as number | undefined) ?? null,
})

// One sync at a time — overlapping transactions help nobody, and the diary
// model makes skipped ticks free (the next one covers everything).
let rowSyncInFlight = false

// ── Drive diary IO ───────────────────────────────────────────────────────────

async function uploadOwnDiary(drive: any, deviceId: string, json: string): Promise<void> {
  const name = diaryFileName(deviceId)
  const existing = await drive.files.list({
    spaces: 'appDataFolder',
    q: `name='${name}' and trashed=false`,
    fields: 'files(id)',
    pageSize: 1,
  })
  const media = { mimeType: 'application/json', body: json }
  if (existing.data.files?.length) {
    await drive.files.update({ fileId: existing.data.files[0].id!, media })
  } else {
    await drive.files.create({ requestBody: { name, parents: ['appDataFolder'] }, media })
  }
}

async function downloadPeerDiaries(
  drive: any,
  ownName: string,
): Promise<{ packets: SyncPacket[]; newerVersion: boolean }> {
  const list = await drive.files.list({
    spaces: 'appDataFolder',
    q: `name contains 'changes-' and trashed=false`,
    fields: 'files(id,name)',
    pageSize: 100,
  })
  const packets: SyncPacket[] = []
  let newerVersion = false
  for (const f of list.data.files ?? []) {
    if (!f.name || f.name === ownName || !f.name.startsWith('changes-')) continue
    const res = await drive.files.get({ fileId: f.id!, alt: 'media' }, { responseType: 'text' })
    const parsed = parseDiary(typeof res.data === 'string' ? res.data : JSON.stringify(res.data))
    if (!parsed.ok) {
      if (parsed.error === 'NEWER_VERSION') newerVersion = true
      // MALFORMED: skip — a half-written peer diary must not kill the sync.
      continue
    }
    packets.push(...parsed.diary.packets)
  }
  return { packets, newerVersion }
}

// ── Bill-photo store (S4 image split) ────────────────────────────────────────
// A scanned bill photo gets exactly ONE Drive file (img-bill-<id>) instead of
// riding inside every diary and backup. Push: best-effort after each sync for
// the changed bills. Pull: lazy, on first view (sync:fetchBillImage).

type DriveImageMeta = { id: string; modifiedTime?: string; size: number }

async function findDriveImage(
  drive: any,
  name: string,
): Promise<DriveImageMeta | null> {
  const res = await drive.files.list({
    spaces: 'appDataFolder',
    q: `name='${name}' and trashed=false`,
    fields: 'files(id,modifiedTime,size)',
    pageSize: 1,
  })
  const f = res.data.files?.[0]
  return f ? { id: f.id, modifiedTime: f.modifiedTime ?? undefined, size: Number(f.size ?? 0) } : null
}

// ONE paginated listing of every img-* Drive object, built once per sync and
// consulted in memory. The per-file findDriveImage shape cost a Drive round
// trip PER changed bill on EVERY sync for the 30 days a bill stays in the
// diary. (findDriveImage remains for the single-file lazy-fetch paths.)
async function listDriveImages(drive: any): Promise<Map<string, DriveImageMeta>> {
  const out = new Map<string, DriveImageMeta>()
  let pageToken: string | undefined
  do {
    const res = await drive.files.list({
      spaces: 'appDataFolder',
      q: `name contains 'img-' and trashed=false`,
      fields: 'nextPageToken, files(id,name,modifiedTime,size)',
      pageSize: 1000,
      pageToken,
    })
    for (const f of res.data.files ?? []) {
      if (!f.id || !f.name) continue
      out.set(f.name, { id: f.id, modifiedTime: f.modifiedTime ?? undefined, size: Number(f.size ?? 0) })
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)
  return out
}

async function pushBillImages(
  drive: any,
  db: DesktopDb,
  billIds: string[],
  images: Map<string, DriveImageMeta>,
): Promise<number> {
  if (billIds.length === 0) return 0
  const bills = await db
    .select({
      id: schema.purchaseBill.id,
      updatedAt: schema.purchaseBill.updatedAt,
      attachmentData: schema.purchaseBill.attachmentData,
      attachmentMimeType: schema.purchaseBill.attachmentMimeType,
    })
    .from(schema.purchaseBill)
    .where(and(inArray(schema.purchaseBill.id, billIds), isNotNull(schema.purchaseBill.attachmentData)))

  let pushed = 0
  for (const bill of bills) {
    if (!bill.attachmentData || !bill.attachmentMimeType) continue
    try {
      const name = billImageFileName(bill.id)
      const existing = images.get(name) ?? null
      // Upload when missing, 0-byte (residue of a failed two-step upload from
      // the phone), or when the bill changed after the last upload (covers a
      // replaced photo; a redundant upload is harmless).
      const stale =
        existing != null &&
        (existing.size === 0 ||
          (existing.modifiedTime != null &&
            (toEpochMs(bill.updatedAt) ?? 0) > (toEpochMs(existing.modifiedTime) ?? 0)))
      if (existing && !stale) continue
      const media = { mimeType: bill.attachmentMimeType, body: Readable.from(Buffer.from(bill.attachmentData)) }
      if (existing) {
        await drive.files.update({ fileId: existing.id, media })
      } else {
        await drive.files.create({ requestBody: { name, parents: ['appDataFolder'] }, media })
      }
      pushed++
    } catch (e) {
      // best-effort — never fail the sync over a photo
      console.warn('[rowSync] photo push failed for bill', bill.id, e)
    }
  }
  return pushed
}

// BACKSTOP SWEEP (throttled, ~3 days): push any photo/archive file that never
// reached Drive, regardless of the 30-day diary window. Without it, a device
// whose pushes kept failing for 30 straight days would strand its photos
// locally forever — and rows older than the window (e.g. the pre-sync archive)
// would never upload their files at all. Only MISSING/0-byte files are pushed
// (staleness is the windowed push's job), pre-filtered against the single
// img-* listing so a quiet sweep costs one Drive call.
const PHOTO_SWEEP_THROTTLE_MS = 3 * 24 * 60 * 60 * 1000
const LAST_PHOTO_SWEEP_KEY = 'last_photo_sweep_at'

async function sweepMissingPhotosIfDue(drive: any, db: DesktopDb): Promise<number> {
  try {
    const last = store.get(LAST_PHOTO_SWEEP_KEY) as number | undefined
    const now = Date.now()
    if (last && now - last < PHOTO_SWEEP_THROTTLE_MS) return 0
    store.set(LAST_PHOTO_SWEEP_KEY, now)

    const bills = await db
      .select({ id: schema.purchaseBill.id })
      .from(schema.purchaseBill)
      .where(isNotNull(schema.purchaseBill.attachmentData))
    const prevs = await db.select({ id: schema.previousInvoice.id }).from(schema.previousInvoice)
    if (bills.length === 0 && prevs.length === 0) return 0

    const images = await listDriveImages(drive)
    const missing = (name: string) => {
      const f = images.get(name)
      return !f || f.size === 0
    }
    const billIds = bills.map((b: any) => b.id).filter((id: string) => missing(billImageFileName(id)))
    const prevIds = prevs.map((p: any) => p.id).filter((id: string) => missing(previousInvoiceFileName(id)))
    if (billIds.length === 0 && prevIds.length === 0) return 0
    console.log(`[rowSync] photo sweep: ${billIds.length} bill photo(s), ${prevIds.length} archive file(s) missing on Drive`)

    // Chunked so the blob loads stay bounded (the first archive sweep can be
    // hundreds of files).
    let pushed = 0
    for (let i = 0; i < billIds.length; i += 20) {
      pushed += await pushBillImages(drive, db, billIds.slice(i, i + 20), images)
    }
    for (let i = 0; i < prevIds.length; i += 20) {
      pushed += await pushPreviousInvoiceFiles(drive, db, prevIds.slice(i, i + 20), images)
    }
    return pushed
  } catch (e) {
    console.warn('[rowSync] photo sweep failed (best-effort, next due run retries):', e)
    return 0
  }
}

async function pushPreviousInvoiceFiles(
  drive: any,
  db: DesktopDb,
  ids: string[],
  images: Map<string, DriveImageMeta>,
): Promise<number> {
  if (ids.length === 0) return 0
  const rows = await db
    .select({
      id: schema.previousInvoice.id,
      fileData: schema.previousInvoice.fileData,
      fileMimeType: schema.previousInvoice.fileMimeType,
    })
    .from(schema.previousInvoice)
    .where(inArray(schema.previousInvoice.id, ids))
  let pushed = 0
  for (const row of rows) {
    // Empty blob = the sentinel (this device never had the file) — nothing to push.
    if (!row.fileData || row.fileData.length === 0) continue
    try {
      const name = previousInvoiceFileName(row.id)
      const existing = images.get(name) ?? null
      // Archive files are immutable — upload only when missing or 0-byte.
      if (existing && existing.size > 0) continue
      const media = {
        mimeType: row.fileMimeType || 'application/octet-stream',
        body: Readable.from(Buffer.from(row.fileData)),
      }
      if (existing) {
        await drive.files.update({ fileId: existing.id, media })
      } else {
        await drive.files.create({ requestBody: { name, parents: ['appDataFolder'] }, media })
      }
      pushed++
    } catch (e) {
      console.warn('[rowSync] archive-file push failed for', row.id, e)
    }
  }
  return pushed
}

// Lazy pull for a synced-in archive row holding the empty-blob sentinel.
// Machine write: updatedAt AND hlc preserved (F5 rule).
export async function fetchPreviousInvoiceFile(id: string): Promise<{ success: boolean; error?: string }> {
  if (!store.get('google_tokens')) return { success: false, error: 'Connect your Google account first.' }
  try {
    const db = getDb()
    const [row] = await db
      .select({
        id: schema.previousInvoice.id,
        updatedAt: schema.previousInvoice.updatedAt,
        hlc: schema.previousInvoice.hlc,
        fileData: schema.previousInvoice.fileData,
      })
      .from(schema.previousInvoice)
      .where(eq(schema.previousInvoice.id, id))
      .limit(1)
    if (!row) return { success: false, error: 'Not found' }
    const local = row.fileData as unknown as Uint8Array | null
    if (local && local.length > 0) return { success: true }

    const auth = getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const found = await findDriveImage(drive, previousInvoiceFileName(id))
    if (!found || found.size === 0) {
      return { success: false, error: 'The file has not been uploaded from the other device yet.' }
    }
    const res = await drive.files.get({ fileId: found.id, alt: 'media' }, { responseType: 'arraybuffer' })
    const bytes = Buffer.from(res.data as ArrayBuffer)
    if (bytes.length === 0) return { success: false, error: 'File download came back empty — try again.' }
    await db
      .update(schema.previousInvoice)
      .set({ fileData: bytes, updatedAt: row.updatedAt, hlc: row.hlc })
      .where(eq(schema.previousInvoice.id, id))
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'File download failed' }
  }
}

// Lazy pull: a synced-in bill has attachmentMimeType but no blob — download it
// once and keep it. Machine write: updatedAt AND hlc preserved (F5 rule), so
// filling in the photo can never win a sync conflict.
async function fetchBillImage(billId: string): Promise<{ success: boolean; error?: string }> {
  if (!store.get('google_tokens')) return { success: false, error: 'Connect your Google account first.' }
  try {
    const db = getDb()
    const [bill] = await db
      .select({
        id: schema.purchaseBill.id,
        updatedAt: schema.purchaseBill.updatedAt,
        hlc: schema.purchaseBill.hlc,
        attachmentData: schema.purchaseBill.attachmentData,
        attachmentMimeType: schema.purchaseBill.attachmentMimeType,
      })
      .from(schema.purchaseBill)
      .where(eq(schema.purchaseBill.id, billId))
      .limit(1)
    if (!bill?.attachmentMimeType) return { success: false, error: 'This bill has no photo.' }
    if (bill.attachmentData) return { success: true }

    const auth = getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const found = await findDriveImage(drive, billImageFileName(billId))
    if (!found || found.size === 0) {
      return { success: false, error: 'The photo has not been uploaded from the other device yet.' }
    }

    const res = await drive.files.get({ fileId: found.id, alt: 'media' }, { responseType: 'arraybuffer' })
    const bytes = Buffer.from(res.data as ArrayBuffer)
    // Never cache an empty download — the bill would look "fetched" forever.
    if (bytes.length === 0) return { success: false, error: 'Photo download came back empty — try again.' }
    await db
      .update(schema.purchaseBill)
      .set({ attachmentData: bytes, updatedAt: bill.updatedAt, hlc: bill.hlc })
      .where(eq(schema.purchaseBill.id, billId))
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Photo download failed' }
  }
}

// ── 21-day purge (design R8/D10) ────────────────────────────────────────────
// Archived (Mode A) DOCUMENTS past the window are hard-deleted locally for
// real; both devices converge on their own (shared deletedAt, no sync needed).
// Deliberately narrowed for safety — see apps/mobile/sync/purge.ts for the
// full rationale: 35 days (not 21) because diaries re-offer rows for 30 days
// and an earlier purge would be resurrected by a stale packet; documents only
// (masters stay archived — tiny rows, heavy FK fan-in); conversion-referenced
// docs are skipped; cancelled money docs are NEVER purged (GST audit trail).

const PURGE_AFTER_MS = 35 * 24 * 60 * 60 * 1000
const PURGE_THROTTLE_MS = 24 * 60 * 60 * 1000
const LAST_PURGE_KEY = 'last_purge_check_at'

async function purgeArchivedDocs(drive: any): Promise<void> {
  try {
    const now = Date.now()
    const last = store.get(LAST_PURGE_KEY) as number | undefined
    if (last && now - last < PURGE_THROTTLE_MS) return
    store.set(LAST_PURGE_KEY, now)

    const db = getDb()
    const cutoff = new Date(now - PURGE_AFTER_MS)
    let purged = 0

    const archivedBefore = (table: any) => and(isNotNull(table.deletedAt), lte(table.deletedAt, cutoff))

    const quotes = await db.select({ id: schema.quotation.id }).from(schema.quotation).where(archivedBefore(schema.quotation))
    for (const q of quotes) {
      const [ref] = await db
        .select({ id: schema.salesInvoice.id })
        .from(schema.salesInvoice)
        .where(eq(schema.salesInvoice.convertedFromQuotationId, q.id))
        .limit(1)
      if (ref) continue
      await db.transaction(async (tx) => {
        await tx.delete(schema.quotationItem).where(eq(schema.quotationItem.quotationId, q.id))
        await tx.delete(schema.quotation).where(eq(schema.quotation.id, q.id))
      })
      purged++
    }

    const proformas = await db.select({ id: schema.proformaInvoice.id }).from(schema.proformaInvoice).where(archivedBefore(schema.proformaInvoice))
    for (const p of proformas) {
      const [ref] = await db
        .select({ id: schema.salesInvoice.id })
        .from(schema.salesInvoice)
        .where(eq(schema.salesInvoice.convertedFromProformaId, p.id))
        .limit(1)
      if (ref) continue
      await db.transaction(async (tx) => {
        await tx.delete(schema.proformaInvoiceItem).where(eq(schema.proformaInvoiceItem.proformaInvoiceId, p.id))
        await tx.delete(schema.proformaInvoice).where(eq(schema.proformaInvoice.id, p.id))
      })
      purged++
    }

    const pos = await db.select({ id: schema.purchaseOrder.id }).from(schema.purchaseOrder).where(archivedBefore(schema.purchaseOrder))
    for (const po of pos) {
      const [ref] = await db
        .select({ id: schema.purchaseBill.id })
        .from(schema.purchaseBill)
        .where(eq(schema.purchaseBill.purchaseOrderId, po.id))
        .limit(1)
      if (ref) continue
      await db.transaction(async (tx) => {
        await tx.delete(schema.purchaseOrderItem).where(eq(schema.purchaseOrderItem.purchaseOrderId, po.id))
        await tx.delete(schema.purchaseOrder).where(eq(schema.purchaseOrder.id, po.id))
      })
      purged++
    }

    const prevs = await db.select({ id: schema.previousInvoice.id }).from(schema.previousInvoice).where(archivedBefore(schema.previousInvoice))
    // One img-* listing for the whole purge run instead of one Drive lookup
    // per archived file.
    const images = prevs.length > 0 ? await listDriveImages(drive) : new Map()
    for (const pi of prevs) {
      await db.transaction(async (tx) => {
        await tx.delete(schema.previousInvoiceItem).where(eq(schema.previousInvoiceItem.previousInvoiceId, pi.id))
        await tx.delete(schema.previousInvoice).where(eq(schema.previousInvoice.id, pi.id))
      })
      purged++
      // Free the archived file's Drive object — best-effort.
      try {
        const found = images.get(previousInvoiceFileName(pi.id))
        if (found) await drive.files.delete({ fileId: found.id })
      } catch { /* the next purge run (or the other device) retries */ }
    }

    if (purged > 0) {
      appendActivity([
        {
          kind: 'PURGE',
          detail: `Purged ${purged} archived document(s) deleted more than 35 days ago (${new Date(now).toDateString()})`,
        },
      ])
    }
  } catch (e) {
    console.error('[purge] failed, app continues:', e)
  }
}

// ── The whole flow ───────────────────────────────────────────────────────────

export const rowSyncNow = async (
  opts: { confirmRemovals?: boolean } = {},
): Promise<RowSyncResult> => {
  if (store.get('demo_mode')) return { success: true, pushedPackets: 0, applied: 0 }
  if (!store.get('google_tokens')) return { success: false, error: 'Connect your Google account to sync.' }
  if (rowSyncInFlight) return { success: false, error: 'Sync is already running.' }
  rowSyncInFlight = true

  try {
    const db = getDb()
    const auth = getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const deviceId = getDeviceId()
    const now = Date.now()

    // PULL first, so renumbers/merges ride the push below.
    const { packets, newerVersion } = await downloadPeerDiaries(drive, diaryFileName(deviceId))
    if (newerVersion) {
      return { success: false, error: 'The other device runs a newer app version — update this one to keep syncing.' }
    }

    // P1: feed every peer HLC stamp into the ratchet BEFORE planning or
    // stamping anything, so edits made after this pull order above everything
    // just seen. A peer whose clock reads far in the future gets a receipt —
    // ordering stays safe (that's the point of HLC) but the user should know.
    const clock = getAppHlcClock()
    const nextHlc = clock ? () => clock.next() : undefined
    let maxPeerPt = 0
    for (const p of packets) {
      clock?.observe(p.row?.hlc)
      const pt = hlcPhysicalMs(p.row?.hlc)
      if (pt != null && pt > maxPeerPt) maxPeerPt = pt
    }
    if (maxPeerPt > now + 60 * 60 * 1000) {
      appendActivity([{
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
      const local = await buildLocalIndexDb(db)
      const plan = planApply(packets, local, now, nextHlc)

      // D6 tripwire: a pull that wants to remove many live rows pauses for a
      // human before ANYTHING is applied or pushed.
      if (plan.incomingRemovals >= TRIPWIRE_THRESHOLD && !opts.confirmRemovals) {
        appendActivity([{ kind: 'TRIPWIRE_PAUSED', detail: `Incoming sync wanted to remove ${plan.incomingRemovals} records — paused for confirmation` }])
        store.set(PENDING_REMOVALS_KEY, plan.incomingRemovals)
        return { success: false, needsConfirmation: true, removalsPending: plan.incomingRemovals }
      }

      // Merge + recompute hold the DB-file lock as ONE unit — a concurrent
      // backup/ladder snapshot must never capture a half-merged ledger.
      await withDbFileLock(async () => {
        // Renumber hlc stamping now rides the shared schema's $onUpdate hook
        // (the stamper is wired at boot), same as mobile.
        await executePlanDb(db, plan)

        // Recompute ONLY when the merge changed rows. A no-op sync must not
        // silently rewrite numbers that pre-date sync — legacy drift is surfaced
        // by the explicit recompute dry-run/Data Health flows, reviewed by a
        // human, not applied as a side effect of an empty pull.
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
      appendActivity(plan.log)
    }

    // PUSH: rewrite this device's whole 30-day diary (stateless, idempotent).
    const diary = await collectDiaryDb(db, deviceId, now)
    await uploadOwnDiary(drive, deviceId, JSON.stringify(diary))

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
      const images = await listDriveImages(drive)
      photosPushed =
        (await pushBillImages(drive, db, changedBillIds, images)) +
        (await pushPreviousInvoiceFiles(drive, db, changedPrevInvIds, images))
    }
    photosPushed += await sweepMissingPhotosIfDue(drive, db)

    store.set(LAST_ROW_SYNC_KEY, Date.now())
    store.delete(PENDING_REMOVALS_KEY)

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
  } catch (error) {
    console.error('rowSyncNow error:', error)
    const friendly = isAuthError(error)
      ? 'Google sign-in expired. Please sign in again.'
      : error instanceof Error ? error.message : 'Sync failed'
    return { success: false, error: friendly }
  } finally {
    rowSyncInFlight = false
  }
}

// ── Auto-sync scheduler (S3) ─────────────────────────────────────────────────
// Foreground-only by nature (the app is open), fires every 5 minutes plus one
// delayed run at startup — delayed so the boot backfills (openingStock, inline
// payments) always finish before the first recompute-after-merge can run.
// Auto ticks NEVER confirm the tripwire; a pause waits for the manual button.

const ROW_SYNC_TICK_MS = 5 * 60 * 1000
const ROW_SYNC_FIRST_RUN_DELAY_MS = 20_000

let rowSyncTimer: NodeJS.Timeout | null = null

const autoTick = async () => {
  if (store.get('demo_mode') || !store.get('google_tokens')) return
  const r = await rowSyncNow()
  if (!r.success && r.error && !r.needsConfirmation && r.error !== 'Sync is already running.') {
    console.log('[rowSync auto] skipped:', r.error)
  }
  // Housekeeping riding the same tick, internally throttled to ~daily.
  try {
    const auth = getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    await purgeArchivedDocs(drive)
  } catch { /* hygiene only */ }
}

export const startRowSyncScheduler = () => {
  if (rowSyncTimer) return
  setTimeout(() => void autoTick(), ROW_SYNC_FIRST_RUN_DELAY_MS)
  rowSyncTimer = setInterval(() => void autoTick(), ROW_SYNC_TICK_MS)
}

export const setupRowSyncHandlers = () => {
  ipcMain.handle('sync:rowSyncNow', async (_, confirmRemovals?: boolean) =>
    rowSyncNow({ confirmRemovals }),
  )
  ipcMain.handle('sync:getActivityLog', async () => getSyncActivity())
  ipcMain.handle('sync:getRowSyncStatus', async () => getRowSyncStatus())
  ipcMain.handle('sync:fetchBillImage', async (_, billId: string) => fetchBillImage(billId))
}
