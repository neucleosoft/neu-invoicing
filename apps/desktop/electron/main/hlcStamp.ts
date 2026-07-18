// Desktop HLC stamping (P1, docs/sync-design.md §11) — the write-side half of
// clock-skew-proof sync. A Prisma client extension stamps a fresh hlc on every
// USER edit of a synced header row; machine writes are recognized and left
// alone by the F5 signature the codebase already follows everywhere:
//
//   explicit `updatedAt` in the write data  ⇒  machine write (recompute,
//   payment posting, photo fetch, sync apply) — hlc is preserved exactly
//   like updatedAt is. No `updatedAt` in data ⇒ real user edit — Prisma's
//   @updatedAt bumps the wall clock and this extension stamps the hlc.
//
// Electron-free on purpose: the sandbox runner builds its own per-device
// clocks and extensions to simulate two machines (with skewed clocks) in one
// process, driving THIS code, not a copy of it.

import { createHlcClock, type HlcClock } from '@neu/shared'

/** Prisma MODEL names of the 15 synced header tables — the only rows that
 *  carry hlc. Children, stockMovement, Company/Settings never sync-order. */
export const SYNCED_MODELS = new Set([
  'Customer',
  'Supplier',
  'SupplierItem',
  'Item',
  'SalesInvoice',
  'Quotation',
  'ProformaInvoice',
  'PurchaseBill',
  'PurchaseOrder',
  'PaymentTransaction',
  'DeliveryChallan',
  'CreditDebitNote',
  'BankAccount',
  'BankTransaction',
  'PreviousInvoice',
])

// The matching SQL table names (Customer lives in "Party" via @@map).
const SYNCED_TABLE_NAMES = [
  'Party',
  'Supplier',
  'SupplierItem',
  'Item',
  'SalesInvoice',
  'Quotation',
  'ProformaInvoice',
  'PurchaseBill',
  'PurchaseOrder',
  'PaymentTransaction',
  'DeliveryChallan',
  'CreditDebitNote',
  'BankAccount',
  'BankTransaction',
  'PreviousInvoice',
]

/**
 * MAX(hlc) across every synced table — the ratchet seed at startup. SQLite's
 * MAX over TEXT is lexicographic, which for hlc strings IS the causal order.
 * Defensive null on any failure (e.g. a DB that somehow missed the migration):
 * the clock then starts from wall time, which is the pre-hlc behavior.
 */
export async function queryMaxHlc(prisma: any): Promise<string | null> {
  try {
    const unions = SYNCED_TABLE_NAMES.map((t) => `SELECT MAX(hlc) AS m FROM "${t}"`).join(' UNION ALL ')
    const rows: { m: string | null }[] = await prisma.$queryRawUnsafe(`SELECT MAX(m) AS m FROM (${unions})`)
    return rows?.[0]?.m ?? null
  } catch (e) {
    console.warn('[hlc] max-scan failed, clock seeds from wall time:', e)
    return null
  }
}

/**
 * The $extends argument that stamps hlc. Parameterized by the stamp source so
 * the app passes its singleton clock and the sandbox passes one per simulated
 * device. `nextHlc` returning null (clock not initialized) skips stamping —
 * rows then stay on the updatedAt fallback, never half-stamped.
 */
export function buildHlcExtensionArgs(nextHlc: () => string | null) {
  const stamp = (data: any) => {
    if (!data || typeof data !== 'object') return
    // Explicit hlc (sync apply carrying a packet's stamp) or explicit
    // updatedAt (the F5 machine-write signature) → preserve, don't mint.
    if ('hlc' in data || 'updatedAt' in data) return
    const v = nextHlc()
    if (v) data.hlc = v
  }
  const stampMany = (data: any) => (Array.isArray(data) ? data.forEach(stamp) : stamp(data))
  return {
    name: 'hlc-stamp',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          if (SYNCED_MODELS.has(model)) {
            if (operation === 'create' || operation === 'update') stampMany(args.data)
            else if (operation === 'createMany' || operation === 'updateMany') stampMany(args.data)
            else if (operation === 'upsert') {
              stamp(args.create)
              stamp(args.update)
            }
          }
          return query(args)
        },
      },
    },
  }
}

// ── The app's singleton clock ────────────────────────────────────────────────

let appClock: HlcClock | null = null

export const getAppHlcClock = (): HlcClock | null => appClock

export const nextAppHlc = (): string | null => (appClock ? appClock.next() : null)

/** Called once from setupDatabase, after migrations + connect, BEFORE the
 *  extension is applied and before any app write. */
export async function initAppHlcClock(prisma: any, deviceId: string): Promise<void> {
  appClock = createHlcClock(deviceId, { init: await queryMaxHlc(prisma) })
}

/** Called after the DB file is REPLACED under us (cloud restore / time
 *  machine): the incoming file may carry higher stamps than anything this
 *  device has seen — the ratchet must never fall below them. */
export async function reobserveDbMaxHlc(prisma: any): Promise<void> {
  if (appClock) appClock.observe(await queryMaxHlc(prisma))
}

export const appHlcExtensionArgs = () => buildHlcExtensionArgs(nextAppHlc)
