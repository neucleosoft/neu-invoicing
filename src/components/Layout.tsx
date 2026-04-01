import { useEffect } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore'

const Layout = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { company, authStatus, syncStatus, setAuthStatus, darkMode, setDarkMode } = useStore()

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [darkMode])

  const handleSignOut = async () => {
    await window.electronAPI.auth.signOut()
    setAuthStatus({ isAuthenticated: false, user: null })
    navigate('/login')
  }

  const handleSync = async () => {
    await window.electronAPI.sync.syncNow()
  }

  const navigation = [
    { name: 'Dashboard', path: '/', icon: '📊' },
    { name: 'Parties', path: '/parties', icon: '👥' },
    { name: 'Items', path: '/items', icon: '📦' },
    { name: 'Sales', path: '/sales', icon: '💰' },
    { name: 'Purchase', path: '/purchase', icon: '🛒' },
    { name: 'Challans', path: '/delivery-challan', icon: '🚚' },
    { name: 'Credit/Debit Notes', path: '/credit-notes', icon: '📝' },
    { name: 'Payments', path: '/payments', icon: '💳' },
    { name: 'Cash & Bank', path: '/cash-bank', icon: '🏦' },
    { name: 'Reports', path: '/reports', icon: '📈' },
    { name: 'GST Reports', path: '/gst-reports', icon: '🧾' },
    { name: 'Settings', path: '/settings', icon: '⚙️' }
  ]

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      {/* Sidebar */}
      <div className="w-64 bg-white shadow-lg dark:bg-gray-800">
        <div className="p-6 border-b dark:border-gray-700">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-primary-600">neuInvoicing</h1>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {darkMode ? (
                <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
              )}
            </button>
          </div>
          {company && <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{company.name}</p>}
        </div>

        <nav className="p-4 space-y-2">
          {navigation.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                location.pathname === item.path
                  ? 'bg-primary-50 text-primary-700 font-medium dark:bg-primary-900/30 dark:text-primary-400'
                  : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              <span>{item.name}</span>
            </Link>
          ))}
        </nav>

        {/* User Info and Sync Status */}
        <div className="absolute bottom-0 w-64 p-4 border-t bg-white dark:bg-gray-800 dark:border-gray-700">
          {/* Sync Status */}
          <div className="mb-3">
            <button
              onClick={handleSync}
              className="w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 transition-colors"
            >
              <span>
                {syncStatus?.status === 'syncing' ? '🔄 Syncing...' :
                 syncStatus?.status === 'error' ? '❌ Sync Error' :
                 '✅ Synced'}
              </span>
              {syncStatus?.lastSync && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {new Date(syncStatus.lastSync).toLocaleTimeString()}
                </span>
              )}
            </button>
          </div>

          {/* User Info */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {authStatus?.user?.picture && (
                <img
                  src={authStatus.user.picture}
                  alt="User"
                  className="w-8 h-8 rounded-full"
                />
              )}
              <div className="text-sm">
                <p className="font-medium text-gray-900 dark:text-gray-100">{authStatus?.user?.name}</p>
              </div>
            </div>
            <button
              onClick={handleSignOut}
              className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              title="Sign Out"
            >
              Exit
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-8">
          <Outlet />
        </div>
      </div>
    </div>
  )
}

export default Layout
