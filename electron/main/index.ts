import path from 'path'
import fs from 'fs'

import { app, BrowserWindow, protocol } from 'electron'
import { setupDatabase } from './database'
import { setupAuthHandlers } from './auth'
import { setupSyncHandlers } from './sync'
import { setupPartyHandlers } from './handlers/party'
import { setupItemHandlers } from './handlers/item'
import { setupSalesHandlers } from './handlers/sales'
import { setupQuotationHandlers } from './handlers/quotation'
import { setupProformaInvoiceHandlers } from './handlers/proformaInvoice'
import { setupPurchaseHandlers } from './handlers/purchase'
import { setupPaymentHandlers } from './handlers/payment'
import { setupDashboardHandlers } from './handlers/dashboard'
import { setupReportHandlers } from './handlers/report'
import { setupGSTReportHandlers } from './handlers/gstReport'
import { setupCompanyHandlers } from './handlers/company'
import { setupSettingsHandlers } from './handlers/settings'
import { setupGstHandlers } from './handlers/gst'
import { setupChallanHandlers } from './handlers/challan'
import { setupCreditNoteHandlers } from './handlers/creditNote'
import { setupCashBankHandlers } from './handlers/cashBank'
import { setupShareHandlers } from './handlers/share'

protocol.registerSchemesAsPrivileged([
  { scheme: 'local-resource', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true } }
])

let mainWindow: BrowserWindow | null = null

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    title: 'neuInvoicing',
    autoHideMenuBar: true
  })

  // Load the app
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  // Enhanced error logging
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (level === 3) { // Error level
      console.error('❌ Renderer ERROR:', message, 'at', sourceId, 'line', line)
    } else if (level === 2) { // Warning level
      console.warn('⚠️  Renderer WARNING:', message)
    } else {
      console.log('📝 Renderer:', message)
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('✅ Page loaded successfully')
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('❌ Page failed to load:', errorCode, errorDescription)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  // Initialize database
  await setupDatabase()

  // Serve local files via custom protocol (renderer can't access file:// directly)
  // Chrome parses "local-resource://C:/path" as host="c", pathname="/path"
  // So we reconstruct the Windows path from those pieces
  protocol.handle('local-resource', (request) => {
    const url = new URL(request.url)
    const filePath = url.host
      ? `${url.host.toUpperCase()}:${decodeURIComponent(url.pathname)}`
      : decodeURIComponent(url.pathname)

    try {
      const data = fs.readFileSync(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg'
      return new Response(data, { headers: { 'Content-Type': mimeType } })
    } catch {
      // File missing or unreadable — return 404 silently (renderer will fall back)
      return new Response('Not found', { status: 404 })
    }
  })

  // Setup IPC handlers
  setupAuthHandlers()
  setupSyncHandlers()
  setupCompanyHandlers()
  setupPartyHandlers()
  setupItemHandlers()
  setupSalesHandlers()
  setupQuotationHandlers()
  setupProformaInvoiceHandlers()
  setupPurchaseHandlers()
  setupPaymentHandlers()
  setupDashboardHandlers()
  setupReportHandlers()
  setupGSTReportHandlers()
  setupSettingsHandlers()
  setupGstHandlers()
  setupChallanHandlers()
  setupCreditNoteHandlers()
  setupCashBankHandlers()
  setupShareHandlers()

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Handle app quit
app.on('before-quit', async () => {
  // Trigger final sync before quitting
  if (mainWindow) {
    mainWindow.webContents.send('app-quitting')
  }
})
