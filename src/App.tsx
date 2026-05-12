import { useEffect, useState } from 'react'
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { useStore } from './store/useStore'
import { ToastProvider } from './components/Toast'
import { ConfirmProvider } from './components/ConfirmDialog'
import Layout from './components/Layout'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Customers from './pages/Customers'
import Suppliers from './pages/Suppliers'
import Items from './pages/Items'
import SupplierItems from './pages/SupplierItems'
import Sales from './pages/Sales'
import PreviousInvoices from './pages/PreviousInvoices'
import Quotations from './pages/Quotations'
import ProformaInvoices from './pages/ProformaInvoices'
import Purchase from './pages/Purchase'
import PurchaseOrders from './pages/PurchaseOrders'
import Payments from './pages/Payments'
import Reports from './pages/Reports'
import GSTReports from './pages/GSTReports'
import DeliveryChallan from './pages/DeliveryChallan'
import CreditNotes from './pages/CreditNotes'
import CashBank from './pages/CashBank'
import CustomerStatement from './pages/CustomerStatement'
import Settings from './pages/Settings'
import RestoreBackupDialog from './components/RestoreBackupDialog'

type BootStage = 'connecting' | 'syncing' | 'workspace'

const STAGE_LABEL: Record<BootStage, string> = {
  connecting: 'Connecting',
  syncing: 'Syncing your data',
  workspace: 'Loading workspace',
}

function App() {
  const { authStatus, setAuthStatus, company, setCompany, setSyncStatus } = useStore()
  const [initializing, setInitializing] = useState(true)
  const [bootStage, setBootStage] = useState<BootStage>('connecting')
  const [backupInfo, setBackupInfo] = useState<{ modifiedTime?: string; size?: number } | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)

  useEffect(() => {
    const checkAuth = async () => {
      try {
        if (!window.electronAPI) {
          setAuthStatus({ isAuthenticated: false, user: null })
          return
        }
        const status = await window.electronAPI.auth.getAuthStatus()
        setAuthStatus(status)

        if (status.isAuthenticated) {
          setBootStage('workspace')
          const companyResult = await window.electronAPI.company.get()
          if (companyResult.success && companyResult.data) {
            // Returning user with local data — no auto-sync, no cloud check.
            // The Back Up Now button in Settings is the only path that touches Drive.
            setCompany(companyResult.data)
          } else {
            // No local company yet. Before falling into onboarding, see if a
            // cloud backup exists for this Google account and offer to restore.
            try {
              const backup = await window.electronAPI.sync.checkCloudBackup()
              if (backup.exists) {
                setBackupInfo({ modifiedTime: backup.modifiedTime, size: backup.size })
              }
            } catch (e) {
              console.log('checkCloudBackup failed, proceeding to onboarding:', e)
            }
          }

          const syncStatus = await window.electronAPI.sync.getSyncStatus()
          setSyncStatus(syncStatus)

          window.electronAPI.sync.onSyncStatusChange((s) => {
            setSyncStatus(s)
          })
        }
      } catch (error) {
        console.error('Error checking auth:', error)
      } finally {
        setInitializing(false)
      }
    }

    checkAuth()
  }, [setAuthStatus, setCompany, setSyncStatus])

  const handleRestore = async () => {
    setIsRestoring(true)
    try {
      const result = await window.electronAPI.sync.download()
      if (!result.success) {
        console.error('Restore failed:', result.error)
        return
      }
      const companyResult = await window.electronAPI.company.get()
      if (companyResult.success && companyResult.data) {
        setCompany(companyResult.data)
      }
      setBackupInfo(null)
    } catch (error) {
      console.error('Restore failed:', error)
    } finally {
      setIsRestoring(false)
    }
  }

  // Simple test - return basic HTML first
  if (!window.electronAPI) {
    return (
      <div style={{ padding: '50px', fontFamily: 'Arial', textAlign: 'center' }}>
        <h1 style={{ color: 'red' }}>electronAPI Not Available</h1>
        <p>The app is rendering but electronAPI is not loaded.</p>
        <p>This indicates a preload script issue.</p>
      </div>
    );
  }

  if (initializing || authStatus === null) {
    return (
      <ToastProvider><ConfirmProvider>
        <div
          className="flex flex-col items-center justify-center h-screen gap-6"
          style={{
            background:
              'radial-gradient(ellipse at top, rgba(14,165,233,0.10) 0%, transparent 55%)',
          }}
        >
          <div className="relative w-[88px] h-[88px]">
            <div
              className="absolute inset-0 rounded-full border-[3px] border-sky-500/20 border-t-sky-500 animate-spin"
              aria-hidden
            />
            <div
              className="absolute top-1/2 left-1/2 w-[60px] h-[60px] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white dark:bg-slate-800 shadow-[0_8px_20px_-6px_rgba(14,116,144,0.28)] dark:shadow-[0_8px_22px_-6px_rgba(0,0,0,0.55)] flex items-center justify-center p-2 box-border"
            >
              <img
                src="./COMPANY%20LOGO.png"
                alt=""
                className="w-full h-full object-contain pointer-events-none select-none"
              />
            </div>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold tracking-tight text-slate-800 dark:text-sky-50">
              neu<span className="text-sky-500">Invoicing</span>
            </p>
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
              {STAGE_LABEL[bootStage]}
            </p>
          </div>
        </div>
      </ConfirmProvider></ToastProvider>
    )
  }

  if (!authStatus.isAuthenticated) {
    return (
      <ToastProvider><ConfirmProvider>
        <Router>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </Router>
      </ConfirmProvider></ToastProvider>
    )
  }

  // If authenticated but no company exists:
  //  - if a cloud backup was found for this account, prompt to restore
  //  - otherwise fall through to onboarding
  if (!company) {
    if (backupInfo) {
      return (
        <ToastProvider><ConfirmProvider>
          <RestoreBackupDialog
            open
            modifiedTime={backupInfo.modifiedTime}
            size={backupInfo.size}
            isRestoring={isRestoring}
            onRestore={handleRestore}
          />
        </ConfirmProvider></ToastProvider>
      )
    }
    return (
      <ToastProvider><ConfirmProvider>
        <Router>
          <Routes>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="*" element={<Navigate to="/onboarding" replace />} />
          </Routes>
        </Router>
      </ConfirmProvider></ToastProvider>
    )
  }

  return (
    <ToastProvider><ConfirmProvider>
      <Router>
        <Routes>
          <Route path="/onboarding" element={<Navigate to="/" replace />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="parties" element={<Navigate to="/customers" replace />} />
            <Route path="customers" element={<Customers />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="items" element={<Items />} />
            <Route path="supplier-items" element={<SupplierItems />} />
            <Route path="sales" element={<Navigate to="/invoices" replace />} />
            <Route path="invoices" element={<Sales />} />
            <Route path="previous-invoices" element={<PreviousInvoices />} />
            <Route path="quotations" element={<Quotations />} />
            <Route path="proforma-invoices" element={<ProformaInvoices />} />
            <Route path="purchase" element={<Purchase />} />
            <Route path="purchase-orders" element={<PurchaseOrders />} />
            <Route path="payments" element={<Payments />} />
            <Route path="delivery-challan" element={<DeliveryChallan />} />
            <Route path="credit-notes" element={<CreditNotes />} />
            <Route path="cash-bank" element={<CashBank />} />
            <Route path="statement" element={<CustomerStatement />} />
            <Route path="reports" element={<Reports />} />
            <Route path="gst-reports" element={<GSTReports />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </Router>
    </ConfirmProvider></ToastProvider>
  )
}

export default App
