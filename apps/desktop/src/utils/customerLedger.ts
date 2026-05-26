// Builds a customer's ledger directly from the raw transaction lists — sales
// invoices, payments-in and credit/debit notes. Assembled in the renderer.
import type { Customer } from '../types'
import type { StatementData, StatementLine } from './pdfmakeStatement'
import { getStatementPDFBytes, buildStatementFilename } from './pdfmakeStatement'
import { loadCompanyForPDF } from './loadCompanyForPDF'
import type { DispatchOpts, TableData } from './downloadHelpers'

export interface CustomerLedgerData {
  customer: Customer
  openingBalance: number
  rows: StatementLine[]
  totalDebit: number
  totalCredit: number
  closingBalance: number
}

const todayIso = () => new Date().toISOString().split('T')[0]

// DB DateTime fields arrive over IPC as Date objects (occasionally strings).
// Normalise to an ISO string so filenames / sorting / .slice() can rely on it.
const toIso = (d: unknown): string => {
  if (!d) return todayIso()
  const dt = d instanceof Date ? d : new Date(d as string)
  return isNaN(dt.getTime()) ? todayIso() : dt.toISOString()
}

// Assemble the ledger for one customer from the raw IPC lists.
export async function buildCustomerLedger(customer: Customer): Promise<CustomerLedgerData> {
  const api = window.electronAPI
  const cid = customer.id
  type Raw = Omit<StatementLine, 'balance'>
  const raw: Raw[] = []

  const [salesRes, payRes, noteRes] = await Promise.all([
    api.sales.getAll(),
    api.payment.getAll('PAYMENT_IN'),
    api.creditNote.getAll(),
  ])

  // Invoices → Debit (what the customer owes goes up)
  for (const inv of (((salesRes as any)?.data ?? []) as any[])) {
    if ((inv.customerId || inv.customer?.id) !== cid) continue
    raw.push({
      date: toIso(inv.invoiceDate),
      type: 'INVOICE',
      number: inv.invoiceNumber || '',
      particulars: `Invoice ${inv.invoiceNumber || ''}`.trim(),
      debit: inv.totalAmount || 0,
      credit: 0,
    })
  }

  // Payments received → Credit
  for (const p of (((payRes as any)?.data ?? []) as any[])) {
    if (p.customerId !== cid) continue
    raw.push({
      date: toIso(p.paymentDate),
      type: 'PAYMENT',
      number: String(p.id || '').slice(-8).toUpperCase(),
      particulars: `Payment received${p.paymentMode ? ` (${p.paymentMode})` : ''}`,
      debit: 0,
      credit: p.amount || 0,
    })
  }

  // Credit / debit notes (active only)
  for (const n of (((noteRes as any)?.data ?? []) as any[])) {
    if (n.customerId !== cid) continue
    if (n.status && n.status !== 'ACTIVE') continue
    const isCredit = n.type === 'CREDIT_NOTE'
    raw.push({
      date: toIso(n.noteDate),
      type: isCredit ? 'CREDIT_NOTE' : 'DEBIT_NOTE',
      number: n.noteNumber || '',
      particulars: `${isCredit ? 'Credit' : 'Debit'} Note ${n.noteNumber || ''}`.trim(),
      debit: isCredit ? 0 : n.totalAmount || 0,
      credit: isCredit ? n.totalAmount || 0 : 0,
    })
  }

  raw.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const openingBalance = customer.openingBalance || 0
  let bal = openingBalance
  const rows: StatementLine[] = raw.map((r) => {
    bal += r.debit - r.credit
    return { ...r, balance: bal }
  })
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0)
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0)

  return {
    customer,
    openingBalance,
    rows,
    totalDebit,
    totalCredit,
    closingBalance: openingBalance + totalDebit - totalCredit,
  }
}

// Shape the ledger into what the statement PDF generator expects.
function toStatementData(ledger: CustomerLedgerData, company: unknown): StatementData {
  return {
    customer: {
      name: ledger.customer.name,
      email: ledger.customer.email,
      phone: ledger.customer.phone,
      billingAddress: ledger.customer.billingAddress,
      taxId: ledger.customer.taxId,
    },
    company,
    fromDate: ledger.rows.length ? ledger.rows[0].date : todayIso(),
    toDate: todayIso(),
    openingBalance: ledger.openingBalance,
    lines: ledger.rows,
    totalDebit: ledger.totalDebit,
    totalCredit: ledger.totalCredit,
    closingBalance: ledger.closingBalance,
    title: 'CUSTOMER LEDGER',
  } as StatementData
}

// PDF bytes for the ledger — used by the Share menu.
export async function getCustomerLedgerPdf(
  ledger: CustomerLedgerData,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const company = await loadCompanyForPDF()
  const data = toStatementData(ledger, company)
  const bytes = await getStatementPDFBytes(data)
  return { bytes, filename: buildStatementFilename(data) }
}

// Lazy PDF + table providers for the Download menu.
export function buildCustomerLedgerDownloadOpts(ledger: CustomerLedgerData): DispatchOpts {
  let cached: { bytes: Uint8Array; filename: string } | null = null
  const getPdf = async () => {
    if (!cached) cached = await getCustomerLedgerPdf(ledger)
    return cached
  }
  const getTable = async (): Promise<TableData> => {
    const { filename } = await getPdf()
    const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB')
    return {
      baseName: filename.replace(/\.pdf$/i, ''),
      meta: [
        ['Customer', ledger.customer.name],
        ['GSTIN', ledger.customer.taxId || ''],
      ],
      metaSuffix: [
        ['Opening Balance', ledger.openingBalance],
        ['Total Debit', ledger.totalDebit],
        ['Total Credit', ledger.totalCredit],
        ['Closing Balance', ledger.closingBalance],
      ],
      headers: ['Date', 'Particulars', 'Debit', 'Credit', 'Balance'],
      rows: ledger.rows.map((r) => [fmt(r.date), r.particulars, r.debit, r.credit, r.balance]),
    }
  }
  return { getPdf, getTable }
}
