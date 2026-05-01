import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
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
  Monitor,
  RefreshCw,
} from 'lucide-react'
import { useStore } from '../store/useStore'

const destinations = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard, group: 'Navigate' },
  { name: 'Parties', path: '/parties', icon: Users, group: 'Navigate' },
  { name: 'Items', path: '/items', icon: Package, group: 'Navigate' },
  { name: 'Invoices', path: '/invoices', icon: Wallet, group: 'Navigate' },
  { name: 'Quotations', path: '/quotations', icon: FileText, group: 'Navigate' },
  { name: 'Proforma Invoices', path: '/proforma-invoices', icon: FileText, group: 'Navigate' },
  { name: 'Purchase', path: '/purchase', icon: ShoppingCart, group: 'Navigate' },
  { name: 'Delivery Challans', path: '/delivery-challan', icon: Truck, group: 'Navigate' },
  { name: 'Credit/Debit Notes', path: '/credit-notes', icon: FileText, group: 'Navigate' },
  { name: 'Payments', path: '/payments', icon: CreditCard, group: 'Navigate' },
  { name: 'Cash & Bank', path: '/cash-bank', icon: Landmark, group: 'Navigate' },
  { name: 'Reports', path: '/reports', icon: BarChart3, group: 'Navigate' },
  { name: 'GST Reports', path: '/gst-reports', icon: Receipt, group: 'Navigate' },
  { name: 'Settings', path: '/settings', icon: SettingsIcon, group: 'Navigate' },
]

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const navigate = useNavigate()
  const { themePreference, setThemePreference } = useStore()

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onOpenChange])

  const runAndClose = (fn: () => void) => {
    fn()
    onOpenChange(false)
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command className="flex flex-col">
          <Command.Input
            autoFocus
            placeholder="Jump to page or run an action…"
            className="w-full px-4 py-3 text-sm bg-transparent border-b border-gray-200 dark:border-gray-700 focus:outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400"
          />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-3 py-6 text-sm text-center text-gray-500 dark:text-gray-400">
              No results found.
            </Command.Empty>

            <Command.Group heading="Navigate" className="text-xs font-medium text-gray-500 dark:text-gray-400 px-2 py-1">
              {destinations.map((d) => {
                const Icon = d.icon
                return (
                  <Command.Item
                    key={d.path}
                    value={`navigate ${d.name}`}
                    onSelect={() => runAndClose(() => navigate(d.path))}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-200 cursor-pointer data-[selected=true]:bg-primary-50 data-[selected=true]:text-primary-700 dark:data-[selected=true]:bg-primary-900/30 dark:data-[selected=true]:text-primary-300"
                  >
                    <Icon className="w-4 h-4" />
                    <span>{d.name}</span>
                  </Command.Item>
                )
              })}
            </Command.Group>

            <Command.Group heading="Actions" className="text-xs font-medium text-gray-500 dark:text-gray-400 px-2 py-1 mt-2">
              <Command.Item
                value="theme light mode"
                onSelect={() => runAndClose(() => setThemePreference('light'))}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-200 cursor-pointer data-[selected=true]:bg-primary-50 data-[selected=true]:text-primary-700 dark:data-[selected=true]:bg-primary-900/30 dark:data-[selected=true]:text-primary-300"
              >
                <Sun className="w-4 h-4" />
                <span>Theme: Light{themePreference === 'light' ? ' (current)' : ''}</span>
              </Command.Item>
              <Command.Item
                value="theme dark mode"
                onSelect={() => runAndClose(() => setThemePreference('dark'))}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-200 cursor-pointer data-[selected=true]:bg-primary-50 data-[selected=true]:text-primary-700 dark:data-[selected=true]:bg-primary-900/30 dark:data-[selected=true]:text-primary-300"
              >
                <Moon className="w-4 h-4" />
                <span>Theme: Dark{themePreference === 'dark' ? ' (current)' : ''}</span>
              </Command.Item>
              <Command.Item
                value="theme system mode auto"
                onSelect={() => runAndClose(() => setThemePreference('system'))}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-200 cursor-pointer data-[selected=true]:bg-primary-50 data-[selected=true]:text-primary-700 dark:data-[selected=true]:bg-primary-900/30 dark:data-[selected=true]:text-primary-300"
              >
                <Monitor className="w-4 h-4" />
                <span>Theme: System{themePreference === 'system' ? ' (current)' : ''}</span>
              </Command.Item>
              <Command.Item
                value="sync now drive"
                onSelect={() => runAndClose(() => window.electronAPI.sync.syncNow())}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-700 dark:text-gray-200 cursor-pointer data-[selected=true]:bg-primary-50 data-[selected=true]:text-primary-700 dark:data-[selected=true]:bg-primary-900/30 dark:data-[selected=true]:text-primary-300"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Sync now</span>
              </Command.Item>
            </Command.Group>
          </Command.List>
          <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>↑↓ to navigate</span>
            <span>↵ to select · Esc to close</span>
          </div>
        </Command>
      </div>
    </div>
  )
}
