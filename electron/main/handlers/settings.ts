import { ipcMain } from 'electron'
import { getPrisma } from '../database'

export const setupSettingsHandlers = () => {
  const prisma = getPrisma()

  // Get a setting by key
  ipcMain.handle('settings:get', async (_, key: string) => {
    try {
      const setting = await prisma.settings.findUnique({
        where: { key }
      })
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
      const setting = await prisma.settings.upsert({
        where: { key },
        update: { value },
        create: { key, value }
      })
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
      const settings = await prisma.settings.findMany()
      const settingsMap: Record<string, string> = {}
      settings.forEach(s => {
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
