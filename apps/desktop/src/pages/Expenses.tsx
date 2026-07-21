import { useEffect, useMemo, useRef, useState } from 'react'
import { Receipt, Search as SearchIcon, Upload, Trash2, FileText, Download, X } from 'lucide-react'
import { formatCurrency } from '../utils/currency'
import NumberInput from '../components/NumberInput'
import DateInput from '../components/DateInput'
import { useToast } from '../components/ToastContext'
import { useConfirm } from '../components/ConfirmDialogContext'
import EmptyState from '../components/EmptyState'

// Fixed category list — alphabetized, "Other" pinned to the end so it always
// renders last regardless of locale. Keep in sync with anything that aggregates
// expenses by category (Reports etc.) when those land.
const EXPENSE_CATEGORIES = [
  'Electricity',
  'Insurance',
  'Internet & Phone',
  'Maintenance & Repairs',
  'Marketing',
  'Office Supplies',
  'Professional Services',
  'Rent',
  'Salaries & Wages',
  'Travel',
  'Water',
  'Other',
] as const

const PAYMENT_MODES = ['CASH', 'BANK_TRANSFER', 'UPI', 'CARD', 'CHEQUE'] as const

const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*'

interface Expense {
  id: string
  date: string
  category: string
  description: string
  amount: number
  paymentMode: string
  notes: string | null
  receiptMimeType: string | null
  receiptFileName: string | null
  createdAt: string
  updatedAt: string
}

const todayISO = () => new Date().toISOString().split('T')[0]

const Expenses = () => {
  const [rows, setRows] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // View modal state: read-only details + inline receipt preview.
  const [viewingExpense, setViewingExpense] = useState<Expense | null>(null)
  const [viewReceiptUrl, setViewReceiptUrl] = useState<string | null>(null)
  const [viewReceiptLoading, setViewReceiptLoading] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    date: todayISO(),
    category: EXPENSE_CATEGORIES[0] as string,
    description: '',
    amount: 0,
    paymentMode: 'CASH' as string,
    notes: '',
  })
  // Receipt staging: undefined = no change, null = clear, { bytes, ... } = replace
  const [pickedReceipt, setPickedReceipt] = useState<
    | undefined
    | null
    | { bytes: Uint8Array; mime: string; name: string }
  >(undefined)
  // Mirror of the existing receipt metadata when editing, so we can show
  // "current file: foo.pdf" in the modal.
  const [existingReceipt, setExistingReceipt] = useState<{ mime: string; name: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    loadRows()
  }, [])

  const loadRows = async () => {
    setLoading(true)
    const result = await window.electronAPI.expense.getAll()
    if (result.success && result.data) {
      setRows(result.data)
    } else {
      toast.error('Failed to load expenses: ' + (result.error || 'Unknown error'))
    }
    setLoading(false)
  }

  const resetForm = () => {
    setEditingId(null)
    setFormData({
      date: todayISO(),
      category: EXPENSE_CATEGORIES[0] as string,
      description: '',
      amount: 0,
      paymentMode: 'CASH',
      notes: '',
    })
    setPickedReceipt(undefined)
    setExistingReceipt(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const openCreateModal = () => {
    resetForm()
    setShowModal(true)
  }

  const openEditModal = (row: Expense) => {
    setEditingId(row.id)
    setFormData({
      date: new Date(row.date).toISOString().split('T')[0],
      category: row.category,
      description: row.description,
      amount: row.amount,
      paymentMode: row.paymentMode,
      notes: row.notes || '',
    })
    setPickedReceipt(undefined)
    setExistingReceipt(
      row.receiptFileName && row.receiptMimeType
        ? { mime: row.receiptMimeType, name: row.receiptFileName }
        : null,
    )
    if (fileInputRef.current) fileInputRef.current.value = ''
    setShowModal(true)
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const ab = await file.arrayBuffer()
    setPickedReceipt({ bytes: new Uint8Array(ab), mime: file.type || 'application/octet-stream', name: file.name })
  }

  const clearReceipt = () => {
    setPickedReceipt(null) // explicit clear (different from undefined = no-op)
    setExistingReceipt(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.description.trim()) {
      toast.info('Please enter a description')
      return
    }
    if (formData.amount <= 0) {
      toast.info('Amount must be greater than 0')
      return
    }

    setSaving(true)

    const payload: any = {
      date: formData.date,
      category: formData.category,
      description: formData.description.trim(),
      amount: formData.amount,
      paymentMode: formData.paymentMode,
      notes: formData.notes.trim() || null,
    }
    if (pickedReceipt === null) {
      // Explicit clear
      payload.receiptData = null
      payload.receiptMimeType = null
      payload.receiptFileName = null
    } else if (pickedReceipt) {
      payload.receiptData = pickedReceipt.bytes
      payload.receiptMimeType = pickedReceipt.mime
      payload.receiptFileName = pickedReceipt.name
    }
    // else: pickedReceipt === undefined — don't touch the field

    const result = editingId
      ? await window.electronAPI.expense.update(editingId, payload)
      : await window.electronAPI.expense.create(payload)

    setSaving(false)

    if (result.success) {
      toast.success(editingId ? 'Expense updated' : 'Expense saved')
      setShowModal(false)
      resetForm()
      loadRows()
    } else {
      toast.error(`Failed to ${editingId ? 'update' : 'save'}: ` + (result.error || 'Unknown error'))
    }
  }

  const handleDelete = async (row: Expense) => {
    const ok = await confirm({
      message: `Delete expense "${row.description}" of ${formatCurrency(row.amount)}? This cannot be undone.`,
      danger: true,
    })
    if (!ok) return
    const result = await window.electronAPI.expense.delete(row.id)
    if (result.success) {
      toast.success('Expense deleted')
      loadRows()
    } else {
      toast.error('Failed to delete: ' + (result.error || 'Unknown error'))
    }
  }

  // Open the view modal — fetches the receipt bytes (if any) and builds a
  // blob URL so the modal can preview it inline (PDF in <iframe>, image in <img>).
  const openViewModal = async (row: Expense) => {
    setViewingExpense(row)
    setViewReceiptUrl(null)
    if (!row.receiptFileName) return
    setViewReceiptLoading(true)
    const result = await window.electronAPI.expense.getReceipt(row.id)
    setViewReceiptLoading(false)
    if (!result.success || !result.data) {
      toast.error(result.error || 'Could not load receipt')
      return
    }
    const { receiptData, receiptMimeType } = result.data
    const blob = new Blob([receiptData as BlobPart], { type: receiptMimeType || 'application/octet-stream' })
    setViewReceiptUrl(URL.createObjectURL(blob))
  }

  const closeViewModal = () => {
    if (viewReceiptUrl) URL.revokeObjectURL(viewReceiptUrl)
    setViewingExpense(null)
    setViewReceiptUrl(null)
  }

  // Trigger a file download for the receipt inside the view modal.
  const downloadReceipt = () => {
    if (!viewReceiptUrl || !viewingExpense?.receiptFileName) return
    const a = document.createElement('a')
    a.href = viewReceiptUrl
    a.download = viewingExpense.receiptFileName
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  // Filter + search applied to the current rows.
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return rows.filter((r) => {
      if (categoryFilter !== 'ALL' && r.category !== categoryFilter) return false
      if (!q) return true
      return (
        r.description.toLowerCase().includes(q) ||
        r.category.toLowerCase().includes(q) ||
        (r.notes || '').toLowerCase().includes(q) ||
        r.paymentMode.toLowerCase().includes(q)
      )
    })
  }, [rows, searchQuery, categoryFilter])

  // Quick stats for the header cards.
  const totals = useMemo(() => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    let allTime = 0
    let thisMonth = 0
    for (const r of rows) {
      allTime += r.amount
      if (new Date(r.date) >= monthStart) thisMonth += r.amount
    }
    return { allTime, thisMonth, count: rows.length }
  }, [rows])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Receipt className="w-7 h-7 text-primary-600" />
            Daily Expenses
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Track day-to-day business expenses — rent, utilities, salaries, travel, and more.
          </p>
        </div>
        <button onClick={openCreateModal} className="btn btn-primary">+ Add Expense</button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card">
          <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">This Month</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{formatCurrency(totals.thisMonth)}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">All-Time Total</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{formatCurrency(totals.allTime)}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Entries</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-1">{totals.count}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search description, category, notes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input pl-9"
          />
        </div>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="input max-w-[220px]"
        >
          <option value="ALL">All categories</option>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="card p-0">
        <div className="overflow-auto max-h-[calc(100vh-360px)]">
          <table className="table">
            <thead>
              <tr>
                <th className="table-header sticky top-0 z-10">S.No</th>
                <th className="table-header sticky top-0 z-10">Date</th>
                <th className="table-header sticky top-0 z-10">Category</th>
                <th className="table-header sticky top-0 z-10">Description</th>
                <th className="table-header sticky top-0 z-10 text-right">Amount</th>
                <th className="table-header sticky top-0 z-10">Mode</th>
                <th className="table-header sticky top-0 z-10">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-500">Loading…</td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={Receipt}
                      title={rows.length === 0 ? 'No expenses yet' : 'No matching expenses'}
                      description={
                        rows.length === 0
                          ? 'Add your first daily expense to start tracking.'
                          : 'Try clearing the search or category filter.'
                      }
                    />
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, idx) => (
                  <tr key={row.id} className="border-b last:border-0 dark:border-gray-700">
                    <td className="px-4 py-2 text-sm">{idx + 1}</td>
                    <td className="px-4 py-2 text-sm">{new Date(row.date).toLocaleDateString('en-IN')}</td>
                    <td className="px-4 py-2 text-sm">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-200">
                        {row.category}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sm">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{row.description}</div>
                      {row.notes && (
                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[420px]">{row.notes}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-sm text-right font-semibold">{formatCurrency(row.amount)}</td>
                    <td className="px-4 py-2 text-sm">
                      <span className="inline-flex items-center gap-1">
                        {row.paymentMode.replace('_', ' ')}
                        {row.receiptFileName && (
                          <FileText
                            className="w-3.5 h-3.5 text-gray-400"
                            aria-label="Has receipt"
                          />
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-sm">
                      <div className="flex items-center space-x-3">
                        <button
                          onClick={() => openViewModal(row)}
                          className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                        >
                          View
                        </button>
                        <button
                          onClick={() => openEditModal(row)}
                          className="text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(row)}
                          className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* View Modal — read-only details + inline receipt preview */}
      {viewingExpense && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-3xl shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-5">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-bold">Expense Details</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                    {new Date(viewingExpense.date).toLocaleDateString('en-IN', {
                      year: 'numeric', month: 'long', day: 'numeric',
                    })}
                  </p>
                </div>
                <button
                  onClick={closeViewModal}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Category</p>
                  <p className="font-medium">{viewingExpense.category}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Amount</p>
                  <p className="font-semibold text-lg">{formatCurrency(viewingExpense.amount)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Payment Mode</p>
                  <p className="font-medium">{viewingExpense.paymentMode.replace('_', ' ')}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Created</p>
                  <p className="font-medium">{new Date(viewingExpense.createdAt).toLocaleString('en-IN')}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Description</p>
                  <p className="font-medium">{viewingExpense.description}</p>
                </div>
                {viewingExpense.notes && (
                  <div className="sm:col-span-2">
                    <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">Notes</p>
                    <p className="whitespace-pre-wrap">{viewingExpense.notes}</p>
                  </div>
                )}
              </div>

              {/* Receipt preview */}
              <div className="pt-4 border-t dark:border-gray-700">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                    Receipt
                  </h3>
                  {viewReceiptUrl && (
                    <button
                      onClick={downloadReceipt}
                      className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 dark:text-primary-400 text-sm"
                    >
                      <Download className="w-4 h-4" /> Download
                    </button>
                  )}
                </div>
                {!viewingExpense.receiptFileName ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400 italic">No receipt attached.</div>
                ) : viewReceiptLoading ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">Loading receipt…</div>
                ) : viewReceiptUrl ? (
                  viewingExpense.receiptMimeType?.startsWith('image/') ? (
                    <img
                      src={viewReceiptUrl}
                      alt={viewingExpense.receiptFileName}
                      className="max-h-[60vh] mx-auto rounded border dark:border-gray-700"
                    />
                  ) : (
                    <iframe
                      src={viewReceiptUrl}
                      title={viewingExpense.receiptFileName}
                      className="w-full h-[60vh] rounded border dark:border-gray-700 bg-white"
                    />
                  )
                ) : (
                  <div className="text-sm text-red-500">Failed to load receipt.</div>
                )}
                {viewingExpense.receiptFileName && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 text-center">
                    {viewingExpense.receiptFileName}
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t dark:border-gray-700">
                <button onClick={closeViewModal} className="btn btn-secondary">Close</button>
                <button
                  onClick={() => {
                    const target = viewingExpense
                    closeViewModal()
                    if (target) openEditModal(target)
                  }}
                  className="btn btn-primary"
                >
                  Edit
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-2xl shadow-xl max-h-[90vh] overflow-y-auto">
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <h2 className="text-xl font-bold">{editingId ? 'Edit Expense' : 'Add Expense'}</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Date *</label>
                  <DateInput
                    className="input"
                    value={formData.date}
                    onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Category *</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="input"
                    required
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Description *</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input"
                  placeholder="e.g. Office electricity bill - May 2026"
                  required
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Amount (₹) *</label>
                  <NumberInput
                    value={formData.amount}
                    onChange={(v) => setFormData({ ...formData, amount: v })}
                  />
                </div>
                <div>
                  <label className="label">Payment Mode</label>
                  <select
                    value={formData.paymentMode}
                    onChange={(e) => setFormData({ ...formData, paymentMode: e.target.value })}
                    className="input"
                  >
                    {PAYMENT_MODES.map((m) => (
                      <option key={m} value={m}>{m.replace('_', ' ')}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="label">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="input"
                  rows={2}
                  placeholder="Optional"
                />
              </div>

              <div>
                <label className="label">Receipt (optional)</label>
                {/* Three states: (1) freshly picked file, (2) existing receipt on edit, (3) nothing */}
                {pickedReceipt && pickedReceipt !== null ? (
                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-primary-600 shrink-0" />
                      <span className="text-sm truncate">{pickedReceipt.name}</span>
                      <span className="text-xs text-gray-500 shrink-0">
                        ({Math.round(pickedReceipt.bytes.byteLength / 1024)} KB)
                      </span>
                    </div>
                    <button type="button" onClick={clearReceipt} className="text-red-600 hover:text-red-700">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ) : existingReceipt && pickedReceipt !== null ? (
                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-primary-600 shrink-0" />
                      <span className="text-sm truncate">{existingReceipt.name}</span>
                      <span className="text-xs text-gray-500 shrink-0">(current)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-blue-600 hover:text-blue-700 text-sm"
                      >
                        Replace
                      </button>
                      <button type="button" onClick={clearReceipt} className="text-red-600 hover:text-red-700">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 p-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-primary-500 hover:bg-primary-50/40 dark:hover:bg-primary-500/10 text-sm text-gray-600 dark:text-gray-300"
                  >
                    <Upload className="w-4 h-4" />
                    Attach receipt (PDF or image)
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT_ATTR}
                  onChange={handleFileSelect}
                  className="hidden"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); resetForm() }}
                  className="btn btn-secondary"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : editingId ? 'Update Expense' : 'Save Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Expenses
