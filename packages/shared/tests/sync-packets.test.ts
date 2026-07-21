// Verification for packages/shared/src/syncPackets.ts — the diary format.

import {
  buildDiary,
  parseDiary,
  toEpochMs,
  SYNC_FORMAT_VERSION,
} from '../src/syncPackets'

let failures = 0
let passes = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passes++; console.log(`  ok  ${name}`) }
  else { failures++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}

const NOW = 1782000000000

console.log('\n1. buildDiary shaping')
const invoiceDate = new Date('2026-07-01T10:00:00.000Z')
const diary = buildDiary({
  device: 'phone-abc',
  now: NOW,
  singles: {
    customer: [{ id: 'C1', name: 'Kaju', updatedAt: new Date(1781000000000), createdAt: new Date(1780000000000) }],
    paymentTransaction: [{ id: 'P1', type: 'PAYMENT_IN', amount: 500, updatedAt: null, createdAt: 1780500000000 }],
  },
  documents: {
    salesInvoice: [{
      header: {
        id: 'I1', invoiceNumber: 'NS/SL/26-27/07', invoiceDate,
        updatedAt: new Date(1781500000000), cancelledAt: null,
        attachmentData: new Uint8Array([1, 2, 3]),
      },
      children: [
        { id: 'L1', salesInvoiceId: 'I1', quantity: 2, rate: 100, createdAt: invoiceDate },
        { id: 'L2', salesInvoiceId: 'I1', quantity: 1, rate: 50, createdAt: invoiceDate },
      ],
      movements: [{ id: 'M1', itemId: 'IT1', quantity: -2, referenceType: 'INVOICE', referenceId: 'I1', createdAt: invoiceDate }],
    }],
  },
})

check('3 packets built', diary.packets.length === 3)
check('deterministic order: customer < paymentTransaction < salesInvoice',
  diary.packets.map((p) => p.table).join(',') === 'customer,paymentTransaction,salesInvoice')

const inv = diary.packets.find((p) => p.table === 'salesInvoice')!
check('header Dates → epoch ms', inv.row.invoiceDate === invoiceDate.getTime() && inv.row.updatedAt === 1781500000000)
check('packet comparator = header updatedAt', inv.updatedAt === 1781500000000)
check('binary column stripped + recorded',
  !('attachmentData' in inv.row) && inv.stripped?.length === 1 && inv.stripped[0] === 'attachmentData')
check('null cancelledAt survives as null', inv.row.cancelledAt === null)
check('both lines inline under salesInvoiceItem', inv.children?.salesInvoiceItem?.length === 2)
check('movement rides under children.stockMovement', inv.children?.stockMovement?.length === 1)
check('child Dates → epoch ms', inv.children?.salesInvoiceItem?.[0].createdAt === invoiceDate.getTime())

const pay = diary.packets.find((p) => p.table === 'paymentTransaction')!
check('payment null updatedAt falls back to createdAt', pay.updatedAt === 1780500000000)

const cust = diary.packets.find((p) => p.table === 'customer')!
check('customer updatedAt used directly', cust.updatedAt === 1781000000000)

console.log('\n2. round-trip + determinism')
const json = JSON.stringify(diary)
const parsed = parseDiary(json)
check('parseDiary accepts own output', parsed.ok)
if (parsed.ok) {
  check('round-trip is lossless', JSON.stringify(parsed.diary) === json)
}
const diary2 = buildDiary({
  device: 'phone-abc',
  now: NOW,
  singles: {
    paymentTransaction: [{ id: 'P1', type: 'PAYMENT_IN', amount: 500, updatedAt: null, createdAt: 1780500000000 }],
    customer: [{ id: 'C1', name: 'Kaju', updatedAt: new Date(1781000000000), createdAt: new Date(1780000000000) }],
  },
  documents: {
    salesInvoice: [{
      header: {
        id: 'I1', invoiceNumber: 'NS/SL/26-27/07', invoiceDate,
        updatedAt: new Date(1781500000000), cancelledAt: null,
        attachmentData: new Uint8Array([1, 2, 3]),
      },
      children: [
        { id: 'L1', salesInvoiceId: 'I1', quantity: 2, rate: 100, createdAt: invoiceDate },
        { id: 'L2', salesInvoiceId: 'I1', quantity: 1, rate: 50, createdAt: invoiceDate },
      ],
      movements: [{ id: 'M1', itemId: 'IT1', quantity: -2, referenceType: 'INVOICE', referenceId: 'I1', createdAt: invoiceDate }],
    }],
  },
})
check('same data (different input order) → byte-identical diary', JSON.stringify(diary2) === json)

console.log('\n3. version gate + malformed input')
const newer = JSON.stringify({ ...diary, v: SYNC_FORMAT_VERSION + 1 })
const gateRes = parseDiary(newer)
check('newer format version → NEWER_VERSION', !gateRes.ok && gateRes.error === 'NEWER_VERSION')
check('garbage → MALFORMED', (() => { const r = parseDiary('not json'); return !r.ok && r.error === 'MALFORMED' })())
check('non-object → MALFORMED', (() => { const r = parseDiary('42'); return !r.ok && r.error === 'MALFORMED' })())
const badPacket = JSON.stringify({ v: 1, device: 'x', generatedAt: NOW, packets: [{ table: 'customer' }] })
check('packet missing rowId/updatedAt → MALFORMED', (() => { const r = parseDiary(badPacket); return !r.ok && r.error === 'MALFORMED' })())

console.log('\n4. toEpochMs')
check('Date → ms', toEpochMs(new Date(123456)) === 123456)
check('number passthrough', toEpochMs(789) === 789)
check('legacy ISO text tolerated', toEpochMs('2026-07-01T10:00:00.000Z') === invoiceDate.getTime())
check('null → null', toEpochMs(null) === null)
check('junk string → null', toEpochMs('not a date') === null)

console.log(`\n=== ${passes} passed, ${failures} failed ===`)
process.exit(failures > 0 ? 1 : 0)
