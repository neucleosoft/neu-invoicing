import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { useToast } from '../components/ToastContext'
import DownloadMenu from '../components/DownloadMenu'
import ShareMenu from '../components/ShareMenu'
import { TableSkeleton } from '../components/Skeleton'
import { formatCurrency } from '../utils/currency'
import { sharePdf, type ShareTarget } from '../utils/sharePdf'
import {
  buildCustomerLedger,
  buildCustomerLedgerDownloadOpts,
  getCustomerLedgerPdf,
  type CustomerLedgerData,
} from '../utils/customerLedger'
import type { Customer } from '../types'

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

// Show a balance without a minus sign. A negative balance means the customer has
// been paid more than billed, i.e. they're in credit — label it "Advance".
const renderBalance = (amount: number): string =>
  amount < 0 ? `${formatCurrency(Math.abs(amount))} (Advance)` : formatCurrency(amount)

// A customer's ledger — every invoice, payment received and credit/debit note
// with a running balance. Reached from the Customers list ("Ledger" action).
const CustomerLedger = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const state = location.state as { party?: Customer } | null
  const customer = state?.party

  const [ledger, setLedger] = useState<CustomerLedgerData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!customer) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    buildCustomerLedger(customer)
      .then((d) => {
        if (!cancelled) setLedger(d)
      })
      .catch(() => {
        if (!cancelled) toast.error('Failed to load the ledger')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customer?.id])

  const handleShare = async (target: ShareTarget) => {
    if (!ledger) return
    try {
      const { bytes, filename } = await getCustomerLedgerPdf(ledger)
      await sharePdf(bytes, filename, target, toast, {
        subject: `Account ledger — ${ledger.customer.name}`,
        phone: ledger.customer.phone,
        email: ledger.customer.email,
        partyName: ledger.customer.name,
      })
    } catch {
      toast.error('Failed to share the ledger')
    }
  }

  if (!customer) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => navigate('/customers')}
          className="btn btn-secondary inline-flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="card text-center py-12 text-gray-500 dark:text-gray-400">
          No customer selected. Open a ledger from the Customers list.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/customers')}
            className="btn btn-secondary inline-flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{customer.name}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Customer Ledger</p>
          </div>
        </div>
        {ledger && (
          <div className="flex items-center gap-2">
            <DownloadMenu variant="button" getOpts={async () => buildCustomerLedgerDownloadOpts(ledger)} />
            <ShareMenu
              variant="button"
              onShare={handleShare}
              phone={customer.phone}
              email={customer.email}
              partyName={customer.name}
            />
          </div>
        )}
      </div>

      {/* Ledger table */}
      <div className="card">
        {loading ? (
          <TableSkeleton rows={6} columns={6} />
        ) : !ledger ? (
          <p className="text-center py-12 text-red-600 dark:text-red-400">Could not load the ledger.</p>
        ) : (
          <>
            <div className="flex justify-end items-baseline gap-2 mb-3">
              <span className="text-sm text-gray-500 dark:text-gray-400">Current Balance:</span>
              <span className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {renderBalance(ledger.closingBalance)}
              </span>
            </div>
            <div className="overflow-auto max-h-[calc(100vh-300px)]">
              <table className="table">
                <thead>
                  <tr>
                    <th className="table-header sticky top-0 z-10">S.No</th>
                    <th className="table-header sticky top-0 z-10">Date</th>
                    <th className="table-header sticky top-0 z-10">Particulars</th>
                    <th className="table-header sticky top-0 z-10 text-right">Debit</th>
                    <th className="table-header sticky top-0 z-10 text-right">Credit</th>
                    <th className="table-header sticky top-0 z-10 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="table-cell" colSpan={5}>
                      <span className="italic text-gray-500 dark:text-gray-400">Opening Balance</span>
                    </td>
                    <td className="table-cell text-right">{renderBalance(ledger.openingBalance)}</td>
                  </tr>

                  {ledger.rows.length === 0 ? (
                    <tr className="border-t">
                      <td className="table-cell text-center text-gray-500 dark:text-gray-400 py-8" colSpan={6}>
                        No transactions yet for this customer.
                      </td>
                    </tr>
                  ) : (
                    ledger.rows.map((r, i) => (
                      <tr key={`${r.type}-${r.number}-${i}`} className="border-t">
                        <td className="table-cell">{i + 1}</td>
                        <td className="table-cell whitespace-nowrap">{fmtDate(r.date)}</td>
                        <td className="table-cell">{r.particulars}</td>
                        <td className="table-cell text-right">{r.debit ? formatCurrency(r.debit) : '—'}</td>
                        <td className="table-cell text-right">{r.credit ? formatCurrency(r.credit) : '—'}</td>
                        <td className="table-cell text-right font-medium">{renderBalance(r.balance)}</td>
                      </tr>
                    ))
                  )}

                  <tr className="border-t bg-gray-50 dark:bg-gray-800/60 font-bold">
                    <td className="table-cell" colSpan={3}>Total</td>
                    <td className="table-cell text-right">{formatCurrency(ledger.totalDebit)}</td>
                    <td className="table-cell text-right">{formatCurrency(ledger.totalCredit)}</td>
                    <td className="table-cell text-right">{renderBalance(ledger.closingBalance)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export default CustomerLedger
