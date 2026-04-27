import { useEffect, useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Package,
  Wallet,
  ShoppingCart,
  Truck,
  FileText,
  CreditCard,
  Landmark,
  BarChart3,
  Receipt,
  Settings as SettingsIcon,
  Moon,
  Sun,
  ChevronLeft,
  ChevronRight,
  Search,
  LogOut,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import CommandPalette from './CommandPalette'

const navigation = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Parties', path: '/parties', icon: Users },
  { name: 'Items', path: '/items', icon: Package },
  { name: 'Invoices', path: '/invoices', icon: Wallet },
  { name: 'Quotations', path: '/quotations', icon: FileText },
  { name: 'Proforma Invoices', path: '/proforma-invoices', icon: FileText },
  { name: 'Purchase', path: '/purchase', icon: ShoppingCart },
  { name: 'Challans', path: '/delivery-challan', icon: Truck },
  { name: 'Credit/Debit Notes', path: '/credit-notes', icon: FileText },
  { name: 'Payments', path: '/payments', icon: CreditCard },
  { name: 'Cash & Bank', path: '/cash-bank', icon: Landmark },
  { name: 'Reports', path: '/reports', icon: BarChart3 },
  { name: 'GST Reports', path: '/gst-reports', icon: Receipt },
  { name: 'Settings', path: '/settings', icon: SettingsIcon },
]

const Layout = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { company, authStatus, syncStatus, setAuthStatus, darkMode, setDarkMode, sidebarOpen, setSidebarOpen } = useStore()
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [darkMode])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((p) => !p)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleSignOut = async () => {
    await window.electronAPI.auth.signOut()
    setAuthStatus({ isAuthenticated: false, user: null })
    navigate('/login')
  }

  const handleSync = async () => {
    await window.electronAPI.sync.syncNow()
  }

  const collapsed = !sidebarOpen

  const SyncBadge = () => {
    const isSyncing = syncStatus?.status === 'syncing'
    const isError = syncStatus?.status === 'error'
    const Icon = isSyncing ? RefreshCw : isError ? AlertTriangle : CheckCircle2
    const color = isSyncing
      ? 'text-primary-600 dark:text-primary-400'
      : isError
      ? 'text-red-600 dark:text-red-400'
      : 'text-green-600 dark:text-green-400'
    return <Icon className={`w-4 h-4 shrink-0 ${color} ${isSyncing ? 'animate-spin' : ''}`} />
  }

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900">
      {/* Sidebar */}
      <aside
        className={`${collapsed ? 'w-16' : 'w-64'} bg-white shadow-lg dark:bg-gray-800 flex flex-col h-screen transition-[width] duration-200 ease-out`}
      >
        <div className={`border-b dark:border-gray-700 shrink-0 ${collapsed ? 'p-3' : 'p-6'}`}>
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
            {!collapsed && (
              <h1 className="text-2xl font-bold text-primary-600 tracking-tight">neuInvoicing</h1>
            )}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>
          {!collapsed && company && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 truncate">{company.name}</p>
          )}
        </div>

        {/* Command palette trigger */}
        {!collapsed && (
          <div className="px-4 pt-3">
            <button
              onClick={() => setPaletteOpen(true)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 transition-colors"
            >
              <Search className="w-4 h-4" />
              <span>Search…</span>
              <span className="ml-auto text-xs font-mono bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded px-1.5 py-0.5">⌘K</span>
            </button>
          </div>
        )}

        <nav className={`flex-1 overflow-y-auto space-y-1 ${collapsed ? 'p-2' : 'p-4'}`}>
          {navigation.map((item) => {
            const Icon = item.icon
            const active = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                title={collapsed ? item.name : undefined}
                className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg transition-colors ${
                  active
                    ? 'bg-primary-50 text-primary-700 font-medium dark:bg-primary-900/30 dark:text-primary-400'
                    : 'text-gray-700 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-700'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                {!collapsed && <span className="truncate">{item.name}</span>}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className={`shrink-0 border-t bg-white dark:bg-gray-800 dark:border-gray-700 ${collapsed ? 'p-2 space-y-2' : 'p-4'}`}>
          {/* Dark mode toggle */}
          <button
            onClick={() => setDarkMode(!darkMode)}
            className={`${collapsed ? 'w-full flex justify-center' : 'w-full flex items-center gap-2'} px-3 py-2 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors mb-2`}
            title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {darkMode ? <Sun className="w-4 h-4 text-yellow-400" /> : <Moon className="w-4 h-4 text-gray-600 dark:text-gray-300" />}
            {!collapsed && <span className="text-gray-700 dark:text-gray-300">{darkMode ? 'Light mode' : 'Dark mode'}</span>}
          </button>

          {/* Sync Status */}
          <button
            onClick={handleSync}
            className={`${collapsed ? 'w-full flex justify-center' : 'w-full flex items-center justify-between'} px-3 py-2 text-sm rounded-lg bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 transition-colors mb-3`}
            title={syncStatus?.status === 'error' ? 'Sync error — click to retry' : 'Sync now'}
          >
            <span className="flex items-center gap-2">
              <SyncBadge />
              {!collapsed && (
                <span className="text-gray-700 dark:text-gray-200">
                  {syncStatus?.status === 'syncing' ? 'Syncing…' : syncStatus?.status === 'error' ? 'Sync error' : 'Synced'}
                </span>
              )}
            </span>
            {!collapsed && syncStatus?.lastSync && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {new Date(syncStatus.lastSync).toLocaleTimeString()}
              </span>
            )}
          </button>

          {/* User Info */}
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
            <div className="flex items-center gap-2 min-w-0">
              {authStatus?.user?.picture && (
                <img
                  src={authStatus.user.picture}
                  alt="User"
                  className="w-8 h-8 rounded-full shrink-0"
                />
              )}
              {!collapsed && (
                <div className="text-sm min-w-0">
                  <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{authStatus?.user?.name}</p>
                </div>
              )}
            </div>
            {!collapsed && (
              <button
                onClick={handleSignOut}
                className="p-1.5 text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">
          <Outlet />
        </div>
      </main>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  )
}

export default Layout
