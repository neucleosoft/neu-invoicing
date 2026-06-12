// Mobile-side Drive client. Talks to Drive's REST API directly via fetch
// because the `googleapis` SDK is Node-only — won't run under Hermes.
//
// Mirrors apps/desktop/electron/main/sync.ts so a backup written by the
// desktop app lives in the exact same Drive location this client reads from.

import { Directory, File, Paths } from 'expo-file-system'
import * as LegacyFS from 'expo-file-system/legacy'
import * as SecureStore from 'expo-secure-store'
import * as SQLite from 'expo-sqlite'

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

  // Release Android's lock on the live DB so we can overwrite the file.
  await liveDb.closeAsync()

  // expo-sqlite stores DBs at <documentDirectory>/SQLite/<name>. Be defensive
  // — the directory exists after first launch but not on a fresh install
  // where the user restores before opening any screen that touches the db.
  const sqliteDir = new Directory(Paths.document, 'SQLite')
  if (!sqliteDir.exists) {
    sqliteDir.create({ intermediates: true })
  }

  // Stream Drive's response straight to disk via the native downloader. The
  // previous arrayBuffer-based version held the entire file in JS memory,
  // which OOM'd Android's ~256MB JVM heap on any DB above that size.
  const dbFile = new File(sqliteDir, MOBILE_DB_NAME)
  await File.downloadFileAsync(
    `${DRIVE_FILES_URL}/${info.fileId}?alt=media`,
    dbFile,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      idempotent: true,
    }
  )

  // The imported file came from Prisma — it has every table our schema
  // expects, but no __drizzle_migrations table. Without intervention the
  // next runMigrations() pass will try to CREATE TABLE Item etc. and fail
  // with "table already exists". Insert a single row dated forward of every
  // known migration; Drizzle's migrator compares each migration's
  // folderMillis against the latest created_at and skips anything older.
  const importedDb = await SQLite.openDatabaseAsync(MOBILE_DB_NAME)
  try {
    await importedDb.execAsync(`
      CREATE TABLE IF NOT EXISTS __drizzle_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hash text NOT NULL,
        created_at numeric
      );
    `)
    await importedDb.runAsync(
      'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
      'imported_from_cloud',
      Date.now()
    )
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
  // Raw SQL (not Drizzle) so this module needs no db-layer import; column types
  // match shared schema's SyncMetadata (ISO-string dates). NOTE: every NOT NULL
  // column must be set explicitly here — the schema's $defaultFn/$onUpdate
  // defaults (e.g. updatedAt) are JS-side Drizzle behavior that raw SQL bypasses.
  const nowIso = new Date().toISOString()
  await liveDb.runAsync(
    `INSERT INTO SyncMetadata (id, lastSyncTimestamp, deviceId, syncStatus, updatedAt)
     VALUES ('main', ?, 'mobile', 'idle', ?)
     ON CONFLICT(id) DO UPDATE SET
       lastSyncTimestamp = excluded.lastSyncTimestamp,
       deviceId = excluded.deviceId,
       syncStatus = 'idle',
       updatedAt = excluded.updatedAt`,
    nowIso,
    nowIso
  )

  // (2) Fold the WAL into the main file so the upload is a complete snapshot.
  await liveDb.getFirstAsync('PRAGMA wal_checkpoint(TRUNCATE)')

  // (3) Find the existing cloud file or create an empty one to PATCH into.
  let fileId = (await checkCloudBackup(accessToken)).fileId
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
  }

  // (4) Stream the DB file up. expo-sqlite stores it at documentDirectory/SQLite/.
  const dbUri = `${LegacyFS.documentDirectory}SQLite/${MOBILE_DB_NAME}`
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
  if (body.modifiedTime) await setLastKnownCloudMtime(body.modifiedTime)

  return {
    exists: true,
    fileId,
    modifiedTime: body.modifiedTime,
    size: body.size ? Number(body.size) : undefined,
  }
}
