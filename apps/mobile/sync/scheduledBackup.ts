// Scheduled full backup — mobile twin of desktop's runIfScheduledSyncDue
// (apps/desktop/electron/main/sync.ts). Per-device cadence kept in SecureStore
// (devices don't need to agree); rides the AutoSync tick, foreground-only by
// nature. Upload-only by policy: when the cloud holds a backup this device
// hasn't seen (the desktop uploaded since), skip silently — replacing it is a
// decision for the manual button's confirm flow, never a background job.

import * as SecureStore from 'expo-secure-store'
import * as SQLite from 'expo-sqlite'

import { backupToCloud, checkCloudBackup, cloudIsAheadOfThisDevice } from './drive'

export type BackupFrequency = 'off' | 'daily' | 'weekly' | 'monthly'

const FREQUENCY_KEY = 'neu.sync.backupFrequency'
const LAST_SCHEDULED_KEY = 'neu.sync.lastScheduledBackupAt'

const FREQUENCY_INTERVAL_MS: Record<BackupFrequency, number> = {
  off: 0,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
  monthly: 30 * 24 * 60 * 60 * 1000,
}

export async function getBackupFrequency(): Promise<BackupFrequency> {
  const v = await SecureStore.getItemAsync(FREQUENCY_KEY)
  return v === 'daily' || v === 'weekly' || v === 'monthly' ? v : 'off'
}

export async function setBackupFrequency(freq: BackupFrequency): Promise<void> {
  await SecureStore.setItemAsync(FREQUENCY_KEY, freq)
}

// In-memory attempt throttle: a due-but-failing backup (offline, Drive down)
// must not hit the network on every 60s tick for hours.
let lastAttemptAt = 0
const ATTEMPT_THROTTLE_MS = 15 * 60 * 1000

export async function runScheduledBackupIfDue(
  liveDb: SQLite.SQLiteDatabase,
  accessToken: string,
): Promise<void> {
  try {
    const freq = await getBackupFrequency()
    if (freq === 'off') return

    const last = await SecureStore.getItemAsync(LAST_SCHEDULED_KEY)
    const lastTime = last ? Number(last) : 0
    const now = Date.now()
    if (now - lastTime < FREQUENCY_INTERVAL_MS[freq]) return
    if (now - lastAttemptAt < ATTEMPT_THROTTLE_MS) return
    lastAttemptAt = now

    // Overwrite guard (mirrors desktop's "cloud diverged, skipping"): stamp is
    // NOT set on a skip, so the next attempt re-checks after the throttle.
    const info = await checkCloudBackup(accessToken)
    if (info.exists && (await cloudIsAheadOfThisDevice(info))) return

    await backupToCloud(accessToken, liveDb)
    await SecureStore.setItemAsync(LAST_SCHEDULED_KEY, String(Date.now()))
  } catch {
    // insurance only — never surfaces; the attempt throttle paces retries
  }
}
