// The recompute engine — the heart of device sync.
//
// After a device merges rows from another device (newest-edit-wins), the app's STORED
// running totals can be wrong: the other device's invoices/payments weren't counted in
// THIS device's balances. Rather than try to merge counters (impossible — two devices
// each did "+5" to a balance, you can't reconcile that), we throw the stored totals away
// and REBUILD them from the raw documents. A number rebuilt from rows can never drift.
//
// These are PURE functions — no DB, no I/O. They take plain row arrays and return the
// rebuilt numbers. Each app (desktop/Prisma, mobile/Drizzle) fetches its own rows, maps
// them to these shapes, calls these functions, and writes the results back in one
// transaction. ONE implementation, identical math on both ends → the two can never disagree.
//
// What this engine OWNS (rebuildable from rows):
//   • customer.currentBalance / supplier.currentBalance
//   • salesInvoice / purchaseBill: amountPaid, balanceDue, status
//   • item.currentStock  — REQUIRES an `openingStock` field on item (mirror of party
//     `openingBalance`); the opening is typed at create with no movement behind it, so
//     without that field the typed opening can't be separated from the movement replay.
//
// What it does NOT own (no event trail — left to plain newest-edit-wins sync):
//   • bankAccount.currentBalance — a manually-typed/adjusted figure with no document
//     behind each change. Isolated: it feeds no other number. ("Journals later" = the fix.)

// --- ORM-agnostic input shapes (the caller maps its Prisma/Drizzle rows to these) ---

type Stamp = Date | number | null | undefined

export interface RParty { id: string; openingBalance: number }
export interface RInvoice { id: string; customerId: string; totalAmount: number; status: string; deletedAt: Stamp; cancelledAt: Stamp }
export interface RBill { id: string; supplierId: string; totalAmount: number; status: string; deletedAt: Stamp; cancelledAt: Stamp }
export interface RPayment { type: string; customerId: string | null; supplierId: string | null; salesInvoiceId: string | null; purchaseBillId: string | null; amount: number; deletedAt: Stamp; cancelledAt: Stamp }
export interface RNote { type: string; customerId: string; referenceInvoiceId: string | null; totalAmount: number; status: string; deletedAt: Stamp; cancelledAt: Stamp }
export interface RItem { id: string; openingStock: number }
export interface RMovement { itemId: string; quantity: number }

export interface DocState { amountPaid: number; balanceDue: number; status: string }

// A row counts only if it's neither archived (deletedAt) nor cancelled (cancelledAt).
// `== null` deliberately matches BOTH null and undefined.
const active = (r: { deletedAt: Stamp; cancelledAt: Stamp }) => r.deletedAt == null && r.cancelledAt == null
// A credit/debit note must ALSO be status ACTIVE to count.
const activeNote = (n: RNote) => active(n) && n.status === 'ACTIVE'

const bump = (m: Map<string, number>, key: string, delta: number) => m.set(key, (m.get(key) ?? 0) + delta)

// --- 1. Party balances ------------------------------------------------------------
// Customer owes us = openingBalance + Σ(their invoices) − Σ(their payments-in)
//                    − Σ(their credit notes) + Σ(their debit notes), active rows only.
// A REVERSED invoice stays active, so its total counts (+); its auto credit-note counts
// (−). They cancel to zero here automatically — the engine never needs to know "reversed".
export function recomputeCustomerBalances(
  customers: RParty[], invoices: RInvoice[], payments: RPayment[], notes: RNote[],
): Map<string, number> {
  const bal = new Map<string, number>()
  for (const c of customers) bal.set(c.id, c.openingBalance)
  for (const inv of invoices) if (active(inv)) bump(bal, inv.customerId, inv.totalAmount)
  for (const p of payments) if (p.type === 'PAYMENT_IN' && p.customerId && active(p)) bump(bal, p.customerId, -p.amount)
  for (const n of notes) if (activeNote(n)) bump(bal, n.customerId, n.type === 'CREDIT_NOTE' ? -n.totalAmount : n.totalAmount)
  return bal
}

// Supplier: we owe = openingBalance + Σ(their bills) − Σ(payments-out). No CN/DN supplier-side.
export function recomputeSupplierBalances(
  suppliers: RParty[], bills: RBill[], payments: RPayment[],
): Map<string, number> {
  const bal = new Map<string, number>()
  for (const s of suppliers) bal.set(s.id, s.openingBalance)
  for (const b of bills) if (active(b)) bump(bal, b.supplierId, b.totalAmount)
  for (const p of payments) if (p.type === 'PAYMENT_OUT' && p.supplierId && active(p)) bump(bal, p.supplierId, -p.amount)
  return bal
}

// --- 2. Per-document paid / owed / status -----------------------------------------
// amountPaid = Σ(active payments linked to this doc). balanceDue = total − paid − credit
// notes against it. status: PAID once balance ≤ 0, PARTIAL once any payment, else DRAFT.
// REVERSED is terminal — preserved with balanceDue 0 (the sale was undone; its CN nets it).
// NOTE: OVERDUE is intentionally NOT produced here — it's derived at display time from the
// due date (deriveDisplayStatus), so the engine normalises a stored OVERDUE back to DRAFT;
// the UI still shows "Overdue".
export function recomputeInvoiceStates(
  invoices: RInvoice[], payments: RPayment[], notes: RNote[],
): Map<string, DocState> {
  const paidByInv = new Map<string, number>()
  for (const p of payments) if (p.type === 'PAYMENT_IN' && p.salesInvoiceId && active(p)) bump(paidByInv, p.salesInvoiceId, p.amount)

  const creditByInv = new Map<string, number>()
  for (const n of notes) if (n.referenceInvoiceId && activeNote(n)) bump(creditByInv, n.referenceInvoiceId, n.type === 'CREDIT_NOTE' ? n.totalAmount : -n.totalAmount)

  const out = new Map<string, DocState>()
  for (const inv of invoices) {
    const amountPaid = paidByInv.get(inv.id) ?? 0
    if (inv.status === 'REVERSED') { out.set(inv.id, { amountPaid, balanceDue: 0, status: 'REVERSED' }); continue }
    const balanceDue = inv.totalAmount - amountPaid - (creditByInv.get(inv.id) ?? 0)
    const status = balanceDue <= 0 ? 'PAID' : amountPaid > 0 ? 'PARTIAL' : 'DRAFT'
    out.set(inv.id, { amountPaid, balanceDue, status })
  }
  return out
}

// Bills: same, supplier-side, no credit notes.
export function recomputeBillStates(bills: RBill[], payments: RPayment[]): Map<string, DocState> {
  const paidByBill = new Map<string, number>()
  for (const p of payments) if (p.type === 'PAYMENT_OUT' && p.purchaseBillId && active(p)) bump(paidByBill, p.purchaseBillId, p.amount)

  const out = new Map<string, DocState>()
  for (const b of bills) {
    const amountPaid = paidByBill.get(b.id) ?? 0
    const balanceDue = b.totalAmount - amountPaid
    const status = balanceDue <= 0 ? 'PAID' : amountPaid > 0 ? 'PARTIAL' : 'DRAFT'
    out.set(b.id, { amountPaid, balanceDue, status })
  }
  return out
}

// --- 3. Item stock ----------------------------------------------------------------
// currentStock = openingStock + Σ(every stockMovement quantity). Movements are append-only
// (a cancel appends a positive reversing row, never deletes), so the replay self-corrects.
// REQUIRES an `openingStock` field on item (see module header) — until that exists, stock
// cannot be wired (the typed opening has no home).
export function recomputeStock(items: RItem[], movements: RMovement[]): Map<string, number> {
  const stock = new Map<string, number>()
  for (const it of items) stock.set(it.id, it.openingStock)
  for (const m of movements) bump(stock, m.itemId, m.quantity)
  return stock
}
