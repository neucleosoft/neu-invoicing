// Serializes big multi-row writes (row-sync merge + recompute) against
// whole-file snapshot reads (full backup upload, ladder copy). The mobile
// twin of apps/desktop/electron/main/dbLock.ts: JS is single-threaded, but
// awaits interleave — a snapshot taken between a merge's statements would
// upload a half-merged ledger.

import * as LegacyFS from 'expo-file-system/legacy'
import * as SQLite from 'expo-sqlite'

// Must match the databaseName passed to <SQLiteProvider> in app/_layout.tsx.
const MOBILE_DB_NAME = 'neu-invoicing.db'

let tail: Promise<void> = Promise.resolve()

export function withDbFileLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = tail.then(() => fn())
  tail = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

// Consistent snapshot of the live DB into <SQLite dir>/<destName>; returns the
// dest file URI. Preferred path is VACUUM INTO — a proper read-transaction
// snapshot that folds WAL content in by construction, immune to a concurrent
// auto-checkpoint tearing a plain file copy. VACUUM INTO needs a plain
// filesystem path (not a file:// URI); if the platform rejects that form, the
// checkpoint+copy fallback is the exact behavior the ladder shipped with.
export async function snapshotDbTo(
  liveDb: SQLite.SQLiteDatabase,
  destName: string,
): Promise<string> {
  const sqliteDirUri = `${LegacyFS.documentDirectory}SQLite/`
  const destUri = `${sqliteDirUri}${destName}`
  for (const suffix of ['', '-wal', '-shm']) {
    await LegacyFS.deleteAsync(`${destUri}${suffix}`, { idempotent: true })
  }
  return withDbFileLock(async () => {
    try {
      const plainPath = decodeURIComponent(destUri.replace(/^file:\/\//, ''))
      await liveDb.execAsync(`VACUUM INTO '${plainPath.replace(/'/g, "''")}'`)
    } catch {
      await liveDb.getFirstAsync('PRAGMA wal_checkpoint(TRUNCATE)')
      await LegacyFS.copyAsync({ from: `${sqliteDirUri}${MOBILE_DB_NAME}`, to: destUri })
    }
    return destUri
  })
}
