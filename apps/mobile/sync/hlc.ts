// Mobile HLC clock (P1, docs/sync-design.md §11) — the write-side half of
// clock-skew-proof sync, twin of desktop's hlcStamp.ts. On mobile the
// stamping itself lives in the shared Drizzle schema ($defaultFn/$onUpdate on
// each synced table's hlc column, routed through setGlobalHlcStamper); this
// module owns the device's ONE ratchet: seeded from MAX(hlc) at DB init,
// advanced by every stamp, fed by every peer stamp seen during a pull.
//
// Machine writes (recompute, payment posting, photo fetch) defeat the schema
// stamp the same way they already defeat $onUpdate(now) on updatedAt — by
// passing the row's existing value explicitly (the F5 rule).

import { createHlcClock, setGlobalHlcStamper, type HlcClock } from '@neu/shared'
import type { SQLiteDatabase } from 'expo-sqlite'

import { getDeviceId } from './deviceId'

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

let clock: HlcClock | null = null

export const getMobileHlcClock = (): HlcClock | null => clock

export const nextMobileHlc = (): string | null => (clock ? clock.next() : null)

/** MAX(hlc) across every synced table — SQLite's MAX over TEXT is
 *  lexicographic, which for hlc strings IS the causal order. */
async function queryMaxHlc(sqlite: SQLiteDatabase): Promise<string | null> {
  try {
    const unions = SYNCED_TABLE_NAMES.map((t) => `SELECT MAX(hlc) AS m FROM "${t}"`).join(' UNION ALL ')
    const row = await sqlite.getFirstAsync<{ m: string | null }>(`SELECT MAX(m) AS m FROM (${unions})`)
    return row?.m ?? null
  } catch (e) {
    console.warn('[hlc] max-scan failed, clock seeds from wall time:', e)
    return null
  }
}

/**
 * Called once from runMigrations, after migrate + repairs and BEFORE the app
 * renders (so before any user write). Seeding from the DB max means a
 * restart — or a crash that lost the in-memory ratchet — can never re-issue
 * a stamp below one already stored in a row. A cloud restore / time-machine
 * swap always reloads the app (SQLiteProvider holds the old file handle), so
 * this same seed also covers "the DB file was just replaced".
 */
export async function initMobileHlcClock(sqlite: SQLiteDatabase): Promise<void> {
  const deviceId = await getDeviceId()
  clock = createHlcClock(deviceId, { init: await queryMaxHlc(sqlite) })
  setGlobalHlcStamper(() => clock!.next())
}
