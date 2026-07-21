// Desktop HLC clock (P1, docs/sync-design.md §11) — the write-side half of
// clock-skew-proof sync, twin of apps/mobile/sync/hlc.ts. Since the
// Prisma→Drizzle migration the stamping itself lives in the SHARED schema
// ($defaultFn/$onUpdate on each synced table's hlc column, routed through
// setGlobalHlcStamper — wired at boot in database.ts); this module owns the
// device's ONE ratchet: seeded from MAX(hlc) at startup, advanced by every
// stamp, fed by every peer stamp seen during a pull.
//
// Machine writes (recompute, payment posting, photo fetch) defeat the schema
// stamp the same way they defeat $onUpdate(now) on updatedAt — by passing
// the row's existing value explicitly (the F5 rule).

import type { Client } from '@libsql/client'
import { createHlcClock, type HlcClock } from '@neu/shared'

// SQL table names of the 15 synced header tables (customer lives in "Party").
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
export async function queryMaxHlc(client: Client): Promise<string | null> {
  try {
    const unions = SYNCED_TABLE_NAMES.map((t) => `SELECT MAX(hlc) AS m FROM "${t}"`).join(' UNION ALL ')
    const res = await client.execute(`SELECT MAX(m) AS m FROM (${unions})`)
    const m = res.rows[0]?.m
    return typeof m === 'string' && m.length > 0 ? m : null
  } catch (e) {
    console.warn('[hlc] max-scan failed, clock seeds from wall time:', e)
    return null
  }
}

// ── The app's singleton clock ────────────────────────────────────────────────

let appClock: HlcClock | null = null

export const getAppHlcClock = (): HlcClock | null => appClock

export const nextAppHlc = (): string | null => (appClock ? appClock.next() : null)

/** Called once from setupDatabase, after migrations + connect, BEFORE any
 *  app write. Seeding from the DB max means a restart — or a crash that lost
 *  the in-memory ratchet — can never re-issue a stamp below one already
 *  stored in a row. */
export async function initAppHlcClock(client: Client, deviceId: string): Promise<void> {
  appClock = createHlcClock(deviceId, { init: await queryMaxHlc(client) })
}

/** Called after the DB file is REPLACED under us (cloud restore / time
 *  machine): the incoming file may carry higher stamps than anything this
 *  device has seen — the ratchet must never fall below them. */
export async function reobserveDbMaxHlc(client: Client): Promise<void> {
  if (appClock) appClock.observe(await queryMaxHlc(client))
}
