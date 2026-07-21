import { ipcMain } from 'electron'
import { eq } from '@neu/shared'
import { getDb, schema } from '../db'

export const setupSettingsHandlers = () => {
  const db = getDb()

  // Get a setting by key
  ipcMain.handle('settings:get', async (_, key: string) => {
    try {
      const [setting] = await db.select().from(schema.settings).where(eq(schema.settings.key, key)).limit(1)
      return { success: true, data: setting?.value || null }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get setting'
      }
    }
  })

  // Set a setting
  ipcMain.handle('settings:set', async (_, key: string, value: string) => {
    try {
      const [setting] = await db
        .insert(schema.settings)
        .values({ key, value })
        .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
        .returning()
      return { success: true, data: setting }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set setting'
      }
    }
  })

  // Get all settings
  ipcMain.handle('settings:getAll', async () => {
    try {
      const settings = await db.select().from(schema.settings)
      const settingsMap: Record<string, string> = {}
      settings.forEach((s) => {
        settingsMap[s.key] = s.value
      })
      return { success: true, data: settingsMap }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get settings'
      }
    }
  })
}
