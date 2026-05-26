// Mobile-side Drive client. Talks to Drive's REST API directly via fetch
// because the `googleapis` SDK is Node-only — won't run under Hermes.
//
// Mirrors apps/desktop/electron/main/sync.ts so a backup written by the
// desktop app lives in the exact same Drive location this client reads from.

import { Directory, File, Paths } from 'expo-file-system'
import * as SQLite from 'expo-sqlite'

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'

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

  return info
}
