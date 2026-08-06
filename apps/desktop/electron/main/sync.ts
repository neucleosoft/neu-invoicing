import { ipcMain, BrowserWindow } from 'electron'
import { google } from 'googleapis'
import { createClient } from '@libsql/client'
import { getOAuth2Client, isAuthError, clearStoredCredentials } from './auth'
import { eq, syncMetadata } from '@neu/shared'
import { getDatabasePath, reconnectDatabase } from './database'
import { ensureTablesExist } from './bootMigrate'
import { closeDrizzle, getDb } from './db'
import { snapshotDatabaseTo, withDbFileLock } from './dbLock'
import fs from 'fs'
import path from 'path'
import Store from 'electron-store'
import { randomUUID } from 'crypto'

const store = new Store()

// Stable per-install identity for sync. Each device writes only its own change
// diary in Drive (changes-<deviceId>.json), so this id MUST be unique and stable.
// os.hostname() was neither — renaming the PC changes it, and two machines can
// share a default name → diary collision. Minted once as `desktop-<uuid>` and
// kept in electron-store (beside the login token) forever after. Mirrors the
// mobile getDeviceId() in apps/mobile/sync/deviceId.ts.
const DEVICE_ID_KEY = 'device_id'

// Exported: rowSync.ts must use THIS minting version — reading the store key
// directly returns undefined on a device that never ran a whole-file backup,
// which produced an unreadable `changes-undefined.json` diary (review 2026-07-11).
export const getDeviceId = (): string => {
  const existing = store.get(DEVICE_ID_KEY) as string | undefined
  if (existing) return existing
  const minted = `desktop-${randomUUID()}`
  store.set(DEVICE_ID_KEY, minted)
  return minted
}

let syncStatus = {
  status: 'idle', // idle, syncing, error
  lastSync: null as Date | null,
  lastError: null as string | null
}

// Update status AND tell the UI about it
const updateSyncStatus = (updates: Partial<typeof syncStatus>) => {
  Object.assign(syncStatus, updates)
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('sync:statusChanged', syncStatus)
  })
}

const CLOUD_DB_FILENAME = 'neuinvoicing.db'

// Per-device baseline. The cloud's modifiedTime the last time THIS device
// successfully synced. Stored in electron-store (NOT in the cloud DB itself —
// that would be circular). null/undefined = no sync yet on this device.
const LAST_KNOWN_CLOUD_MTIME_KEY = 'last_known_cloud_modified_time'

const getLastKnownCloudMtime = (): Date | null => {
  const stored = store.get(LAST_KNOWN_CLOUD_MTIME_KEY) as string | undefined
  return stored ? new Date(stored) : null
}

const setLastKnownCloudMtime = (time: string) => {
  store.set(LAST_KNOWN_CLOUD_MTIME_KEY, time)
}

// Local-side counterpart to the cloud-mtime tracker. Captures the LOCAL file's
// mtime at the end of every successful sync (after our own syncMetadata write
// completes) so the next syncState's localChanged check excludes that
// bookkeeping bump. Without this, every sync would falsely report localChanged
// = true and we'd never reach the "Already in sync" path.
const LAST_KNOWN_LOCAL_MTIME_KEY = 'last_known_local_modified_time'

const getLastKnownLocalMtime = (): Date | null => {
  const stored = store.get(LAST_KNOWN_LOCAL_MTIME_KEY) as string | undefined
  return stored ? new Date(stored) : null
}

const setLastKnownLocalMtime = (time: Date) => {
  store.set(LAST_KNOWN_LOCAL_MTIME_KEY, time.toISOString())
}

// Clear this device's per-account sync baseline. MUST be called on sign-out /
// account-switch: the trackers below describe THIS device's relationship to a
// SPECIFIC account's cloud file. If account B signs in while account A's
// baseline is still present, syncState() compares B's cloud against A's
// remembered mtimes and can conclude "nothing changed" — letting an upload
// silently overwrite B's cloud, or skipping the divergence guard. Wiping the
// baseline forces the next sync to treat this as a fresh device (no false
// "already in sync"), which is the safe default.
export const resetSyncBaseline = () => {
  store.delete(LAST_KNOWN_CLOUD_MTIME_KEY)
  store.delete(LAST_KNOWN_LOCAL_MTIME_KEY)
  store.delete(LAST_UPLOAD_TIMESTAMP_KEY)
  store.delete(LAST_SCHEDULED_SYNC_KEY)
  // A pending-tripwire flag describes the PRE-restore database — surviving the
  // restore it would show a stale "removals pending" banner until the next
  // successful sync. (Key literal matches rowSync.ts's PENDING_REMOVALS_KEY.)
  store.delete('row_sync_pending_removals')
  // The pushed-diary fingerprint also describes the pre-restore database —
  // clearing it forces the next sync to re-upload unconditionally. (Key
  // literal matches rowSync.ts's LAST_PUSHED_DIARY_HASH_KEY.)
  store.delete('last_pushed_diary_hash')
}

// Scheduled-backup configuration. Per-device (electron-store, not synced).
// Each device sets its own cadence — office desktop "weekly" vs home laptop
// "monthly" is fine; they don't need to agree.
export type BackupFrequency = 'off' | 'daily' | 'weekly' | 'monthly'

const BACKUP_FREQUENCY_KEY = 'backup_frequency'
const LAST_UPLOAD_TIMESTAMP_KEY = 'last_upload_timestamp'
const LAST_SCHEDULED_SYNC_KEY = 'last_scheduled_sync_at'

const FREQUENCY_INTERVAL_MS: Record<BackupFrequency, number> = {
  off: 0,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
}

// We tick the scheduler every hour while the app is open. That's frequent
// enough to catch a freshly-passed daily deadline, but rare enough to be free.
// The actual "is it due?" decision is time-based, not tick-based, so an app
// that's closed for 2 days will still catch up on the next launch.
const SCHEDULER_TICK_MS = 60 * 60 * 1000

const getBackupFrequency = (): BackupFrequency => {
  return (store.get(BACKUP_FREQUENCY_KEY) as BackupFrequency) || 'off'
}

// Shared error path for syncUpload / syncDownload. On auth expiry, clears
// stored tokens and signals the renderer to prompt re-auth — otherwise we'd
// silently loop on a dead refresh token every retry.
const handleSyncError = (error: unknown, label: string): { success: boolean; error: string } => {
  console.error(`${label} error:`, error)
  const authProblem = isAuthError(error)
  const friendly = authProblem
    ? 'Google sign-in expired. Please sign in again.'
    : error instanceof Error ? error.message : `${label} failed`
  if (authProblem) {
    clearStoredCredentials()
    BrowserWindow.getAllWindows().forEach(win => {
      win.webContents.send('auth:invalidated')
    })
  }
  updateSyncStatus({ status: 'error', lastError: friendly })
  return { success: false, error: friendly }
}

// Offline-mode safety. Without Google tokens any sync call to Drive would
// throw; these guards keep skip-sign-in callers from crashing.
const isSignedIn = (): boolean => Boolean(store.get('google_tokens'))

export const setupSyncHandlers = () => {
  // Get sync status
  ipcMain.handle('sync:getSyncStatus', async () => {
    return syncStatus
  })

  // Read-only: ask Drive whether a backup file exists and return its metadata.
  // Used on startup to decide whether to prompt the user to restore.
  ipcMain.handle('sync:checkCloudBackup', async () => {
    if (!isSignedIn()) return { exists: false }
    return await checkCloudBackup()
  })

  // Manual-sync pre-flight. Returns the four-way state (local/cloud changed,
  // conflict, firstSync) so the renderer can decide direction or surface a
  // conflict dialog without the main process making UI decisions.
  ipcMain.handle('sync:syncState', async () => {
    if (!isSignedIn()) return { cloudExists: false, localChanged: false, cloudChanged: false, isConflict: false, firstSync: false }
    return await syncState()
  })

  // Explicit upload — caller has already chosen direction.
  ipcMain.handle('sync:upload', async () => {
    if (!isSignedIn()) return { success: false, error: 'OFFLINE' }
    return await syncUpload()
  })

  // Explicit download — caller has already confirmed destructive replace of local.
  ipcMain.handle('sync:download', async () => {
    if (!isSignedIn()) return { success: false, error: 'OFFLINE' }
    return await syncDownload()
  })

  // Combined status for Settings → Backup: latest cloud backup metadata,
  // this device's last upload, and the current schedule.
  ipcMain.handle('sync:getBackupInfo', async () => {
    if (!isSignedIn()) {
      return { cloudBackup: null, thisDeviceLastUpload: null, backupFrequency: getBackupFrequency() }
    }
    return await getBackupInfo()
  })

  // Set the per-device cadence. We kick the scheduler immediately so a user
  // who just turned ON daily backups doesn't have to wait a full hour for the
  // next tick to see something happen.
  ipcMain.handle('sync:setBackupFrequency', async (_, freq: BackupFrequency) => {
    setBackupFrequencyValue(freq)
    void runIfScheduledSyncDue()
    return { success: true }
  })

  // Backup ladder (S4): rung metadata + the destructive time-machine restore.
  ipcMain.handle('sync:getLadderInfo', async () => getLadderInfo())

  // Reset sync data — the fire extinguisher. Deletes every device diary
  // (changes-*.json) on this account's Drive and clears this device's local
  // sync bookkeeping. Touches NOTHING else: backups, ladder, photos and all
  // local rows stay. Diaries are the sync system's memory OUTSIDE any backup —
  // they survive restores and resurrect old rows (the ghost-invoice /52-/53
  // mechanism), so a clean re-baseline must wipe them. Other devices that
  // still hold old data will re-share it on their next sync — the caller's
  // procedure (restore or sign out every device) handles that half.
  ipcMain.handle('sync:resetSyncData', async () => {
    try {
      if (!isSignedIn()) return { success: false, error: 'Not signed in' }
      const auth = getOAuth2Client()
      const drive = google.drive({ version: 'v3', auth })
      let deleted = 0
      let pageToken: string | undefined
      do {
        const res = await drive.files.list({
          spaces: 'appDataFolder',
          // Diaries AND the business-identity marker: after a reset, the next
          // device to sync stamps its business as this account's identity
          // fresh — the deliberate "change which company this account syncs".
          q: "name contains 'changes-' or name = 'business-identity.json'",
          fields: 'nextPageToken, files(id, name)',
          pageSize: 100,
          pageToken,
        })
        for (const f of res.data.files ?? []) {
          if (f.id && (f.name?.startsWith('changes-') || f.name === 'business-identity.json')) {
            await drive.files.delete({ fileId: f.id })
            deleted++
          }
        }
        pageToken = res.data.nextPageToken ?? undefined
      } while (pageToken)
      resetSyncBaseline()
      const log = (store.get('sync_activity_log') as { at: number }[] | undefined) ?? []
      store.set('sync_activity_log', [
        { at: Date.now(), kind: 'RESET', detail: `Sync data reset — ${deleted} sync file(s) (device diaries + identity marker) deleted from Drive; local baselines cleared` },
        ...log,
      ].slice(0, 100))
      return { success: true, deleted }
    } catch (error) {
      return handleSyncError(error, 'Reset sync data')
    }
  })

  ipcMain.handle('sync:restoreFromLadder', async (_, slotName: string) => {
    if (!isSignedIn()) return { success: false, error: 'OFFLINE' }
    return await restoreFromLadder(slotName)
  })
}

// Looks for the backup file in the user's Drive appDataFolder without
// downloading anything. Returns null-ish info on any failure so callers can
// treat unreachable cloud the same as "no backup" — the UI then proceeds with
// onboarding instead of getting stuck on an error.
export const checkCloudBackup = async (): Promise<{
  exists: boolean
  modifiedTime?: string
  size?: number
}> => {
  // Demo mode never has a real cloud backup
  if (store.get('demo_mode')) {
    return { exists: false }
  }

  try {
    const auth = getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })

    const response = await drive.files.list({
      spaces: 'appDataFolder',
      q: `name='${CLOUD_DB_FILENAME}'`,
      fields: 'files(id, name, modifiedTime, size)',
      pageSize: 1
    })

    const files = response.data.files || []
    if (files.length === 0) {
      return { exists: false }
    }

    const cloudFile = files[0]
    return {
      exists: true,
      modifiedTime: cloudFile.modifiedTime || undefined,
      size: cloudFile.size ? Number(cloudFile.size) : undefined,
    }
  } catch (error) {
    console.error('checkCloudBackup error:', error)
    return { exists: false }
  }
}

// Manual-sync pre-flight. Reports the four-way state used by the renderer to
// decide direction or surface a conflict dialog.
//   - localChanged: this device edited local since lastKnownCloudMtime
//   - cloudChanged: cloud's mtime has advanced past lastKnownCloudMtime (i.e.
//                   another device synced since this device last knew)
//   - isConflict:   both → render the conflict dialog
//   - firstSync:    tracker unset → caller should upload-only (syncUpload
//                   primes the tracker so future syncs use real detection)
export const syncState = async (): Promise<{
  cloudExists: boolean
  localChanged: boolean
  cloudChanged: boolean
  isConflict: boolean
  firstSync: boolean
  cloudModifiedTime?: string
  cloudSize?: number
}> => {
  if (store.get('demo_mode')) {
    return { cloudExists: false, localChanged: false, cloudChanged: false, isConflict: false, firstSync: false }
  }

  const auth = getOAuth2Client()
  const drive = google.drive({ version: 'v3', auth })
  const dbPath = getDatabasePath()

  const response = await drive.files.list({
    spaces: 'appDataFolder',
    q: `name='${CLOUD_DB_FILENAME}'`,
    fields: 'files(id, name, modifiedTime, size)',
    pageSize: 1,
  })
  const files = response.data.files || []

  if (files.length === 0) {
    // Cloud is empty — nothing to conflict with. Caller should upload.
    return {
      cloudExists: false,
      localChanged: fs.existsSync(dbPath),
      cloudChanged: false,
      isConflict: false,
      firstSync: false,
    }
  }

  const cloudFile = files[0]
  const cloudMtime = new Date(cloudFile.modifiedTime!)
  const cloudInfo = {
    cloudModifiedTime: cloudFile.modifiedTime || undefined,
    cloudSize: cloudFile.size ? Number(cloudFile.size) : undefined,
  }

  const lastKnownCloud = getLastKnownCloudMtime()
  const lastKnownLocal = getLastKnownLocalMtime()
  if (!lastKnownCloud || !lastKnownLocal) {
    // Either tracker missing → this device has no baseline for THIS account's
    // cloud file (brand-new install, or trackers wiped by sign-out/switch). A
    // cloud backup EXISTS and we cannot prove it's ours — so report it as
    // cloudChanged and let the caller put a human in the loop. Reporting the
    // old all-clear here was the exact gap that let a re-signed-in desktop
    // silently overwrite a newer mobile backup (the May data-loss incident).
    return {
      cloudExists: true,
      localChanged: false,
      cloudChanged: true,
      isConflict: false,
      firstSync: true,
      ...cloudInfo,
    }
  }

  const localStats = fs.existsSync(dbPath) ? fs.statSync(dbPath) : null
  const localMtime = localStats ? localStats.mtime : new Date(0)

  // Compare each tracker against its OWN counterpart. Mixing local vs cloud
  // mtime here used to make every post-upload syncMetadata write look like a
  // user edit, locking us into a perpetual "Backup complete" loop.
  const localChanged = localMtime > lastKnownLocal
  const cloudChanged = cloudMtime > lastKnownCloud

  return {
    cloudExists: true,
    localChanged,
    cloudChanged,
    isConflict: localChanged && cloudChanged,
    firstSync: false,
    ...cloudInfo,
  }
}

// Explicit upload — pushes local DB to cloud, overwriting whatever's there.
// On success, records the cloud's new modifiedTime so future conflict checks
// are calibrated against this baseline.
export const syncUpload = async (): Promise<{ success: boolean; error?: string }> => {
  if (store.get('demo_mode')) {
    return { success: true }
  }

  try {
    updateSyncStatus({ status: 'syncing', lastError: null })

    const auth = getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const dbPath = getDatabasePath()

    // Never stream the LIVE file — a write transaction mid-stream (row-sync
    // merge, a user saving an invoice) would upload torn pages. The snapshot
    // is consistent by construction and holds the DB lock only while it's
    // being written, not for the whole (slow) upload.
    const snapshotPath = `${dbPath}.upload`
    await snapshotDatabaseTo(snapshotPath)

    let updated
    try {
      const response = await drive.files.list({
        spaces: 'appDataFolder',
        q: `name='${CLOUD_DB_FILENAME}'`,
        fields: 'files(id)',
        pageSize: 1,
      })
      const files = response.data.files || []

      if (files.length > 0) {
        updated = await drive.files.update({
          fileId: files[0].id!,
          media: { mimeType: 'application/x-sqlite3', body: fs.createReadStream(snapshotPath) },
          fields: 'modifiedTime',
        })
      } else {
        updated = await drive.files.create({
          requestBody: { name: CLOUD_DB_FILENAME, parents: ['appDataFolder'] },
          media: { mimeType: 'application/x-sqlite3', body: fs.createReadStream(snapshotPath) },
          fields: 'id, modifiedTime',
        })
      }
    } finally {
      try {
        if (fs.existsSync(snapshotPath)) fs.unlinkSync(snapshotPath)
      } catch { /* best-effort cleanup */ }
    }

    if (updated.data.modifiedTime) {
      setLastKnownCloudMtime(updated.data.modifiedTime)
    }
    // Track when THIS device last successfully pushed, separate from the
    // shared "Last cloud backup" stamp in SyncMetadata.
    store.set(LAST_UPLOAD_TIMESTAMP_KEY, new Date().toISOString())

    const deviceId = getDeviceId()
    await getDb()
      .insert(syncMetadata)
      .values({ id: 'main', lastSyncTimestamp: new Date(), syncStatus: 'idle', deviceId })
      .onConflictDoUpdate({
        target: syncMetadata.id,
        set: { lastSyncTimestamp: new Date(), syncStatus: 'idle', deviceId },
      })

    // Capture local mtime AFTER our own writes so the next syncState's
    // localChanged check excludes this bookkeeping bump.
    const localStatsAfter = fs.existsSync(dbPath) ? fs.statSync(dbPath) : null
    if (localStatsAfter) setLastKnownLocalMtime(localStatsAfter.mtime)

    updateSyncStatus({ status: 'idle', lastSync: new Date() })
    return { success: true }
  } catch (error) {
    return handleSyncError(error, 'Upload')
  }
}

// The ONE safe way to replace the local DB with a Drive file: download to a
// TEMP file (a dropped connection must leave the live DB untouched), resolve
// on the WRITE stream's 'finish' (the source's 'end' fires before bytes hit
// disk), verify the size, then swap — Prisma disconnected first (Windows file
// locks), stale WAL/SHM/journal sidecars cleared, the outgoing DB parked as a
// .pre-restore-<stamp> sibling (rename it back to undo a wrong restore), and
// the temp file renamed into place with a copy fallback. Once the old DB is
// parked, the temp file is the ONLY copy of the restored data and must never
// be deleted on failure. Used by both the whole-file restore and the ladder
// time-machine restore.
const replaceLocalDbFromDrive = async (
  drive: any,
  fileId: string,
  expectedSize: number | null,
): Promise<void> => {
  const dbPath = getDatabasePath()
  const tmpPath = `${dbPath}.download`

  // PHASE 1 — download + verify; failure leaves the live DB untouched.
  try {
    const fileResponse = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    )

    await new Promise<void>((resolve, reject) => {
      const dest = fs.createWriteStream(tmpPath)
      fileResponse.data.on('error', reject)
      dest.on('error', reject)
      dest.on('finish', () => resolve())
      fileResponse.data.pipe(dest)
    })

    const gotSize = fs.statSync(tmpPath).size
    if (gotSize === 0 || (expectedSize != null && gotSize !== expectedSize)) {
      throw new Error(`Download incomplete (${gotSize} of ${expectedSize ?? 'unknown'} bytes) — local data untouched.`)
    }
  } catch (e) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
    } catch { /* best-effort cleanup */ }
    throw e
  }

  // PHASE 2 — swap; no tmp cleanup on failure past this point. Runs under the
  // DB-file lock so it WAITS for an in-flight row-sync merge or snapshot to
  // finish instead of killing it mid-transaction via $disconnect.
  await withDbFileLock(async () => {
    closeDrizzle() // the libsql handle would block the rename on Windows
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = `${dbPath}${suffix}`
      if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar)
    }
    // PARK the outgoing DB instead of deleting it — restore must be the only
    // undoable-by-rename "destructive" action in the app (a wrong-direction
    // restore is recovered by renaming this file back to neuinvoicing.db).
    // Only the newest parked copy is kept, bounding disk cost to one extra DB.
    if (fs.existsSync(dbPath)) {
      const dir = path.dirname(dbPath)
      const parkedPrefix = `${path.basename(dbPath)}.pre-restore-`
      for (const name of fs.readdirSync(dir)) {
        if (name.startsWith(parkedPrefix)) {
          try { fs.unlinkSync(path.join(dir, name)) } catch { /* best-effort */ }
        }
      }
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
      try {
        fs.renameSync(dbPath, `${dbPath}.pre-restore-${stamp}`)
      } catch {
        // Parking is a safety net, not a correctness requirement — the download
        // is already verified, so fall back to the plain delete rather than
        // failing the whole restore.
        fs.unlinkSync(dbPath)
      }
    }
    try {
      fs.renameSync(tmpPath, dbPath)
    } catch {
      fs.copyFileSync(tmpPath, dbPath)
      try { fs.unlinkSync(tmpPath) } catch { /* keep the spare copy */ }
    }

    await ensureTablesExist(dbPath)
    await reconnectDatabase()
  })
}

// Explicit download — replaces local DB with cloud. Caller MUST have user
// confirmation; this is destructive to any unsynced local edits.
export const syncDownload = async (): Promise<{ success: boolean; error?: string }> => {
  if (store.get('demo_mode')) {
    return { success: true }
  }

  try {
    updateSyncStatus({ status: 'syncing', lastError: null })

    const auth = getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const dbPath = getDatabasePath()

    const response = await drive.files.list({
      spaces: 'appDataFolder',
      q: `name='${CLOUD_DB_FILENAME}'`,
      fields: 'files(id, modifiedTime, size)',
      pageSize: 1,
    })
    const files = response.data.files || []

    if (files.length === 0) {
      updateSyncStatus({ status: 'idle', lastSync: new Date() })
      return { success: false, error: 'No backup found in cloud' }
    }

    const cloudFile = files[0]
    const expectedSize = cloudFile.size ? Number(cloudFile.size) : null

    // A 0-byte cloud file is the residue of a failed upload — restoring it
    // would wipe the local data it was supposed to protect.
    if (expectedSize === 0) {
      updateSyncStatus({ status: 'idle', lastSync: new Date() })
      return { success: false, error: 'The cloud backup file is empty (a previous upload failed). Back up again from the device that has your data.' }
    }

    await replaceLocalDbFromDrive(drive, cloudFile.id!, expectedSize)
    // Same reasoning as resetSyncBaseline: a tripwire pause recorded against
    // the replaced database is meaningless for the restored one.
    store.delete('row_sync_pending_removals')

    if (cloudFile.modifiedTime) {
      setLastKnownCloudMtime(cloudFile.modifiedTime)
    }

    const deviceId = getDeviceId()
    await getDb()
      .insert(syncMetadata)
      .values({ id: 'main', lastSyncTimestamp: new Date(), syncStatus: 'idle', deviceId })
      .onConflictDoUpdate({
        target: syncMetadata.id,
        set: { lastSyncTimestamp: new Date(), syncStatus: 'idle', deviceId },
      })

    // Same baseline-capture as syncUpload — the just-downloaded file's mtime
    // is "now" (when the local write finished), plus syncMetadata bumped it
    // further. Both should count as the new "synced" baseline.
    const localStatsAfter = fs.existsSync(dbPath) ? fs.statSync(dbPath) : null
    if (localStatsAfter) setLastKnownLocalMtime(localStatsAfter.mtime)

    updateSyncStatus({ status: 'idle', lastSync: new Date() })
    return { success: true }
  } catch (error) {
    return handleSyncError(error, 'Download')
  }
}

// Bundle of everything the Settings → Backup tab wants to show:
//   - cloudBackup: latest cloud-side metadata (whoever synced last)
//   - thisDeviceLastUpload: this specific device's last successful upload
//   - backupFrequency: current cadence on this device
export const getBackupInfo = async (): Promise<{
  cloudBackup: { lastSyncTimestamp: string; deviceId: string } | null
  thisDeviceLastUpload: string | null
  backupFrequency: BackupFrequency
}> => {
  let cloudBackup: { lastSyncTimestamp: string; deviceId: string } | null = null
  try {
    const [metadata] = await getDb().select().from(syncMetadata).where(eq(syncMetadata.id, 'main')).limit(1)
    if (metadata) {
      cloudBackup = {
        lastSyncTimestamp: metadata.lastSyncTimestamp.toISOString(),
        deviceId: metadata.deviceId,
      }
    }
  } catch (e) {
    console.error('getBackupInfo: failed to read SyncMetadata:', e)
  }

  const lastUpload = store.get(LAST_UPLOAD_TIMESTAMP_KEY) as string | undefined

  return {
    cloudBackup,
    thisDeviceLastUpload: lastUpload || null,
    backupFrequency: getBackupFrequency(),
  }
}

export const setBackupFrequencyValue = (freq: BackupFrequency) => {
  store.set(BACKUP_FREQUENCY_KEY, freq)
}

// Time-based "is it due?" check. Not tick-based — that would miss cadence
// boundaries when the app was closed across them. Compares wall-clock time
// vs last_scheduled_sync_at.
const runIfScheduledSyncDue = async () => {
  const freq = getBackupFrequency()
  if (freq === 'off') return

  // No tokens = not signed in. Don't bother making Drive calls.
  if (!store.get('google_tokens')) return

  // Don't collide with a manual sync the user just kicked off.
  if (syncStatus.status === 'syncing') return

  const lastScheduled = store.get(LAST_SCHEDULED_SYNC_KEY) as string | undefined
  const lastTime = lastScheduled ? new Date(lastScheduled).getTime() : 0
  const intervalMs = FREQUENCY_INTERVAL_MS[freq]
  if (Date.now() - lastTime < intervalMs) return

  try {
    const state = await syncState()

    // Scheduled is upload-only by policy. If cloud has changes the user hasn't
    // seen, OR there's a true conflict, skip — user must manually resolve.
    if (state.cloudExists && (state.isConflict || state.cloudChanged)) {
      console.log('Scheduled backup: cloud diverged from this device, skipping')
      return
    }

    // Upload if anything's worth uploading (or if this is the first sync).
    if (state.localChanged || state.firstSync || !state.cloudExists) {
      console.log('Scheduled backup: uploading')
      const result = await syncUpload()
      console.log('Scheduled backup:', result.success ? 'done' : `failed (${result.error})`)
    } else {
      console.log('Scheduled backup: nothing to upload')
    }
  } catch (e) {
    console.log('Scheduled backup error:', e)
  } finally {
    // Record the attempt either way — keeps a failure from hammering Drive
    // every hour. Next attempt will be one cadence from now.
    store.set(LAST_SCHEDULED_SYNC_KEY, new Date().toISOString())
  }
}

// ── Backup ladder (S4, D7) ───────────────────────────────────────────────────
// Three additional slots beside the main backup: daily (freshest), weekly and
// monthly (STALE ON PURPOSE — the time machine for disasters noticed late).
// Ladder copies are BLOB-STRIPPED + VACUUMed (~10 MB instead of ~300 MB):
// bill photos live once as img-bill-* files (S4 image split), and
// previousInvoice PDFs stay in the live DB + the full manual backup.
// Staleness is judged by the DRIVE file's own age, so two devices sharing the
// slots can't thrash each other's cadence.

const LADDER_SLOTS = [
  { name: 'backup-daily.db', minAgeMs: 24 * 60 * 60 * 1000 },
  { name: 'backup-weekly.db', minAgeMs: 7 * 24 * 60 * 60 * 1000 },
  { name: 'backup-monthly.db', minAgeMs: 30 * 24 * 60 * 60 * 1000 },
]

const buildStrippedLedgerCopy = async (): Promise<string> => {
  const dbPath = getDatabasePath()
  const tmpPath = `${dbPath}.ladder`
  // Consistent snapshot (VACUUM INTO under the DB-file lock) — a raw file
  // copy could capture torn pages mid-transaction, and this also folds any
  // WAL content in without a separate checkpoint.
  await snapshotDatabaseTo(tmpPath)

  const tmp = createClient({ url: `file:${tmpPath}` })
  try {
    await tmp.execute(`UPDATE "PurchaseBill" SET "attachmentData" = NULL`)
    // fileData is NOT NULL — empty blob, not NULL.
    await tmp.execute(`UPDATE "PreviousInvoice" SET "fileData" = X''`)
    await tmp.execute(`VACUUM`)
  } finally {
    tmp.close()
  }
  return tmpPath
}

const runLadderIfDue = async () => {
  if (store.get('demo_mode') || !store.get('google_tokens')) return
  try {
    const auth = getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const now = Date.now()

    // Decide which slots are due from the Drive files' own age.
    const due: { name: string; fileId?: string }[] = []
    for (const slot of LADDER_SLOTS) {
      const res = await drive.files.list({
        spaces: 'appDataFolder',
        q: `name='${slot.name}' and trashed=false`,
        fields: 'files(id,modifiedTime,size)',
        pageSize: 1,
      })
      const f = res.data.files?.[0]
      // A 0-byte slot (failed two-step upload from the phone) counts as missing.
      const age =
        f?.modifiedTime && Number(f.size ?? 0) > 0
          ? now - new Date(f.modifiedTime).getTime()
          : Infinity
      if (age >= slot.minAgeMs) due.push({ name: slot.name, fileId: f?.id ?? undefined })
    }
    if (due.length === 0) return

    const tmpPath = await buildStrippedLedgerCopy()
    try {
      for (const slot of due) {
        const media = { mimeType: 'application/x-sqlite3', body: fs.createReadStream(tmpPath) }
        if (slot.fileId) {
          await drive.files.update({ fileId: slot.fileId, media })
        } else {
          await drive.files.create({ requestBody: { name: slot.name, parents: ['appDataFolder'] }, media })
        }
      }
      console.log(`[ladder] refreshed ${due.map((s) => s.name).join(', ')}`)
    } finally {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath)
      } catch { /* best-effort cleanup */ }
    }
  } catch (e) {
    console.error('[ladder] failed, app continues:', e)
  }
}

// Ladder metadata for the Settings "time machine" list.
export const getLadderInfo = async (): Promise<
  { name: string; modifiedTime: string | null; size: number | null }[]
> => {
  if (store.get('demo_mode') || !store.get('google_tokens')) return []
  try {
    const auth = getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const out: { name: string; modifiedTime: string | null; size: number | null }[] = []
    for (const slot of LADDER_SLOTS) {
      const res = await drive.files.list({
        spaces: 'appDataFolder',
        q: `name='${slot.name}' and trashed=false`,
        fields: 'files(id,modifiedTime,size)',
        pageSize: 1,
      })
      const f = res.data.files?.[0]
      out.push({
        name: slot.name,
        modifiedTime: f?.modifiedTime ?? null,
        size: f?.size ? Number(f.size) : null,
      })
    }
    return out
  } catch (e) {
    console.error('getLadderInfo error:', e)
    return []
  }
}

// Time-machine restore: replace the local DB with a ladder rung. Ladder copies
// are BLOB-STRIPPED — bill photos and archive files refetch lazily from their
// img-* Drive objects afterwards. Baselines reset so the device re-syncs
// forward from the restored state (row-sync diaries replay the newer edits).
export const restoreFromLadder = async (slotName: string): Promise<{ success: boolean; error?: string }> => {
  if (!LADDER_SLOTS.some((s) => s.name === slotName)) {
    return { success: false, error: 'Unknown backup slot.' }
  }
  if (!store.get('google_tokens')) return { success: false, error: 'Connect your Google account first.' }
  try {
    updateSyncStatus({ status: 'syncing', lastError: null })
    const auth = getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const res = await drive.files.list({
      spaces: 'appDataFolder',
      q: `name='${slotName}' and trashed=false`,
      fields: 'files(id,modifiedTime,size)',
      pageSize: 1,
    })
    const f = res.data.files?.[0]
    if (!f) return { success: false, error: 'That backup slot does not exist yet.' }
    const expected = f.size ? Number(f.size) : null
    if (expected === 0) return { success: false, error: 'That backup slot is empty.' }

    await replaceLocalDbFromDrive(drive, f.id!, expected)
    resetSyncBaseline()

    updateSyncStatus({ status: 'idle', lastSync: new Date() })
    return { success: true }
  } catch (error) {
    return handleSyncError(error, 'Ladder restore')
  }
}

// Records the cloud backup slot's own age for the Layout's stale-backup
// warning. Reads the SLOT's timestamp from Drive (one files.list per hour) —
// deliberately NOT our upload history, because the warning must keep working
// precisely when uploads are failing. 0 = slot missing entirely.
const recordBackupSlotAge = async () => {
  try {
    if (!isSignedIn() || store.get('demo_mode')) return
    const auth = getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })
    const res = await drive.files.list({
      spaces: 'appDataFolder',
      q: `name='${CLOUD_DB_FILENAME}'`,
      fields: 'files(modifiedTime)',
      pageSize: 1,
    })
    const f = (res.data.files || [])[0]
    store.set('backup_slot_mtime', f?.modifiedTime ? new Date(f.modifiedTime).getTime() : 0)
  } catch {
    // Unreachable (offline / dead token) — keep the last known value; the
    // session banner owns the dead-token story.
  }
}

let schedulerInterval: NodeJS.Timeout | null = null

export const startBackupScheduler = () => {
  if (schedulerInterval) return
  // Run once on startup — catches "I had it set to Daily but closed my laptop
  // for 3 days" cases.
  void runIfScheduledSyncDue()
  void runLadderIfDue()
  void recordBackupSlotAge()
  schedulerInterval = setInterval(() => {
    void runIfScheduledSyncDue()
    void runLadderIfDue()
    void recordBackupSlotAge()
  }, SCHEDULER_TICK_MS)
}

export const stopBackupScheduler = () => {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
  }
}

