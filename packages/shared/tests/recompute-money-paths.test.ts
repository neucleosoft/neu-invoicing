// Verification harness for the 2026-07-11 fix wave.
//
// Replays the NEW live write-path logic (transcribed operation-for-operation
// from the edited handlers) as plain object mutations, then asserts the shared
// recompute engine rebuilds EXACTLY the same numbers. Any disagreement = a
// write path that would corrupt data the first time recompute-after-merge runs.

import {
  computeGstValues,
  applyPurchaseTaxOverride,
} from '../src/gstCompute'
import {
  recomputeSupplierBalances,
  recomputeBillStates,
  recomputeCustomerBalances,
  recomputeInvoiceStates,
} from '../src/recompute'
import {
  runRecomputeDiff,
} from '../src/recomputeReport'

let failures = 0
let passes = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passes++; console.log(`  ok  ${name}`) }
  else { failures++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
const approx = (a: number, b: number) => Math.abs(a - b) < 1e-9
const paymentStatus = (total: number, paid: number) =>
  total - paid <= 0 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'DRAFT'

const companyMH = { stateCode: '27', stateName: 'Maharashtra' }
const supplierMH = { taxId: '27ABCDE1234F1Z5', stateCode: '27', stateName: 'Maharashtra' }
const supplierDL = { taxId: '07ABCDE1234F1Z5', stateCode: '07', stateName: 'Delhi' }

// ── A. applyPurchaseTaxOverride unit behavior ────────────────────────────────
console.log('\nA. applyPurchaseTaxOverride')
{
  const base = computeGstValues({
    company: companyMH, party: supplierMH,
    items: [{ quantity: 2, rate: 100, discount: 0, taxRate: 0 }],
  })
  // subtotal 200, computed tax 0 (line rates 0 — the OCR bottom-line case)
  check('baseline: subtotal 200, tax 0', approx(base.subtotal, 200) && approx(base.taxAmount, 0))

  const none = applyPurchaseTaxOverride(base, { taxAmount: undefined })
  check('no override → result unchanged', none === base)

  const intra = applyPurchaseTaxOverride(base, { taxAmount: 36 })
  check('intra-state override 36 → CGST 18 / SGST 18 / IGST 0',
    approx(intra.totalCgst, 18) && approx(intra.totalSgst, 18) && approx(intra.totalIgst, 0))
  check('override sets taxAmount 36, totalAmount 236',
    approx(intra.taxAmount, 36) && approx(intra.totalAmount, 236))

  const baseInter = computeGstValues({
    company: companyMH, party: supplierDL,
    items: [{ quantity: 2, rate: 100, discount: 0, taxRate: 0 }],
  })
  const inter = applyPurchaseTaxOverride(baseInter, { taxAmount: 36 })
  check('inter-state override 36 → all IGST',
    approx(inter.totalIgst, 36) && approx(inter.totalCgst, 0) && approx(inter.totalSgst, 0))

  const explicit = applyPurchaseTaxOverride(base, { taxAmount: 36, cgstAmount: 20, sgstAmount: 16 })
  check('explicit OCR split wins over state split',
    approx(explicit.totalCgst, 20) && approx(explicit.totalSgst, 16) && approx(explicit.totalIgst, 0))

  const withDisc = applyPurchaseTaxOverride(
    computeGstValues({
      company: companyMH, party: supplierMH,
      items: [{ quantity: 2, rate: 100, discount: 0, taxRate: 0 }],
      docDiscount: 50,
    }),
    { taxAmount: 36 },
  )
  check('doc discount recovered through override: total = 200 + 36 − 50 = 186',
    approx(withDisc.totalAmount, 186))

  const zeroOverride = applyPurchaseTaxOverride(base, { taxAmount: 0 })
  check('override 0 is honored (tax-free bill stays 0)', approx(zeroOverride.taxAmount, 0) && approx(zeroOverride.totalAmount, 200))

  // Normalization of physically-impossible splits (reviewer finding 3):
  // desktop's scan UI buckets a bare bottom-line tax under IGST — intra-state,
  // that split is illegal and must land exactly where mobile's bare-total does.
  const desktopBucket = applyPurchaseTaxOverride(base, { taxAmount: 36, igstAmount: 36 })
  const mobileBare = applyPurchaseTaxOverride(base, { taxAmount: 36 })
  check('intra-state pure-IGST bucket normalized to CGST/SGST halves',
    approx(desktopBucket.totalCgst, 18) && approx(desktopBucket.totalSgst, 18) && approx(desktopBucket.totalIgst, 0))
  check('desktop bucket and mobile bare-total now store IDENTICAL splits',
    approx(desktopBucket.totalCgst, mobileBare.totalCgst) &&
    approx(desktopBucket.totalSgst, mobileBare.totalSgst) &&
    approx(desktopBucket.totalIgst, mobileBare.totalIgst) &&
    approx(desktopBucket.totalAmount, mobileBare.totalAmount))

  const baseInter2 = computeGstValues({
    company: companyMH, party: supplierDL,
    items: [{ quantity: 2, rate: 100, discount: 0, taxRate: 0 }],
  })
  const wrongWay = applyPurchaseTaxOverride(baseInter2, { taxAmount: 36, cgstAmount: 18, sgstAmount: 18 })
  check('inter-state CGST/SGST-only split normalized to all IGST',
    approx(wrongWay.totalIgst, 36) && approx(wrongWay.totalCgst, 0) && approx(wrongWay.totalSgst, 0))

  const mixed = applyPurchaseTaxOverride(base, { taxAmount: 36, cgstAmount: 18, sgstAmount: 18 })
  check('legal explicit split passes through untouched',
    approx(mixed.totalCgst, 18) && approx(mixed.totalSgst, 18) && approx(mixed.totalIgst, 0))
}

// ── B. New purchase create (up-front payment) vs engine ─────────────────────
console.log('\nB. Purchase create with up-front payment vs engine')
{
  const gst = applyPurchaseTaxOverride(
    computeGstValues({
      company: companyMH, party: supplierMH,
      items: [
        { quantity: 2, rate: 100, discount: 0, taxRate: 18 },
        { quantity: 1, rate: 50, discount: 0, taxRate: 0 },
      ],
    }),
    { taxAmount: undefined },
  )
  const T = gst.totalAmount // 250 + 36 = 286
  const paid = 118

  // live path (new create):
  const supplier = { id: 'S1', openingBalance: 0, currentBalance: 0 }
  const bill = {
    id: 'B1', supplierId: 'S1', totalAmount: T,
    amountPaid: paid, balanceDue: T - paid,
    status: paymentStatus(T, paid),
    deletedAt: null, cancelledAt: null,
  }
  supplier.currentBalance += bill.balanceDue
  const payment = {
    id: 'P1', type: 'PAYMENT_OUT', customerId: null, supplierId: 'S1',
    salesInvoiceId: null, purchaseBillId: 'B1', amount: paid,
    deletedAt: null, cancelledAt: null as Date | null,
  }

  // engine rebuild:
  const supBal = recomputeSupplierBalances([supplier], [bill], [payment])
  const billState = recomputeBillStates([bill], [payment])
  check('supplier balance: live == engine', approx(supplier.currentBalance, supBal.get('S1')!),
    `live ${supplier.currentBalance} vs engine ${supBal.get('S1')}`)
  check('bill amountPaid: stored == engine', approx(bill.amountPaid, billState.get('B1')!.amountPaid))
  check('bill balanceDue: stored == engine', approx(bill.balanceDue, billState.get('B1')!.balanceDue))
  check('bill status: stored == engine', bill.status === billState.get('B1')!.status,
    `stored ${bill.status} vs engine ${billState.get('B1')!.status}`)

  // ── C. New purchase cancel (reverse payments first) vs engine ─────────────
  console.log('\nC. Purchase cancel of the paid bill vs engine')
  // live path (new cancel): reverse each active linked payment...
  // reversePayment(PAYMENT_OUT): supplier.currentBalance += amount; bill paid/balance/status recompute
  supplier.currentBalance += payment.amount
  bill.amountPaid -= payment.amount
  bill.balanceDue = bill.totalAmount - bill.amountPaid
  bill.status = paymentStatus(bill.totalAmount, bill.amountPaid)
  payment.cancelledAt = new Date()
  // ...then reverse the refreshed balanceDue and stamp the bill:
  supplier.currentBalance -= bill.balanceDue
  ;(bill as any).cancelledAt = new Date()

  const supBal2 = recomputeSupplierBalances([supplier], [bill], [payment])
  check('after cancel: supplier back to opening (0), live == engine',
    approx(supplier.currentBalance, 0) && approx(supBal2.get('S1')!, 0),
    `live ${supplier.currentBalance} vs engine ${supBal2.get('S1')}`)
}

// ── D. Credit note nets an invoice → status PAID, matches engine ────────────
console.log('\nD. Credit note nets invoice vs engine')
{
  const customer = { id: 'C1', openingBalance: 0, currentBalance: 0 }
  const inv = {
    id: 'I1', customerId: 'C1', totalAmount: 118, amountPaid: 0, balanceDue: 118,
    status: 'DRAFT', deletedAt: null, cancelledAt: null,
  }
  customer.currentBalance += 118 // live invoice create (unpaid)

  // live CN create (new mobile logic == desktop): sign −1, balanceDue −118, status rule
  const note = {
    type: 'CREDIT_NOTE', customerId: 'C1', referenceInvoiceId: 'I1',
    totalAmount: 118, status: 'ACTIVE', deletedAt: null, cancelledAt: null,
  }
  customer.currentBalance += -1 * 118
  const newBalanceDue = inv.balanceDue - 118
  inv.balanceDue = newBalanceDue
  inv.status = newBalanceDue <= 0 ? 'PAID' : inv.amountPaid > 0 ? 'PARTIAL' : inv.status

  const custBal = recomputeCustomerBalances([customer], [inv], [], [note])
  const invState = recomputeInvoiceStates([inv], [], [note])
  check('customer balance: live == engine == 0',
    approx(customer.currentBalance, 0) && approx(custBal.get('C1')!, 0))
  check('invoice balanceDue: stored == engine == 0',
    approx(inv.balanceDue, 0) && approx(invState.get('I1')!.balanceDue, 0))
  check('invoice status: stored PAID == engine',
    inv.status === 'PAID' && invState.get('I1')!.status === 'PAID',
    `stored ${inv.status} vs engine ${invState.get('I1')!.status}`)
}

// ── E. Doc-level discount flows into totals and customer balance ────────────
console.log('\nE. Doc discount on an invoice vs engine')
{
  const gst = computeGstValues({
    company: companyMH, party: supplierMH,
    items: [{ quantity: 2, rate: 100, discount: 0, taxRate: 18 }],
    docDiscount: 20,
  })
  check('totalAmount = 200 + 36 − 20 = 216', approx(gst.totalAmount, 216))

  const customer = { id: 'C2', openingBalance: 0, currentBalance: 0 }
  const inv = {
    id: 'I2', customerId: 'C2', totalAmount: gst.totalAmount, amountPaid: 0,
    balanceDue: gst.totalAmount, status: 'DRAFT', deletedAt: null, cancelledAt: null,
  }
  customer.currentBalance += gst.totalAmount
  const custBal = recomputeCustomerBalances([customer], [inv], [], [])
  check('customer balance with discounted invoice: live == engine',
    approx(customer.currentBalance, custBal.get('C2')!))
}

// ── F. runRecomputeDiff wiring sanity ────────────────────────────────────────
console.log('\nF. runRecomputeDiff (shared wrapper plumbing)')
{
  const rows = {
    customers: [{ id: 'C1', name: 'Cust', openingBalance: 0, currentBalance: 100 }],
    suppliers: [] as any[],
    invoices: [{ id: 'I1', invoiceNumber: 'INV-1', customerId: 'C1', totalAmount: 100, amountPaid: 0, balanceDue: 100, status: 'DRAFT', deletedAt: null, cancelledAt: null }],
    bills: [] as any[],
    payments: [] as any[],
    notes: [] as any[],
    stockAvailable: true,
    items: [{ id: 'IT1', name: 'Widget', openingStock: 5, currentStock: 3 }],
    movements: [{ itemId: 'IT1', quantity: -2 }],
    // Bank journals (P3): opening 100 + adjustment −30 must land at the
    // stored 70 for the aligned case to stay clean.
    bankAccounts: [{ id: 'B1', name: 'Cash', currentBalance: 70 }],
    bankTxns: [
      { bankAccountId: 'B1', amount: 100, deletedAt: null },
      { bankAccountId: 'B1', amount: -30, deletedAt: null },
    ],
  }
  const clean = runRecomputeDiff(rows as any)
  check('aligned data → 0 changes', clean.totalChanges === 0,
    `got ${clean.totalChanges}: ${JSON.stringify(clean.sections.filter(s => s.changes.length))}`)

  const drifted = runRecomputeDiff({ ...rows, customers: [{ ...rows.customers[0], currentBalance: 150 }] } as any)
  check('one drifted balance → exactly 1 change in Customer balance',
    drifted.totalChanges === 1 && drifted.sections[0].changes.length === 1)

  const overdue = runRecomputeDiff({
    ...rows,
    invoices: [{ ...rows.invoices[0], status: 'OVERDUE' }],
  } as any)
  check('stored OVERDUE rebuilding to DRAFT is benign (0 changes)', overdue.totalChanges === 0)

  // Bank drift: a stored balance the journal can't explain gets flagged; a
  // soft-deleted journal row stops counting.
  const bankDrift = runRecomputeDiff({
    ...rows,
    bankAccounts: [{ id: 'B1', name: 'Cash', currentBalance: 999 }],
  } as any)
  check('bank balance drift → 1 change in Bank balance section',
    bankDrift.totalChanges === 1 && bankDrift.sections.some((s) => s.title === 'Bank balance' && s.changes.length === 1))
  const bankDeleted = runRecomputeDiff({
    ...rows,
    bankAccounts: [{ id: 'B1', name: 'Cash', currentBalance: 100 }],
    bankTxns: [
      { bankAccountId: 'B1', amount: 100, deletedAt: null },
      { bankAccountId: 'B1', amount: -30, deletedAt: 123456 },
    ],
  } as any)
  check('soft-deleted journal rows do not count', bankDeleted.totalChanges === 0)
}

console.log(`\n=== ${passes} passed, ${failures} failed ===`)
process.exit(failures > 0 ? 1 : 0)
