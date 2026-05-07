import { useEffect, useMemo, useState } from 'react'
import { FileText, Download } from 'lucide-react'
import DateInput from '../components/DateInput'
import SearchableSelect from '../components/SearchableSelect'
import { useToast } from '../components/ToastContext'
import { formatCurrency } from '../utils/currency'
import { loadCompanyForPDF } from '../utils/loadCompanyForPDF'
import {
  downloadStatementPDF,
  StatementData,
  StatementLine,
} from '../utils/pdfmakeStatement'

interface CustomerOption {
  id: string
  name: string
  type: string
}

const TYPE_BADGE: Record<StatementLine['type'], string> = {
  INVOICE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  PAYMENT: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  CREDIT_NOTE: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  DEBIT_NOTE: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
}

const TYPE_LABEL: Record<StatementLine['type'], string> = {
  INVOICE: 'Invoice',
  PAYMENT: 'Payment',
  CREDIT_NOTE: 'Credit Note',
  DEBIT_NOTE: 'Debit Note',
}

const today = () => new Date().toISOString().split('T')[0]

const startOfFiscalYear = () => {
  const now = new Date()
  // April 1 of current or prior FY (matches the rest of the app's default).
  const fyStart = now.getMonth() + 1 >= 4
    ? new Date(now.getFullYear(), 3, 1)
    : new Date(now.getFullYear() - 1, 3, 1)
  return fyStart.toISOString().split('T')[0]
}

const formatDate = (iso: string) => {
  const d = new Date(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

const CustomerStatement = () => {
  const toast = useToast()
  const [customers, setCustomers] = useState<CustomerOption[]>([])
  const [customerId, setCustomerId] = useState('')
  const [fromDate, setFromDate] = useState(startOfFiscalYear())
  const [toDate, setToDate] = useState(today())
  const [loading, setLoading] = useState(false)
  const [statement, setStatement] = useState<StatementData | null>(null)

  useEffect(() => {
    loadCustomers()
  }, [])

  const loadCustomers = async () => {
    const result = await window.electronAPI.customer.getAll()
    if (result.success && result.data) setCustomers(result.data)
  }

  const customerOptions = useMemo(
    () => customers.map((customer) => ({ id: customer.id, name: customer.name })),
    [customers]
  )

  const generate = async () => {
    if (!customerId) {
      toast.error('Please select a customer.')
      return
    }
    if (!fromDate || !toDate) {
      toast.error('Please select a date range.')
      return
    }
    if (new Date(fromDate) > new Date(toDate)) {
      toast.error('"From" date cannot be later than "To" date.')
      return
    }

    setLoading(true)
    try {
      const result = await window.electronAPI.customer.getStatement({
        customerId,
        fromDate,
        toDate,
      })
      if (!result.success || !result.data) {
        toast.error(result.error || 'Failed to generate statement.')
        setStatement(null)
        return
      }
      setStatement(result.data as StatementData)
    } catch (err) {
      console.error(err)
      toast.error('Failed to generate statement.')
    } finally {
      setLoading(false)
    }
  }

  const downloadPDF = async () => {
    if (!statement) return
    try {
      const company = await loadCompanyForPDF()
      downloadStatementPDF({ ...statement, company })
    } catch (err) {
      console.error(err)
      toast.error('Failed to generate PDF.')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Customer Statement</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            All invoices, payments, and credit/debit notes for a customer over a date range.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="md:col-span-2">
            <label className="label">Customer *</label>
            <SearchableSelect
              value={customerId}
              onChange={setCustomerId}
              options={customerOptions}
              placeholder="Select Customer"
            />
          </div>
          <div>
            <label className="label">From *</label>
            <DateInput
              className="input"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label">To *</label>
            <DateInput
              className="input"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              required
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-3">
          <button
            onClick={generate}
            disabled={loading}
            className="btn btn-primary inline-flex items-center gap-2 disabled:opacity-60"
          >
            <FileText className="h-4 w-4" />
            {loading ? 'Generating…' : 'Generate Statement'}
          </button>
        </div>
      </div>

      {/* Result */}
      {statement && (
        <div className="card">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {statement.customer.name}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {formatDate(statement.fromDate)} — {formatDate(statement.toDate)}
              </p>
            </div>
            <button
              onClick={downloadPDF}
              className="btn bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-2"
            >
              <Download className="h-4 w-4" /> Download PDF
            </button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <SummaryCard label="Opening Balance" value={statement.openingBalance} />
            <SummaryCard label="Total Charges" value={statement.totalDebit} positive />
            <SummaryCard label="Total Receipts" value={statement.totalCredit} positive />
            <SummaryCard label="Closing Balance" value={statement.closingBalance} highlight />
          </div>

          {/* Lines table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700/40">
                <tr>
                  <th className="table-header-cell">Date</th>
                  <th className="table-header-cell">Type</th>
                  <th className="table-header-cell">Number</th>
                  <th className="table-header-cell">Particulars</th>
                  <th className="table-header-cell text-right">Charges</th>
                  <th className="table-header-cell text-right">Receipts</th>
                  <th className="table-header-cell text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-emerald-50 dark:bg-emerald-900/20 border-t border-gray-200 dark:border-gray-700">
                  <td className="table-cell" colSpan={6}>
                    <span className="font-semibold">Opening Balance</span>
                  </td>
                  <td className="table-cell text-right font-semibold">
                    {formatCurrency(statement.openingBalance)}
                  </td>
                </tr>
                {statement.lines.length === 0 ? (
                  <tr className="border-t border-gray-200 dark:border-gray-700">
                    <td
                      className="table-cell text-center italic text-gray-500 dark:text-gray-400 py-6"
                      colSpan={7}
                    >
                      No transactions in this period.
                    </td>
                  </tr>
                ) : (
                  statement.lines.map((line, i) => (
                    <tr key={i} className="border-t border-gray-200 dark:border-gray-700">
                      <td className="table-cell whitespace-nowrap">{formatDate(line.date)}</td>
                      <td className="table-cell">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_BADGE[line.type]}`}
                        >
                          {TYPE_LABEL[line.type]}
                        </span>
                      </td>
                      <td className="table-cell font-mono text-xs">{line.number}</td>
                      <td className="table-cell">{line.particulars}</td>
                      <td className="table-cell text-right">
                        {line.debit ? formatCurrency(line.debit) : '—'}
                      </td>
                      <td className="table-cell text-right">
                        {line.credit ? formatCurrency(line.credit) : '—'}
                      </td>
                      <td className="table-cell text-right font-medium">
                        {formatCurrency(line.balance)}
                      </td>
                    </tr>
                  ))
                )}
                {statement.lines.length > 0 && (
                  <tr className="bg-emerald-50 dark:bg-emerald-900/20 border-t border-gray-200 dark:border-gray-700">
                    <td className="table-cell" colSpan={4}>
                      <span className="font-semibold">Period Totals</span>
                    </td>
                    <td className="table-cell text-right font-semibold">
                      {formatCurrency(statement.totalDebit)}
                    </td>
                    <td className="table-cell text-right font-semibold">
                      {formatCurrency(statement.totalCredit)}
                    </td>
                    <td className="table-cell text-right font-bold">
                      {formatCurrency(statement.closingBalance)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

const SummaryCard = ({
  label,
  value,
  positive,
  highlight,
}: {
  label: string
  value: number
  positive?: boolean
  highlight?: boolean
}) => (
  <div
    className={`rounded-lg p-3 ${
      highlight
        ? 'bg-emerald-50 dark:bg-emerald-900/20'
        : 'bg-gray-50 dark:bg-gray-800/40'
    }`}
  >
    <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
    <p
      className={`mt-1 truncate text-lg font-semibold ${
        highlight
          ? 'text-emerald-700 dark:text-emerald-300'
          : positive
            ? 'text-gray-900 dark:text-gray-100'
            : 'text-gray-900 dark:text-gray-100'
      }`}
    >
      {formatCurrency(value)}
    </p>
  </div>
)

export default CustomerStatement
