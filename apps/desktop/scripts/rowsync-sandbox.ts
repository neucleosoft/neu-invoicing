// Two-device sandbox: copies the REAL desktop DB into throwaway A and B, edits
// A like a user would, then syncs A→B through the REAL code path (collectDiary
// → JSON → parseDiary → planApply → executePlan → recomputeAll). No Drive, no
// electron — this proves the executor and serialization against a real schema
// with real data. The live DB is only ever READ.
//
// Fully drizzle since the Prisma→Drizzle migration: staging writes run through
// the SHARED schema (whose $defaultFn/$onUpdate hooks stamp updatedAt + hlc,
// exactly like the app), and the sync path runs the SHARED rowSyncDb code.
// Two simulated devices share one process, so the global hlc stamper is
// re-pointed at whichever device is "typing".
//
// MANUAL dev tool, not CI: it needs the live desktop database on this machine.
//   pnpm sandbox:rowsync
// (The pure engine tests that CI runs live in packages/shared/tests/.)

import fs from 'fs'
import os from 'os'
import path from 'path'
import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import {
  and,
  asc,
  bankAccount,
  bankTransaction,
  buildLocalIndexDb,
  collectDiaryDb,
  createHlcClock,
  customer,
  eq,
  executePlanDb,
  isNull,
  item,
  parseDiary,
  paymentTransaction,
  planApply,
  purchaseBill,
  purchaseBillItem,
  recomputeAllDb,
  salesInvoice,
  salesInvoiceItem,
  setGlobalHlcStamper,
  stockMovement,
  supplier,
  supplierItem,
  type HlcClock,
} from '../../../packages/shared/src/index'

const MONTH_MS = 30 * 24 * 60 * 60 * 1000

async function openSandboxDb(file: string) {
  const client = createClient({ url: `file:${file}` })
  await client.execute('PRAGMA foreign_keys = ON')
  await client.execute('PRAGMA busy_timeout = 10000')
  return { client, db: drizzle(client) }
}

const APPDATA = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
const REAL_DB = path.join(APPDATA, 'neu-invoicing', 'neuinvoicing.db')
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'neu-rowsync-sandbox-'))
const DB_A = path.join(SCRATCH, 'sandbox-A.db')
const DB_B = path.join(SCRATCH, 'sandbox-B.db')

let failures = 0
let passes = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passes++; console.log(`  ok  ${name}`) }
  else { failures++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Point the shared schema's hlc stamper at the device currently "typing" —
// each app process has exactly one device, the sandbox simulates two.
const typingOn = (clock: HlcClock) => setGlobalHlcStamper(() => clock.next())

async function main() {
  if (!fs.existsSync(REAL_DB)) throw new Error(`Real DB not found: ${REAL_DB}`)
  for (const p of [DB_A, DB_B]) {
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      if (fs.existsSync(p + suffix)) fs.unlinkSync(p + suffix)
    }
  }
  fs.copyFileSync(REAL_DB, DB_A)
  fs.copyFileSync(REAL_DB, DB_B)

  // P1: each simulated device gets its own HLC ratchet. Device B's wall clock
  // runs a MONTH BEHIND — the exact skew the HLC upgrade exists to survive.
  const clockA = createHlcClock('sandbox-A')
  const clockB = createHlcClock('sandbox-B', { now: () => Date.now() - MONTH_MS })
  const { client: clientA, db: dbA } = await openSandboxDb(DB_A)
  const { client: clientB, db: dbB } = await openSandboxDb(DB_B)

  // The real DB may predate recent migrations (they apply at next app
  // startup). Bring the sandbox copies up to schema the same way startup will.
  for (const c of [clientA, clientB]) {
    try {
      await c.execute(`ALTER TABLE "PaymentTransaction" ADD COLUMN "updatedAt" DATETIME`)
    } catch { /* already applied */ }
    await c.execute(`UPDATE "PaymentTransaction" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL`)
    await c.execute(`CREATE TABLE IF NOT EXISTS "BankTransaction" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "deletedAt" DATETIME,
      "bankAccountId" TEXT NOT NULL,
      "amount" REAL NOT NULL,
      "description" TEXT,
      "transactionDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
    )`)
    // P1: the hlc column (migration 20260718102539) — the live DB may predate it.
    for (const t of ['Party', 'Supplier', 'SupplierItem', 'Item', 'SalesInvoice', 'Quotation', 'ProformaInvoice', 'PurchaseBill', 'PurchaseOrder', 'PaymentTransaction', 'DeliveryChallan', 'CreditDebitNote', 'BankAccount', 'BankTransaction', 'PreviousInvoice']) {
      try {
        await c.execute(`ALTER TABLE "${t}" ADD COLUMN "hlc" TEXT`)
      } catch { /* already applied */ }
    }
  }

  // ── stage edits ─────────────────────────────────────────────────────────
  console.log('\nStaging: user activity on both devices while offline')

  // Device B creates an invoice numbered SBX-TEST-001 FIRST (earlier createdAt).
  typingOn(clockB)
  const [anyCustomerB] = await dbB.select().from(customer).where(isNull(customer.deletedAt)).limit(1)
  const [invB] = await dbB
    .insert(salesInvoice)
    .values({
      invoiceNumber: 'SBX-TEST-001', invoiceDate: new Date(), type: 'INVOICE',
      customerId: anyCustomerB!.id, subtotal: 50, taxAmount: 0, totalAmount: 50,
      amountPaid: 0, balanceDue: 50, status: 'DRAFT', discount: 0,
    })
    .returning()
  await sleep(20)

  // Device A: a brand-new customer…
  typingOn(clockA)
  const [custA] = await dbA
    .insert(customer)
    .values({ name: 'SANDBOX SYNC CUSTOMER', type: 'CUSTOMER', openingBalance: 0, currentBalance: 0 })
    .returning()
  // …an edit to an existing invoice…
  const [editable] = await dbA
    .select()
    .from(salesInvoice)
    .where(and(eq(salesInvoice.type, 'INVOICE'), isNull(salesInvoice.cancelledAt), isNull(salesInvoice.deletedAt)))
    .orderBy(asc(salesInvoice.createdAt))
    .limit(1)
  await dbA.update(salesInvoice).set({ notes: 'sandbox-edited' }).where(eq(salesInvoice.id, editable!.id))
  // …and a LATER invoice that collides on SBX-TEST-001, with a line + movement.
  const [anyItemA] =
    (await dbA.select().from(item).where(and(isNull(item.deletedAt), eq(item.trackStock, true))).limit(1)).length > 0
      ? await dbA.select().from(item).where(and(isNull(item.deletedAt), eq(item.trackStock, true))).limit(1)
      : await dbA.select().from(item).where(isNull(item.deletedAt)).limit(1)
  const [invA] = await dbA
    .insert(salesInvoice)
    .values({
      invoiceNumber: 'SBX-TEST-001', invoiceDate: new Date(), type: 'INVOICE',
      customerId: custA.id, subtotal: 100, taxAmount: 18, totalAmount: 118,
      amountPaid: 0, balanceDue: 118, status: 'DRAFT', discount: 0,
    })
    .returning()
  await dbA.insert(salesInvoiceItem).values({
    salesInvoiceId: invA.id, itemId: anyItemA!.id, quantity: 1, rate: 100,
    discount: 0, taxRate: 18, total: 118, taxableAmount: 100,
  })
  await dbA.insert(stockMovement).values({
    itemId: anyItemA!.id, movementType: 'SALE', quantity: -1,
    referenceType: 'INVOICE', referenceId: invA.id,
  })

  // Review-bug F1: the full FK dependency chain born offline in ONE diary —
  // supplier → supplierItem → bill(+line) → linked payment. Alphabetical apply
  // order used to insert the payment/bill BEFORE the supplier and roll back
  // the whole sync on desktop's enforced foreign keys.
  const [supA] = await dbA
    .insert(supplier)
    .values({ name: 'SBX SUPPLIER', openingBalance: 0, currentBalance: 0 })
    .returning()
  const [siA] = await dbA
    .insert(supplierItem)
    .values({ supplierId: supA.id, name: 'SBX WIDGET', unit: 'pcs', lastPurchasePrice: 100, defaultTaxRate: 0 })
    .returning()
  const [billA] = await dbA
    .insert(purchaseBill)
    .values({
      billNumber: 'SBX-BILL-001', billDate: new Date(), supplierId: supA.id,
      subtotal: 100, discount: 0, taxAmount: 0, totalAmount: 100,
      amountPaid: 40, balanceDue: 60, status: 'PARTIAL',
    })
    .returning()
  await dbA.insert(purchaseBillItem).values({
    purchaseBillId: billA.id, supplierItemId: siA.id, quantity: 1, rate: 100,
    discount: 0, taxRate: 0, total: 100, taxableAmount: 100,
  })
  await dbA.insert(paymentTransaction).values({
    type: 'PAYMENT_OUT', supplierId: supA.id, amount: 40, paymentMode: 'CASH',
    paymentDate: new Date(), referenceType: 'BILL', purchaseBillId: billA.id,
    notes: 'Paid with bill',
  })

  // Review-bug F2 mirror: A mints SBX-LOCAL-001 FIRST; B mints its own
  // SBX-LOCAL-001 LATER → the planner must renumber B's LOCAL doc, and the
  // executor must do that BEFORE inserting A's (UNIQUE fires at statement time).
  const [invA2] = await dbA
    .insert(salesInvoice)
    .values({
      invoiceNumber: 'SBX-LOCAL-001', invoiceDate: new Date(), type: 'INVOICE',
      customerId: custA.id, subtotal: 10, taxAmount: 0, totalAmount: 10,
      amountPaid: 0, balanceDue: 10, status: 'DRAFT', discount: 0,
    })
    .returning()
  await sleep(20)
  typingOn(clockB)
  const [invB2] = await dbB
    .insert(salesInvoice)
    .values({
      invoiceNumber: 'SBX-LOCAL-001', invoiceDate: new Date(), type: 'INVOICE',
      customerId: anyCustomerB!.id, subtotal: 5, taxAmount: 0, totalAmount: 5,
      amountPaid: 0, balanceDue: 5, status: 'DRAFT', discount: 0,
    })
    .returning()

  // P3 bank journals: A creates an account with an opening journal + one
  // adjustment — B must receive account + both journals, and recompute must
  // land the balance purely from the replay.
  typingOn(clockA)
  const [bankA] = await dbA
    .insert(bankAccount)
    .values({ name: 'SBX BANK', type: 'BANK', currentBalance: 300 })
    .returning()
  await dbA.insert(bankTransaction).values({
    id: `open-${bankA.id}`, bankAccountId: bankA.id, amount: 500, description: 'Opening balance',
  })
  await dbA.insert(bankTransaction).values({
    bankAccountId: bankA.id, amount: -200, description: 'Manual adjustment',
  })

  // ── sync A → B through the real pipeline ────────────────────────────────
  console.log('\nSync A → B (collect → JSON → parse → plan → execute)')
  const diaryA = await collectDiaryDb(dbA, 'sandbox-A', Date.now())
  const parsed = parseDiary(JSON.stringify(diaryA))
  check('diary survives JSON round-trip', parsed.ok)
  if (!parsed.ok) throw new Error('diary parse failed')

  // Mirror rowSyncNow: the puller feeds every peer stamp into its ratchet
  // BEFORE planning, so its own next stamps order above everything seen.
  for (const p of parsed.diary.packets) clockB.observe(p.row?.hlc)
  const localB = await buildLocalIndexDb(dbB)
  const plan = planApply(parsed.diary.packets, localB, Date.now(), () => clockB.next())
  check('plan renumbers the later-created incoming invoice',
    plan.log.some((l) => l.kind === 'RENUMBER_INCOMING'))
  check('plan renumbers the later-created LOCAL invoice (F2)',
    plan.localRenumbers.some((r) => r.rowId === invB2.id && r.to === 'SBX-LOCAL-002'))
  const tables = plan.upserts.map((u) => u.table)
  check('plan orders supplier before bill before payment (F1)',
    tables.indexOf('supplier') < tables.indexOf('purchaseBill') &&
    tables.indexOf('purchaseBill') < tables.indexOf('paymentTransaction'),
    tables.join(','))
  // The schema's $onUpdate(hlcStamp) is what stamps renumbers — B is applying.
  typingOn(clockB)
  await executePlanDb(dbB, plan)

  // ── assertions on B ─────────────────────────────────────────────────────
  console.log('\nAssertions on device B')
  const [custOnB] = await dbB.select().from(customer).where(eq(customer.id, custA.id)).limit(1)
  check('new customer arrived on B', custOnB?.name === 'SANDBOX SYNC CUSTOMER')

  const [editedOnB] = await dbB.select().from(salesInvoice).where(eq(salesInvoice.id, editable!.id)).limit(1)
  check('invoice edit arrived on B', editedOnB?.notes === 'sandbox-edited')

  const [invAOnB] = await dbB.select().from(salesInvoice).where(eq(salesInvoice.id, invA.id)).limit(1)
  check("A's colliding invoice arrived renumbered to SBX-TEST-002",
    invAOnB?.invoiceNumber === 'SBX-TEST-002', `got ${invAOnB?.invoiceNumber}`)

  const [invBStill] = await dbB.select().from(salesInvoice).where(eq(salesInvoice.id, invB.id)).limit(1)
  check("B's earlier invoice keeps SBX-TEST-001", invBStill?.invoiceNumber === 'SBX-TEST-001')

  const linesOnB = await dbB.select().from(salesInvoiceItem).where(eq(salesInvoiceItem.salesInvoiceId, invA.id))
  check('line items arrived with the doc', linesOnB.length === 1 && linesOnB[0].total === 118)

  const movesOnB = await dbB
    .select()
    .from(stockMovement)
    .where(and(eq(stockMovement.referenceType, 'INVOICE'), eq(stockMovement.referenceId, invA.id)))
  check('stock movement arrived with the doc', movesOnB.length === 1 && movesOnB[0].quantity === -1)

  // F1 chain arrived intact?
  const [supOnB] = await dbB.select().from(supplier).where(eq(supplier.id, supA.id)).limit(1)
  const billItemsOnB = await dbB.select().from(purchaseBillItem).where(eq(purchaseBillItem.purchaseBillId, billA.id))
  const billPaymentsOnB = await dbB.select().from(paymentTransaction).where(eq(paymentTransaction.purchaseBillId, billA.id))
  check('new supplier arrived on B (F1)', supOnB?.name === 'SBX SUPPLIER')
  check('bill + line + linked payment arrived on B (F1)',
    billItemsOnB.length === 1 && billPaymentsOnB.length === 1 && billPaymentsOnB[0].amount === 40)

  // F2 outcome: B's own later doc renumbered, A's earlier doc keeps the number.
  const [invB2After] = await dbB.select().from(salesInvoice).where(eq(salesInvoice.id, invB2.id)).limit(1)
  const [invA2OnB] = await dbB.select().from(salesInvoice).where(eq(salesInvoice.id, invA2.id)).limit(1)
  check("B's later local invoice renumbered to SBX-LOCAL-002 (F2)",
    invB2After?.invoiceNumber === 'SBX-LOCAL-002', `got ${invB2After?.invoiceNumber}`)
  check("A's earlier invoice arrived keeping SBX-LOCAL-001 (F2)",
    invA2OnB?.invoiceNumber === 'SBX-LOCAL-001', `got ${invA2OnB?.invoiceNumber}`)

  // ── recompute B end-to-end ──────────────────────────────────────────────
  await recomputeAllDb(dbB, { apply: true })
  const [custAfter] = await dbB.select().from(customer).where(eq(customer.id, custA.id)).limit(1)
  check('recompute lands the synced customer balance at ₹128 (118 + 10)',
    Math.abs((custAfter?.currentBalance ?? 0) - 128) < 0.01, `got ${custAfter?.currentBalance}`)
  const [supAfter] = await dbB.select().from(supplier).where(eq(supplier.id, supA.id)).limit(1)
  check('recompute lands the synced supplier balance at ₹60 (100 − 40)',
    Math.abs((supAfter?.currentBalance ?? 0) - 60) < 0.01, `got ${supAfter?.currentBalance}`)

  const bankTxnsOnB = await dbB.select().from(bankTransaction).where(eq(bankTransaction.bankAccountId, bankA.id))
  check('bank account + both journal rows arrived on B (P3)', bankTxnsOnB.length === 2)
  const [bankAfter] = await dbB.select().from(bankAccount).where(eq(bankAccount.id, bankA.id)).limit(1)
  check('recompute lands the bank balance at ₹300 from the journal replay (P3)',
    Math.abs((bankAfter?.currentBalance ?? 0) - 300) < 0.01, `got ${bankAfter?.currentBalance}`)

  // ── idempotency: sync the SAME diary again ──────────────────────────────
  console.log('\nIdempotency: applying the same diary again')
  const localB2 = await buildLocalIndexDb(dbB)
  const plan2 = planApply(parsed.diary.packets, localB2, Date.now(), () => clockB.next())
  check('second apply is a no-op (everything skips)', plan2.upserts.length === 0,
    `upserts=${plan2.upserts.length} sample=${JSON.stringify(plan2.upserts.slice(0, 2).map((u) => [u.table, u.rowId]))}`)
  check('no repeat renumbering', plan2.localRenumbers.length === 0 && !plan2.log.some((l) => l.kind.startsWith('RENUMBER')))

  // ── P1: HLC stamps through the real pipeline ────────────────────────────
  console.log('\nP1 HLC: stamping, preservation, and the backdated-clock story')

  // The shared schema's $defaultFn stamped A's inserts at write time.
  const [custOnA] = await dbA.select().from(customer).where(eq(customer.id, custA.id)).limit(1)
  check('schema hook stamped the new customer with a device-A hlc',
    typeof custOnA?.hlc === 'string' && custOnA.hlc.endsWith('sandbox-A'), `got ${custOnA?.hlc}`)

  // Apply + recompute both PRESERVED the stamp bit-for-bit on B (executor
  // writes the packet's hlc; recompute passes updatedAt+hlc explicitly).
  const [custPreserved] = await dbB.select().from(customer).where(eq(customer.id, custA.id)).limit(1)
  check("apply + recompute preserved A's stamp on B bit-for-bit", custPreserved?.hlc === custOnA?.hlc,
    `A=${custOnA?.hlc} B=${custPreserved?.hlc}`)

  // The F2 renumber on B re-stamped the renumbered LOCAL doc ABOVE its
  // creation stamp, so the renumber outranks the original everywhere.
  check('local renumber minted a fresh, higher device-B stamp',
    typeof invB2After?.hlc === 'string' &&
    invB2After.hlc.endsWith('sandbox-B') &&
    (invB2.hlc == null || invB2After.hlc > invB2.hlc),
    `created=${invB2.hlc} renumbered=${invB2After?.hlc}`)

  // User edits inside transactions get stamped too — every doc handler
  // writes inside db.transaction(async tx => …).
  typingOn(clockA)
  await dbA.transaction(async (tx) => {
    await tx.update(customer).set({ city: 'SBX-ITX' }).where(eq(customer.id, custA.id))
  })
  const [custAfterItx] = await dbA.select().from(customer).where(eq(customer.id, custA.id)).limit(1)
  check('schema hook stamps inside transactions',
    typeof custAfterItx?.hlc === 'string' && custAfterItx.hlc !== custOnA?.hlc, `got ${custAfterItx?.hlc}`)

  // ── the headline story: a month-backdated clock still wins ──────────────
  // A's transactional edit above is the customer's latest state. Ship it to
  // B, then B — wall clock a MONTH BEHIND — edits the same customer. Under
  // pure updatedAt ordering, B's edit is "a month older" than what A already
  // has and would be silently discarded. The hlc (ratcheted past A's stamps
  // at pull time) must carry it back and WIN on A.
  const diaryA2 = await collectDiaryDb(dbA, 'sandbox-A', Date.now())
  for (const p of diaryA2.packets) clockB.observe(p.row?.hlc)
  const planB2 = planApply(diaryA2.packets, await buildLocalIndexDb(dbB), Date.now(), () => clockB.next())
  typingOn(clockB)
  await executePlanDb(dbB, planB2)

  await dbB.update(customer).set({ billingAddress: 'edited on the backdated device' }).where(eq(customer.id, custA.id))
  // The schema's $onUpdate(now) stamped the REAL process clock — rewrite it to
  // what a month-behind wall clock would have written. (The hlc came from B's
  // ratchet, exactly as it would on the skewed device.)
  await clientB.execute({
    sql: `UPDATE "Party" SET "updatedAt" = ? WHERE "id" = ?`,
    args: [Date.now() - 40 * 24 * 60 * 60 * 1000, custA.id],
  })

  // 40 days puts the edit OUTSIDE the 30-day updatedAt window — under the old
  // filter this edit would never even be PUSHED. The hlc window must carry it.
  const diaryB = await collectDiaryDb(dbB, 'sandbox-B', Date.now())
  check('hlc window keeps a 40-day-backdated edit in the diary',
    diaryB.packets.some((p) => p.table === 'customer' && p.rowId === custA.id))

  for (const p of diaryB.packets) clockA.observe(p.row?.hlc)
  const planA = planApply(diaryB.packets, await buildLocalIndexDb(dbA), Date.now(), () => clockA.next())
  typingOn(clockA)
  await executePlanDb(dbA, planA)
  const [custBackOnA] = await dbA.select().from(customer).where(eq(customer.id, custA.id)).limit(1)
  check('backdated-clock edit WON on A — hlc beat a month-newer updatedAt',
    custBackOnA?.billingAddress === 'edited on the backdated device',
    `got ${custBackOnA?.billingAddress}`)

  setGlobalHlcStamper(null)
  clientA.close()
  clientB.close()

  console.log(`\n=== ${passes} passed, ${failures} failed ===`)
  process.exit(failures > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
