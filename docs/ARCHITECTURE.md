# Architecture

How Neu Invoicing is put together, and the rules that keep two offline devices
telling the same financial story. Written for someone joining the codebase —
each section says *what* exists, *where* it lives, and *why it's shaped that way*.

## The one-paragraph version

Neu Invoicing is a **monorepo with two apps and one brain**. The desktop app
(Electron + React + Prisma) and the mobile app (Expo + React Native + Drizzle)
each own their platform glue — screens, IPC, file access — but every rule that
touches money, tax, or merging lives once in `packages/shared` and is imported
by both. There is no server: each business syncs through its **own Google
Drive** `appDataFolder`, which acts as a mailbox between the user's devices.

```
neu_invoicing/
├── apps/
│   ├── desktop/               # Electron shell
│   │   ├── electron/main/     # Node side: Prisma DB, OAuth, sync, IPC handlers/
│   │   ├── src/               # React renderer (pages, components)
│   │   └── prisma/            # schema.prisma + migrations
│   └── mobile/                # Expo (React Native) app
│       ├── app/               # expo-router screens
│       ├── sync/              # row sync, backups, ladder, purge, auth glue
│       ├── utils/             # save-path logic, PDF payload builders, reports
│       └── drizzle/           # generated migrations (bundled into the app)
└── packages/shared/src/       # THE BRAIN — imported by both apps
    ├── schema.ts              # Drizzle schema (hand-mirrored with schema.prisma)
    ├── gstCompute.ts          # ONE GST implementation (CGST/SGST vs IGST split)
    ├── paymentLogic.ts        # applyPayment / reversePayment (exact inverses)
    ├── recompute.ts           # rebuilds every derived number from documents
    ├── syncPackets.ts         # diary file format (30-day change notes)
    ├── syncApply.ts           # merge planner (newest-wins, renumber, tripwire)
    ├── gstr1Gstn.ts           # GST-portal JSON builder (both apps, same file)
    ├── convertToInvoice.ts    # quotation/proforma/challan → invoice
    └── pdf/                   # pdfmake docDefinition builders (all documents,
                               #   all 5 invoice templates)
```

**The design rule:** if a bug in some logic could make the two apps disagree
about a number, that logic is not allowed to exist twice. Screens can differ;
math cannot.

## Data model: how documents behave

- **IDs are cuids everywhere**, minted on the device that creates the row. When
  two devices might mint "the same" row while offline (converting the same
  quotation, reversing the same invoice, backfilling the same opening balance),
  the ID is **deterministic** instead — `conv-<sourceId>`, `rev-<invoiceId>`,
  `open-<bankAccountId>` — so both devices produce the *identical* row and sync
  de-duplicates instead of doubling.
- **Deletion is two-tier.** Master data and non-binding documents (customers,
  suppliers, items, quotations, proformas, POs, previous invoices) are
  **archived**: `deletedAt` is stamped, the row stays visible with a Restore
  action, and it's excluded from every total. Posted money documents (invoices,
  bills, credit/debit notes, challans, payments) are **cancelled**:
  `cancelledAt` is stamped after their balance/stock effect is reversed, the
  number stays reserved, and there is no restore — GST rules forbid gaps in
  issued invoice numbers, so a mistake becomes a fresh document or a credit
  note, never a deletion.
- **Derived numbers are owned by the recompute engine.** Customer/supplier
  balances, invoice paid-amount/status, stock counts, and bank balances are
  stored columns for fast reads, but the truth is always re-derivable from the
  documents. `recompute.ts` rebuilds all of them; both apps expose it as
  **Data Health** in Settings (check = dry-run diff, fix = apply). After every
  sync merge that changed rows, recompute runs automatically so totals can
  never drift from the merged documents.
- **Bank balances are journal-backed.** Every balance change is an append-only
  `BankTransaction` row (opening balances included, with deterministic IDs), so
  two devices adjusting the same account offline both survive the merge —
  append-only means newest-wins degenerates into insert-if-absent.

## Sync: two devices, no server

Full design: `docs/sync-design.md` (kept locally, not committed). The shape:

1. **Diaries.** Each device writes ONE file to Drive —
   `changes-<deviceId>.json` — containing every row it changed in the last 30
   days. Push rewrites the whole diary each time (stateless, idempotent: there
   are no baselines to corrupt, and re-running sync is always harmless).
2. **Pull + plan.** A sync downloads every *other* device's diary and runs
   `planApply`: per-row **newest-edit-wins** by `updatedAt`, with three
   overrides — `cancelledAt` and REVERSED are **sticky** (a cancel beats a
   later edit in both directions), machine writes (recompute, payment posting,
   lazy photo fetches) preserve `updatedAt` so they never out-shout human
   edits, and documents travel as **one packet** (header + line items + their
   stock movements) because line items have no stable identity of their own.
3. **Collisions.** Two devices minting the same invoice number offline: the
   **later-created document is renumbered** to the next free number, on both
   devices identically, with a receipt in the sync activity log.
4. **The tripwire.** If an incoming merge wants to remove 10+ live rows, sync
   pauses *before touching anything* and asks the human. Auto-sync never
   confirms it.
5. **Photos ride separately.** Bill photos and archived-invoice files are each
   ONE Drive file (`img-bill-<id>`, `img-previnv-<id>`), pushed best-effort
   after a sync and lazily downloaded the first time a document is viewed.
   This is why the ledger backups are ~10 MB instead of ~300 MB.
6. **Cadence.** Desktop auto-syncs every 5 minutes, mobile every 60 seconds
   while foregrounded; both have a manual "Sync changes now". Convergence
   after simultaneous edits takes one extra round (A → B → A) because devices
   only talk through files.

A single **DB-file lock** per app serializes big merge transactions against
whole-file snapshots, and snapshots are taken with SQLite's `VACUUM INTO` — a
consistent copy even while writes continue — so a backup can never photograph
a half-merged ledger.

## Backups and restore: three layers of undo

- **Full backup** — the entire database (photos included) as one Drive file,
  on demand or on a per-device schedule (off/daily/weekly/monthly). Upload-only
  by policy: if the cloud copy is newer than this device has seen, the
  scheduled job skips and a human decides.
- **The ladder (time machine)** — three photo-stripped, vacuumed rungs on
  Drive: `backup-daily.db`, `backup-weekly.db`, `backup-monthly.db`, each
  refreshed only when *the Drive file itself* is older than its window (so two
  devices never fight over cadence). Sync faithfully replicates mistakes;
  only a copy from *before* the mistake undoes one — that's what the stale
  rungs are for.
- **Restores are atomic and undoable.** Every restore downloads to a temp
  file, verifies the byte count (a dropped connection leaves local data
  untouched), refuses 0-byte cloud files, and **parks** the outgoing database
  as `<db>.pre-restore-<timestamp>` next to the live one instead of deleting
  it — a wrong-direction restore is recovered by renaming the file back.
- **Archive purge** — archived documents are hard-deleted after **35 days**
  (not less: 30-day diaries would resurrect anything purged earlier), with
  conversion-reference guards; masters and cancelled money docs are never
  purged.

## GST

`gstCompute.ts` is the single tax implementation: place-of-supply resolution,
inter-state detection, CGST/SGST-vs-IGST split, B2B/B2C-Large/B2C-Small supply
typing, per-line HSN fallback chains, and the purchase-side override for
scanned bills that print tax only at the bottom. Reports (GSTR-1/2/3B/9, HSN
summaries both directions) are computed per app from the same stored columns;
the **GST-portal upload file** (GSTR-1 JSON in GSTN schema v3) comes from the
shared `gstr1Gstn.ts`, so desktop and mobile emit byte-identical files.

## PDFs

All documents — invoices (5 templates), quotations, proformas, purchase bills,
POs, credit notes, challans, ledgers/statements — are **pdfmake document
definitions built in `packages/shared/src/pdf/`**. Each app renders them with
its own pdfmake instance:

- Desktop feeds them to pdfmake directly in the renderer.
- Mobile runs pdfmake inside a **hidden WebView** (`assets/pdf/pdfHarness.html`,
  regenerated by `pnpm build:pdf-harness` — the builders execute *inside* the
  WebView so their layout callbacks survive; JSON-serializing a docDefinition
  would silently drop every function).

Because the builder is shared, a "Modern" invoice from the phone is the same
document the desktop produces. Template choice is stored in the synced
`Settings` table under `invoiceTemplate`, so it follows the business, not the
device.

## Working on the codebase

- Package manager is **pnpm** (workspace root), Node 22.
- Desktop dev: `cd apps/desktop && pnpm dev`. Mobile dev: `cd apps/mobile &&
  pnpm dev` and open the Expo dev client (a new native build is only needed
  when native modules or app config change — plain TS/JS rides in over Metro).
- **Schema changes touch BOTH schemas** — `packages/shared/src/schema.ts`
  (Drizzle, used by mobile) and `apps/desktop/prisma/schema.prisma` are
  hand-mirrored twins. The full recipe, including the pnpm dual-Prisma-client
  quirk, lives in `MIGRATIONS.md`.
- Typecheck: `pnpm exec tsc --noEmit` inside each app (never `npx tsc` — a
  decoy npm package shadows it).
- Tests: `pnpm test` at the root runs the shared-brain proof harnesses
  (`packages/shared/tests/` — sync merge rules, diary format, recompute vs
  write paths) plus the Prisma↔Drizzle schema-parity guard. CI
  (`.github/workflows/ci.yml`) runs the same on every push. The two-device
  sandbox (`pnpm --dir apps/desktop sandbox:rowsync`) is a manual tool that
  needs a real local DB.
- Secrets live in each app's `.env` (gitignored): desktop OAuth + OCR keys,
  mobile `EXPO_PUBLIC_OPENROUTER_API_KEY` (inlined at bundle time — restart
  the dev server after changing it).
