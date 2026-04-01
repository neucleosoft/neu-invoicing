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
- Real-time business metrics (receivables, payables, sales)
- Sales trend visualization
- Low stock alerts
- Recent invoice overview
- Quick action buttons

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
- Professional invoice creation
- Quotation generation with one-click conversion
- Automatic invoice numbering
- Partial payment tracking
- Multiple tax rates support

#### 🛒 Purchase Module
- Purchase bill management
- Automatic stock updates
- Supplier payment tracking

#### 💳 Payment Tracking
- Payment In (from customers)
- Payment Out (to suppliers)
- Multiple payment modes (Cash, Bank, Card, UPI, Cheque)
- Automatic balance reconciliation

#### 📈 Reports
- Sales Report (filterable by date, party, status)
- Stock Summary with valuation
- Outstanding Receivables
- Outstanding Payables
- Tax Report (collected vs paid)

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

   h. Update credentials in `electron/main/auth.ts`:
      ```typescript
      const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID'
      const GOOGLE_CLIENT_SECRET = 'YOUR_GOOGLE_CLIENT_SECRET'
      ```

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
│   │   ├── index.ts           # Main Electron process
│   │   ├── database.ts        # Prisma SQLite setup
│   │   ├── auth.ts            # Google OAuth handler
│   │   ├── sync.ts            # Google Drive sync
│   │   └── handlers/          # IPC handlers for all modules
│   │       ├── company.ts
│   │       ├── party.ts
│   │       ├── item.ts
│   │       ├── sales.ts
│   │       ├── purchase.ts
│   │       ├── payment.ts
│   │       ├── dashboard.ts
│   │       └── report.ts
│   └── preload/
│       └── index.ts           # Preload script (context bridge)
├── src/
│   ├── pages/                 # React pages
│   │   ├── Login.tsx
│   │   ├── Onboarding.tsx
│   │   ├── Dashboard.tsx
│   │   ├── Parties.tsx
│   │   ├── Items.tsx
│   │   ├── Sales.tsx
│   │   ├── Purchase.tsx
│   │   ├── Payments.tsx
│   │   ├── Reports.tsx
│   │   └── Settings.tsx
│   ├── components/
│   │   └── Layout.tsx         # Main app layout with sidebar
│   ├── store/
│   │   └── useStore.ts        # Zustand state management
│   ├── types/
│   │   └── index.ts           # TypeScript definitions
│   ├── App.tsx                # Main React component
│   ├── main.tsx               # React entry point
│   └── index.css              # Global styles (Tailwind)
├── prisma/
│   └── schema.prisma          # Database schema
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

- **Framework**: Electron.js
- **Frontend**: React 18 + TypeScript
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Database**: SQLite + Prisma ORM
- **Charts**: Recharts
- **Build Tool**: Vite
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

### v1.1 (Planned)
- [ ] PDF Invoice generation with templates
- [ ] Email invoices directly
- [ ] Recurring invoices
- [ ] Multi-currency support
- [ ] Advanced tax configurations (GST, VAT)

### v2.0 (Future)
- [ ] Mobile app (React Native)
- [ ] Multi-company support
- [ ] User roles and permissions
- [ ] Advanced reporting with charts
- [ ] Integration with accounting software

## 📧 Support

For issues or questions:
- Check this README
- Review Google OAuth setup
- Check Prisma database configuration

---

**Built with ❤️ for small businesses who value data ownership**

Remember: Your data, your control, your business.
