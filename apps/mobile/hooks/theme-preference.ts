// User theme override (light/dark/system) — the mobile counterpart of
// desktop's theme switcher. A module-level store (not React context) so the
// use-color-scheme hook can consult it from ANY component without threading a
// provider through the tree; persisted in SecureStore and loaded at boot by
// the root layout.

import * as SecureStore from 'expo-secure-store'

export type ThemePreference = 'light' | 'dark' | 'system'

const KEY = 'neu.theme.preference'

let current: ThemePreference = 'system'
const listeners = new Set<() => void>()

export function getThemePreference(): ThemePreference {
  return current
}

export async function loadThemePreference(): Promise<ThemePreference> {
  const v = await SecureStore.getItemAsync(KEY)
  current = v === 'light' || v === 'dark' ? v : 'system'
  listeners.forEach((l) => l())
  return current
}

export async function setThemePreference(p: ThemePreference): Promise<void> {
  current = p
  listeners.forEach((l) => l())
  await SecureStore.setItemAsync(KEY, p)
}

export function subscribeThemePreference(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}
