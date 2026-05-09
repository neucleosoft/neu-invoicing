<div align="center">

<img src="docs/screenshots/logo.png" alt="Neu Invoicing" width="120" />

# Neu Invoicing

**Offline-first GST invoicing that lives on your laptop — not someone else's server.**

Run your shop, your studio, your side hustle without paying a SaaS tax every month. Your data stays in a SQLite file you can copy, your backups go to *your* Google Drive, and the app works on the train.

[![Download for Windows](https://img.shields.io/badge/Download-Windows-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/neucleosoft/neu-invoicing/releases/latest)
[![Download for macOS](https://img.shields.io/badge/Download-macOS-000000?style=for-the-badge&logo=apple&logoColor=white)](https://github.com/neucleosoft/neu-invoicing/releases/latest)
[![Download for Linux](https://img.shields.io/badge/Download-Linux-FCC624?style=for-the-badge&logo=linux&logoColor=black)](https://github.com/neucleosoft/neu-invoicing/releases/latest)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/neucleosoft/neu-invoicing?style=flat-square)](https://github.com/neucleosoft/neu-invoicing/releases/latest)
[![GitHub stars](https://img.shields.io/github/stars/neucleosoft/neu-invoicing?style=flat-square)](https://github.com/neucleosoft/neu-invoicing/stargazers)

<img src="docs/screenshots/hero.png" alt="Neu Invoicing dashboard" width="900" />

</div>

---

## Why Neu Invoicing?

| 🛜 Works offline | 🔒 Your data, your drive | 🇮🇳 GST done right |
| --- | --- | --- |
| Cut power, kill Wi-Fi, board a flight — every screen still loads. | Your SQLite file syncs only to your own Google Drive `appDataFolder`. We don't have a server. | GSTR-1, GSTR-3B, HSN-wise summaries, GSTIN auto-validation, intra/inter-state CGST/SGST/IGST split — all out of the box. |

<br>

## ⚡ Quick Start (Non-Technical)

Three steps. No terminal, no Node, no Prisma.

<table>
<tr>
<td width="33%" align="center">

### 1. Download
[Grab the latest installer →](https://github.com/neucleosoft/neu-invoicing/releases/latest)

Pick **Windows**, **macOS**, or **Linux**.

</td>
<td width="33%" align="center">

### 2. Install
Double-click the installer.<br>
Approve the "untrusted publisher" prompt — we don't have a code-signing cert yet, the file is still safe.

</td>
<td width="33%" align="center">

### 3. Sign in
Click **Sign in with Google** the first time so your data can back up to your Drive.<br>
Done. Start invoicing.

</td>
</tr>
</table>

<br>

## ✨ What's inside

<details open>
<summary><b>📊 Dashboard</b> — receivables, payables, sales trend, low stock at a glance</summary>

<img src="docs/screenshots/dashboard.png" alt="Dashboard" width="800" />

Real-time tiles for receivables, payables, YTD sales, overdue invoices, and cash position. A sales trend chart that defaults to *all-time* with monthly bucketing once you cross a few months. Quick-action tiles drop you straight into "+ New Invoice", "+ Add Customer", etc. — no wasted clicks.

</details>

<details>
<summary><b>💰 Sales, Quotations &amp; Proforma</b> — pretty PDFs, multiple templates, GST-ready</summary>

<img src="docs/screenshots/sales.png" alt="Sales" width="800" />

Pick from clean modern templates or the Classic GST template. Quotations and proforma invoices convert to a real invoice in one click. Editable invoice numbers with duplicate-detection, partial payments, and multi-rate tax handling.

</details>

<details>
<summary><b>🛒 Purchase + Purchase Orders</b> — extract bills from a photo, convert PO → bill</summary>

<img src="docs/screenshots/purchase.png" alt="Purchase" width="800" />

Upload a supplier's bill (image or PDF) and let the AI extract supplier, line items, HSN codes, and CGST/SGST/IGST split. Send a Purchase Order to a supplier as a styled PDF; convert it to a Purchase Bill the moment goods arrive.

</details>

<details>
<summary><b>🚚 Delivery Challans &amp; 📝 Credit/Debit Notes</b></summary>

<img src="docs/screenshots/challan.png" alt="Challans" width="800" />

Auto-numbered challans against parties with transport mode and vehicle number. Credit/debit notes link to invoices/bills and adjust the ledger automatically.

</details>

<details>
<summary><b>📈 Reports &amp; 🧾 GST</b> — GSTR-1, GSTR-3B, HSN summary, Excel export</summary>

<img src="docs/screenshots/gst.png" alt="GST reports" width="800" />

Sales report, stock summary with valuation, outstanding receivables/payables, tax report, GSTR-1, GSTR-3B, and HSN-wise breakdowns. Every report exports to Excel with one click.

</details>

<details>
<summary><b>📥 Multi-format Download</b> — PDF, PNG, JPEG, Excel, CSV, Print — with live preview</summary>

<img src="docs/screenshots/download-menu.png" alt="Download menu" width="800" />

Every document has a **Download** icon that drops a fold-down menu of formats. Pick one and a preview opens — confirm to save. The Excel export is a single flat sheet you can pivot, sort, or paste into Tally.

</details>

<details>
<summary><b>👥 Parties, 📦 Items, 💳 Payments, 🏦 Cash &amp; Bank</b></summary>

Customer + supplier ledgers, statement view, item catalog with stock tracking and low-stock alerts, payment in/out across cash/bank/card/UPI/cheque, multi-account cash & bank with transfers and per-account statements.

</details>

<br>

## 📸 Screenshots

<table>
<tr>
<td><img src="docs/screenshots/dashboard-light.png" alt="Dashboard light" /></td>
<td><img src="docs/screenshots/dashboard-dark.png" alt="Dashboard dark" /></td>
</tr>
<tr>
<td align="center"><sub>Dashboard — light</sub></td>
<td align="center"><sub>Dashboard — dark</sub></td>
</tr>
<tr>
<td><img src="docs/screenshots/invoice-create.png" alt="Create invoice" /></td>
<td><img src="docs/screenshots/invoice-pdf.png" alt="Invoice PDF" /></td>
</tr>
<tr>
<td align="center"><sub>Create an invoice</sub></td>
<td align="center"><sub>Generated PDF</sub></td>
</tr>
</table>

<br>

## 🔒 Where does my data go?

Short answer: **into a SQLite file on your computer**, and into **your own Google Drive** (in a hidden app folder only this app can see). That's it.

- **Local:** `userData/neuinvoicing.db` — copy it, back it up, version it.
- **Cloud:** Google Drive `appDataFolder` scope. We literally cannot read it.
- **Sync model:** Last-write-wins. Open on one device at a time.
- **Auth:** Google OAuth 2.0, refresh token persisted via `electron-store`.
- **No third-party servers.** No analytics. No phone-home.

<details>
<summary><b>Where is the local database file?</b></summary>

| OS | Path |
| --- | --- |
| Windows | `C:\Users\<you>\AppData\Roaming\neu-invoicing\neuinvoicing.db` |
| macOS | `~/Library/Application Support/neu-invoicing/neuinvoicing.db` |
| Linux | `~/.config/neu-invoicing/neuinvoicing.db` |

</details>

<br>

## 🛠️ For developers

<details>
<summary><b>Run from source</b></summary>

```bash
git clone https://github.com/neucleosoft/neu-invoicing.git
cd neu-invoicing
npm install
cp .env.example .env       # fill in GOOGLE_CLIENT_ID / SECRET (see below)
npm run prisma:generate
npm run electron:dev
```

</details>

<details>
<summary><b>Set up Google OAuth (one-time)</b></summary>

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project.
2. Enable **Google Drive API**.
3. **Credentials → Create Credentials → OAuth 2.0 Client ID** → application type **Desktop app**.
4. Copy the Client ID + Client Secret into `.env`:
   ```env
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_CLIENT_SECRET=your-client-secret
   REDIRECT_URI=http://localhost
   ```
5. Vite reads `.env` at build time and bakes the values into the main-process bundle — re-run `electron:dev` after editing `.env`.

</details>

<details>
<summary><b>Build platform installers</b></summary>

```bash
npm run build:win      # Windows NSIS .exe
npm run build:mac      # macOS .dmg
npm run build:linux    # Linux AppImage
```

Output lands in `release/`.

</details>

<details>
<summary><b>Tech stack</b></summary>

- **Shell:** Electron 41 (main + preload + renderer split)
- **UI:** React 18 + TypeScript + Tailwind CSS + Zustand
- **DB:** SQLite via Prisma ORM, file in `userData/`
- **PDF:** pdfmake (Classic GST template) + jsPDF (alt templates)
- **Excel:** ExcelJS
- **AI extraction:** Gemini / OpenRouter for OCR (`OCR_PROVIDER` env var)
- **Build:** Vite + `vite-plugin-electron`, packaged with `electron-builder`
- **Sync:** `googleapis` Drive `appDataFolder` scope

</details>

<details>
<summary><b>Repo layout</b></summary>

```
neu_invoicing/
├── electron/
│   ├── main/                 # Node-side: DB, OAuth, sync, IPC handlers
│   │   ├── index.ts          # Registers all handler modules
│   │   ├── database.ts       # Prisma + SQLite bootstrap
│   │   ├── auth.ts           # Google OAuth 2.0
│   │   ├── sync.ts           # Drive appDataFolder upload/download
│   │   └── handlers/         # One file per domain (sales, purchase, …)
│   └── preload/index.ts      # contextBridge → window.electronAPI
├── src/
│   ├── pages/                # One page per module
│   ├── components/           # Layout, DownloadMenu, ShareMenu, …
│   ├── store/useStore.ts     # Zustand
│   ├── utils/                # PDF generators, formatters, validators
│   └── types/index.ts
├── prisma/schema.prisma
└── docs/screenshots/         # Media for this README
```

</details>

<br>

## 🐛 Troubleshooting

<details>
<summary><b>Sync says "error" / I just signed in fresh</b></summary>

Settings → sign out → sign back in. The OAuth refresh token is regenerated and the app reconnects on the next sync tick. If it still fails, check that the OAuth consent screen for your project includes your email under "Test users" while in unverified mode.

</details>

<details>
<summary><b>"My data isn't there on the new device"</b></summary>

Sync downloads on app start *only if cloud is newer than local*. If you signed in fresh on the new device, the local DB starts empty so cloud should overwrite it on the next sync — manually click the Sync icon in the sidebar. If your old device hasn't pushed up its latest changes, open it once first so it syncs on exit.

</details>

<details>
<summary><b>"AI extract from photo" fails</b></summary>

That feature needs `GEMINI_API_KEY` (or an OpenRouter key) in `.env`, and a *built* main bundle that includes it. After editing `.env`, re-run `npm run electron:dev` or rebuild — `.env` is baked at compile time, not read at runtime.

</details>

<br>

## 🗺️ Roadmap

**Shipped** — Multi-format Download menu (PDF/PNG/JPEG/Excel/CSV/Print) · Bulk Excel export · Purchase Orders + convert-to-Bill · AI bill extraction · Classic GST template · GSTR-1/3B/HSN summary · Dark mode · Quick Actions

**Next** — Email invoices in-app · Recurring invoices · Multi-currency

**Later** — Mobile companion · Multi-company · Roles + permissions · Integrations (Tally, Zoho)

<br>

## 🤝 Contributing

Bug reports, feature ideas, and PRs are welcome — open an [issue](https://github.com/neucleosoft/neu-invoicing/issues) and let's chat first if it's a big change.

## 📄 License

[MIT](LICENSE) — use it for your business, fork it, ship it.

---

<div align="center">

**Built for small businesses who want to own their numbers.**<br>
<sub>Your data, your control, your business.</sub>

</div>
