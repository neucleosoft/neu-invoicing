// Row-level sync ("Sync now") — desktop shell around the shared sync brain.
//
// The intelligence lives in @neu/shared (syncPackets = diary format,
// syncApply = merge rules, recompute = totals rebuild); the Prisma fetch/
// execute half lives in rowSyncCore.ts (electron-free, so the sandbox runner
// can drive the real code path); THIS file is only the Drive diary IO, auth,
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
import { parseDiary, planApply, TRIPWIRE_THRESHOLD, type SyncPacket } from '@neu/shared'
import { getOAuth2Client, isAuthError } from './auth'
import { getPrisma } from './database'
import { recomputeAll } from './recompute'
import { getDeviceId } from './sync'
import {
  buildLocalIndex,
  collectDiary,
  diaryFileName,
  executePlan,
  type RowSyncResult,
} from './rowSyncCore'

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

// ── The whole flow ───────────────────────────────────────────────────────────

export const rowSyncNow = async (
  opts: { confirmRemovals?: boolean } = {},
): Promise<RowSyncResult> => {
  if (store.get('demo_mode')) return { success: true, pushedPackets: 0, applied: 0 }
  if (!store.get('google_tokens')) return { success: false, error: 'Connect your Google account to sync.' }
  if (rowSyncInFlight) return { success: false, error: 'Sync is already running.' }
  rowSyncInFlight = true

  try {
    const prisma = getPrisma()
    const auth = getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const deviceId = getDeviceId()
    const now = Date.now()

    // PULL first, so renumbers/merges ride the push below.
    const { packets, newerVersion } = await downloadPeerDiaries(drive, diaryFileName(deviceId))
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
      const local = await buildLocalIndex(prisma)
      const plan = planApply(packets, local, now)

      // D6 tripwire: a pull that wants to remove many live rows pauses for a
      // human before ANYTHING is applied or pushed.
      if (plan.incomingRemovals >= TRIPWIRE_THRESHOLD && !opts.confirmRemovals) {
        appendActivity([{ kind: 'TRIPWIRE_PAUSED', detail: `Incoming sync wanted to remove ${plan.incomingRemovals} records — paused for confirmation` }])
        store.set(PENDING_REMOVALS_KEY, plan.incomingRemovals)
        return { success: false, needsConfirmation: true, removalsPending: plan.incomingRemovals }
      }

      await executePlan(prisma, plan)
      applied = plan.upserts.length
      skipped = plan.skipped.length
      localRenumbers = plan.localRenumbers.length
      removalsApplied = plan.incomingRemovals
      log = plan.log
      appendActivity(plan.log)

      // Recompute ONLY when the merge changed rows. A no-op sync must not
      // silently rewrite numbers that pre-date sync — legacy drift is surfaced
      // by the explicit recompute dry-run/Data Health flows, reviewed by a
      // human, not applied as a side effect of an empty pull.
      if (plan.upserts.length > 0 || plan.localRenumbers.length > 0) {
        const recompute = await recomputeAll(prisma, { apply: true })
        recomputeChanges = recompute.totalChanges
      }
    }

    // PUSH: rewrite this device's whole 30-day diary (stateless, idempotent).
    const diary = await collectDiary(prisma, deviceId, now)
    await uploadOwnDiary(drive, deviceId, JSON.stringify(diary))

    store.set(LAST_ROW_SYNC_KEY, Date.now())
    store.delete(PENDING_REMOVALS_KEY)

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
}
