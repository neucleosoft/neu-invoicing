// Party-ledger builders. Mirrors apps/desktop/src/utils/customerLedger.ts and
// supplierLedger.ts exactly, but reads straight from Drizzle (filtered queries)
// instead of pulling every record over IPC and filtering in JS.
//
// The ledger is the running account between you and one party:
//   - Customer: invoices + debit notes are DEBIT (they owe more); payments-in +
//     credit notes are CREDIT (they owe less).
//   - Supplier: purchase bills are DEBIT (you owe more); payments-out are CREDIT.
// Opening balance seeds the running total; closing = opening + debit − credit.
//
// On-screen only for now — the desktop PDF/Share path is Phase C work.

import { and, eq } from 'drizzle-orm'

import { schema, useDb } from '@/db'
import { notDeleted } from '@/db/softDelete'

type Db = ReturnType<typeof useDb>

// One movement in the account. `date` stays a Date (Drizzle's prismaDate columns
// hand back Date objects) so the screen can sort and formatDate() it directly.
export interface LedgerLine {
  date: Date
  type: 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'BILL'
  number: string
  particulars: string
  debit: number
  credit: number
  balance: number
}

export interface LedgerData {
  openingBalance: number
  rows: LedgerLine[]
  totalDebit: number
  totalCredit: number
  closingBalance: number
}

// Shared tail: sort chronologically, run the balance forward, total the columns.
// Mirrors the reduce/closing math in both desktop ledger utils.
function assemble(
  raw: Omit<LedgerLine, 'balance'>[],
  openingBalance: number,
): LedgerData {
  raw.sort((a, b) => a.date.getTime() - b.date.getTime())
  let bal = openingBalance
  const rows: LedgerLine[] = raw.map((r) => {
    bal += r.debit - r.credit
    return { ...r, balance: bal }
  })
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0)
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0)
  return {
    openingBalance,
    rows,
    totalDebit,
    totalCredit,
    closingBalance: openingBalance + totalDebit - totalCredit,
  }
}

// Short, human-ish reference for a payment row (desktop uses the id's last 8
// chars uppercased, since payments carry no user-facing number).
const payRef = (id: string): string => id.slice(-8).toUpperCase()

// Customer ledger: invoices (debit) + payments-in (credit) + credit/debit notes.
export async function buildCustomerLedger(
  db: Db,
  customerId: string,
  openingBalance: number,
): Promise<LedgerData> {
  const [invoices, payments, notes] = await Promise.all([
    db
      .select({
        date: schema.salesInvoice.invoiceDate,
        number: schema.salesInvoice.invoiceNumber,
        total: schema.salesInvoice.totalAmount,
      })
      .from(schema.salesInvoice)
      // type='INVOICE' mirrors desktop's sales.getAll handler filter. Mobile keeps
      // quotations/proformas in their own tables so this is currently redundant,
      // but it guards the ledger against any future multi-type salesInvoice rows.
      .where(
        and(
          eq(schema.salesInvoice.customerId, customerId),
          eq(schema.salesInvoice.type, 'INVOICE'),
          notDeleted(schema.salesInvoice.deletedAt),
        ),
      ),
    db
      .select({
        id: schema.paymentTransaction.id,
        date: schema.paymentTransaction.paymentDate,
        amount: schema.paymentTransaction.amount,
        mode: schema.paymentTransaction.paymentMode,
      })
      .from(schema.paymentTransaction)
      .where(
        and(
          eq(schema.paymentTransaction.customerId, customerId),
          eq(schema.paymentTransaction.type, 'PAYMENT_IN'),
          notDeleted(schema.paymentTransaction.deletedAt),
        ),
      ),
    db
      .select({
        date: schema.creditDebitNote.noteDate,
        number: schema.creditDebitNote.noteNumber,
        type: schema.creditDebitNote.type,
        total: schema.creditDebitNote.totalAmount,
        status: schema.creditDebitNote.status,
      })
      .from(schema.creditDebitNote)
      .where(
        and(
          eq(schema.creditDebitNote.customerId, customerId),
          notDeleted(schema.creditDebitNote.deletedAt),
        ),
      ),
  ])

  const raw: Omit<LedgerLine, 'balance'>[] = []

  for (const inv of invoices) {
    raw.push({
      date: inv.date,
      type: 'INVOICE',
      number: inv.number,
      particulars: `Invoice ${inv.number}`.trim(),
      debit: inv.total || 0,
      credit: 0,
    })
  }

  for (const p of payments) {
    raw.push({
      date: p.date,
      type: 'PAYMENT',
      number: payRef(p.id),
      particulars: `Payment received${p.mode ? ` (${p.mode})` : ''}`,
      debit: 0,
      credit: p.amount || 0,
    })
  }

  for (const n of notes) {
    // Only active notes move the ledger (mirrors desktop's status !== ACTIVE skip).
    if (n.status && n.status !== 'ACTIVE') continue
    const isCredit = n.type === 'CREDIT_NOTE'
    raw.push({
      date: n.date,
      type: isCredit ? 'CREDIT_NOTE' : 'DEBIT_NOTE',
      number: n.number,
      particulars: `${isCredit ? 'Credit' : 'Debit'} Note ${n.number}`.trim(),
      debit: isCredit ? 0 : n.total || 0,
      credit: isCredit ? n.total || 0 : 0,
    })
  }

  return assemble(raw, openingBalance)
}

// Supplier ledger: purchase bills (debit) + payments-out (credit).
export async function buildSupplierLedger(
  db: Db,
  supplierId: string,
  openingBalance: number,
): Promise<LedgerData> {
  const [bills, payments] = await Promise.all([
    db
      .select({
        date: schema.purchaseBill.billDate,
        number: schema.purchaseBill.billNumber,
        total: schema.purchaseBill.totalAmount,
      })
      .from(schema.purchaseBill)
      .where(
        and(
          eq(schema.purchaseBill.supplierId, supplierId),
          notDeleted(schema.purchaseBill.deletedAt),
        ),
      ),
    db
      .select({
        id: schema.paymentTransaction.id,
        date: schema.paymentTransaction.paymentDate,
        amount: schema.paymentTransaction.amount,
        mode: schema.paymentTransaction.paymentMode,
      })
      .from(schema.paymentTransaction)
      .where(
        and(
          eq(schema.paymentTransaction.supplierId, supplierId),
          eq(schema.paymentTransaction.type, 'PAYMENT_OUT'),
          notDeleted(schema.paymentTransaction.deletedAt),
        ),
      ),
  ])

  const raw: Omit<LedgerLine, 'balance'>[] = []

  for (const bill of bills) {
    raw.push({
      date: bill.date,
      type: 'BILL',
      number: bill.number,
      particulars: `Purchase Bill ${bill.number}`.trim(),
      debit: bill.total || 0,
      credit: 0,
    })
  }

  for (const p of payments) {
    raw.push({
      date: p.date,
      type: 'PAYMENT',
      number: payRef(p.id),
      particulars: `Payment made${p.mode ? ` (${p.mode})` : ''}`,
      debit: 0,
      credit: p.amount || 0,
    })
  }

  return assemble(raw, openingBalance)
}

// Statement = ledger sliced to a date range. Rows before `from` collapse into
// the opening balance (carried forward); rows after `to` are dropped. Mirrors
// desktop CustomerStatement's "opening balance up to fromDate" behaviour.
export function sliceToDateRange(
  ledger: LedgerData,
  from: Date | null,
  to: Date | null,
): LedgerData {
  const fromMs = from ? startOfDay(from).getTime() : -Infinity
  const toMs = to ? endOfDay(to).getTime() : Infinity

  let opening = ledger.openingBalance
  const inRange: Omit<LedgerLine, 'balance'>[] = []
  for (const r of ledger.rows) {
    const t = r.date.getTime()
    if (t < fromMs) {
      // Before the window — fold into the carried-forward opening balance.
      opening += r.debit - r.credit
    } else if (t <= toMs) {
      inRange.push({
        date: r.date,
        type: r.type,
        number: r.number,
        particulars: r.particulars,
        debit: r.debit,
        credit: r.credit,
      })
    }
    // After the window — ignore.
  }
  return assemble(inRange, opening)
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function endOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(23, 59, 59, 999)
  return x
}
