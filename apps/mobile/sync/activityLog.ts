// Sync activity log — device-local receipts for every renumber, conflict,
// sticky event and tripwire pause (D5: quiet resolution + full receipts).
// Mobile twin of the electron-store log in desktop's rowSync.ts. Stored as a
// small capped JSON file; never synced.

import * as LegacyFS from 'expo-file-system/legacy'

const LOG_PATH = `${LegacyFS.documentDirectory}sync-activity.json`
const CAP = 100

export interface SyncActivityEntry {
  at: number
  kind: string
  table?: string
  rowId?: string
  detail: string
}

export async function getSyncActivity(): Promise<SyncActivityEntry[]> {
  try {
    const info = await LegacyFS.getInfoAsync(LOG_PATH)
    if (!info.exists) return []
    const parsed = JSON.parse(await LegacyFS.readAsStringAsync(LOG_PATH))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return [] // a corrupt log must never break sync or Settings
  }
}

export async function appendSyncActivity(
  entries: Omit<SyncActivityEntry, 'at'>[],
): Promise<void> {
  if (entries.length === 0) return
  try {
    const now = Date.now()
    const existing = await getSyncActivity()
    const next = [...entries.map((e) => ({ at: now, ...e })), ...existing].slice(0, CAP)
    await LegacyFS.writeAsStringAsync(LOG_PATH, JSON.stringify(next))
  } catch {
    // best-effort — receipts are a convenience, not a correctness layer
  }
}
