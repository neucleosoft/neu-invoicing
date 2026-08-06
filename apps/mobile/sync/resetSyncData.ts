// Reset sync data — the fire extinguisher. Deletes every device diary
// (changes-*.json) on this account's Drive and clears this device's local
// sync bookkeeping. Touches NOTHING else: backups, the ladder, photos and all
// local rows stay. Diaries are the sync system's memory OUTSIDE any backup —
// they survive restores and resurrect old rows (the ghost-invoice /52-/53
// mechanism), so a clean re-baseline must wipe them. Other devices that still
// hold old data will re-share it on their next sync — the user's procedure
// (restore or sign out every device) handles that half.

import * as SecureStore from 'expo-secure-store'

import { appendSyncActivity } from './activityLog'
import { IDENTITY_MARKER_NAME } from './businessIdentity'
import { clearLastKnownCloudMtime } from './drive'

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const LAST_PUSHED_DIARY_HASH_KEY = 'neu.sync.lastPushedDiaryHash'
const LAST_ROW_SYNC_KEY = 'neu.sync.lastRowSyncAt'

/** Deletes all sync diaries on the account + clears local baselines.
 *  Returns the number of diary files deleted. */
export async function resetSyncData(accessToken: string): Promise<number> {
  let deleted = 0
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      // Diaries AND the business-identity marker: after a reset, the next
      // device to sync stamps its business as this account's identity fresh —
      // that's the deliberate "change which company this account syncs" path.
      q: `name contains 'changes-' or name = '${IDENTITY_MARKER_NAME}'`,
      fields: 'nextPageToken, files(id,name)',
      pageSize: '100',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await fetch(`${DRIVE_FILES_URL}?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw new Error(`Could not list sync files (HTTP ${res.status})`)
    const data = (await res.json()) as {
      nextPageToken?: string
      files?: { id: string; name: string }[]
    }
    for (const f of data.files ?? []) {
      if (!f.name.startsWith('changes-') && f.name !== IDENTITY_MARKER_NAME) continue
      const del = await fetch(`${DRIVE_FILES_URL}/${f.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      if (!del.ok && del.status !== 404) {
        throw new Error(`Could not delete ${f.name} (HTTP ${del.status})`)
      }
      deleted++
    }
    pageToken = data.nextPageToken
  } while (pageToken)

  await Promise.all([
    SecureStore.deleteItemAsync(LAST_PUSHED_DIARY_HASH_KEY),
    SecureStore.deleteItemAsync(LAST_ROW_SYNC_KEY),
    clearLastKnownCloudMtime(),
  ])
  await appendSyncActivity([
    {
      kind: 'RESET',
      detail: `Sync data reset — ${deleted} sync file(s) (device diaries + identity marker) deleted from Drive; local baselines cleared`,
    },
  ])
  return deleted
}
