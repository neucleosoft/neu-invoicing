import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'

const Login = () => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const { setAuthStatus, setCompany } = useStore()

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError('')

    try {
      const result = await window.electronAPI.auth.signInWithGoogle()

      if (result.success) {
        // Cloud may have existing data — pull it down before checking for a
        // local company, so returning users don't briefly see the onboarding
        // page. Done BEFORE setAuthStatus so the user stays on the login screen
        // while this resolves.
        // (See open question in MIGRATIONS / issues: this silently bypasses the
        // Phase 1 restore prompt for sign-in flows — intentional for now.)
        try {
          const backup = await window.electronAPI.sync.checkCloudBackup()
          if (backup.exists) {
            await window.electronAPI.sync.download()
          }
        } catch (syncError) {
          console.log('Cloud check failed, continuing with local data:', syncError)
        }

        // Check if company exists (after possible download, so cloud data is available)
        const companyResult = await window.electronAPI.company.get()

        // Now update state — React renders the right page in one go
        setAuthStatus({ isAuthenticated: true, user: result.user })
        if (companyResult.success && companyResult.data) {
          setCompany(companyResult.data)
          navigate('/')
        } else {
          navigate('/onboarding')
        }
      } else {
        setError(result.error || 'Authentication failed')
      }
    } catch (err) {
      setError('An error occurred during authentication')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-primary-50 to-primary-100 dark:from-gray-900 dark:to-gray-800">
      <div className="card w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-primary-600 mb-2">Neu Invoicing</h1>
          <p className="text-gray-600 dark:text-gray-400">Your business, your data, your control</p>
        </div>

        <div className="space-y-4">
          <button
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center space-x-3 px-6 py-3 bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 rounded-lg hover:border-primary-500 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            <span className="font-medium text-gray-700 dark:text-gray-200">
              {loading ? 'Signing in...' : 'Sign in with Google'}
            </span>
          </button>

          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
              {error}
            </div>
          )}
        </div>

        <div className="mt-8 text-center text-sm text-gray-600 dark:text-gray-400">
          <p className="mb-2">By signing in, you agree to:</p>
          <ul className="space-y-1 text-xs">
            <li>✓ Store your data in your Google Drive</li>
            <li>✓ Offline-first operation</li>
            <li>✓ Full data portability and ownership</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

export default Login
