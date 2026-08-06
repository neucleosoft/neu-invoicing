// Session health strip — the app's voice for the two failures that used to be
// silent. Renders at the very top of every screen:
//
//   RED    Google revoked the session (invalid_grant) — sync & backups are
//          dead until a human signs in again. No code can fix this silently.
//   AMBER  The sign-in is 6+ days old. In Google's Testing mode a session
//          dies at day 7 — one tap now renews it BEFORE anything breaks.
//          (Once the OAuth consent screen is published, sessions stop
//          expiring and this banner simply never appears.)
//
// Invisible whenever everything is healthy, signed out, or offline-mode.

import { useEffect, useState } from 'react'
import { Pressable, StyleSheet } from 'react-native'

import { getSignedInAt, useAuth } from '@/auth'
import { ThemedText } from '@/components/themed-text'

const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000
const RECHECK_MS = 60_000

export function SessionBanner() {
  const { user, offlineMode, authDead, signIn } = useAuth()
  const [signedInAt, setSignedInAt] = useState<number | null>(null)

  // The timestamp lives in SecureStore (written whenever Google issues a
  // refresh token); poll it once a minute so the banner appears without a
  // relaunch when day 6 arrives mid-session.
  useEffect(() => {
    let disposed = false
    const check = () => {
      void getSignedInAt().then((v) => {
        if (!disposed) setSignedInAt(v)
      })
    }
    check()
    const interval = setInterval(check, RECHECK_MS)
    return () => {
      disposed = true
      clearInterval(interval)
    }
  }, [user, authDead])

  if (!user || offlineMode) return null

  if (authDead) {
    return (
      <Pressable style={[styles.strip, styles.dead]} onPress={() => void signIn()}>
        <ThemedText style={styles.text}>
          Google sign-in expired — sync & backups are paused. Tap to sign in.
        </ThemedText>
      </Pressable>
    )
  }

  if (signedInAt && Date.now() - signedInAt >= SIX_DAYS_MS) {
    return (
      <Pressable style={[styles.strip, styles.aging]} onPress={() => void signIn()}>
        <ThemedText style={styles.text}>
          Google sign-in expires soon — tap to renew and keep backups running.
        </ThemedText>
      </Pressable>
    )
  }

  return null
}

const styles = StyleSheet.create({
  strip: {
    paddingTop: 48,
    paddingBottom: 10,
    paddingHorizontal: 16,
  },
  dead: { backgroundColor: '#dc2626' },
  aging: { backgroundColor: '#d97706' },
  text: { color: 'white', fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
})
