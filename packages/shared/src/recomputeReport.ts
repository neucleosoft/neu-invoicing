// Shared dry-run/apply plumbing for the recompute engine — the parts of the
// desktop and mobile recompute wrappers that used to be byte-identical twins
// (diff, benign-status rule, section building, report formatting). Each app now
// keeps only its ORM boundary: fetch rows → runRecomputeDiff → write the changed
// values back. Because the "what counts as changed" logic lives HERE, the two
// apps can never disagree about what a recompute pass would do.

import {
  recomputeCustomerBalances,
  recomputeSupplierBalances,
  recomputeInvoiceStates,
  recomputeBillStates,
  recomputeStock,
  type DocState,
  type RParty,
  type RInvoice,
  type RBill,
  type RPayment,
  type RNote,
  type RItem,
  type RMovement,
} from './recompute'

export const RECOMPUTE_EPS = 0.01 // float tolerance for money/qty
export const round2 = (n: number) => Math.round(n * 100) / 100
const money = (n: number) => `₹${(n ?? 0).toFixed(2)}`

export interface Change {
  id: string
  name: string
  stored: number | string
  rebuilt: number | string
}
export interface RecomputeSection {
  title: string
  checked: number
  changes: Change[]
}
export interface RecomputeReport {
  applied: boolean
  stockAvailable: boolean
  sections: RecomputeSection[]
  totalChanges: number
}

// Compare stored vs rebuilt over a set of rows; collect only the ones that differ.
// `benign` lets a section ignore a difference that's expected and not real drift
// (e.g. status OVERDUE → DRAFT, since OVERDUE is a display-only label the engine drops).
function diff<T>(
  title: string,
  rows: T[],
  labelOf: (r: T) => { id: string; name: string },
  storedOf: (r: T) => number | string,
  rebuiltOf: (r: T) => number | string,
  isMoney: boolean,
  benign?: (stored: number | string, rebuilt: number | string) => boolean,
): RecomputeSection {
  const changes: Change[] = []
  for (const r of rows) {
    const stored = storedOf(r)
    const rebuilt = rebuiltOf(r)
    const differs = isMoney
      ? Math.abs((stored as number) - (rebuilt as number)) > RECOMPUTE_EPS
      : stored !== rebuilt
    if (differs && !benign?.(stored, rebuilt)) {
      const { id, name } = labelOf(r)
      changes.push({ id, name, stored, rebuilt })
    }
  }
  return { title, checked: rows.length, changes }
}

// OVERDUE is derived at display time from the due date, not stored truth — the
// engine normalises it back to DRAFT. So a stored OVERDUE rebuilding to DRAFT is
// not drift.
export const benignStatus = (stored: number | string, rebuilt: number | string) =>
  stored === 'OVERDUE' && rebuilt === 'DRAFT'

// The rows each app fetches (via its own ORM) before running the engine — the
// engine's R* shapes plus the STORED values being checked and a display name.
export interface RecomputeRows {
  customers: Array<RParty & { name?: string | null; currentBalance: number }>
  suppliers: Array<RParty & { name?: string | null; currentBalance: number }>
  invoices: Array<RInvoice & { invoiceNumber?: string | null; amountPaid: number; balanceDue: number }>
  bills: Array<RBill & { billNumber?: string | null; amountPaid: number; balanceDue: number }>
  payments: RPayment[]
  notes: RNote[]
  stockAvailable: boolean
  items: Array<RItem & { name?: string | null; currentStock: number }>
  movements: RMovement[]
}

export interface RecomputeDiffResult {
  custBal: Map<string, number>
  supBal: Map<string, number>
  invState: Map<string, DocState>
  billState: Map<string, DocState>
  stock: Map<string, number>
  sections: RecomputeSection[]
  totalChanges: number
}

// Run the shared engine over the fetched rows and diff stored vs rebuilt.
// Pure — writes nothing; the caller applies the returned maps if it wants to.
export function runRecomputeDiff(rows: RecomputeRows): RecomputeDiffResult {
  const { customers, suppliers, invoices, bills, payments, notes, stockAvailable, items, movements } = rows

  const custBal = recomputeCustomerBalances(customers, invoices, payments, notes)
  const supBal = recomputeSupplierBalances(suppliers, bills, payments)
  const invState = recomputeInvoiceStates(invoices, payments, notes)
  const billState = recomputeBillStates(bills, payments)
  const stock = stockAvailable ? recomputeStock(items, movements) : new Map<string, number>()

  const sections: RecomputeSection[] = [
    diff('Customer balance', customers, (c) => ({ id: c.id, name: c.name || c.id }), (c) => c.currentBalance, (c) => custBal.get(c.id) ?? 0, true),
    diff('Supplier balance', suppliers, (s) => ({ id: s.id, name: s.name || s.id }), (s) => s.currentBalance, (s) => supBal.get(s.id) ?? 0, true),
    diff('Invoice amountPaid', invoices, (i) => ({ id: i.id, name: i.invoiceNumber || i.id }), (i) => i.amountPaid, (i) => invState.get(i.id)?.amountPaid ?? 0, true),
    diff('Invoice balanceDue', invoices, (i) => ({ id: i.id, name: i.invoiceNumber || i.id }), (i) => i.balanceDue, (i) => invState.get(i.id)?.balanceDue ?? 0, true),
    diff('Invoice status', invoices, (i) => ({ id: i.id, name: i.invoiceNumber || i.id }), (i) => i.status, (i) => invState.get(i.id)?.status ?? i.status, false, benignStatus),
    diff('Bill amountPaid', bills, (b) => ({ id: b.id, name: b.billNumber || b.id }), (b) => b.amountPaid, (b) => billState.get(b.id)?.amountPaid ?? 0, true),
    diff('Bill balanceDue', bills, (b) => ({ id: b.id, name: b.billNumber || b.id }), (b) => b.balanceDue, (b) => billState.get(b.id)?.balanceDue ?? 0, true),
    diff('Bill status', bills, (b) => ({ id: b.id, name: b.billNumber || b.id }), (b) => b.status, (b) => billState.get(b.id)?.status ?? b.status, false),
  ]
  if (stockAvailable) {
    sections.push(diff('Item stock', items, (it) => ({ id: it.id, name: it.name || it.id }), (it) => it.currentStock, (it) => stock.get(it.id) ?? 0, true))
  }
  const totalChanges = sections.reduce((s, sec) => s + sec.changes.length, 0)

  return { custBal, supBal, invState, billState, stock, sections, totalChanges }
}

export function formatRecomputeReport(r: RecomputeReport): string {
  const lines: string[] = []
  lines.push(`=== Recompute ${r.applied ? 'APPLY' : 'DRY RUN'} ===`)
  if (!r.stockAvailable) lines.push(`(item stock skipped — openingStock column not on this DB yet)`)
  const fmt = (v: number | string) => (typeof v === 'number' ? money(v) : v)
  for (const s of r.sections) {
    const verb = r.applied ? 'changed' : 'would change'
    lines.push(`\n${s.title}: ${s.checked} checked · ${s.changes.length} ${verb}`)
    for (const c of s.changes.slice(0, 25)) lines.push(`   ✗ ${c.name}: ${fmt(c.stored)} → ${fmt(c.rebuilt)}`)
    if (s.changes.length > 25) lines.push(`   … and ${s.changes.length - 25} more`)
  }
  const tail = r.applied ? `${r.totalChanges} rows written` : `${r.totalChanges} differences (dry run — nothing written)`
  lines.push(`\n--- ${tail} ---`)
  return lines.join('\n')
}
