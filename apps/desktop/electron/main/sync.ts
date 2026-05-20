import { ipcMain, BrowserWindow } from 'electron'
import { google } from 'googleapis'
import { getOAuth2Client, isAuthError, clearStoredCredentials } from './auth'
import { getDatabasePath, getPrisma, ensureTablesExist, reconnectDatabase } from './database'
import fs from 'fs'
import Store from 'electron-store'

const store = new Store()

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
    // Either tracker missing → this device hasn't completed a conflict-aware
    // sync yet (brand-new install, or pre-fix existing user). Don't surface a
    // fake conflict; caller uploads and primes both trackers in lockstep.
    return {
      cloudExists: true,
      localChanged: false,
      cloudChanged: false,
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

    const response = await drive.files.list({
      spaces: 'appDataFolder',
      q: `name='${CLOUD_DB_FILENAME}'`,
      fields: 'files(id)',
      pageSize: 1,
    })
    const files = response.data.files || []

    let updated
    if (files.length > 0) {
      updated = await drive.files.update({
        fileId: files[0].id!,
        media: { mimeType: 'application/x-sqlite3', body: fs.createReadStream(dbPath) },
        fields: 'modifiedTime',
      })
    } else {
      updated = await drive.files.create({
        requestBody: { name: CLOUD_DB_FILENAME, parents: ['appDataFolder'] },
        media: { mimeType: 'application/x-sqlite3', body: fs.createReadStream(dbPath) },
        fields: 'id, modifiedTime',
      })
    }

    if (updated.data.modifiedTime) {
      setLastKnownCloudMtime(updated.data.modifiedTime)
    }
    // Track when THIS device last successfully pushed, separate from the
    // shared "Last cloud backup" stamp in SyncMetadata.
    store.set(LAST_UPLOAD_TIMESTAMP_KEY, new Date().toISOString())

    const prisma = getPrisma()
    const deviceId = require('os').hostname()
    await prisma.syncMetadata.upsert({
      where: { id: 'main' },
      update: { lastSyncTimestamp: new Date(), syncStatus: 'idle', deviceId },
      create: { id: 'main', lastSyncTimestamp: new Date(), syncStatus: 'idle', deviceId },
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
      fields: 'files(id, modifiedTime)',
      pageSize: 1,
    })
    const files = response.data.files || []

    if (files.length === 0) {
      updateSyncStatus({ status: 'idle', lastSync: new Date() })
      return { success: false, error: 'No backup found in cloud' }
    }

    const cloudFile = files[0]
    const dest = fs.createWriteStream(dbPath)
    const fileResponse = await drive.files.get(
      { fileId: cloudFile.id!, alt: 'media' },
      { responseType: 'stream' }
    )

    await new Promise((resolve, reject) => {
      fileResponse.data.on('end', resolve).on('error', reject).pipe(dest)
    })

    ensureTablesExist(`file:${dbPath}`)
    await reconnectDatabase()

    if (cloudFile.modifiedTime) {
      setLastKnownCloudMtime(cloudFile.modifiedTime)
    }

    const prisma = getPrisma()
    const deviceId = require('os').hostname()
    await prisma.syncMetadata.upsert({
      where: { id: 'main' },
      update: { lastSyncTimestamp: new Date(), syncStatus: 'idle', deviceId },
      create: { id: 'main', lastSyncTimestamp: new Date(), syncStatus: 'idle', deviceId },
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
    const prisma = getPrisma()
    const metadata = await prisma.syncMetadata.findUnique({ where: { id: 'main' } })
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

let schedulerInterval: NodeJS.Timeout | null = null

export const startBackupScheduler = () => {
  if (schedulerInterval) return
  // Run once on startup — catches "I had it set to Daily but closed my laptop
  // for 3 days" cases.
  void runIfScheduledSyncDue()
  schedulerInterval = setInterval(() => {
    void runIfScheduledSyncDue()
  }, SCHEDULER_TICK_MS)
}

export const stopBackupScheduler = () => {
  if (schedulerInterval) {
    clearInterval(schedulerInterval)
    schedulerInterval = null
  }
}

