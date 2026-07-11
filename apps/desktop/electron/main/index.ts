import { app as _app } from 'electron'
_app.setName('neu-invoicing')
import 'dotenv/config'

import path from 'path'
import fs from 'fs'

import { app, BrowserWindow, protocol } from 'electron'
import { setupDatabase } from './database'
import { setupAuthHandlers } from './auth'
import { setupSyncHandlers, startBackupScheduler } from './sync'
import { setupRowSyncHandlers } from './rowSync'
import { setupCustomerHandlers } from './handlers/customer'
import { setupSupplierHandlers, migrateLegacySuppliersFromParty } from './handlers/supplier'
import { setupSupplierItemHandlers } from './handlers/supplierItem'
import { setupItemHandlers, backfillOpeningStock } from './handlers/item'
import { setupSalesHandlers } from './handlers/sales'
import { setupQuotationHandlers } from './handlers/quotation'
import { setupProformaInvoiceHandlers } from './handlers/proformaInvoice'
import { setupPurchaseHandlers } from './handlers/purchase'
import { setupPurchaseOrderHandlers } from './handlers/purchaseOrder'
import { setupPaymentHandlers, backfillInlinePayments, backfillInlinePurchasePayments, backfillPaymentUpdatedAt } from './handlers/payment'
import { setupDashboardHandlers } from './handlers/dashboard'
import { setupReportHandlers } from './handlers/report'
import { setupGSTReportHandlers } from './handlers/gstReport'
import { setupCompanyHandlers, backfillInlineImages } from './handlers/company'
import { setupSettingsHandlers } from './handlers/settings'
import { setupGstHandlers } from './handlers/gst'
import { setupChallanHandlers } from './handlers/challan'
import { setupCreditNoteHandlers } from './handlers/creditNote'
import { setupPreviousInvoiceHandlers } from './handlers/previousInvoice'
import { setupCashBankHandlers } from './handlers/cashBank'
import { setupShareHandlers } from './handlers/share'

protocol.registerSchemesAsPrivileged([
  { scheme: 'local-resource', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
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
    title: 'Neu Invoicing',
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
  setupCustomerHandlers()
  setupSupplierHandlers()
  setupSupplierItemHandlers()
  setupItemHandlers()
  setupSalesHandlers()
  setupQuotationHandlers()
  setupProformaInvoiceHandlers()
  setupPurchaseHandlers()
  setupPurchaseOrderHandlers()
  setupPaymentHandlers()
  setupDashboardHandlers()
  setupReportHandlers()
  setupGSTReportHandlers()
  setupSettingsHandlers()
  setupGstHandlers()
  setupChallanHandlers()
  setupCreditNoteHandlers()
  setupPreviousInvoiceHandlers()
  setupCashBankHandlers()
  setupShareHandlers()
  setupRowSyncHandlers()

  // One-shot data fix: pre-split databases held suppliers in the Customer/Party
  // table with type='SUPPLIER'. Move them into the dedicated Supplier table.
  // Idempotent — no-op once everything's been migrated.
  migrateLegacySuppliersFromParty()

  // One-shot data fix: align item.openingStock so stock rebuilds from rows. Idempotent —
  // no-op once aligned. Runs automatically on every device, so no per-customer manual step.
  backfillOpeningStock()

  // One-shot data fix: record old inline payments (amountPaid with no payment row) as real
  // PAYMENT_IN rows, so the rebuild can see that money. Idempotent; additive (never edits a
  // balance). Leaves ambiguous "PAID with ₹0" invoices alone — those need a human.
  backfillInlinePayments()

  // Purchase twin of the above: bills saved with an up-front amountPaid but no
  // PAYMENT_OUT row behind it. Must exist before any recompute-apply, or the
  // rebuild erases those payments and inflates supplier balances.
  backfillInlinePurchasePayments()

  // One-shot data fix: fold filesystem logo/signature images into the DB as
  // base64 data URLs so backups (and future sync) actually carry them.
  backfillInlineImages()

  // Stamp legacy payment rows' updatedAt (covers the db-push baseline path,
  // which never runs the migration SQL's backfill UPDATE).
  backfillPaymentUpdatedAt()

  // Kick off scheduled-backup watchdog. Runs an immediate due-check, then
  // ticks every hour for as long as the app is open.
  startBackupScheduler()

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
