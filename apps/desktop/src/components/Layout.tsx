import { useEffect, useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Package,
  Wallet,
  ShoppingCart,
  ClipboardList,
  Truck,
  FileText,
  CreditCard,
  Landmark,
  BarChart3,
  Receipt,
  ScrollText,
  Archive,
  Settings as SettingsIcon,
  Moon,
  Sun,
  Monitor,
  ChevronLeft,
  ChevronRight,
  Search,
  LogOut,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  CloudUpload,
  CloudDownload,
} from 'lucide-react'
import { useStore } from '../store/useStore'
import CommandPalette from './CommandPalette'
import SyncConflictDialog from './SyncConflictDialog'
import { useManualBackup } from '../hooks/useManualBackup'
import { useConnectGoogle } from '../hooks/useConnectGoogle'

const navigationGroups: { label?: string; items: { name: string; path: string; icon: typeof LayoutDashboard }[] }[] = [
  {
    items: [
      { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Sales',
    items: [
      { name: 'Invoices', path: '/invoices', icon: Wallet },
      { name: 'Previous Invoices', path: '/previous-invoices', icon: Archive },
      { name: 'Quotations', path: '/quotations', icon: FileText },
      { name: 'Proforma Invoices', path: '/proforma-invoices', icon: FileText },
      { name: 'Challans', path: '/delivery-challan', icon: Truck },
    ],
  },
  {
    label: 'Purchase & Payments',
    items: [
      { name: 'Purchase Orders', path: '/purchase-orders', icon: ClipboardList },
      { name: 'Purchase Bills', path: '/purchase', icon: ShoppingCart },
      { name: 'Credit/Debit Notes', path: '/credit-notes', icon: FileText },
      { name: 'Payments', path: '/payments', icon: CreditCard },
      { name: 'Cash & Bank', path: '/cash-bank', icon: Landmark },
      { name: 'Daily Expenses', path: '/expenses', icon: Receipt },
    ],
  },
  {
    label: 'Master',
    items: [
      { name: 'Customers', path: '/customers', icon: Users },
      { name: 'Suppliers', path: '/suppliers', icon: Users },
      { name: 'Items', path: '/items', icon: Package },
      { name: 'Supplier Items', path: '/supplier-items', icon: Package },
    ],
  },
  {
    label: 'Reports',
    items: [
      { name: 'Customer Statement', path: '/statement', icon: ScrollText },
      { name: 'Reports', path: '/reports', icon: BarChart3 },
      { name: 'GST Reports', path: '/gst-reports', icon: Receipt },
    ],
  },
  {
    items: [
      { name: 'Settings', path: '/settings', icon: SettingsIcon },
    ],
  },
]

const Layout = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const {
    company,
    authStatus,
    syncStatus,
    setAuthStatus,
    darkMode,
    setDarkMode,
    themePreference,
    setThemePreference,
    sidebarOpen,
    setSidebarOpen,
  } = useStore()
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Main process tells us tokens are no longer valid → bounce to /login.
  useEffect(() => {
    const unsubscribe = window.electronAPI.auth.onAuthInvalidated?.(() => {
      setAuthStatus({ isAuthenticated: false, user: null })
      navigate('/login')
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Apply the dark class to <html> whenever effective darkMode changes.
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [darkMode])

  // When preference is "system", track the OS color-scheme media query and
  // update the effective darkMode accordingly. Stop tracking when the user
  // picks an explicit light/dark preference.
  useEffect(() => {
    if (themePreference !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setDarkMode(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setDarkMode(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [themePreference, setDarkMode])

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

  const {
    triggerBackup,
    triggerUpload,
    triggerRestore,
    timestamps,
    isWorking: isBackingUp,
    conflictDialogProps,
  } = useManualBackup()

  // Short "May 30, 6:05 PM" style for the button subtitles. Empty when never.
  const fmtStamp = (iso: string | null): string =>
    iso
      ? new Date(iso).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
      : 'Never'
  const { connect: connectGoogle, isConnecting, dialog: connectDialog } = useConnectGoogle()

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
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside
        className={`${collapsed ? 'w-16' : 'w-64'} flex flex-col h-screen
          bg-white dark:bg-slate-900
          ring-1 ring-slate-200 dark:ring-slate-800
          shadow-sm
          transition-[width] duration-200 ease-out z-10`}
      >
        <div className={`border-b dark:border-gray-700 shrink-0 ${collapsed ? 'p-3' : 'p-6'}`}>
          <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'}`}>
            {!collapsed && (
              <h1 className="text-2xl font-bold text-primary-600 tracking-tight">Neu Invoicing</h1>
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

        <nav className={`flex-1 overflow-y-auto ${collapsed ? 'p-2' : 'px-3 py-4'}`}>
          {navigationGroups.map((group, gi) => (
            <div key={gi} className={gi > 0 ? (collapsed ? 'mt-2 pt-2 border-t border-gray-100 dark:border-gray-700/50' : 'mt-4') : ''}>
              {!collapsed && group.label && (
                <div className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  {group.label}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon
                  const active = location.pathname === item.path
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      title={collapsed ? item.name : undefined}
                      className={`relative flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2 rounded-lg transition-colors duration-150 ${
                        active
                          ? 'bg-primary-50 text-primary-700 font-semibold dark:bg-primary-500/15 dark:text-primary-200'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                      }`}
                    >
                      {active && !collapsed && (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-primary-600 dark:bg-primary-400" />
                      )}
                      <Icon className={`w-5 h-5 shrink-0 transition-transform duration-150 ${active ? 'text-primary-600 dark:text-primary-300' : ''}`} strokeWidth={active ? 2.25 : 1.75} />
                      {!collapsed && <span className="truncate text-sm">{item.name}</span>}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className={`shrink-0 border-t bg-white dark:bg-gray-800 dark:border-gray-700 ${collapsed ? 'p-2 space-y-2' : 'p-4'}`}>
          {/* Theme switch — segmented pill: Light / Dark / System */}
          {(() => {
            const options: { key: 'light' | 'dark' | 'system'; Icon: typeof Sun; label: string }[] = [
              { key: 'light', Icon: Sun, label: 'Light' },
              { key: 'dark', Icon: Moon, label: 'Dark' },
              { key: 'system', Icon: Monitor, label: 'System' },
            ]
            if (collapsed) {
              // Compact: cycle through on a single icon button
              const next = themePreference === 'light' ? 'dark' : themePreference === 'dark' ? 'system' : 'light'
              const current = options.find((o) => o.key === themePreference)!
              const Icon = current.Icon
              const iconColor =
                themePreference === 'light' ? 'text-yellow-500' :
                themePreference === 'dark' ? 'text-indigo-400' :
                'text-gray-600 dark:text-gray-300'
              return (
                <button
                  onClick={() => setThemePreference(next)}
                  className="w-full flex justify-center px-3 py-2 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors mb-2"
                  title={`Theme: ${current.label} — click for ${next}`}
                >
                  <Icon className={`w-4 h-4 ${iconColor}`} />
                </button>
              )
            }
            return (
              <div
                role="radiogroup"
                aria-label="Theme"
                className="mb-2 grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-900/60"
              >
                {options.map(({ key, Icon, label }) => {
                  const active = themePreference === key
                  return (
                    <button
                      key={key}
                      role="radio"
                      aria-checked={active}
                      onClick={() => setThemePreference(key)}
                      title={`${label} mode`}
                      className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition ${
                        active
                          ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                          : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{label}</span>
                    </button>
                  )
                })}
              </div>
            )
          })()}

          {/* Sync controls — two EXPLICIT directions so you always see which way
              data is about to move (the single auto-button used to hide this,
              which is how an old cloud copy could silently overwrite newer local
              data). Each button shows its timestamp = the warning label. Hidden
              in offline mode (no Google = no sync). */}
          {authStatus?.isAuthenticated && (
            <>
              {collapsed ? (
                <div className="space-y-2 mb-3">
                  <button
                    onClick={triggerUpload}
                    disabled={isBackingUp}
                    className="w-full flex justify-center px-3 py-2 rounded-lg bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 transition-colors disabled:opacity-60"
                    title={`Back up to cloud — this device last: ${fmtStamp(timestamps.thisDeviceLastUpload)}`}
                  >
                    <CloudUpload className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                  </button>
                  <button
                    onClick={triggerRestore}
                    disabled={isBackingUp || !timestamps.cloudExists}
                    className="w-full flex justify-center px-3 py-2 rounded-lg bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 transition-colors disabled:opacity-40"
                    title={`Restore from cloud — cloud backup: ${fmtStamp(timestamps.cloudModifiedTime)}`}
                  >
                    <CloudDownload className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                  </button>
                </div>
              ) : (
                <div className="space-y-2 mb-3">
                  <button
                    onClick={triggerUpload}
                    disabled={isBackingUp}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 transition-colors disabled:opacity-60 text-left"
                    title="Upload this device's data to the cloud"
                  >
                    <CloudUpload className="w-4 h-4 shrink-0 text-primary-600 dark:text-primary-400" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-gray-800 dark:text-gray-100">Back up to cloud</span>
                      <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                        This device: {fmtStamp(timestamps.thisDeviceLastUpload)}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={triggerRestore}
                    disabled={isBackingUp || !timestamps.cloudExists}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-lg bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 transition-colors disabled:opacity-40 text-left"
                    title="Replace this device's data with the cloud backup"
                  >
                    <CloudDownload className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-gray-800 dark:text-gray-100">Restore from cloud</span>
                      <span className="block text-[11px] text-gray-500 dark:text-gray-400">
                        {timestamps.cloudExists ? `Cloud backup: ${fmtStamp(timestamps.cloudModifiedTime)}` : 'No cloud backup yet'}
                      </span>
                    </span>
                  </button>
                </div>
              )}
              {/* Live sync status line (badge + error), under the buttons. */}
              {!collapsed && (
                <div className="flex items-center gap-2 mb-3 px-1 text-xs text-gray-500 dark:text-gray-400">
                  <SyncBadge />
                  <span>
                    {syncStatus?.status === 'syncing'
                      ? 'Syncing…'
                      : syncStatus?.status === 'error'
                      ? 'Sync error'
                      : 'Up to date'}
                  </span>
                </div>
              )}
              {!collapsed && syncStatus?.status === 'error' && syncStatus?.lastError && (
                <div className="mb-3 -mt-1 px-3 py-2 text-xs rounded-lg bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300 border border-red-200 dark:border-red-900/50">
                  {syncStatus.lastError}
                </div>
              )}
            </>
          )}

          {/* Offline indicator — clickable: turns on cloud backup via Google sign-in. */}
          {authStatus?.offlineMode && (
            <button
              onClick={connectGoogle}
              disabled={isConnecting}
              className={`${collapsed ? 'w-full flex justify-center' : 'w-full flex items-center gap-2 px-3 py-2'} text-xs rounded-lg bg-gray-100 hover:bg-gray-200 dark:bg-gray-700/50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 transition-colors disabled:opacity-60 disabled:cursor-wait`}
              title="Connect Google to enable cloud backup"
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isConnecting ? 'bg-primary-500 animate-pulse' : 'bg-gray-400 dark:bg-gray-500'}`} />
              {!collapsed && (
                <span className="truncate text-left flex-1">
                  {isConnecting ? 'Connecting…' : 'Connect Google for backup'}
                </span>
              )}
            </button>
          )}

          {/* User Info — only when actually signed in with Google. */}
          {authStatus?.isAuthenticated && (
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
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900">
        <div className="p-8">
          <Outlet />
        </div>
      </main>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onSyncNow={triggerBackup} />
      <SyncConflictDialog {...conflictDialogProps} />
      {connectDialog}
    </div>
  )
}

export default Layout
