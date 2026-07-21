// Boot-time schema management — the electron-free half (importable by the
// sandbox / proof scripts without an Electron runtime). See database.ts for
// the boot ORDER; this module owns the three-population upgrade logic:
// deploy-lite for Prisma-born DBs, tolerant catch-up for legacy db-push DBs,
// and drizzle-tracker adoption so ONE migration lineage
// (packages/shared/drizzle) serves both apps from here on.

import path from 'path'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { createClient } from '@libsql/client'

const isDevMode = () => !!process.env.VITE_DEV_SERVER_URL

// Where the shipped migration folders live. Dev: the repo. Prod: extraResources.
const prismaMigrationsDir = () =>
  isDevMode()
    ? path.join(process.cwd(), 'prisma', 'migrations')
    : path.join(process.resourcesPath, 'prisma', 'migrations')

export const drizzleMigrationsDir = () =>
  isDevMode()
    ? path.join(process.cwd(), '..', '..', 'packages', 'shared', 'drizzle')
    : path.join(process.resourcesPath, 'drizzle')

// Split a migration.sql into statements. Our SQLite migrations are plain
// CREATE/ALTER/UPDATE/INSERT statements — no triggers, so a semicolon at
// end-of-line is a safe boundary.
const splitStatements = (sqlText: string): string[] =>
  sqlText
    .split(/;\s*[\r\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'))

const listMigrationFolders = (dir: string): string[] => {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((name) => {
      try {
        return fs.statSync(path.join(dir, name)).isDirectory()
      } catch {
        return false
      }
    })
    .sort()
}

/**
 * Bring the DB file at dbPath up to the current schema (see file header).
 * Uses its own short-lived libsql client — call BEFORE openDrizzle.
 */
export const ensureTablesExist = async (dbPath: string): Promise<void> => {
  const client = createClient({ url: `file:${dbPath}` })
  try {
    const tableExists = async (name: string): Promise<boolean> => {
      const res = await client.execute({
        sql: "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        args: [name],
      })
      return res.rows.length > 0
    }

    const hasDrizzleTracker = await tableExists('__drizzle_migrations')
    const hasPrismaTracker = await tableExists('_prisma_migrations')
    const hasData = await tableExists('SalesInvoice')

    if (!hasDrizzleTracker && (hasPrismaTracker || hasData)) {
      const folders = listMigrationFolders(prismaMigrationsDir())

      if (hasPrismaTracker) {
        // Deploy-lite: apply only what the tracker says is pending, in order.
        // (Tracker rows whose folder no longer ships — the known orphan
        // 20260527115832_add_expenses — are simply ignored, exactly like the
        // Prisma CLI tolerated them.)
        const appliedRes = await client.execute(
          'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL',
        )
        const applied = new Set(appliedRes.rows.map((r) => String(r.migration_name)))
        for (const folder of folders) {
          if (applied.has(folder)) continue
          const sqlFile = path.join(prismaMigrationsDir(), folder, 'migration.sql')
          if (!fs.existsSync(sqlFile)) continue
          const text = fs.readFileSync(sqlFile, 'utf8')
          console.log(`[boot-migrate] applying pending migration ${folder}`)
          await client.executeMultiple(text)
          await client.execute({
            sql: 'INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, 1)',
            args: [randomUUID(), '', new Date().toISOString(), folder, new Date().toISOString()],
          })
        }
      } else {
        // Legacy db-push install (no tracker): tolerant statement-by-statement
        // catch-up — existing tables/columns throw and are skipped; genuinely
        // missing pieces get created; idempotent data backfills re-run safely.
        console.log('[boot-migrate] no migration tracker — running tolerant catch-up')
        for (const folder of folders) {
          const sqlFile = path.join(prismaMigrationsDir(), folder, 'migration.sql')
          if (!fs.existsSync(sqlFile)) continue
          for (const stmt of splitStatements(fs.readFileSync(sqlFile, 'utf8'))) {
            try {
              await client.execute(stmt)
            } catch {
              // expected: "already exists" / "duplicate column name"
            }
          }
        }
      }

      // ADOPT the drizzle tracker so its migrator sees this DB as current.
      // CRITICAL: stamp each bundled migration with its REAL folderMillis
      // (journal `when`) — drizzle applies entries newer than MAX(created_at),
      // so a Date.now() stamp would skip every future shipped migration.
      const journalPath = path.join(drizzleMigrationsDir(), 'meta', '_journal.json')
      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as {
        entries: { tag: string; when: number }[]
      }
      await client.executeMultiple(`
        CREATE TABLE IF NOT EXISTS __drizzle_migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          hash text NOT NULL,
          created_at numeric
        );
      `)
      const count = await client.execute('SELECT COUNT(*) AS c FROM __drizzle_migrations')
      if (Number(count.rows[0]?.c ?? 0) === 0) {
        for (const entry of journal.entries) {
          await client.execute({
            sql: 'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)',
            args: [entry.tag, entry.when],
          })
        }
        console.log(`[boot-migrate] adopted drizzle tracker (${journal.entries.length} migrations recorded)`)
      }
    }
  } finally {
    client.close()
  }
}

