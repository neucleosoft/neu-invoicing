// Boot-time schema management — Prisma-free since the Drizzle migration.
//
// Three populations, one code path (mirrors what `prisma migrate deploy` +
// the db-push baseline used to do, without spawning the Prisma CLI):
//
//   1. Fresh install (no DB yet, or empty DB)
//        → drizzle's migrator builds the schema from packages/shared/drizzle
//          (the SAME migration lineage mobile runs).
//   2. Prisma-born DB (has _prisma_migrations)
//        → "deploy-lite": read the tracker, execute any PENDING prisma
//          migration.sql files shipped with the app (exactly what migrate
//          deploy did — proven on the boss's real May-era DB), record them,
//          then ADOPT the drizzle tracker: __drizzle_migrations is seeded
//          with every bundled migration at its REAL folderMillis (the same
//          trick mobile's restore uses), so drizzle's migrator sees the DB
//          as current and only future migrations ever run.
//   3. Legacy db-push DB (tables but NO tracker at all)
//        → tolerant catch-up: every prisma migration statement runs inside
//          try/catch ("already exists" / "duplicate column" are expected),
//          then the same drizzle adoption.
//
// From then on there is ONE migration lineage for both apps: run
// `pnpm exec drizzle-kit generate` in apps/mobile (its config writes to
// packages/shared/drizzle) and both desktop and mobile pick it up.

import path from 'path'
import { app } from 'electron'
import fs from 'fs'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { asc, eq, isNull, previousInvoice, setGlobalHlcStamper, sql } from '@neu/shared'
import { drizzleMigrationsDir, ensureTablesExist } from './bootMigrate'
import { initAppHlcClock, nextAppHlc, reobserveDbMaxHlc } from './hlcStamp'
import { getDb, getDbClient, openDrizzle, reopenDrizzle } from './db'
import { getDeviceId } from './sync'

// One-time backfill: rows imported before the serialNumber column existed
// (or created in a window where the handler skipped the assignment) get
// sequential numbers in createdAt order. Cheap no-op when nothing's missing.
// Non-fatal — log and continue on failure.
const backfillPreviousInvoiceSerialNumbers = async () => {
  try {
    const db = getDb()
    const orphans = await db
      .select({ id: previousInvoice.id })
      .from(previousInvoice)
      .where(isNull(previousInvoice.serialNumber))
      .orderBy(asc(previousInvoice.createdAt))
    if (orphans.length === 0) return
    const [agg] = await db
      .select({ max: sql<number | null>`max(${previousInvoice.serialNumber})` })
      .from(previousInvoice)
    let next = (agg?.max ?? 0) + 1
    for (const row of orphans) {
      await db.update(previousInvoice).set({ serialNumber: next++ }).where(eq(previousInvoice.id, row.id))
    }
    console.log(`Backfilled serialNumber for ${orphans.length} previous invoice row(s)`)
  } catch (err) {
    console.warn('Failed to backfill previous invoice serial numbers:', err)
  }
}

export const setupDatabase = async () => {
  const userDataPath = app.getPath('userData')
  const dbPath = path.join(userDataPath, 'neuinvoicing.db')

  // Ensure directory exists
  if (!fs.existsSync(userDataPath)) {
    fs.mkdirSync(userDataPath, { recursive: true })
  }

  // Bring an existing DB up to schema / adopt the drizzle tracker.
  await ensureTablesExist(dbPath)

  // Open the app's connection, then run drizzle's migrator: a no-op for
  // adopted/current DBs, the full build for fresh ones, and the delivery
  // path for every FUTURE migration on all three populations.
  await openDrizzle(dbPath)
  await migrate(getDb() as any, { migrationsFolder: drizzleMigrationsDir() })

  // P1: seed the HLC ratchet from MAX(hlc) BEFORE any write can happen, then
  // hook the shared schema's stamper so every user edit of a synced row gets
  // stamped (machine writes defeat it by passing explicit values — F5).
  await initAppHlcClock(getDbClient(), getDeviceId())
  setGlobalHlcStamper(nextAppHlc)

  console.log('Database ready (drizzle)')

  await backfillPreviousInvoiceSerialNumbers()
}

// Reopen after sync replaces the file on disk. The replaced file may carry
// HLC stamps above anything this device has seen — the ratchet must never
// issue below them.
export const reconnectDatabase = async () => {
  await reopenDrizzle(getDatabasePath())
  await reobserveDbMaxHlc(getDbClient())
  console.log('Database reconnected successfully')
}

export const getDatabasePath = () => {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'neuinvoicing.db')
}
