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
    const existing = await getSyncActivity()
    // Dedupe against everything still in the log: with auto-sync ticking every
    // minute, a sticky-skip or tripwire pause would otherwise re-log on EVERY
    // pull for as long as the stale packet sits in the peer's 30-day diary.
    const seen = new Set(existing.map((e) => `${e.kind}|${e.table}|${e.rowId}|${e.detail}`))
    const fresh = entries.filter((e) => !seen.has(`${e.kind}|${e.table}|${e.rowId}|${e.detail}`))
    if (fresh.length === 0) return
    const now = Date.now()
    const next = [...fresh.map((e) => ({ at: now, ...e })), ...existing].slice(0, CAP)
    await LegacyFS.writeAsStringAsync(LOG_PATH, JSON.stringify(next))
  } catch {
    // best-effort — receipts are a convenience, not a correctness layer
  }
}
