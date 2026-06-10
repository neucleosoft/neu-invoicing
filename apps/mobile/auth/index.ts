import * as Google from 'expo-auth-session/providers/google'
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

// Required for the OAuth browser redirect to complete cleanly on iOS.
WebBrowser.maybeCompleteAuthSession()

const WEB_CLIENT_ID = '1088283723953-ksne545qon08jgm1hgnrl6a74q5egk7d.apps.googleusercontent.com'
const ANDROID_CLIENT_ID = '1088283723953-4akf58d2nbomhu6um42hp4malbdoampg.apps.googleusercontent.com'
// Reverse-client-id format — the URI Google's Android client auto-allows.
// `mobile://oauthredirect` gets rejected by Google's validator.
const REDIRECT_URI =
  'com.googleusercontent.apps.1088283723953-4akf58d2nbomhu6um42hp4malbdoampg:/oauthredirect'
const STORAGE_KEY = 'neu.auth.accessToken'
// Set when the user chooses to use the app without a Google account. The gate in
// _layout treats (user || offlineMode) as "allowed in"; cleared on real sign-in.
const OFFLINE_KEY = 'neu.auth.offlineMode'

export type AuthUser = {
  sub: string
  email: string
  name: string
  picture?: string
}

type AuthContextValue = {
  user: AuthUser | null
  accessToken: string | null
  /** True when using the app without a Google account. */
  offlineMode: boolean
  loading: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  /** Continue without signing in (data stays local; no cloud backup). */
  enterOfflineMode: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [offlineMode, setOfflineMode] = useState(false)
  const [loading, setLoading] = useState(true)

  const [, response, promptAsync] = Google.useAuthRequest({
    webClientId: WEB_CLIENT_ID,
    iosClientId: WEB_CLIENT_ID,
    androidClientId: ANDROID_CLIENT_ID,
    scopes: [
      'profile',
      'email',
      // App-private Drive folder where the desktop app stores neuinvoicing.db.
      // Hidden from the user's main Drive UI; only this app's OAuth client can see it.
      'https://www.googleapis.com/auth/drive.appdata',
    ],
    redirectUri: REDIRECT_URI,
    extraParams: { prompt: 'select_account' },
  })

  // Restore session (and the offline-mode choice) on boot.
  useEffect(() => {
    void (async () => {
      const [token, offline] = await Promise.all([
        SecureStore.getItemAsync(STORAGE_KEY),
        SecureStore.getItemAsync(OFFLINE_KEY),
      ])
      if (offline === 'true') setOfflineMode(true)
      if (token) {
        try {
          const userInfo = await fetchUserInfo(token)
          setUser(userInfo)
          setAccessToken(token)
        } catch {
          await SecureStore.deleteItemAsync(STORAGE_KEY)
        }
      }
      setLoading(false)
    })()
  }, [])

  // expo-auth-session handles the code → token exchange internally; when it
  // succeeds, the response object becomes populated and we save the token here.
  useEffect(() => {
    if (response?.type === 'success') {
      const token = response.authentication?.accessToken
      if (!token) return
      fetchUserInfo(token)
        .then((userInfo) => {
          setUser(userInfo)
          setAccessToken(token)
          // A real sign-in supersedes offline mode.
          setOfflineMode(false)
          return Promise.all([
            SecureStore.setItemAsync(STORAGE_KEY, token),
            SecureStore.deleteItemAsync(OFFLINE_KEY),
          ])
        })
        .catch((e) => {
          console.error('Failed to fetch user info after sign-in', e)
        })
    }
  }, [response])

  async function signIn() {
    await promptAsync()
  }

  // Use the app without a Google account. Persisted so it survives a relaunch;
  // the gate then lets the user in (a company profile is still required).
  async function enterOfflineMode() {
    await SecureStore.setItemAsync(OFFLINE_KEY, 'true')
    setOfflineMode(true)
  }

  async function signOut() {
    setUser(null)
    setAccessToken(null)
    setOfflineMode(false)
    await Promise.all([
      SecureStore.deleteItemAsync(STORAGE_KEY),
      SecureStore.deleteItemAsync(OFFLINE_KEY),
    ])
  }

  return createElement(
    AuthContext.Provider,
    {
      value: {
        user,
        accessToken,
        offlineMode,
        loading,
        signIn,
        signOut,
        enterOfflineMode,
      },
    },
    children
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

async function fetchUserInfo(token: string): Promise<AuthUser> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`)
  const data = await res.json()
  return {
    sub: data.sub,
    email: data.email,
    name: data.name,
    picture: data.picture,
  }
}
