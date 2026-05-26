// Builds a supplier's ledger directly from the raw transaction lists — purchase
// bills and payments-out. Assembled in the renderer.
import type { Supplier } from '../types'
import type { StatementData, StatementLine } from './pdfmakeStatement'
import { getStatementPDFBytes, buildStatementFilename } from './pdfmakeStatement'
import { loadCompanyForPDF } from './loadCompanyForPDF'
import type { DispatchOpts, TableData } from './downloadHelpers'

export interface SupplierLedgerData {
  supplier: Supplier
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

// Assemble the ledger for one supplier from the raw IPC lists.
export async function buildSupplierLedger(supplier: Supplier): Promise<SupplierLedgerData> {
  const api = window.electronAPI
  const sid = supplier.id
  type Raw = Omit<StatementLine, 'balance'>
  const raw: Raw[] = []

  const [billRes, payRes] = await Promise.all([
    api.purchase.getAll(),
    api.payment.getAll('PAYMENT_OUT'),
  ])

  // Purchase bills → Debit (what you owe the supplier goes up)
  for (const bill of (((billRes as any)?.data ?? []) as any[])) {
    if ((bill.supplierId || bill.supplier?.id) !== sid) continue
    raw.push({
      date: toIso(bill.billDate),
      type: 'INVOICE',
      number: bill.billNumber || '',
      particulars: `Purchase Bill ${bill.billNumber || ''}`.trim(),
      debit: bill.totalAmount || 0,
      credit: 0,
    })
  }

  // Payments made → Credit
  for (const p of (((payRes as any)?.data ?? []) as any[])) {
    if (p.supplierId !== sid) continue
    raw.push({
      date: toIso(p.paymentDate),
      type: 'PAYMENT',
      number: String(p.id || '').slice(-8).toUpperCase(),
      particulars: `Payment made${p.paymentMode ? ` (${p.paymentMode})` : ''}`,
      debit: 0,
      credit: p.amount || 0,
    })
  }

  raw.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  const openingBalance = supplier.openingBalance || 0
  let bal = openingBalance
  const rows: StatementLine[] = raw.map((r) => {
    bal += r.debit - r.credit
    return { ...r, balance: bal }
  })
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0)
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0)

  return {
    supplier,
    openingBalance,
    rows,
    totalDebit,
    totalCredit,
    closingBalance: openingBalance + totalDebit - totalCredit,
  }
}

// Shape the ledger into what the statement PDF generator expects.
function toStatementData(ledger: SupplierLedgerData, company: unknown): StatementData {
  return {
    customer: {
      name: ledger.supplier.name,
      email: ledger.supplier.email,
      phone: ledger.supplier.phone,
      billingAddress: ledger.supplier.billingAddress,
      taxId: ledger.supplier.taxId,
    },
    company,
    fromDate: ledger.rows.length ? ledger.rows[0].date : todayIso(),
    toDate: todayIso(),
    openingBalance: ledger.openingBalance,
    lines: ledger.rows,
    totalDebit: ledger.totalDebit,
    totalCredit: ledger.totalCredit,
    closingBalance: ledger.closingBalance,
    title: 'SUPPLIER LEDGER',
  } as StatementData
}

// PDF bytes for the ledger — used by the Share menu.
export async function getSupplierLedgerPdf(
  ledger: SupplierLedgerData,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const company = await loadCompanyForPDF()
  const data = toStatementData(ledger, company)
  const bytes = await getStatementPDFBytes(data)
  return { bytes, filename: buildStatementFilename(data) }
}

// Lazy PDF + table providers for the Download menu.
export function buildSupplierLedgerDownloadOpts(ledger: SupplierLedgerData): DispatchOpts {
  let cached: { bytes: Uint8Array; filename: string } | null = null
  const getPdf = async () => {
    if (!cached) cached = await getSupplierLedgerPdf(ledger)
    return cached
  }
  const getTable = async (): Promise<TableData> => {
    const { filename } = await getPdf()
    const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB')
    return {
      baseName: filename.replace(/\.pdf$/i, ''),
      meta: [
        ['Supplier', ledger.supplier.name],
        ['GSTIN', ledger.supplier.taxId || ''],
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
