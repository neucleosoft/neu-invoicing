import { ipcMain, BrowserWindow } from 'electron'
import { google } from 'googleapis'
import Store from 'electron-store'

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

const SCOPES = [
  'https://www.googleapis.com/auth/drive.appdata',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email'
]

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

              // Store tokens securely
              store.set('google_tokens', tokens)

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
      oauth2Client.setCredentials({})

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
        user: userInfo
      }
    }

    return {
      isAuthenticated: false,
      user: null
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
