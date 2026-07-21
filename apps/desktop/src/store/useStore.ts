import { create } from 'zustand'
import { AuthStatus, Company, SyncStatus } from '../types'

export type ThemePreference = 'light' | 'dark' | 'system'

const THEME_STORAGE_KEY = 'themePreference'

const readStoredPreference = (): ThemePreference => {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // localStorage unavailable
  }
  return 'system'
}

const systemPrefersDark = (): boolean => {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

const initialPreference = readStoredPreference()
const initialDarkMode =
  initialPreference === 'dark' || (initialPreference === 'system' && systemPrefersDark())

interface AppState {
  // Auth
  authStatus: AuthStatus | null
  setAuthStatus: (status: AuthStatus) => void

  // Company
  company: Company | null
  setCompany: (company: Company | null) => void

  // Sync
  syncStatus: SyncStatus | null
  setSyncStatus: (status: SyncStatus) => void

  // UI State
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void

  // Theme
  themePreference: ThemePreference
  setThemePreference: (pref: ThemePreference) => void
  darkMode: boolean
  setDarkMode: (dark: boolean) => void

  // Loading states
  loading: boolean
  setLoading: (loading: boolean) => void
}

export const useStore = create<AppState>((set) => ({
  // Auth
  authStatus: null,
  setAuthStatus: (status) => set({ authStatus: status }),

  // Company
  company: null,
  setCompany: (company) => set({ company }),

  // Sync
  syncStatus: null,
  setSyncStatus: (status) => set({ syncStatus: status }),

  // UI
  sidebarOpen: true,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  // Theme
  themePreference: initialPreference,
  setThemePreference: (pref) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, pref)
    } catch {
      // localStorage unavailable
    }
    const dark = pref === 'dark' || (pref === 'system' && systemPrefersDark())
    set({ themePreference: pref, darkMode: dark })
  },
  darkMode: initialDarkMode,
  setDarkMode: (dark) => set({ darkMode: dark }),

  // Loading
  loading: false,
  setLoading: (loading) => set({ loading })
}))
