// Backup-slot age tracking for the stale-backup warning. Reads the SLOT's own
// mtime from Drive (throttled to one check per 6h, riding AutoSync's token) —
// deliberately NOT our upload history, because the warning must keep working
// precisely when uploads are failing.

import * as SecureStore from 'expo-secure-store'

import { checkCloudBackup } from './drive'

const CHECKED_AT_KEY = 'neu.backup.slotCheckedAt'
const MTIME_KEY = 'neu.backup.slotMtime'
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

/** Throttled probe: records the cloud slot's mtime (0 = slot missing). */
export async function recordBackupSlotAge(accessToken: string): Promise<void> {
  try {
    const last = Number((await SecureStore.getItemAsync(CHECKED_AT_KEY)) ?? 0)
    if (Date.now() - last < CHECK_EVERY_MS) return
    const info = await checkCloudBackup(accessToken)
    await SecureStore.setItemAsync(
      MTIME_KEY,
      info.exists && info.modifiedTime ? String(new Date(info.modifiedTime).getTime()) : '0',
    )
    await SecureStore.setItemAsync(CHECKED_AT_KEY, String(Date.now()))
  } catch {
    // Unreachable (offline / dead token) — keep the last known value; the
    // session banner owns the dead-token story.
  }
}

/** Last recorded slot mtime (ms). 0 = no backup exists. null = never checked. */
export async function getBackupSlotMtime(): Promise<number | null> {
  const v = await SecureStore.getItemAsync(MTIME_KEY)
  return v === null ? null : Number(v)
}
