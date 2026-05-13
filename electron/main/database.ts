import { PrismaClient } from '@prisma/client'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'
import { execSync } from 'child_process'

let prisma: PrismaClient

/**
 * Bring the user's DB up to the current schema. Handles three populations with one code path:
 *
 *   1. Fresh install (no DB yet)        → migrate deploy applies all migrations from scratch
 *   2. Pre-existing user, never tracked → db push aligns schema, then we baseline by marking
 *      every shipped migration as applied. Future versions then run migrate deploy normally.
 *   3. User already on the migrate-deploy track → migrate deploy is a no-op or applies any
 *      new migrations shipped since their last update.
 *
 * The detection: try `migrate deploy` first. If it fails (existing tables collide with the
 * init migration's CREATE TABLE), fall back to db push + migrate resolve baseline.
 */
export const ensureTablesExist = (dbUrl: string) => {
  const isDevMode = !!process.env.VITE_DEV_SERVER_URL
  const appPath = isDevMode ? process.cwd() : app.getAppPath()
  // In production with asar, the schema, migration files, and prisma CLI all live in
  // app.asar.unpacked (configured via asarUnpack in package.json) — child_process.execSync
  // cannot spawn a Node entry point from inside the asar archive, and prisma's CLI reads
  // schema.prisma + migration .sql files as real files, not via Electron's asar shim.
  const resourcePath = isDevMode ? appPath : appPath.replace('app.asar', 'app.asar.unpacked')
  const schemaPath = path.join(resourcePath, 'prisma', 'schema.prisma')
  const migrationsDir = path.join(resourcePath, 'prisma', 'migrations')
  const prismaCliPath = path.join(resourcePath, 'node_modules', 'prisma', 'build', 'index.js')

  if (!fs.existsSync(prismaCliPath)) {
    console.warn('Prisma CLI not found at:', prismaCliPath)
    return
  }
  if (!fs.existsSync(schemaPath)) {
    console.warn('Prisma schema not found at:', schemaPath)
    return
  }

  const execOpts = {
    env: {
      ...process.env,
      DATABASE_URL: dbUrl,
      ELECTRON_RUN_AS_NODE: '1'
    },
    cwd: resourcePath,
    stdio: 'pipe' as const,
    timeout: 60000
  }

  // Path 1 + 3: try migrate deploy. Works for fresh installs and already-baselined users.
  try {
    execSync(
      `"${process.execPath}" "${prismaCliPath}" migrate deploy --schema="${schemaPath}"`,
      execOpts
    )
    console.log('Database migrations applied successfully')
    return
  } catch (deployError: any) {
    // Most likely cause: existing user whose DB was created via `db push` and lacks the
    // _prisma_migrations tracking table. The init migration tries to CREATE TABLE and
    // collides with already-existing tables. Fall through to baseline path below.
    console.warn(
      'migrate deploy failed — attempting baseline for existing user:',
      deployError.stderr?.toString()?.slice(0, 200) || deployError.message
    )
  }

  // Path 2: align the schema with db push first (idempotent, fixes any drift), then
  // mark every migration as applied so future migrate deploy runs are clean no-ops or
  // only apply genuinely new migrations.
  try {
    execSync(
      `"${process.execPath}" "${prismaCliPath}" db push --skip-generate --accept-data-loss --schema="${schemaPath}"`,
      execOpts
    )
    console.log('Schema aligned via db push')
  } catch (pushError: any) {
    console.error('db push failed during baseline:', pushError.stderr?.toString() || pushError.message)
    return
  }

  if (!fs.existsSync(migrationsDir)) {
    console.warn('Migrations folder missing — skipping baseline:', migrationsDir)
    return
  }

  const migrations = fs.readdirSync(migrationsDir).filter((name) => {
    try {
      return fs.statSync(path.join(migrationsDir, name)).isDirectory()
    } catch {
      return false
    }
  })

  let baselined = 0
  for (const migration of migrations) {
    try {
      execSync(
        `"${process.execPath}" "${prismaCliPath}" migrate resolve --applied "${migration}" --schema="${schemaPath}"`,
        execOpts
      )
      baselined++
    } catch (resolveError: any) {
      // Already-recorded migrations throw — safe to ignore. Log others.
      const errMsg = resolveError.stderr?.toString() || ''
      if (!/already (recorded|applied)/i.test(errMsg)) {
        console.warn(`Failed to mark ${migration} as applied:`, errMsg.slice(0, 200))
      }
    }
  }
  console.log(`Baselined ${baselined}/${migrations.length} migrations as applied`)
}

// One-time backfill: rows imported before the serialNumber column existed
// (or created in a window where the handler skipped the assignment) get
// sequential numbers in createdAt order. Cheap no-op when nothing's missing.
// Non-fatal — log and continue on failure.
const backfillPreviousInvoiceSerialNumbers = async () => {
  try {
    const orphans = await prisma.previousInvoice.findMany({
      where: { serialNumber: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (orphans.length === 0) return
    const agg = await prisma.previousInvoice.aggregate({ _max: { serialNumber: true } })
    let next = (agg._max.serialNumber ?? 0) + 1
    for (const row of orphans) {
      await prisma.previousInvoice.update({
        where: { id: row.id },
        data: { serialNumber: next++ },
      })
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

  // Set database URL
  const dbUrl = `file:${dbPath}`
  process.env.DATABASE_URL = dbUrl

  // Auto-create tables from schema.prisma if they don't exist
  ensureTablesExist(dbUrl)

  prisma = new PrismaClient({
    datasources: {
      db: {
        url: dbUrl
      }
    }
  })

  try {
    await prisma.$connect()
    console.log('Database connected successfully')
  } catch (error) {
    console.error('Database connection error:', error)
    throw error
  }

  await backfillPreviousInvoiceSerialNumbers()
}

export const getPrisma = () => {
  if (!prisma) {
    throw new Error('Database not initialized. Call setupDatabase first.')
  }
  return prisma
}

// Reopen the same connection (call after sync replaces the file on disk)
// We reuse the same Prisma object so all handlers still have a valid reference
export const reconnectDatabase = async () => {
  await prisma.$disconnect()
  await prisma.$connect()
  console.log('Database reconnected successfully')
}

export const getDatabasePath = () => {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'neuinvoicing.db')
}
