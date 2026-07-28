import * as AuthSession from 'expo-auth-session'
import * as Google from 'expo-auth-session/providers/google'
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { Platform } from 'react-native'

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

// The access token is a one-hour visitor badge; the refresh token is the
// long-lived key that silently mints new badges. Storing it is what keeps the
// user signed in across days — and what future background sync depends on.
const REFRESH_KEY = 'neu.auth.refreshToken'
// Unix-ms timestamp when the stored access token expires (with expiresIn
// missing we assume Google's standard hour).
const EXPIRY_KEY = 'neu.auth.accessTokenExpiry'
// Cached profile JSON so boot needs NO network call — an offline launch stays
// signed in instead of appearing logged out (or worse, wiping tokens).
const USER_KEY = 'neu.auth.user'
// Unix-ms when the CURRENT refresh token was issued. In Google's Testing mode
// a refresh token dies 7 days after issue — the SessionBanner prompts a renew
// at day 6 so backups/sync never break silently. Reset whenever Google hands
// us a (new or rotated) refresh token.
const SIGNED_IN_AT_KEY = 'neu.auth.signedInAt'

/** When the current refresh token was issued (ms), or null. Read by the
 *  SessionBanner to show the day-6 "renew soon" prompt. */
export async function getSignedInAt(): Promise<number | null> {
  const v = await SecureStore.getItemAsync(SIGNED_IN_AT_KEY)
  return v ? Number(v) : null
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'

// The refresh call must use the same client the code was exchanged with:
// Android's native client on Android, the web client elsewhere (dev/iOS).
const platformClientId = () =>
  Platform.OS === 'android' ? ANDROID_CLIENT_ID : WEB_CLIENT_ID

// Persist a token response. Google only returns the refresh token on the FIRST
// consent (or when it rotates) — never overwrite a stored one with undefined.
async function persistTokens(t: {
  accessToken: string
  refreshToken?: string
  expiresIn?: number
}): Promise<void> {
  const expiry = Date.now() + (t.expiresIn ?? 3600) * 1000
  const writes = [
    SecureStore.setItemAsync(STORAGE_KEY, t.accessToken),
    SecureStore.setItemAsync(EXPIRY_KEY, String(expiry)),
  ]
  if (t.refreshToken) {
    writes.push(SecureStore.setItemAsync(REFRESH_KEY, t.refreshToken))
    // A fresh (or rotated) refresh token restarts the 7-day Testing-mode clock.
    writes.push(SecureStore.setItemAsync(SIGNED_IN_AT_KEY, String(Date.now())))
  }
  await Promise.all(writes)
}

// Mint a fresh access token from the stored refresh token and persist it.
// Throws when Google rejects the refresh token (revoked/expired) — the caller
// decides whether that means "sign in again".
async function refreshAccessToken(refreshToken: string): Promise<string> {
  const result = await AuthSession.refreshAsync(
    { clientId: platformClientId(), refreshToken },
    { tokenEndpoint: TOKEN_ENDPOINT },
  )
  await persistTokens(result)
  return result.accessToken
}

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
  /**
   * The token every Drive call should use: returns the stored access token if
   * it still has >60s of life, otherwise silently mints a new one from the
   * refresh token. null = genuinely signed out (refresh revoked/absent) — the
   * caller should prompt a re-sign-in.
   */
  getFreshAccessToken: () => Promise<string | null>
  /** True when Google has REVOKED the session (invalid_grant) while a user is
   *  still cached — sync/backups are dead until a fresh sign-in. Drives the
   *  red SessionBanner. */
  authDead: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [offlineMode, setOfflineMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [authDead, setAuthDead] = useState(false)

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
    // access_type=offline asks for a refresh token on web-client exchanges;
    // Google's native (installed-app) flow returns one regardless. Harmless
    // where it's ignored, required where it isn't.
    extraParams: { prompt: 'select_account', access_type: 'offline' },
  })

  // Restore session (and the offline-mode choice) on boot.
  //
  // The profile comes from the local cache, NOT a network call — so an offline
  // launch (or an expired access token) keeps the user signed in. The old
  // version validated the token against Google's userinfo endpoint on every
  // boot and DELETED it on any failure, which silently signed people out an
  // hour after sign-in (and on airplane mode). Token freshness is now handled
  // lazily by getFreshAccessToken at the moment a Drive call actually needs it.
  useEffect(() => {
    void (async () => {
      const [token, refresh, cachedUser, offline] = await Promise.all([
        SecureStore.getItemAsync(STORAGE_KEY),
        SecureStore.getItemAsync(REFRESH_KEY),
        SecureStore.getItemAsync(USER_KEY),
        SecureStore.getItemAsync(OFFLINE_KEY),
      ])
      if (offline === 'true') setOfflineMode(true)

      if (cachedUser) {
        try {
          setUser(JSON.parse(cachedUser) as AuthUser)
          setAccessToken(token)
        } catch {
          await SecureStore.deleteItemAsync(USER_KEY)
        }
      } else if (token) {
        // Legacy install (pre-refresh-token): no cached profile. Try the old
        // network validation once; on success, cache the profile so every
        // future boot takes the offline path above. Only delete the token when
        // Google explicitly rejects it — a network failure is not a sign-out.
        try {
          const userInfo = await fetchUserInfo(token)
          setUser(userInfo)
          setAccessToken(token)
          await SecureStore.setItemAsync(USER_KEY, JSON.stringify(userInfo))
        } catch (e) {
          if (e instanceof TokenRejectedError && !refresh) {
            await SecureStore.deleteItemAsync(STORAGE_KEY)
          }
        }
      }
      setLoading(false)
    })()
  }, [])

  // expo-auth-session handles the code → token exchange internally; when it
  // succeeds, the response object becomes populated and we save the whole
  // token set (access + refresh + expiry) plus the profile here.
  useEffect(() => {
    if (response?.type === 'success') {
      const auth = response.authentication
      if (!auth?.accessToken) return
      // Persist the grant IMMEDIATELY — consent is expensive, and a flaky
      // userinfo call right after it must never cost the user their
      // freshly-issued refresh token.
      persistTokens({
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken ?? undefined,
        expiresIn: auth.expiresIn ?? undefined,
      })
        .then(() => fetchUserInfo(auth.accessToken))
        .then((userInfo) => {
          setUser(userInfo)
          setAccessToken(auth.accessToken)
          setAuthDead(false)
          // A real sign-in supersedes offline mode.
          setOfflineMode(false)
          return Promise.all([
            SecureStore.setItemAsync(USER_KEY, JSON.stringify(userInfo)),
            SecureStore.deleteItemAsync(OFFLINE_KEY),
          ])
        })
        .catch((e) => {
          // Tokens are already stored — the boot-time legacy path will finish
          // the job on the next launch instead of forcing a fresh consent.
          console.error('Failed to fetch user info after sign-in', e)
        })
    }
  }, [response])

  // The token every Drive call should use. Reads storage each time (cheap, and
  // safe across reloads), refreshes only when the stored badge is near death.
  const getFreshAccessToken = useCallback(async (): Promise<string | null> => {
    const [token, refresh, expiry] = await Promise.all([
      SecureStore.getItemAsync(STORAGE_KEY),
      SecureStore.getItemAsync(REFRESH_KEY),
      SecureStore.getItemAsync(EXPIRY_KEY),
    ])
    const stillValid =
      !!token && !!expiry && Date.now() < Number(expiry) - 60_000
    if (stillValid) {
      setAccessToken(token)
      setAuthDead(false)
      return token
    }
    if (!refresh) {
      // Legacy install: no refresh token yet. Hand back whatever we have — a
      // 401 downstream will tell the user to sign in again (which upgrades
      // them to the refresh-token flow).
      return token
    }
    try {
      const fresh = await refreshAccessToken(refresh)
      setAccessToken(fresh)
      setAuthDead(false)
      return fresh
    } catch (e) {
      // Only a REVOKED/expired grant means "signed out". A network failure
      // during refresh hands back the stale token instead — the Drive call
      // then fails with a network error, which is the truth (offline ≠
      // signed out).
      const detail =
        String((e as { code?: string }).code ?? '') + ' ' + String((e as Error).message ?? '')
      if (detail.includes('invalid_grant')) {
        // Google revoked the grant (7-day Testing-mode expiry, or manual
        // revoke). Surface it — the red banner tells the user to sign in.
        setAuthDead(true)
        return null
      }
      console.error('Token refresh failed (transient)', e)
      return token
    }
  }, [])

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
      SecureStore.deleteItemAsync(REFRESH_KEY),
      SecureStore.deleteItemAsync(EXPIRY_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
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
        getFreshAccessToken,
        authDead,
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

// Thrown when Google explicitly rejects a token (401/403) — distinct from a
// network failure, which must never be treated as "signed out".
class TokenRejectedError extends Error {}

async function fetchUserInfo(token: string): Promise<AuthUser> {
  const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401 || res.status === 403) {
    throw new TokenRejectedError(`userinfo rejected: ${res.status}`)
  }
  if (!res.ok) throw new Error(`userinfo failed: ${res.status}`)
  const data = await res.json()
  return {
    sub: data.sub,
    email: data.email,
    name: data.name,
    picture: data.picture,
  }
}
