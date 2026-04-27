import { useEffect, useState } from 'react'
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useStore } from './store/useStore'
import { ToastProvider } from './components/Toast'
import { ConfirmProvider } from './components/ConfirmDialog'
import Layout from './components/Layout'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Parties from './pages/Parties'
import Items from './pages/Items'
import Sales from './pages/Sales'
import Quotations from './pages/Quotations'
import ProformaInvoices from './pages/ProformaInvoices'
import Purchase from './pages/Purchase'
import Payments from './pages/Payments'
import Reports from './pages/Reports'
import GSTReports from './pages/GSTReports'
import DeliveryChallan from './pages/DeliveryChallan'
import CreditNotes from './pages/CreditNotes'
import CashBank from './pages/CashBank'
import Settings from './pages/Settings'

function App() {
  const { authStatus, setAuthStatus, company, setCompany, setSyncStatus } = useStore()
  const [initializing, setInitializing] = useState(true)

  useEffect(() => {
    const checkAuth = async () => {
      try {
        if (!window.electronAPI) {
          setAuthStatus({ isAuthenticated: false, user: null });
          return
        }
        const status = await window.electronAPI.auth.getAuthStatus()
        setAuthStatus(status)

        if (status.isAuthenticated) {
          // Sync first — if cloud has newer data, download it before checking company
          // This way we don't show onboarding when cloud already has the user's data
          try {
            await window.electronAPI.sync.syncNow()
          } catch (syncError) {
            // Sync failed (maybe offline) — no problem, continue with local data
            console.log('Sync failed, continuing with local data:', syncError)
          }

          const companyResult = await window.electronAPI.company.get()
          if (companyResult.success && companyResult.data) {
            setCompany(companyResult.data)
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
        <div className="flex flex-col items-center justify-center h-screen bg-gray-50 dark:bg-gray-900 gap-5">
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-primary-500/20 blur-xl animate-pulse" />
            <Loader2 className="relative w-16 h-16 text-primary-600 dark:text-primary-400 animate-spin" strokeWidth={2} />
          </div>
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400 tracking-wide animate-pulse">
            Please wait…
          </p>
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

  // If authenticated but no company exists, redirect to onboarding
  if (!company) {
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
            <Route path="parties" element={<Parties />} />
            <Route path="items" element={<Items />} />
            <Route path="sales" element={<Navigate to="/invoices" replace />} />
            <Route path="invoices" element={<Sales />} />
            <Route path="quotations" element={<Quotations />} />
            <Route path="proforma-invoices" element={<ProformaInvoices />} />
            <Route path="purchase" element={<Purchase />} />
            <Route path="payments" element={<Payments />} />
            <Route path="delivery-challan" element={<DeliveryChallan />} />
            <Route path="credit-notes" element={<CreditNotes />} />
            <Route path="cash-bank" element={<CashBank />} />
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
