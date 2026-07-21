import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { useAuth } from '@/auth'

export default function LoginScreen() {
  const { signIn, enterOfflineMode, loading } = useAuth()
  const [signingIn, setSigningIn] = useState(false)

  async function handleSignIn() {
    setSigningIn(true)
    try {
      await signIn()
    } finally {
      setSigningIn(false)
    }
  }

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator />
      </ThemedView>
    )
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">Neu Invoicing</ThemedText>
        <ThemedText style={styles.subtitle}>Sign in to continue</ThemedText>
      </View>

      <Pressable
        style={[styles.button, signingIn && styles.buttonDisabled]}
        onPress={handleSignIn}
        disabled={signingIn}
      >
        <ThemedText style={styles.buttonText}>
          {signingIn ? 'Signing in…' : 'Sign in with Google'}
        </ThemedText>
      </Pressable>

      <Pressable
        style={styles.secondaryButton}
        onPress={() => enterOfflineMode()}
        disabled={signingIn}
      >
        <ThemedText style={styles.secondaryButtonText}>Use without an account</ThemedText>
      </Pressable>

      <ThemedText style={styles.footer}>
        Signing in lets you back up to Google Drive later. You can use the app fully
        offline — your data stays on this device.
      </ThemedText>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 24,
  },
  header: { alignItems: 'center', gap: 8 },
  subtitle: { fontSize: 16, opacity: 0.6 },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
    minWidth: 240,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: 'white', fontSize: 16, fontWeight: '600' },
  secondaryButton: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    minWidth: 240,
    alignItems: 'center',
  },
  secondaryButtonText: { color: '#007AFF', fontSize: 15, fontWeight: '600' },
  footer: { fontSize: 12, opacity: 0.5, textAlign: 'center', marginTop: 24 },
})
