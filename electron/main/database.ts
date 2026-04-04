import { PrismaClient } from '@prisma/client'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'
import { execSync } from 'child_process'

let prisma: PrismaClient

/**
 * Creates all database tables from prisma/schema.prisma if they don't exist.
 * Uses ELECTRON_RUN_AS_NODE=1 so Electron's binary acts as Node.js
 * and runs the Prisma CLI to sync schema → SQLite tables.
 */
export const ensureTablesExist = (dbUrl: string) => {
  const isDevMode = !!process.env.VITE_DEV_SERVER_URL
  const appPath = isDevMode ? process.cwd() : app.getAppPath()
  const schemaPath = path.join(appPath, 'prisma', 'schema.prisma')
  const prismaCliPath = path.join(appPath, 'node_modules', 'prisma', 'build', 'index.js')

  if (!fs.existsSync(prismaCliPath)) {
    console.warn('Prisma CLI not found at:', prismaCliPath)
    return
  }
  if (!fs.existsSync(schemaPath)) {
    console.warn('Prisma schema not found at:', schemaPath)
    return
  }

  try {
    execSync(
      `"${process.execPath}" "${prismaCliPath}" db push --skip-generate --accept-data-loss --schema="${schemaPath}"`,
      {
        env: {
          ...process.env,
          DATABASE_URL: dbUrl,
          ELECTRON_RUN_AS_NODE: '1'
        },
        cwd: appPath,
        stdio: 'pipe',
        timeout: 30000
      }
    )
    console.log('Database tables synced successfully')
  } catch (error: any) {
    console.error('Schema sync error:', error.stderr?.toString() || error.message)
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
