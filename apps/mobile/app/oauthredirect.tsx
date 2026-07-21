import { router } from 'expo-router'
import { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { useAuth } from '@/auth'

// Landing pad for the OAuth deep link. expo-auth-session's URL listener
// handles the actual code → token exchange; we just wait for `user` to be
// populated, then bounce the user into the app.
export default function OAuthRedirect() {
  const { user } = useAuth()

  useEffect(() => {
    if (user) {
      router.replace('/(tabs)')
    }
  }, [user])

  return (
    <View style={styles.container}>
      <ActivityIndicator />
      <ThemedText style={styles.label}>Signing in…</ThemedText>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  label: { marginTop: 12 },
})
