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

// Fetches the raw file bytes for a Drive file id. `alt=media` is what
// switches Drive's GET from "return JSON metadata" to "return file body".
// Returns Uint8Array so it can be handed to expo-file-system's File.write
// or to expo-sqlite's deserialize without further conversion.
export async function downloadCloudBackup(
  accessToken: string,
  fileId: string
): Promise<Uint8Array> {
  const res = await fetch(`${DRIVE_FILES_URL}/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`Drive download failed (${res.status}): ${errText}`)
  }
  const buffer = await res.arrayBuffer()
  return new Uint8Array(buffer)
}

// Overwrites the live mobile SQLite file with downloaded cloud bytes, then
// stamps the migration table so Drizzle's runMigrations() treats every known
// migration as already applied on the next boot.
//
// Caller MUST trigger an app reload immediately after this returns — the
// SQLiteProvider is still holding a (now-invalid) handle to the old file in
// memory. Anything that touches the live db before the reload will throw.
export async function applyCloudBackup(
  bytes: Uint8Array,
  liveDb: SQLite.SQLiteDatabase
): Promise<void> {
  // 1. Release Android's lock on the live DB so we can overwrite the file.
  await liveDb.closeAsync()

  // 2. expo-sqlite stores DBs at <documentDirectory>/SQLite/<name>. Make sure
  //    that directory exists (it will after first launch, but be defensive).
  const sqliteDir = new Directory(Paths.document, 'SQLite')
  if (!sqliteDir.exists) {
    sqliteDir.create({ intermediates: true })
  }

  // 3. Overwrite the DB file with the downloaded bytes.
  const dbFile = new File(sqliteDir, MOBILE_DB_NAME)
  if (dbFile.exists) {
    dbFile.delete()
  }
  dbFile.create()
  dbFile.write(bytes)

  // 4. The imported file came from Prisma — it has every table our schema
  //    expects, but no __drizzle_migrations table. Without intervention the
  //    next runMigrations() pass will try to CREATE TABLE Item etc. and fail
  //    with "table already exists". Insert a single row dated forward of every
  //    known migration; Drizzle's migrator compares each migration's
  //    folderMillis against the latest created_at and skips anything older.
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
}

// One-call restore: list → download → apply. Callers (Settings screen) just
// invoke this and reload the app. Throws if no backup exists, so the UI can
// surface "nothing to restore from" without doing its own list call first.
export async function restoreFromCloud(
  accessToken: string,
  liveDb: SQLite.SQLiteDatabase
): Promise<CloudBackupInfo> {
  const info = await checkCloudBackup(accessToken)
  if (!info.exists || !info.fileId) {
    throw new Error('No cloud backup found — sync from desktop first.')
  }
  const bytes = await downloadCloudBackup(accessToken, info.fileId)
  await applyCloudBackup(bytes, liveDb)
  return info
}
