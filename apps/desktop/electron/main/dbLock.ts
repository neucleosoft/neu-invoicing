// Serializes big multi-row writes (row-sync merge + recompute) against
// whole-file snapshots (full backup, ladder rungs). The desktop DB runs in
// SQLite's default rollback-journal mode, where the MAIN file holds
// uncommitted pages during a write transaction — copying or streaming it in
// that window produces a torn, corrupt backup. Everything that snapshots the
// DB file, and the row-sync apply, must run through this lock.
import fs from 'fs'
import { getDbClient } from './db'

let tail: Promise<void> = Promise.resolve()

export function withDbFileLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = tail.then(() => fn())
  tail = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

// Consistent point-in-time copy of the live DB via SQLite's VACUUM INTO — a
// proper read-transaction snapshot even while other connections write (unlike
// fs.copyFileSync / createReadStream on the live file, which can capture torn
// pages). WAL content is folded in by construction, so no separate checkpoint
// is needed. Runs under the lock so it can't start mid-merge either.
//
// INTEGRITY GATE: quick_check runs first — a corrupted database must fail the
// backup loudly instead of silently overwriting the good cloud copy with a
// corrupt one (backups exist for exactly the day corruption happens).
export async function snapshotDatabaseTo(targetPath: string): Promise<void> {
  // VACUUM INTO refuses to overwrite an existing file.
  if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath)
  await withDbFileLock(async () => {
    const check = await getDbClient().execute(`PRAGMA quick_check(1)`)
    const verdict = check.rows?.[0] ? Object.values(check.rows[0])[0] : undefined
    if (verdict !== 'ok') {
      console.error('[integrity] quick_check failed before snapshot:', JSON.stringify(check.rows))
      throw new Error(
        'Database integrity check FAILED — backup aborted so a corrupt copy never overwrites a good one. See Settings → Open logs folder.',
      )
    }
    await getDbClient().execute(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`)
  })
}
