import { ipcMain, BrowserWindow } from 'electron'
import { google } from 'googleapis'
import { getOAuth2Client } from './auth'
import { getDatabasePath, getPrisma, ensureTablesExist, reconnectDatabase } from './database'
import fs from 'fs'
import Store from 'electron-store'

const store = new Store()

let syncStatus = {
  status: 'idle', // idle, syncing, error
  lastSync: null as Date | null,
  lastError: null as string | null
}

// Update status AND tell the UI about it
const updateSyncStatus = (updates: Partial<typeof syncStatus>) => {
  Object.assign(syncStatus, updates)
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('sync:statusChanged', syncStatus)
  })
}

const CLOUD_DB_FILENAME = 'neuinvoicing.db'

export const setupSyncHandlers = () => {
  // Sync now
  ipcMain.handle('sync:syncNow', async () => {
    return await performSync()
  })

  // Get sync status
  ipcMain.handle('sync:getSyncStatus', async () => {
    return syncStatus
  })
}

const performSync = async () => {
  // Skip sync in demo mode
  if (store.get('demo_mode')) {
    console.log('🎭 DEMO MODE: Skipping Google Drive sync')
    updateSyncStatus({ status: 'idle', lastSync: new Date() })
    return {
      success: true,
      message: 'Demo mode - sync disabled',
      lastSync: syncStatus.lastSync
    }
  }

  try {
    updateSyncStatus({ status: 'syncing', lastError: null })

    const auth = getOAuth2Client()
    const drive = google.drive({ version: 'v3', auth })

    const dbPath = getDatabasePath()

    // Check if database file exists in Google Drive
    const response = await drive.files.list({
      spaces: 'appDataFolder',
      q: `name='${CLOUD_DB_FILENAME}'`,
      fields: 'files(id, name, modifiedTime)',
      pageSize: 1
    })

    const files = response.data.files || []
    const prisma = getPrisma()

    if (files.length > 0) {
      // Cloud file exists
      const cloudFile = files[0]
      const cloudModifiedTime = new Date(cloudFile.modifiedTime!)

      // Check local file modification time
      const localStats = fs.existsSync(dbPath) ? fs.statSync(dbPath) : null
      const localModifiedTime = localStats ? localStats.mtime : new Date(0)

      // Check if local DB is empty (no company = fresh install)
      const localCompany = await prisma.company.findFirst()
      const localIsEmpty = !localCompany

      if (localIsEmpty || cloudModifiedTime > localModifiedTime) {
        // Download from cloud (cloud is newer)
        console.log('Downloading database from cloud...')
        const dest = fs.createWriteStream(dbPath)

        const fileResponse = await drive.files.get(
          {
            fileId: cloudFile.id!,
            alt: 'media'
          },
          { responseType: 'stream' }
        )

        await new Promise((resolve, reject) => {
          fileResponse.data
            .on('end', resolve)
            .on('error', reject)
            .pipe(dest)
        })

        console.log('Database downloaded successfully')

        // The downloaded DB might be from an older version — add any missing tables
        ensureTablesExist(`file:${dbPath}`)

        // Reconnect Prisma so it reads the new file instead of the old empty one
        await reconnectDatabase()
      } else {
        // Upload to cloud (local is newer or same)
        console.log('Uploading database to cloud...')
        await drive.files.update({
          fileId: cloudFile.id!,
          media: {
            mimeType: 'application/x-sqlite3',
            body: fs.createReadStream(dbPath)
          }
        })

        console.log('Database uploaded successfully')
      }
    } else {
      // No cloud file exists, upload local file
      console.log('Creating initial cloud database...')

      if (fs.existsSync(dbPath)) {
        await drive.files.create({
          requestBody: {
            name: CLOUD_DB_FILENAME,
            parents: ['appDataFolder']
          },
          media: {
            mimeType: 'application/x-sqlite3',
            body: fs.createReadStream(dbPath)
          },
          fields: 'id'
        })

        console.log('Initial database uploaded successfully')
      }
    }

    // Update sync metadata in database
    const deviceId = require('os').hostname()

    await prisma.syncMetadata.upsert({
      where: { id: 'main' },
      update: {
        lastSyncTimestamp: new Date(),
        syncStatus: 'idle',
        deviceId
      },
      create: {
        id: 'main',
        lastSyncTimestamp: new Date(),
        syncStatus: 'idle',
        deviceId
      }
    })

    updateSyncStatus({ status: 'idle', lastSync: new Date() })

    return {
      success: true,
      lastSync: syncStatus.lastSync
    }
  } catch (error) {
    console.error('Sync error:', error)
    updateSyncStatus({
      status: 'error',
      lastError: error instanceof Error ? error.message : 'Sync failed'
    })

    return {
      success: false,
      error: syncStatus.lastError
    }
  }
}

// Auto-sync on app start
export const performInitialSync = async () => {
  console.log('Performing initial sync...')
  await performSync()
}

// Trigger sync after database changes (properly debounced)
let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null

// Disabled auto-sync — sync only happens when user clicks sync button
export const triggerSyncAfterChange = async () => {
  // intentionally empty
}
