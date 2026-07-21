// Desktop Drizzle connection (Prisma→Drizzle migration) — the desktop twin of
// apps/mobile/db/index.ts. One libsql client on the SAME SQLite file, wrapped
// in drizzle with the SHARED schema (packages/shared/src/schema.ts) — so
// desktop and mobile now speak the same query layer and can share the whole
// DB-touching half of sync, recompute, and the money brain.
//
// Why @libsql/client and not better-sqlite3: it's N-API (loads in Electron
// with no rebuild) and ASYNC — drizzle's better-sqlite3 driver only supports
// synchronous transaction callbacks, which would have made every shared
// module (paymentLogic, rowSyncDb, recomputeDb — all `async (tx) => …`)
// desktop-incompatible. Async parity with expo-sqlite is the whole point.
//
// Connection pragmas (Prisma set these implicitly — losing them silently
// would change behavior):
//   foreign_keys = ON   — FK enforcement at statement time; the sync apply
//                         order (parents before children) RELIES on this
//                         failing loudly, and cascades on child tables.
//   busy_timeout = 10s  — a second connection (backup snapshot, sandbox)
//                         waits instead of throwing SQLITE_BUSY.
// journal_mode stays `delete` (rollback journal) — the DB file's persisted
// mode; dbLock's VACUUM INTO snapshot logic assumes it.

import { createClient, type Client } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from '@neu/shared'
import type { SharedSqliteDb } from '@neu/shared'

export { schema }

// The ONE sanctioned cast (see @neu/shared drizzleClient.ts): the libsql
// driver instance is typed with the SHARED drizzle-orm copy so that queries
// against the shared schema tables typecheck; runtime compatibility across
// pnpm's dual instances is a documented drizzle design property (entityKind).
const buildDb = (c: Client): SharedSqliteDb => drizzle(c, { schema }) as unknown as SharedSqliteDb

export type DesktopDb = SharedSqliteDb

let client: Client | null = null
let db: DesktopDb | null = null

export async function openDrizzle(dbPath: string): Promise<void> {
  client = createClient({ url: `file:${dbPath}` })
  await client.execute('PRAGMA foreign_keys = ON')
  await client.execute('PRAGMA busy_timeout = 10000')
  db = buildDb(client)
}

export function getDb(): DesktopDb {
  if (!db) throw new Error('Drizzle not initialized. Call setupDatabase first.')
  return db
}

/** Raw client for statements drizzle has no builder for (VACUUM INTO,
 *  PRAGMA quick_check, the boot migration runner). */
export function getDbClient(): Client {
  if (!client) throw new Error('Drizzle not initialized. Call setupDatabase first.')
  return client
}

/** Close the libsql handle so a restore can swap the DB file out from under
 *  us — Windows refuses the rename while any handle stays open. */
export function closeDrizzle(): void {
  try {
    client?.close()
  } catch {
    // closing a dead handle must never block the swap
  }
  client = null
  db = null
}

/** Reopen after the DB file was REPLACED on disk (cloud restore / time
 *  machine) — the old client still holds a handle to the outgoing file. */
export async function reopenDrizzle(dbPath: string): Promise<void> {
  closeDrizzle()
  await openDrizzle(dbPath)
}
