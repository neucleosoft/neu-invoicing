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
import { parseDiary, planApply, type SyncPacket } from '@neu/shared'
import { getOAuth2Client, isAuthError } from './auth'
import { getPrisma } from './database'
import { recomputeAll } from './recompute'
import {
  buildLocalIndex,
  collectDiary,
  diaryFileName,
  executePlan,
  type RowSyncResult,
} from './rowSyncCore'

const store = new Store()

const getDeviceId = (): string => store.get('device_id') as string

export type { RowSyncResult }

// ── Drive diary IO ───────────────────────────────────────────────────────────

async function uploadOwnDiary(drive: any, deviceId: string, json: string): Promise<void> {
  const name = diaryFileName(deviceId)
  const existing = await drive.files.list({
    spaces: 'appDataFolder',
    q: `name='${name}'`,
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
    q: `name contains 'changes-'`,
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

export const rowSyncNow = async (): Promise<RowSyncResult> => {
  if (store.get('demo_mode')) return { success: true, pushedPackets: 0, applied: 0 }
  if (!store.get('google_tokens')) return { success: false, error: 'OFFLINE' }

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
      const plan = planApply(packets, local)
      await executePlan(prisma, plan)
      applied = plan.upserts.length
      skipped = plan.skipped.length
      localRenumbers = plan.localRenumbers.length
      removalsApplied = plan.incomingRemovals
      log = plan.log

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
  }
}

export const setupRowSyncHandlers = () => {
  ipcMain.handle('sync:rowSyncNow', async () => rowSyncNow())
}
