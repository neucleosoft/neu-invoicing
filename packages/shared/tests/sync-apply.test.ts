// Conflict-scenario verification for packages/shared/src/syncApply.ts.

import {
  planApply,
  dedupePackets,
  nextFreeNumber,
  type LocalIndex,
} from '../src/syncApply'
import type { SyncPacket } from '../src/syncPackets'

let failures = 0
let passes = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passes++; console.log(`  ok  ${name}`) }
  else { failures++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

const pkt = (over: Partial<SyncPacket> & { table: string; rowId: string; updatedAt: number }): SyncPacket => ({
  v: 1,
  device: 'phone-abc',
  row: {},
  ...over,
})

const emptyLocal = (): LocalIndex => ({ headers: {} })

// planApply is pure — the caller supplies the clock. Fixed here for determinism.
const NOW_TS = 999_999
const run = (pk: SyncPacket[], lo: LocalIndex) => planApply(pk, lo, NOW_TS)

console.log('\n1. insert / newest-wins basics')
{
  const plan = run(
    [pkt({ table: 'customer', rowId: 'C1', updatedAt: 100, row: { id: 'C1', name: 'Kaju' } })],
    emptyLocal(),
  )
  check('absent locally → insert upsert', plan.upserts.length === 1 && plan.upserts[0].insert)

  const newer = run(
    [pkt({ table: 'customer', rowId: 'C1', updatedAt: 200, row: { id: 'C1' } })],
    { headers: { customer: { C1: { updatedAt: 100 } } } },
  )
  check('incoming newer → update upsert', newer.upserts.length === 1 && !newer.upserts[0].insert)

  const older = run(
    [pkt({ table: 'customer', rowId: 'C1', updatedAt: 50, row: { id: 'C1' } })],
    { headers: { customer: { C1: { updatedAt: 100 } } } },
  )
  check('incoming older → skipped NOT_NEWER', older.skipped.length === 1 && older.skipped[0].reason === 'NOT_NEWER')

  const tie = run(
    [pkt({ table: 'customer', rowId: 'C1', updatedAt: 100, row: { id: 'C1' } })],
    { headers: { customer: { C1: { updatedAt: 100 } } } },
  )
  check('equal timestamps → local wins (skip)', tie.skipped.length === 1)

  const unknown = run([pkt({ table: 'martianLedger', rowId: 'X', updatedAt: 1, row: {} })], emptyLocal())
  check('unknown table → skipped UNKNOWN_TABLE', unknown.skipped[0]?.reason === 'UNKNOWN_TABLE')
}

console.log('\n2. sticky cancel / sticky REVERSED')
{
  // Local cancelled, incoming NEWER plain edit → must NOT resurrect.
  const resurrect = run(
    [pkt({ table: 'salesInvoice', rowId: 'I1', updatedAt: 900, row: { id: 'I1', cancelledAt: null, status: 'PAID' } })],
    { headers: { salesInvoice: { I1: { updatedAt: 100, cancelledAt: 500 } } } },
  )
  check('newer edit cannot resurrect a cancelled doc', resurrect.skipped[0]?.reason === 'CANCEL_STICKY')
  check('sticky skip is logged', resurrect.log.some((l) => l.kind === 'STICKY_SKIP'))

  // Incoming cancel with OLDER timestamp than local edit → cancel still wins.
  const cancelWins = run(
    [pkt({ table: 'salesInvoice', rowId: 'I2', updatedAt: 100, row: { id: 'I2', cancelledAt: 90, status: 'DRAFT' } })],
    { headers: { salesInvoice: { I2: { updatedAt: 500, cancelledAt: null } } } },
  )
  check('incoming cancel beats a newer local edit', cancelWins.upserts.length === 1)
  check('sticky win is logged', cancelWins.log.some((l) => l.kind === 'STICKY_WIN'))

  // REVERSED: local reversed, incoming newer non-reversed edit → skip.
  const unreverse = run(
    [pkt({ table: 'salesInvoice', rowId: 'I3', updatedAt: 900, row: { id: 'I3', cancelledAt: null, status: 'PAID' } })],
    { headers: { salesInvoice: { I3: { updatedAt: 100, cancelledAt: null, status: 'REVERSED' } } } },
  )
  check('newer edit cannot un-reverse a REVERSED invoice', unreverse.skipped[0]?.reason === 'REVERSED_STICKY')

  // Incoming REVERSED with older timestamp → wins.
  const reversedWins = run(
    [pkt({ table: 'salesInvoice', rowId: 'I4', updatedAt: 100, row: { id: 'I4', cancelledAt: null, status: 'REVERSED' } })],
    { headers: { salesInvoice: { I4: { updatedAt: 500, cancelledAt: null, status: 'PAID' } } } },
  )
  check('incoming REVERSED beats a newer local edit', reversedWins.upserts.length === 1)

  // deletedAt is NOT sticky: newer restore (deletedAt null) over local archived → applies.
  const restore = run(
    [pkt({ table: 'customer', rowId: 'C9', updatedAt: 900, row: { id: 'C9', deletedAt: null } })],
    { headers: { customer: { C9: { updatedAt: 100, deletedAt: 400 } } } },
  )
  check('archive restore rides plain newest-wins', restore.upserts.length === 1)
}

console.log('\n3. dedupe across diaries')
{
  const a = pkt({ table: 'customer', rowId: 'C1', updatedAt: 100, device: 'phone-a', row: { id: 'C1', name: 'old' } })
  const b = pkt({ table: 'customer', rowId: 'C1', updatedAt: 200, device: 'desktop-b', row: { id: 'C1', name: 'new' } })
  const deduped = dedupePackets([a, b])
  check('newest packet survives dedupe', deduped.length === 1 && deduped[0].row.name === 'new')

  const tie1 = pkt({ table: 'customer', rowId: 'C1', updatedAt: 100, device: 'aaa', row: { id: 'C1' } })
  const tie2 = pkt({ table: 'customer', rowId: 'C1', updatedAt: 100, device: 'zzz', row: { id: 'C1' } })
  check('tie dedupe is device-deterministic (both orders agree)',
    dedupePackets([tie1, tie2])[0].device === 'zzz' && dedupePackets([tie2, tie1])[0].device === 'zzz')
}

console.log('\n4. number collisions (D4: later-created renumbers)')
{
  // Incoming later-created → incoming renumbered, padding kept.
  const incLater = run(
    [pkt({ table: 'salesInvoice', rowId: 'I-new', updatedAt: 900, row: { id: 'I-new', invoiceNumber: 'NS/SL/26-27/07', createdAt: 2000 } })],
    {
      headers: { salesInvoice: {} },
      numbers: { salesInvoice: { 'NS/SL/26-27/07': { rowId: 'I-old', createdAt: 1000 }, 'NS/SL/26-27/08': { rowId: 'I-8', createdAt: 1 } } },
    },
  )
  check('later incoming renumbered past taken slots', incLater.upserts[0]?.row.invoiceNumber === 'NS/SL/26-27/09')
  check('renumber logged', incLater.log.some((l) => l.kind === 'RENUMBER_INCOMING'))

  // LOCAL later-created → local renumber planned, incoming keeps its number.
  const locLater = run(
    [pkt({ table: 'salesInvoice', rowId: 'I-in', updatedAt: 900, row: { id: 'I-in', invoiceNumber: 'NS/SL/26-27/07', createdAt: 1000 } })],
    {
      headers: { salesInvoice: {} },
      numbers: { salesInvoice: { 'NS/SL/26-27/07': { rowId: 'I-local', createdAt: 2000 } } },
    },
  )
  check('earlier incoming keeps its number', locLater.upserts[0]?.row.invoiceNumber === 'NS/SL/26-27/07')
  check('later local gets renumbered', locLater.localRenumbers[0]?.rowId === 'I-local' && locLater.localRenumbers[0]?.to === 'NS/SL/26-27/08')

  // Two incoming packets colliding into the same series get DISTINCT numbers.
  const both = run(
    [
      pkt({ table: 'salesInvoice', rowId: 'I-a', updatedAt: 900, row: { id: 'I-a', invoiceNumber: 'INV-2026-005', createdAt: 3000 } }),
      pkt({ table: 'salesInvoice', rowId: 'I-b', updatedAt: 901, row: { id: 'I-b', invoiceNumber: 'INV-2026-005', createdAt: 4000 } }),
    ],
    {
      headers: { salesInvoice: {} },
      numbers: { salesInvoice: { 'INV-2026-005': { rowId: 'I-owner', createdAt: 1 } } },
    },
  )
  const nums = both.upserts.map((u) => u.row.invoiceNumber).sort()
  check('batch collisions get distinct numbers', nums.length === 2 && nums[0] !== nums[1],
    JSON.stringify(nums))

  // previousInvoice rejoined sync (S4b: empty-blob sentinel + Drive file):
  // packets apply, and integer serials renumber numerically on collision.
  const prevInv = run(
    [pkt({ table: 'previousInvoice', rowId: 'P-new', updatedAt: 10, row: { id: 'P-new', serialNumber: 42, createdAt: 900 } })],
    {
      headers: { previousInvoice: {} },
      numbers: { previousInvoice: { '42': { rowId: 'P-old', createdAt: 1 }, '43': { rowId: 'P-43', createdAt: 1 } } },
    },
  )
  check('previousInvoice packets apply again', prevInv.upserts.length === 1)
  check('integer serial bumps numerically past taken slots', prevInv.upserts[0]?.row.serialNumber === 44)

  // Same doc re-synced with its own number → NO collision.
  const self = run(
    [pkt({ table: 'salesInvoice', rowId: 'I-same', updatedAt: 900, row: { id: 'I-same', invoiceNumber: 'NS/SL/26-27/07', createdAt: 1000 } })],
    {
      headers: { salesInvoice: { 'I-same': { updatedAt: 100 } } },
      numbers: { salesInvoice: { 'NS/SL/26-27/07': { rowId: 'I-same', createdAt: 1000 } } },
    },
  )
  check('own number is never a collision', self.localRenumbers.length === 0 && self.upserts[0]?.row.invoiceNumber === 'NS/SL/26-27/07')
}

console.log('\n5. document packets: children + movements + tripwire')
{
  const plan = run(
    [
      pkt({
        table: 'salesInvoice', rowId: 'I1', updatedAt: 900,
        row: { id: 'I1', invoiceNumber: 'NS/SL/26-27/01', createdAt: 1, cancelledAt: null },
        children: {
          salesInvoiceItem: [{ id: 'L1', salesInvoiceId: 'I1' }],
          stockMovement: [{ id: 'M1', referenceType: 'INVOICE', referenceId: 'I1', quantity: -2 }],
        },
      }),
    ],
    emptyLocal(),
  )
  const up = plan.upserts[0]
  check('children replacement set attached', up.children?.table === 'salesInvoiceItem' && up.children.rows.length === 1)
  check('movements as doc-scoped replace-set', up.movements?.referenceType === 'INVOICE' && up.movements.referenceId === 'I1' && up.movements.rows.length === 1)

  // Tripwire: incoming cancels/archives of LIVE local rows count; fresh inserts don't.
  const trip = run(
    [
      pkt({ table: 'salesInvoice', rowId: 'T1', updatedAt: 900, row: { id: 'T1', cancelledAt: 800, createdAt: 1 } }),
      pkt({ table: 'customer', rowId: 'T2', updatedAt: 900, row: { id: 'T2', deletedAt: 800 } }),
      pkt({ table: 'customer', rowId: 'T3', updatedAt: 900, row: { id: 'T3', deletedAt: 800 } }), // absent locally → not a removal event
    ],
    {
      headers: {
        salesInvoice: { T1: { updatedAt: 100, cancelledAt: null } },
        customer: { T2: { updatedAt: 100, deletedAt: null } },
      },
    },
  )
  check('tripwire counts newly-removed LIVE local rows only', trip.incomingRemovals === 2, `got ${trip.incomingRemovals}`)
}

console.log('\n6b. review-fix behaviors (2026-07-11)')
{
  // Renumbered incoming rows get stamped NOW so the renumber propagates back
  // to the doc's home device instead of dying as a NOT_NEWER echo.
  const stamped = run(
    [pkt({ table: 'salesInvoice', rowId: 'I-x', updatedAt: 100, row: { id: 'I-x', invoiceNumber: 'INV-001', createdAt: 2000 } })],
    { headers: { salesInvoice: {} }, numbers: { salesInvoice: { 'INV-001': { rowId: 'I-owner', createdAt: 1000 } } } },
  )
  check('renumbered incoming row stamped with now', stamped.upserts[0]?.row.updatedAt === NOW_TS)

  // createdAt exact tie → rowId tiebreak, identical on both devices.
  const tieLocal = { headers: { salesInvoice: {} }, numbers: { salesInvoice: { 'INV-001': { rowId: 'I-mmm', createdAt: 500 } } } }
  const tieBig = run([pkt({ table: 'salesInvoice', rowId: 'I-zzz', updatedAt: 10, row: { id: 'I-zzz', invoiceNumber: 'INV-001', createdAt: 500 } })], tieLocal)
  const tieSmall = run([pkt({ table: 'salesInvoice', rowId: 'I-aaa', updatedAt: 10, row: { id: 'I-aaa', invoiceNumber: 'INV-001', createdAt: 500 } })], tieLocal)
  check('createdAt tie: larger rowId loses (incoming renumbered)', tieBig.upserts[0]?.row.invoiceNumber === 'INV-002' && tieBig.localRenumbers.length === 0)
  check('createdAt tie: smaller rowId keeps number (local renumbered)', tieSmall.upserts[0]?.row.invoiceNumber === 'INV-001' && tieSmall.localRenumbers[0]?.rowId === 'I-mmm')

  // ≥3 devices: a number introduced by an earlier packet in the SAME plan is
  // a visible collision owner to a later one.
  const threeWay = run(
    [
      pkt({ table: 'salesInvoice', rowId: 'I-p1', updatedAt: 10, device: 'phone-a', row: { id: 'I-p1', invoiceNumber: 'INV-005', createdAt: 100 } }),
      pkt({ table: 'salesInvoice', rowId: 'I-p2', updatedAt: 11, device: 'phone-b', row: { id: 'I-p2', invoiceNumber: 'INV-005', createdAt: 200 } }),
    ],
    { headers: { salesInvoice: {} } },
  )
  const threeNums = threeWay.upserts.map((u) => u.row.invoiceNumber).sort()
  check('same number from two peers in one plan → distinct numbers', threeNums[0] === 'INV-005' && threeNums[1] === 'INV-006', JSON.stringify(threeNums))

  // FK-safe ordering: parents before children regardless of packet order.
  const ordered = run(
    [
      pkt({ table: 'paymentTransaction', rowId: 'P1', updatedAt: 10, row: { id: 'P1' } }),
      pkt({ table: 'salesInvoice', rowId: 'I1', updatedAt: 10, row: { id: 'I1', invoiceNumber: 'X-1', createdAt: 1 } }),
      pkt({ table: 'customer', rowId: 'C1', updatedAt: 10, row: { id: 'C1' } }),
      pkt({ table: 'supplierItem', rowId: 'SI1', updatedAt: 10, row: { id: 'SI1' } }),
      pkt({ table: 'supplier', rowId: 'S1', updatedAt: 10, row: { id: 'S1' } }),
    ],
    emptyLocal(),
  )
  check('upserts ordered parents-first for FK safety',
    ordered.upserts.map((u) => u.table).join(',') === 'customer,supplier,supplierItem,salesInvoice,paymentTransaction',
    ordered.upserts.map((u) => u.table).join(','))
}

console.log('\n6. nextFreeNumber edge cases')
{
  check('pads preserved', nextFreeNumber('NS/SL/26-27/09', () => false) === 'NS/SL/26-27/10')
  check('width growth ok', nextFreeNumber('INV-99', () => false) === 'INV-100')
  check('no digits → suffix', nextFreeNumber('ADHOC', (n) => n === 'ADHOC-2') === 'ADHOC-3')
  check('numeric', nextFreeNumber(7, (n) => n === 8) === 9)
}

console.log(`\n=== ${passes} passed, ${failures} failed ===`)
process.exit(failures > 0 ? 1 : 0)
