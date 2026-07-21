// App lock: when a PIN is set (Settings → App Lock), the books hide behind a
// PIN screen on cold start and whenever the app comes back from the background
// after LOCK_AFTER_MS. Rendered as a wrapper INSIDE the theme provider but
// around the whole navigator, so no route (or deep link) can render under it.
// Sync keeps running while locked — the lock protects eyes, not data flow.

import { useEffect, useRef, useState } from 'react'
import { AppState, Pressable, StyleSheet, TextInput } from 'react-native'

import { ThemedText } from '@/components/themed-text'
import { ThemedView } from '@/components/themed-view'
import { isPinSet, verifyPin } from '@/utils/appLock'

// Re-lock when the app was backgrounded longer than this (5 minutes) — long
// enough to switch to WhatsApp and back, short enough that a phone left on
// the counter locks itself.
const LOCK_AFTER_MS = 5 * 60 * 1000

export function AppLockGate({ children }: { children: React.ReactNode }) {
  // null = still checking whether a PIN exists (render nothing over the app
  // for one frame rather than flashing the lock).
  const [locked, setLocked] = useState<boolean | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const backgroundedAt = useRef<number | null>(null)

  useEffect(() => {
    isPinSet().then((set) => setLocked(set ? true : false))
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        backgroundedAt.current = Date.now()
      } else if (state === 'active') {
        const away = backgroundedAt.current ? Date.now() - backgroundedAt.current : 0
        backgroundedAt.current = null
        if (away > LOCK_AFTER_MS) {
          isPinSet().then((set) => {
            if (set) {
              setPin('')
              setError(false)
              setLocked(true)
            }
          })
        }
      }
    })
    return () => sub.remove()
  }, [])

  async function handleUnlock() {
    if (await verifyPin(pin)) {
      setPin('')
      setError(false)
      setLocked(false)
    } else {
      setPin('')
      setError(true)
    }
  }

  if (locked === null) return null
  if (!locked) return <>{children}</>

  return (
    <ThemedView style={styles.container}>
      <ThemedText type="title" style={styles.title}>🔒</ThemedText>
      <ThemedText type="subtitle">Enter PIN</ThemedText>
      <ThemedText style={styles.hint}>Your books are locked.</ThemedText>
      <TextInput
        value={pin}
        onChangeText={(v) => {
          setPin(v.replace(/[^0-9]/g, '').slice(0, 6))
          setError(false)
        }}
        keyboardType="number-pad"
        secureTextEntry
        autoFocus
        style={styles.input}
        placeholder="••••"
        placeholderTextColor="#9ca3af"
        onSubmitEditing={handleUnlock}
      />
      {error ? <ThemedText style={styles.error}>Wrong PIN — try again.</ThemedText> : null}
      <Pressable style={styles.button} onPress={handleUnlock} disabled={pin.length < 4}>
        <ThemedText style={styles.buttonText}>Unlock</ThemedText>
      </Pressable>
    </ThemedView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  title: { fontSize: 44, lineHeight: 52 },
  hint: { opacity: 0.6, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    fontSize: 24,
    letterSpacing: 12,
    textAlign: 'center',
    minWidth: 180,
    color: '#111827',
    backgroundColor: '#f9fafb',
  },
  error: { color: '#dc2626', fontSize: 13 },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 10,
    marginTop: 8,
  },
  buttonText: { color: 'white', fontWeight: '600', fontSize: 16 },
})
