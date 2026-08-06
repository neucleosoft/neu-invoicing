// Stale-backup warning strip — the symptom-alarm partner to SessionBanner's
// cause-alarm. Compares the cloud backup slot's own age (recorded by
// AutoSync's throttled probe) against the user's chosen backup cadence:
// daily → warn at 3 days, weekly → 14, monthly → 60, off (manual-only) → 7.
// slotMtime 0 = no backup exists at all. Suppressed while the session is
// dead — a dead sign-in already explains a stale backup.

import { router, type Href } from 'expo-router'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet } from 'react-native'

import { useAuth } from '@/auth'
import { ThemedText } from '@/components/themed-text'
import { getBackupSlotMtime } from '@/sync/backupHealth'
import { getBackupFrequency, type BackupFrequency } from '@/sync/scheduledBackup'

const STALE_DAYS: Record<BackupFrequency, number> = { off: 7, daily: 3, weekly: 14, monthly: 60 }
const DAY_MS = 24 * 60 * 60 * 1000
const RECHECK_MS = 60_000

export function BackupBanner() {
  const { user, offlineMode, authDead } = useAuth()
  const [slotMtime, setSlotMtime] = useState<number | null>(null)
  const [frequency, setFrequency] = useState<BackupFrequency>('off')

  useEffect(() => {
    let disposed = false
    const check = () => {
      void Promise.all([getBackupSlotMtime(), getBackupFrequency()]).then(([m, f]) => {
        if (!disposed) {
          setSlotMtime(m)
          setFrequency(f)
        }
      })
    }
    check()
    const interval = setInterval(check, RECHECK_MS)
    return () => {
      disposed = true
      clearInterval(interval)
    }
  }, [user, authDead])

  if (!user || offlineMode || authDead) return null
  if (slotMtime === null) return null // never checked yet — stay silent

  const missing = slotMtime === 0
  const ageDays = missing ? null : Math.floor((Date.now() - slotMtime) / DAY_MS)
  const stale = ageDays !== null && Date.now() - slotMtime >= STALE_DAYS[frequency] * DAY_MS
  if (!missing && !stale) return null

  return (
    <Pressable
      style={styles.strip}
      onPress={() => router.push('/(tabs)/settings' as Href)}
    >
      <ThemedText style={styles.text}>
        {missing
          ? 'No cloud backup exists yet — open Settings to back up now.'
          : `Cloud backup is ${ageDays} days old — recent work is not protected. Open Settings to back up.`}
      </ThemedText>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  strip: {
    backgroundColor: '#d97706',
    paddingTop: 48,
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  text: { color: 'white', fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
})
