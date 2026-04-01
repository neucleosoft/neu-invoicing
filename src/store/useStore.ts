import { create } from 'zustand'
import { AuthStatus, Company, SyncStatus } from '../types'

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
  darkMode: false,
  setDarkMode: (dark) => set({ darkMode: dark }),

  // Loading
  loading: false,
  setLoading: (loading) => set({ loading })
}))
