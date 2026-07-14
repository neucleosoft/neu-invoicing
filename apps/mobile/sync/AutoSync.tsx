// Foreground auto-sync (S3): pull+push when the app comes to the foreground,
// then every 60s while it stays active. Render-null component mounted in the
// root layout (needs the auth + db providers).
//
// Safety rules, in order of importance:
//  - NEVER bypasses the D6 tripwire: a pull that needs confirmation is left
//    for the manual button, where the confirm dialog lives (the pause receipt
//    is already recorded by rowSyncNow).
//  - Never runs concurrently with itself (inFlight ref) — rowSyncNow's diary
//    model is idempotent anyway, but overlapping transactions help nobody.
//  - Silent on failure: offline just means "next tick retries". The network
//    only ever adds, never gates (C0).

import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { useSQLiteContext } from 'expo-sqlite'

import { useAuth } from '@/auth'
import { useDb } from '@/db'

import { runLadderIfDue } from './ladder'
import { purgeArchivedDocs } from './purge'
import { rowSyncNow } from './rowSync'
import { runScheduledBackupIfDue } from './scheduledBackup'

export const LAST_ROW_SYNC_KEY = 'neu.sync.lastRowSyncAt'

const TICK_MS = 60_000
// Give startup work (migrations, openingStock backfill) a clear head start —
// recompute-after-merge must never run before the backfill has aligned stock.
const FIRST_RUN_DELAY_MS = 15_000

export function AutoSync() {
  const db = useDb()
  const liveDb = useSQLiteContext()
  const { user, offlineMode, getFreshAccessToken } = useAuth()
  const inFlight = useRef(false)

  useEffect(() => {
    if (!user || offlineMode) return

    let disposed = false

    const tick = async () => {
      if (disposed || inFlight.current) return
      inFlight.current = true
      try {
        const token = await getFreshAccessToken()
        if (!token) return
        const r = await rowSyncNow(db, token)
        if (r.success) {
          await SecureStore.setItemAsync(LAST_ROW_SYNC_KEY, String(Date.now()))
        }
        // Housekeeping riding the same tick, all internally throttled and
        // silent: the backup ladder (~6h checks), the 35-day archive purge
        // (~daily), and the scheduled full backup (user-picked cadence).
        // Insurance and hygiene — never gates.
        await runLadderIfDue(liveDb, token)
        await purgeArchivedDocs(db, token)
        await runScheduledBackupIfDue(liveDb, token)
      } catch {
        // transient/offline — auto-sync never surfaces errors
      } finally {
        inFlight.current = false
      }
    }

    const first = setTimeout(() => void tick(), FIRST_RUN_DELAY_MS)
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void tick()
    }, TICK_MS)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void tick()
    })

    return () => {
      disposed = true
      clearTimeout(first)
      clearInterval(interval)
      sub.remove()
    }
  }, [db, liveDb, user, offlineMode, getFreshAccessToken])

  return null
}
