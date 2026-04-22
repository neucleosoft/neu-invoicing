# neuInvoicing

A powerful, offline-first desktop invoicing application with seamless Google Drive synchronization. Built for small businesses who value data ownership and privacy.

## 🌟 Key Features

### Core Philosophy
- **Offline-First**: 100% functional without internet connectivity
- **User-Owned Data**: Your database stored in YOUR Google Drive
- **Privacy-Focused**: No third-party servers, complete data portability
- **Cross-Platform**: Windows, macOS, and Linux support

### Modules

#### 📊 Dashboard
- Real-time metric cards: Total Receivables, Total Payables, Total Sales (YTD), Low Stock Alerts, Cash & Bank, Overdue Invoices
- Sales trend chart (last 6 months)
- Recent invoices panel
- Latest transactions feed (invoices + payments, sorted by date)
- Quick action buttons
- Light / dark mode toggle

#### 👥 Party Management
- Customer and Supplier management
- Complete contact details and addresses
- Party ledger with transaction history
- Running balance tracking

#### 📦 Item & Inventory Management
- Product and Service catalog
- Automatic stock tracking
- Low stock warnings
- Purchase and sale price management
- Tax rate configuration per item

#### 💰 Sales Module
- Professional invoice creation with PDF export (jsPDF + pdfmake, including a Classic GST template)
- Quotation generation with one-click conversion
- Editable invoice numbering with duplicate validation and zero-padding normalization
- Partial payment tracking
- Multiple tax rates support

#### 🛒 Purchase Module
- Purchase bill management
- Automatic stock updates
- Supplier payment tracking

#### 🚚 Delivery Challans
- Challan creation against parties
- Transport mode and vehicle number tracking
- PDF generation for dispatch
- Auto-numbering

#### 📝 Credit / Debit Notes
- Issue credit and debit notes linked to invoices or bills
- Automatic ledger adjustments
- Separate numbering series

#### 💳 Payment Tracking
- Payment In (from customers)
- Payment Out (to suppliers)
- Multiple payment modes (Cash, Bank, Card, UPI, Cheque)
- Automatic balance reconciliation

#### 🏦 Cash & Bank
- Manage cash and bank accounts
- Record deposits, withdrawals, and inter-account transfers
- Per-account statement view and combined balance on dashboard

#### 📈 Reports
- Sales Report (filterable by date, party, status)
- Stock Summary with valuation
- Outstanding Receivables
- Outstanding Payables
- Tax Report (collected vs paid)
- Excel export via ExcelJS

#### 🧾 GST Reports
- GSTR-1 (outward supplies) and GSTR-3B summary
- HSN-wise tax breakdown
- GSTIN validation with state code mapping
- Cached GST lookups via local `GstCache` table

#### ⚙️ Settings
- Company profile management
- Invoice customization
- Fiscal year configuration
- Terms & conditions
- Bank details for invoices

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm
- Google Cloud Console account (for OAuth setup)

### Installation

1. **Clone the repository**
   ```bash
   cd neu_invoicing
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Google OAuth Credentials**

   a. Go to [Google Cloud Console](https://console.cloud.google.com/)

   b. Create a new project or select existing one

   c. Enable Google Drive API and Google OAuth2 API

   d. Go to "Credentials" → "Create Credentials" → "OAuth 2.0 Client ID"

   e. Application type: "Desktop app"

   f. Download credentials and note your:
      - Client ID
      - Client Secret

   g. Add authorized redirect URI: `http://localhost:3000/oauth/callback`

   h. Copy `.env.example` to `.env` in the project root and fill in your credentials:
      ```env
      GOOGLE_CLIENT_ID=your-client-id
      GOOGLE_CLIENT_SECRET=your-client-secret
      REDIRECT_URI=http://localhost:3000/oauth/callback
      ```
      Vite reads `.env` at build time and injects the values into the main-process bundle via `define` — no hardcoding in `auth.ts` is needed.

4. **Initialize Prisma**
   ```bash
   npm run prisma:generate
   ```

5. **Run in development mode**
   ```bash
   npm run electron:dev
   ```

### Building for Production

Build for all platforms:
```bash
npm run build
```

Build for specific platform:
```bash
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

Executables will be in the `release` folder.

## 📁 Project Structure

```
neu-invoicing/
├── electron/
│   ├── main/
│   │   ├── index.ts           # Main Electron process, registers IPC handlers
│   │   ├── database.ts        # Prisma SQLite setup (userData/neuinvoicing.db)
│   │   ├── auth.ts            # Google OAuth handler
│   │   ├── sync.ts            # Google Drive appDataFolder sync
│   │   └── handlers/          # IPC handlers (one file per domain)
│   │       ├── company.ts
│   │       ├── settings.ts
│   │       ├── party.ts
│   │       ├── item.ts
│   │       ├── sales.ts
│   │       ├── purchase.ts
│   │       ├── challan.ts
│   │       ├── creditNote.ts
│   │       ├── payment.ts
│   │       ├── cashBank.ts
│   │       ├── dashboard.ts
│   │       ├── report.ts
│   │       ├── gstReport.ts
│   │       └── gst.ts
│   └── preload/
│       └── index.ts           # Preload script (contextBridge → window.electronAPI)
├── src/
│   ├── pages/                 # React pages (one per module)
│   │   ├── Login.tsx
│   │   ├── Onboarding.tsx
│   │   ├── Dashboard.tsx
│   │   ├── Parties.tsx
│   │   ├── Items.tsx
│   │   ├── Sales.tsx
│   │   ├── Purchase.tsx
│   │   ├── DeliveryChallan.tsx
│   │   ├── CreditNotes.tsx
│   │   ├── Payments.tsx
│   │   ├── CashBank.tsx
│   │   ├── Reports.tsx
│   │   ├── GSTReports.tsx
│   │   └── Settings.tsx
│   ├── components/
│   │   └── Layout.tsx         # App layout: sidebar + outlet
│   ├── store/
│   │   └── useStore.ts        # Zustand state (auth, company, sync, UI flags)
│   ├── utils/                 # Formatters, validators, PDF generators
│   │   ├── currency.ts
│   │   ├── gstValidation.ts
│   │   ├── generateInvoicePDF.ts
│   │   ├── generateChallanPDF.ts
│   │   ├── pdfmakeInvoice.ts
│   │   └── pdfHelpers.ts
│   ├── types/
│   │   └── index.ts           # Shared TypeScript interfaces
│   ├── App.tsx                # Routing + auth gate (HashRouter)
│   ├── main.tsx               # React entry
│   └── index.css              # Global styles + Tailwind
├── prisma/
│   └── schema.prisma          # Database schema
├── scripts/
│   └── import-invoices.js     # Bulk invoice import
├── .env.example               # OAuth credential template
├── package.json
├── vite.config.ts
└── README.md
```

## 🔒 Security & Privacy

### Data Storage
- Database: Local SQLite file stored in app data directory
- Sync: Encrypted upload to your personal Google Drive `appDataFolder`
- No Third-Party Servers: Your data never touches our servers

### Authentication
- OAuth 2.0: Secure Google Sign-In
- Token Storage: Encrypted using electron-store
- Scope: Minimal permissions (only appDataFolder access)

### Sync Mechanism
- **On App Start**: Check cloud for newer version, download if needed
- **On Changes**: Upload database after significant operations
- **On Exit**: Final sync before app closes
- **Conflict Resolution**: Last-write-wins model (single user assumed)

## 🛠️ Tech Stack

- **Framework**: Electron 32
- **Frontend**: React 18 + TypeScript
- **Routing**: React Router (HashRouter)
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Database**: SQLite + Prisma ORM
- **PDF Generation**: jsPDF + jspdf-autotable, pdfmake (Classic GST template)
- **Excel Export**: ExcelJS
- **Charts**: Recharts
- **Google Integration**: googleapis (Drive appDataFolder scope)
- **Build Tool**: Vite (+ vite-plugin-electron)
- **Bundler**: electron-builder

## 📱 Usage Guide

### First Time Setup
1. Launch neuInvoicing
2. Click "Sign in with Google"
3. Authorize app to access your Google Drive
4. Complete business onboarding wizard
5. Start creating invoices!

### Creating Your First Invoice
1. Add Customers: Go to **Parties** → Add Customer
2. Add Items: Go to **Items** → Add Product/Service
3. Create Invoice: Go to **Sales** → New Invoice
4. Select customer, add items, set quantities
5. Record payment if received
6. Save! (Auto-syncs to Google Drive)

### Recording Payments
1. Go to **Payments**
2. Click "Payment In" (from customer) or "Payment Out" (to supplier)
3. Select party and enter amount
4. Link to specific invoice/bill or mark as advance
5. Choose payment mode
6. Save!

### Generating Reports
1. Go to **Reports**
2. Select report type (Sales, Stock, Receivables, etc.)
3. Apply filters (date range, party, status)
4. Click "Generate Report"
5. Export or print

### Managing Stock
- Enable "Track Stock" when creating items
- Stock automatically updates on:
  - Sale invoices (decreases)
  - Purchase bills (increases)
- Low stock alerts appear on Dashboard

## 🔄 Sync Status

Watch the sync indicator in the sidebar:
- ✅ **Synced**: Data is backed up
- 🔄 **Syncing**: Upload/download in progress
- ❌ **Error**: Sync failed (check internet connection)

Manual sync: Click the sync button anytime.

## ⚠️ Important Notes

### Database Location
- **Windows**: `C:\Users\[Username]\AppData\Roaming\neu-invoicing\neuinvoicing.db`
- **macOS**: `~/Library/Application Support/neu-invoicing/neuinvoicing.db`
- **Linux**: `~/.config/neu-invoicing/neuinvoicing.db`

### Backup Strategy
- **Primary**: Auto-sync to Google Drive
- **Secondary**: Manual database file backup recommended
- **Export**: Use Reports to export data to CSV

### Multi-Device Usage
⚠️ **Current Limitation**: Last-write-wins sync model
- Close app on one device before opening on another
- Future: Conflict detection and resolution UI

## 🐛 Troubleshooting

### Sync Errors
1. Check internet connection
2. Re-authenticate (Settings → Sign Out → Sign In)
3. Check Google Drive permissions
4. Try "Force Sync" button

### Database Errors
1. Close all instances of the app
2. Restart the application
3. If persists, check database file permissions

### Login Issues
1. Clear browser cache for Google OAuth
2. Check OAuth credentials are correct
3. Verify redirect URI matches configuration

## 🤝 Contributing

This is a personal/business project, but suggestions are welcome!

## 📄 License

MIT License - Use freely for personal or commercial purposes

## 🎯 Roadmap

### Shipped
- [x] PDF invoice generation with templates (jsPDF + pdfmake, Classic GST)
- [x] GST compliance (GSTR-1, GSTR-3B, HSN summary, GSTIN validation)
- [x] Delivery challans with PDF
- [x] Credit / debit notes
- [x] Cash & bank account management
- [x] Dark mode
- [x] Editable invoice numbering with duplicate validation
- [x] Excel export for reports

### Planned
- [ ] Email invoices directly from the app
- [ ] Recurring invoices
- [ ] Multi-currency support
- [ ] VAT support (non-India markets)

### Future
- [ ] Mobile app (React Native)
- [ ] Multi-company support
- [ ] User roles and permissions
- [ ] Advanced reporting with richer charts
- [ ] Integration with accounting software

## 📧 Support

For issues or questions:
- Check this README
- Review Google OAuth setup
- Check Prisma database configuration

---

**Built with ❤️ for small businesses who value data ownership**

Remember: Your data, your control, your business.
