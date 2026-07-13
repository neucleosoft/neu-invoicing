// Mobile-side Drive client. Talks to Drive's REST API directly via fetch
// because the `googleapis` SDK is Node-only — won't run under Hermes.
//
// Mirrors apps/desktop/electron/main/sync.ts so a backup written by the
// desktop app lives in the exact same Drive location this client reads from.

import { Directory, File, Paths } from 'expo-file-system'
import * as LegacyFS from 'expo-file-system/legacy'
import * as SecureStore from 'expo-secure-store'
import * as SQLite from 'expo-sqlite'

import drizzleMigrations from '../drizzle/migrations'
import { getDeviceId } from './deviceId'

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

// Must match the databaseName passed to <SQLiteProvider> in app/_layout.tsx.
const MOBILE_DB_NAME = 'neu-invoicing.db'

// Must match CLOUD_DB_FILENAME on the desktop side.
export const CLOUD_DB_FILENAME = 'neuinvoicing.db'

export type CloudBackupInfo = {
  exists: boolean
  fileId?: string
  modifiedTime?: string
  size?: number
}

// Lists the user's appDataFolder for `neuinvoicing.db` without downloading.
// Returns {exists:false} when the folder is empty so callers can treat that
// as a normal "no backup yet" state.
export async function checkCloudBackup(accessToken: string): Promise<CloudBackupInfo> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name='${CLOUD_DB_FILENAME}'`,
    fields: 'files(id,name,modifiedTime,size)',
    pageSize: '1',
  })

  const res = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Drive list failed (${res.status}): ${errText}`)
  }

  const data = (await res.json()) as { files?: Array<{ id: string; modifiedTime?: string; size?: string }> }
  const files = data.files ?? []
  if (files.length === 0) {
    return { exists: false }
  }

  const f = files[0]
  return {
    exists: true,
    fileId: f.id,
    modifiedTime: f.modifiedTime,
    size: f.size ? Number(f.size) : undefined,
  }
}

// One-call restore: list → stream-download → stamp migrations. Callers
// (Settings screen) invoke this and then reload the app — the SQLiteProvider
// is still holding a (now-invalid) handle to the old file in memory, so
// anything that touches the live db before the reload will throw.
//
// Throws if no backup exists so the UI can surface "nothing to restore from"
// without doing its own list call first.
export async function restoreFromCloud(
  accessToken: string,
  liveDb: SQLite.SQLiteDatabase
): Promise<CloudBackupInfo> {
  const info = await checkCloudBackup(accessToken)
  if (!info.exists || !info.fileId) {
    throw new Error('No cloud backup found — sync from desktop first.')
  }

  // A 0-byte cloud file is the residue of a failed upload — restoring it would
  // wipe the local data it was supposed to protect.
  if (!info.size) {
    throw new Error('The cloud backup file is empty (a previous upload failed). Back up again from the device that has your data.')
  }

  // expo-sqlite stores DBs at <documentDirectory>/SQLite/<name>. Be defensive
  // — the directory exists after first launch but not on a fresh install
  // where the user restores before opening any screen that touches the db.
  const sqliteDir = new Directory(Paths.document, 'SQLite')
  if (!sqliteDir.exists) {
    sqliteDir.create({ intermediates: true })
  }

  // Download to a TEMP file — never straight onto the live DB. A dropped
  // connection mid-download used to leave a truncated, corrupt database with
  // no way back; with the temp file, a failed download leaves the live DB
  // untouched (it isn't even closed yet). Streams to disk via the native
  // downloader — an arrayBuffer round-trip would OOM on large DBs.
  const tmpFile = new File(sqliteDir, `${MOBILE_DB_NAME}.download`)
  if (tmpFile.exists) tmpFile.delete()
  await File.downloadFileAsync(
    `${DRIVE_FILES_URL}/${info.fileId}?alt=media`,
    tmpFile,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      idempotent: true,
    }
  )

  // Verify the download is complete before touching the live DB.
  const gotSize = tmpFile.size ?? 0
  if (gotSize === 0 || gotSize !== info.size) {
    tmpFile.delete()
    throw new Error(`Download incomplete (${gotSize} of ${info.size} bytes) — your local data is untouched. Try again.`)
  }

  // Swap: release Android's lock on the live DB, clear stale WAL/SHM sidecars
  // (they belong to the OLD file and would corrupt the new one on first open),
  // then move the verified download into place.
  await liveDb.closeAsync()
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = new File(sqliteDir, `${MOBILE_DB_NAME}${suffix}`)
    if (sidecar.exists) sidecar.delete()
  }
  // PARK the outgoing DB instead of deleting it — a wrong-direction restore is
  // recovered by renaming this file back to the live DB name. Only the newest
  // parked copy is kept, bounding disk cost to one extra DB. (Mirrors
  // replaceLocalDbFromDrive on desktop.)
  const dbFile = new File(sqliteDir, MOBILE_DB_NAME)
  if (dbFile.exists) {
    for (const entry of sqliteDir.list()) {
      if (entry instanceof File && entry.name.startsWith(`${MOBILE_DB_NAME}.pre-restore-`)) {
        try { entry.delete() } catch { /* best-effort */ }
      }
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    try {
      // move() retargets the File instance's uri, so the live-DB destination
      // below must be a FRESH File object, not this one.
      dbFile.move(new File(sqliteDir, `${MOBILE_DB_NAME}.pre-restore-${stamp}`))
    } catch {
      // Parking is a safety net, not a correctness requirement — the download
      // is already verified, so fall back to the plain delete.
      const stale = new File(sqliteDir, MOBILE_DB_NAME)
      if (stale.exists) stale.delete()
    }
  }
  tmpFile.move(new File(sqliteDir, MOBILE_DB_NAME))

  // The imported file came from Prisma — it has every table our schema
  // expects, but no __drizzle_migrations table. Without intervention the next
  // runMigrations() pass would try to CREATE TABLE Item etc. and fail with
  // "table already exists". So we pre-seed the migration tracker to record that
  // every CURRENTLY-bundled migration is already applied.
  //
  // CRITICAL — stamp each migration with its REAL folderMillis (the journal
  // `when`), NOT Date.now(). Drizzle's migrator runs a migration only when its
  // folderMillis is greater than MAX(created_at) in this table. A single
  // Date.now() row poisoned that test: any migration authored BEFORE a restore
  // (every future-shipped migration whose `when` predates the restore moment)
  // looked "already applied" and was skipped forever — the device booted
  // without the new table and crashed on first use ("no such table"). Stamping
  // the real `when` of each shipped migration makes MAX(created_at) equal the
  // newest shipped migration, so only genuinely newer migrations run, and the
  // restored DB (which already holds every current table) is left untouched.
  const importedDb = await SQLite.openDatabaseAsync(MOBILE_DB_NAME)
  try {
    await importedDb.execAsync(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash text NOT NULL,
        created_at numeric
      );
    `)
    const entries: { tag: string; when: number }[] = drizzleMigrations.journal.entries
    for (const entry of entries) {
      await importedDb.runAsync(
        'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
        entry.tag,
        entry.when,
      )
    }
  } finally {
    await importedDb.closeAsync()
  }

  // We just synced WITH the cloud — its current mtime is now this device's
  // known-good baseline for the upload overwrite-guard.
  if (info.modifiedTime) await setLastKnownCloudMtime(info.modifiedTime)

  return info
}

// ─── Backup (upload) ─────────────────────────────────────────────────────────

// Per-device baseline: the cloud file's modifiedTime as of the last time THIS
// device uploaded or restored. Lets the Back-up button warn before overwriting
// a cloud backup some OTHER device (e.g. the desktop) wrote since. Mirrors the
// desktop's last_known_cloud_modified_time tracker in electron-store.
const LAST_KNOWN_CLOUD_MTIME_KEY = 'neu.sync.lastKnownCloudMtime'

export async function getLastKnownCloudMtime(): Promise<string | null> {
  return SecureStore.getItemAsync(LAST_KNOWN_CLOUD_MTIME_KEY)
}

async function setLastKnownCloudMtime(mtime: string): Promise<void> {
  await SecureStore.setItemAsync(LAST_KNOWN_CLOUD_MTIME_KEY, mtime)
}

// True when the cloud holds a backup this device hasn't seen — i.e. uploading
// now would overwrite changes written by another device. The Settings screen
// uses this to show a confirm dialog before calling backupToCloud.
export async function cloudIsAheadOfThisDevice(info: CloudBackupInfo): Promise<boolean> {
  if (!info.exists || !info.modifiedTime) return false
  const baseline = await getLastKnownCloudMtime()
  if (!baseline) return true // cloud exists but this device never synced with it
  return new Date(info.modifiedTime).getTime() > new Date(baseline).getTime()
}

// Upload the local DB to Drive's appDataFolder as `neuinvoicing.db` — the SAME
// file desktop syncs, so either app can restore the other's backup.
//
// Steps and why each exists:
//  1. Stamp SyncMetadata so the uploaded snapshot records who/when backed up
//     (desktop writes the same row via Prisma).
//  2. PRAGMA wal_checkpoint(TRUNCATE) — expo-sqlite runs in WAL mode, so recent
//     commits live in the -wal sidecar, NOT the main .db file. Skipping this
//     would upload a backup missing the newest invoices.
//  3. Find-or-create the Drive file: metadata-only JSON POST when absent (avoids
//     hand-building a multipart body), then PATCH the bytes with uploadType=media.
//  4. Bytes go up via the legacy native uploader (BINARY_CONTENT) — streams from
//     disk; a base64/arrayBuffer round-trip would OOM on large DBs (same trap
//     restoreFromCloud's downloader comment documents).
export async function backupToCloud(
  accessToken: string,
  liveDb: SQLite.SQLiteDatabase
): Promise<CloudBackupInfo> {
  // (1) Record this backup in the DB itself, before the snapshot is taken.
  // Raw SQL (not Drizzle) so this module needs no db-layer import; dates are
  // Unix-ms integers matching Prisma's SQLite dialect (and the shared schema's
  // prismaDate columns). NOTE: every NOT NULL column must be set explicitly
  // here — the schema's $defaultFn/$onUpdate defaults (e.g. updatedAt) are
  // JS-side Drizzle behavior that raw SQL bypasses.
  const nowMs = Date.now()
  const deviceId = await getDeviceId()
  await liveDb.runAsync(
    `INSERT INTO SyncMetadata (id, lastSyncTimestamp, deviceId, syncStatus, updatedAt)
     VALUES ('main', ?, ?, 'idle', ?)
     ON CONFLICT(id) DO UPDATE SET
       lastSyncTimestamp = excluded.lastSyncTimestamp,
       deviceId = excluded.deviceId,
       syncStatus = 'idle',
       updatedAt = excluded.updatedAt`,
    nowMs,
    deviceId,
    nowMs
  )

  // (2) Fold the WAL into the main file so the upload is a complete snapshot.
  await liveDb.getFirstAsync('PRAGMA wal_checkpoint(TRUNCATE)')

  // (3) Find the existing cloud file or create an empty one to PATCH into.
  let fileId = (await checkCloudBackup(accessToken)).fileId
  let createdFresh = false
  if (!fileId) {
    const createRes = await fetch(DRIVE_FILES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: CLOUD_DB_FILENAME, parents: ['appDataFolder'] }),
    })
    if (!createRes.ok) {
      throw new Error(`Drive create failed (${createRes.status}): ${await createRes.text()}`)
    }
    fileId = ((await createRes.json()) as { id: string }).id
    createdFresh = true
  }

  // (4) Stream the DB file up. expo-sqlite stores it at documentDirectory/SQLite/.
  // If the upload fails (or arrives incomplete) right after WE created the file,
  // delete the empty slot — otherwise a 0-byte "backup" sits in Drive looking
  // restorable, and restoring it would wipe a device's data.
  const dbUri = `${LegacyFS.documentDirectory}SQLite/${MOBILE_DB_NAME}`
  try {
    const localInfo = await LegacyFS.getInfoAsync(dbUri)
    const localSize = localInfo.exists && !localInfo.isDirectory ? localInfo.size : undefined

    const uploadRes = await LegacyFS.uploadAsync(
      `${DRIVE_UPLOAD_URL}/${fileId}?uploadType=media&fields=modifiedTime,size`,
      dbUri,
      {
        httpMethod: 'PATCH',
        uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/x-sqlite3',
        },
      }
    )
    if (uploadRes.status < 200 || uploadRes.status >= 300) {
      throw new Error(`Drive upload failed (${uploadRes.status}): ${uploadRes.body}`)
    }

    const body = JSON.parse(uploadRes.body) as { modifiedTime?: string; size?: string }

    // Verify Drive holds the complete file — a half-written cloud backup is
    // worse than none, because it LOOKS restorable.
    const cloudSize = body.size ? Number(body.size) : undefined
    if (localSize != null && cloudSize != null && cloudSize !== localSize) {
      throw new Error(`Backup incomplete: Drive holds ${cloudSize} of ${localSize} bytes. Try again.`)
    }

    if (body.modifiedTime) await setLastKnownCloudMtime(body.modifiedTime)

    return {
      exists: true,
      fileId,
      modifiedTime: body.modifiedTime,
      size: cloudSize,
    }
  } catch (e) {
    if (createdFresh) {
      // Best-effort: remove the empty/partial slot we just created.
      await fetch(`${DRIVE_FILES_URL}/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {})
    }
    throw e
  }
}
