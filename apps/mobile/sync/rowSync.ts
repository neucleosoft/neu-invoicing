// Row-level sync ("Sync now") — mobile plumbing around the shared sync brain.
//
// The MOBILE twin of apps/desktop/electron/main/rowSync.ts: the intelligence
// (diary format, merge rules, DB collect/index/execute, recompute) lives in
// @neu/shared — since the Prisma→Drizzle migration BOTH apps run the same
// rowSyncDb.ts code, so this file is only the Drive REST diary IO and the
// flow. Same stateless model: push rewrites this device's whole 30-day
// diary; pull reads the peers' diaries in full and planApply skips the rest.
// Re-running Sync now is always harmless.

import {
  buildLocalIndexDb,
  collectDiaryDb,
  diaryFileName,
  executePlanDb,
  hlcPhysicalMs,
  parseDiary,
  planApply,
  recomputeAllDb,
  TRIPWIRE_THRESHOLD,
  type RowSyncResult,
  type SyncPacket,
} from '@neu/shared'

import { useDb } from '@/db'

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
      const local = await buildLocalIndexDb(db)
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
        await executePlanDb(db, plan)

        // Recompute ONLY when the merge changed rows. A no-op sync must not
        // silently rewrite numbers that pre-date sync — legacy drift is surfaced
        // by the explicit Data Health flow, reviewed by a human, not applied as
        // a side effect of an empty pull. (openingStock backfill already ran at
        // app start, before any sync can.)
        if (plan.upserts.length > 0 || plan.localRenumbers.length > 0) {
          const recompute = await recomputeAllDb(db, { apply: true })
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
    const diary = await collectDiaryDb(db, deviceId, now)
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
