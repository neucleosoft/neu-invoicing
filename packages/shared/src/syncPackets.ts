// Sync packets — the change-diary format both devices write to and read from
// Drive (docs/sync-design.md §5). Pure data shaping: no DB, no IO, no clock —
// the caller fetches rows and supplies timestamps, so the exact same code runs
// on desktop (Prisma rows) and mobile (Drizzle rows) and can be unit-proven.
//
// DESIGN RULE (P4, sync-design.md §11): prefer merges whose outcome doesn't
// depend on timestamps — one-way flags (cancelledAt, REVERSED), append-only
// rows (stockMovement), recomputed totals. Newest-edit-wins on updatedAt is the
// FALLBACK for genuinely editable headers, not the default for everything.
//
// The packet model (decided 2026-06-13, extended 2026-07-11):
//  - A DOCUMENT syncs as ONE packet: header + every child line inline. Line
//    items have no stable ids (edits delete+reinsert them) and no updatedAt,
//    so apply always replaces the whole child set.
//  - Stock-affecting documents (invoice / bill / challan) ALSO carry their
//    stockMovement rows (matched by referenceType/referenceId). Apply REPLACES
//    the doc-scoped movement set (delete by reference, insert the packet's) —
//    NOT insert-if-missing, because document EDITS rewrite their movements
//    with fresh ids (only create/cancel append). The packet always carries the
//    doc's complete current movement set, so replace is correct in every case;
//    without movements syncing at all, the receiving device's stock recompute
//    would diverge.
//  - Master rows (customer, item, …) and payments are single-row packets.
//  - deletedAt / cancelledAt are ordinary columns inside `row` — an archive,
//    restore, or cancel is just an edit riding the same path.
//  - Binary columns (bill photos) are STRIPPED, never embedded — a diary must
//    stay KBs. Photos get their own Drive files in S4 (image split); until
//    then a synced doc arrives without its photo and keeps working.

export const SYNC_FORMAT_VERSION = 1

/**
 * S4 image split: a bill's scanned photo lives ONCE on Drive as its own file,
 * named deterministically from the bill id — packets and backups never embed
 * it. Both apps derive the name from THIS function so they can never disagree
 * about where a photo lives. (A replaced photo overwrites the same file; the
 * file dies when the bill is purged — S5.)
 */
export const billImageFileName = (billId: string) => `img-bill-${billId}`

/** Same split for a previous-invoice's archived PDF/image (immutable). */
export const previousInvoiceFileName = (id: string) => `img-previnv-${id}`

/**
 * previousInvoice.fileData is NOT NULL on both schemas, but packets strip
 * blobs — so a synced-in archive row is inserted with an EMPTY blob as the
 * "lives on Drive, not fetched yet" sentinel (a real PDF is never 0 bytes).
 * Executors must NEVER include fileData in the UPDATE branch of an upsert,
 * or a stripped packet would wipe a locally-fetched file back to empty.
 */
export const PREV_INVOICE_BLOB_COLUMN = 'fileData'

// A row after normalization: Dates → epoch-ms numbers, binaries stripped.
export type PacketRow = Record<string, unknown>

export interface SyncPacket {
  v: typeof SYNC_FORMAT_VERSION
  /** Stable id of the device that wrote this packet. */
  device: string
  /** Logical table name of the header row (drizzle-style key, e.g. 'salesInvoice'). */
  table: string
  /** Header row primary key (cuid). */
  rowId: string
  /** Header's updatedAt as epoch ms — the newest-edit-wins comparator. */
  updatedAt: number
  row: PacketRow
  /** childTable → full replacement row set; plus 'stockMovement' (append-only). */
  children?: Record<string, PacketRow[]>
  /** Binary columns that were stripped from `row` (photos sync in S4). */
  stripped?: string[]
}

export interface SyncDiary {
  v: typeof SYNC_FORMAT_VERSION
  device: string
  /** When this diary snapshot was generated (epoch ms, supplied by caller). */
  generatedAt: number
  packets: SyncPacket[]
}

// ── Table registry ───────────────────────────────────────────────────────────
// The single source of truth for WHAT syncs and HOW. Shared by the collector
// (below) and the apply planner, so the two can never disagree about shape.

export interface DocTableSpec {
  table: string
  childTable: string
  /** FK column on the child that points at the header id. */
  childFk: string
  /** stockMovement.referenceType value when this doc moves stock. */
  movementRef?: 'INVOICE' | 'BILL' | 'CHALLAN'
  /** UNIQUE document-number column — two offline devices can mint the same
   *  value, so the apply planner renumbers the later-created doc (D4). */
  numberColumn?: string
}

/** Documents: header + children (+ movements) as one packet.
 *  previousInvoice syncs WITHOUT its NOT-NULL fileData blob: inserts get the
 *  empty-blob sentinel (see PREV_INVOICE_BLOB_COLUMN) and the real file rides
 *  as its own Drive object (previousInvoiceFileName), fetched lazily. */
export const SYNC_DOCUMENT_TABLES: DocTableSpec[] = [
  { table: 'salesInvoice', childTable: 'salesInvoiceItem', childFk: 'salesInvoiceId', movementRef: 'INVOICE', numberColumn: 'invoiceNumber' },
  { table: 'purchaseBill', childTable: 'purchaseBillItem', childFk: 'purchaseBillId', movementRef: 'BILL', numberColumn: 'billNumber' },
  { table: 'deliveryChallan', childTable: 'deliveryChallanItem', childFk: 'deliveryChallanId', movementRef: 'CHALLAN', numberColumn: 'challanNumber' },
  { table: 'creditDebitNote', childTable: 'creditDebitNoteItem', childFk: 'creditDebitNoteId', numberColumn: 'noteNumber' },
  { table: 'quotation', childTable: 'quotationItem', childFk: 'quotationId', numberColumn: 'invoiceNumber' },
  { table: 'proformaInvoice', childTable: 'proformaInvoiceItem', childFk: 'proformaInvoiceId', numberColumn: 'invoiceNumber' },
  { table: 'purchaseOrder', childTable: 'purchaseOrderItem', childFk: 'purchaseOrderId', numberColumn: 'orderNumber' },
  { table: 'previousInvoice', childTable: 'previousInvoiceItem', childFk: 'previousInvoiceId', numberColumn: 'serialNumber' },
]

/** Single-row packets: master data + payments + bank journals (append-only,
 *  immutable — plain newest-wins degenerates to insert-if-absent for them).
 *  company/settings never sync. */
export const SYNC_SINGLE_TABLES = [
  'customer',
  'supplier',
  'supplierItem',
  'item',
  'bankAccount',
  'bankTransaction',
  'paymentTransaction',
] as const

/**
 * FK-safe apply order: parents strictly before anything that references them.
 * Desktop runs with PRAGMA foreign_keys=ON and SQLite checks at statement
 * time, so an alphabetically-ordered plan (bill before its new supplier)
 * would roll back the whole sync. planApply sorts its upserts by this list.
 *   supplierItem → supplier, item · salesInvoice → customer, quotation,
 *   proformaInvoice · deliveryChallan → customer, salesInvoice (convert link)
 *   · purchaseOrder → supplier · purchaseBill → supplier, purchaseOrder ·
 *   creditDebitNote → customer, salesInvoice · paymentTransaction → all four.
 */
export const SYNC_APPLY_ORDER: string[] = [
  'customer',
  'supplier',
  'item',
  'supplierItem',
  'bankAccount',
  'bankTransaction',
  'quotation',
  'proformaInvoice',
  'salesInvoice',
  'deliveryChallan',
  'purchaseOrder',
  'purchaseBill',
  'creditDebitNote',
  'previousInvoice',
  'paymentTransaction',
]

// ── Normalization ────────────────────────────────────────────────────────────

const isBinary = (v: unknown): boolean =>
  v instanceof Uint8Array ||
  (typeof v === 'object' && v !== null && (v as { type?: string }).type === 'Buffer' && Array.isArray((v as { data?: unknown }).data))

/** Date | epoch-ms | null → epoch-ms | null. Diaries carry ONLY integer dates. */
export const toEpochMs = (v: unknown): number | null => {
  if (v == null) return null
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number' && Number.isFinite(v)) return v
  // Legacy ISO-text rows (pre date-fix) — tolerate on the way out.
  if (typeof v === 'string') {
    const parsed = Date.parse(v)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

// Column-name convention for date fields across BOTH schemas: createdAt,
// updatedAt, deletedAt, cancelledAt, invoiceDate, billDate, paymentDate,
// dueDate, orderDate, expectedDate, noteDate, supplierInvoiceDate,
// deliveryTime, lastSyncTimestamp… — everything ending At / Date / Time /
// Timestamp is a date column. The one schema column that breaks the
// convention gets an explicit entry (verified against BOTH full schemas —
// review 2026-07-11 found lastGstFetch was crashing the apply on every
// GST-fetched party).
const DATE_KEY = /(At|Date|Time|Timestamp)$/
const EXTRA_DATE_KEYS = new Set(['lastGstFetch'])
const isDateKey = (key: string) => DATE_KEY.test(key) || EXTRA_DATE_KEYS.has(key)

/**
 * Inverse of normalizeRow for the APPLY side: turn a packet row back into what
 * the ORM expects — epoch-ms (or legacy ISO text) date fields become Date
 * objects; everything else passes through. Both executors use this, so the
 * revival convention can never fork between the apps.
 */
export function reviveRowDates(row: PacketRow): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (value != null && isDateKey(key)) {
      const ms = toEpochMs(value)
      out[key] = ms == null ? value : new Date(ms)
    } else {
      out[key] = value
    }
  }
  return out
}

/**
 * Make a raw ORM row diary-safe: Date objects → epoch ms, binary columns
 * stripped (returned separately). Everything else passes through untouched.
 */
export function normalizeRow(raw: Record<string, unknown>): { row: PacketRow; stripped: string[] } {
  const row: PacketRow = {}
  const stripped: string[] = []
  for (const [key, value] of Object.entries(raw)) {
    if (isBinary(value)) {
      stripped.push(key)
      continue
    }
    row[key] = value instanceof Date ? value.getTime() : value
  }
  return { row, stripped }
}

// ── Collector (export side) ──────────────────────────────────────────────────

export interface DocumentBundle {
  header: Record<string, unknown>
  children: Record<string, unknown>[]
  /** stockMovement rows referencing this doc; only for stock-moving tables. */
  movements?: Record<string, unknown>[]
}

export interface CollectInput {
  device: string
  /** Caller-supplied clock (Date.now() at the call site). */
  now: number
  /** table → changed single rows (masters + payments). */
  singles?: Partial<Record<(typeof SYNC_SINGLE_TABLES)[number], Record<string, unknown>[]>>
  /** table → changed document bundles. */
  documents?: Partial<Record<string, DocumentBundle[]>>
}

/**
 * Assemble a diary from rows the app already fetched (everything whose header
 * updatedAt moved past the device's last-push baseline). Deterministic: packets
 * are sorted by table then rowId, so the same data always yields the same diary
 * — which makes re-uploads idempotent and diffs readable.
 */
export function buildDiary(input: CollectInput): SyncDiary {
  const packets: SyncPacket[] = []

  for (const table of SYNC_SINGLE_TABLES) {
    for (const raw of input.singles?.[table] ?? []) {
      const { row, stripped } = normalizeRow(raw)
      packets.push({
        v: SYNC_FORMAT_VERSION,
        device: input.device,
        table,
        rowId: String(raw.id),
        // Payments' updatedAt is nullable (legacy rows pre-backfill) — fall
        // back createdAt, then the collection time, so the comparator always
        // has a number.
        updatedAt: toEpochMs(raw.updatedAt) ?? toEpochMs(raw.createdAt) ?? input.now,
        row,
        ...(stripped.length ? { stripped } : {}),
      })
    }
  }

  for (const spec of SYNC_DOCUMENT_TABLES) {
    for (const bundle of input.documents?.[spec.table] ?? []) {
      const { row, stripped } = normalizeRow(bundle.header)
      const children: Record<string, PacketRow[]> = {
        [spec.childTable]: bundle.children.map((c) => normalizeRow(c).row),
      }
      if (spec.movementRef && bundle.movements?.length) {
        children.stockMovement = bundle.movements.map((m) => normalizeRow(m).row)
      }
      packets.push({
        v: SYNC_FORMAT_VERSION,
        device: input.device,
        table: spec.table,
        rowId: String(bundle.header.id),
        updatedAt: toEpochMs(bundle.header.updatedAt) ?? toEpochMs(bundle.header.createdAt) ?? input.now,
        row,
        children,
        ...(stripped.length ? { stripped } : {}),
      })
    }
  }

  packets.sort((a, b) => (a.table === b.table ? a.rowId.localeCompare(b.rowId) : a.table.localeCompare(b.table)))

  return { v: SYNC_FORMAT_VERSION, device: input.device, generatedAt: input.now, packets }
}

// ── Parser (import side) ─────────────────────────────────────────────────────

export type ParseDiaryResult =
  | { ok: true; diary: SyncDiary }
  | { ok: false; error: 'NEWER_VERSION' | 'MALFORMED' }

/**
 * Parse a peer's diary file. A newer format version than this build understands
 * is a hard stop ("update the app to keep syncing") — never guess at unknown
 * fields when money is involved.
 */
export function parseDiary(json: string): ParseDiaryResult {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return { ok: false, error: 'MALFORMED' }
  }
  if (typeof data !== 'object' || data === null) return { ok: false, error: 'MALFORMED' }
  const d = data as Partial<SyncDiary>
  if (typeof d.v !== 'number' || typeof d.device !== 'string' || !Array.isArray(d.packets)) {
    return { ok: false, error: 'MALFORMED' }
  }
  if (d.v > SYNC_FORMAT_VERSION) return { ok: false, error: 'NEWER_VERSION' }
  for (const p of d.packets) {
    if (
      typeof p !== 'object' || p === null ||
      typeof (p as SyncPacket).table !== 'string' ||
      typeof (p as SyncPacket).rowId !== 'string' ||
      typeof (p as SyncPacket).updatedAt !== 'number' ||
      typeof (p as SyncPacket).row !== 'object' ||
      (p as SyncPacket).row === null
    ) {
      return { ok: false, error: 'MALFORMED' }
    }
  }
  return { ok: true, diary: data as SyncDiary }
}
