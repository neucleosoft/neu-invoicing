import { useSyncExternalStore } from 'react'
import { useColorScheme as useSystemColorScheme } from 'react-native'

import { getThemePreference, subscribeThemePreference } from './theme-preference'

// System scheme, overridden by the user's Settings choice (Appearance:
// Light / Dark / System). Every themed component already calls this hook, so
// the override applies app-wide with no provider plumbing.
export function useColorScheme() {
  const system = useSystemColorScheme()
  const pref = useSyncExternalStore(subscribeThemePreference, getThemePreference)
  return pref === 'system' ? system : pref
}
