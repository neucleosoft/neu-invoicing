import { ipcMain, BrowserWindow } from 'electron'
import { google } from 'googleapis'
import Store from 'electron-store'
import { resetSyncBaseline } from './sync'

const store = new Store()

// Google OAuth Configuration — load from environment variables
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/oauth/callback'

const oauth2Client = new google.auth.OAuth2(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  REDIRECT_URI
)

// Persist refreshed access tokens. googleapis auto-refreshes when the access
// token expires, but the new credentials only live in memory unless we save
// them back. Without this, every app restart starts with a stale access token
// and (eventually, when the in-memory refresh chain breaks) sync fails.
oauth2Client.on('tokens', (tokens) => {
  const existing = (store.get('google_tokens') as any) || {}
  // Refresh responses don't include refresh_token — keep the old one.
  const merged = { ...existing, ...tokens }
  store.set('google_tokens', merged)
  // A new/rotated refresh token restarts the 7-day Testing-mode life clock —
  // the SessionBanner's day-6 renew prompt keys off this timestamp.
  if (tokens.refresh_token) {
    store.set('signed_in_at', Date.now())
    store.delete('auth_invalidated_at')
  }
})

const SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email'
]

// "Skip sign-in" mode. Set when the user chooses to use the app without
// connecting Google. Cleared automatically when they sign in later.
const OFFLINE_MODE_KEY = 'offline_mode'

const isOfflineMode = (): boolean => Boolean(store.get(OFFLINE_MODE_KEY))
const setOfflineMode = (on: boolean) => {
  if (on) store.set(OFFLINE_MODE_KEY, true)
  else store.delete(OFFLINE_MODE_KEY)
}

export const setupAuthHandlers = () => {
  // Sign in with Google
  ipcMain.handle('auth:signInWithGoogle', async () => {
    try {
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
      })

      // Create a new window for authentication
      const authWindow = new BrowserWindow({
        width: 600,
        height: 700,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        },
        autoHideMenuBar: true,
        title: 'Sign in with Google'
      })

      authWindow.loadURL(authUrl)

      return new Promise((resolve, reject) => {
        // Listen for the redirect with the code
        authWindow.webContents.on('will-redirect', async (_event, url) => {
          const urlParams = new URL(url)
          const code = urlParams.searchParams.get('code')

          if (code) {
            try {
              const { tokens } = await oauth2Client.getToken(code)
              oauth2Client.setCredentials(tokens)

              // Store tokens securely; signing in cancels any prior offline mode.
              store.set('google_tokens', tokens)
              store.set('signed_in_at', Date.now())
              store.delete('auth_invalidated_at')
              setOfflineMode(false)

              // Get user info
              const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
              const { data } = await oauth2.userinfo.get()

              store.set('user_info', data)

              authWindow.close()
              resolve({
                success: true,
                user: data
              })
            } catch (error) {
              authWindow.close()
              reject(error)
            }
          }
        })

        authWindow.on('closed', () => {
          reject(new Error('Authentication window closed'))
        })
      })
    } catch (error) {
      console.error('Authentication error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Authentication failed'
      }
    }
  })

  // Sign out
  ipcMain.handle('auth:signOut', async () => {
    try {
      store.delete('google_tokens')
      store.delete('user_info')
      store.delete('demo_mode')
      // A DELIBERATE sign-out is not an expiry — no red banner afterwards.
      store.delete('signed_in_at')
      store.delete('auth_invalidated_at')
      setOfflineMode(false)
      oauth2Client.setCredentials({})
      // Clear this device's sync baseline so the NEXT account that signs in
      // doesn't inherit the previous account's "last known" mtimes. Without
      // this, an account switch can make syncState() falsely report "in sync"
      // and silently overwrite the new account's data (the cross-account
      // contamination behind the data-loss incident).
      resetSyncBaseline()

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Sign out failed'
      }
    }
  })

  // Get auth status
  ipcMain.handle('auth:getAuthStatus', async () => {
    const tokens = store.get('google_tokens') as any
    const userInfo = store.get('user_info') as any

    if (tokens) {
      oauth2Client.setCredentials(tokens)
      return {
        isAuthenticated: true,
        user: userInfo,
        offlineMode: false,
        // When the CURRENT refresh token was issued — the SessionBanner shows
        // a renew prompt at day 6 (Testing-mode tokens die at day 7).
        signedInAt: (store.get('signed_in_at') as number | undefined) ?? null,
        authInvalidatedAt: null,
      }
    }

    return {
      isAuthenticated: false,
      user: null,
      offlineMode: isOfflineMode(),
      signedInAt: null,
      // Set when Google REVOKED the session (vs never signed in / signed out
      // on purpose) — drives the red "sign-in expired" banner.
      authInvalidatedAt: (store.get('auth_invalidated_at') as number | undefined) ?? null,
    }
  })

  // Enter offline mode — user opted to use the app without connecting Google.
  // The login screen still shows; this just unlocks the rest of the app.
  ipcMain.handle('auth:enterOfflineMode', async () => {
    try {
      setOfflineMode(true)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to enter offline mode'
      }
    }
  })

  // Exit offline mode — used when the user is about to sign in to Google so
  // the auth gate falls back to "needs sign-in" if the OAuth flow is cancelled.
  ipcMain.handle('auth:exitOfflineMode', async () => {
    try {
      setOfflineMode(false)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to exit offline mode'
      }
    }
  })
}

export const getOAuth2Client = () => {
  const tokens = store.get('google_tokens') as any
  if (tokens) {
    oauth2Client.setCredentials(tokens)
  }
  return oauth2Client
}

// Returns true if the error from googleapis indicates the user needs to
// re-authenticate (refresh token revoked, expired, or invalid_grant).
export const isAuthError = (err: unknown): boolean => {
  if (!err || typeof err !== 'object') return false
  const e = err as any
  const code = e.response?.status || e.code
  if (code === 401 || code === 403) return true
  const msg = String(e.message || '').toLowerCase()
  return (
    msg.includes('invalid_grant') ||
    msg.includes('invalid grant') ||
    msg.includes('token has been expired') ||
    msg.includes('token has been revoked') ||
    msg.includes('no access') ||
    msg.includes('no refresh token')
  )
}

// Wipe persisted tokens so the next sync attempt prompts re-auth. Called on
// auth ERRORS (revoked/expired grant) — record the moment so the UI can show
// "sign-in expired" instead of pretending the user never signed in.
export const clearStoredCredentials = () => {
  store.delete('google_tokens')
  store.delete('user_info')
  store.delete('signed_in_at')
  store.set('auth_invalidated_at', Date.now())
  oauth2Client.setCredentials({})
}
