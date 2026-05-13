import { useEffect, useRef, useState } from 'react'
import { Archive, Search as SearchIcon, Upload, Trash2, Eye, Sparkles } from 'lucide-react'
import { formatCurrency } from '../utils/currency'
import NumberInput from '../components/NumberInput'
import DateInput from '../components/DateInput'
import { useToast } from '../components/ToastContext'
import { useConfirm } from '../components/ConfirmDialogContext'
import EmptyState from '../components/EmptyState'
import { TableSkeleton } from '../components/Skeleton'
import SortHeader from '../components/SortHeader'
import { useSortable } from '../hooks/useSortable'
import BulkDownloadMenu from '../components/BulkDownloadMenu'
import DownloadMenu from '../components/DownloadMenu'
import type { DispatchOpts, TableData } from '../utils/downloadHelpers'
import { bulkDownloadPdfs, bulkDownloadExcel, buildZipFilename } from '../utils/bulkDownloadPdfs'
import { renderPdfFirstPage } from '../utils/pdfRender'

interface PreviousInvoice {
  id: string
  serialNumber?: number | null
  invoiceNumber: string
  invoiceDate: string
  partyName: string
  totalAmount: number
  notes?: string | null
  fileMimeType: string
  fileName: string
  createdAt: string
  updatedAt: string
}

// Editable shape for the inline items table in the upload/edit modal. Strings
// for optional text fields so empty inputs round-trip without null/'' churn.
interface EditableItem {
  name: string
  hsnCode: string
  quantity: number
  unit: string
  rate: number
  discount: number
  taxRate: number
  amount: number
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'text/csv',
]
const ACCEPT_ATTR = '.pdf,.jpg,.jpeg,.png,.webp,.xlsx,.xls,.csv,application/pdf,image/*,text/csv'

const formatFileSize = (mime: string) => {
  if (mime === 'application/pdf') return 'PDF'
  if (mime.startsWith('image/')) return mime.replace('image/', '').toUpperCase()
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'Excel'
  if (mime === 'text/csv') return 'CSV'
  return mime
}

// Claude Vision can return billDate in several shapes — Indian "DD/MM/YYYY",
// ISO "YYYY-MM-DD", written-out "11 May 2026", or sometimes the literal string
// "Invalid Date" when extraction failed. Normalize to "YYYY-MM-DD" for the
// <DateInput>, or return null if the value can't be salvaged so the form
// keeps its current date instead of poisoning the create call.
const normalizeExtractedDate = (s: string | undefined | null): string | null => {
  if (!s) return null
  const trimmed = String(s).trim()
  if (!trimmed || /invalid/i.test(trimmed)) return null
  const dm = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (dm) {
    const [, d, m, y] = dm
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const dt = new Date(trimmed)
  if (isNaN(dt.getTime())) return null
  return dt.toISOString().split('T')[0]
}

const PreviousInvoices = () => {
  const [rows, setRows] = useState<PreviousInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState<'all' | '7d' | '1m' | '1q' | '1y' | 'custom'>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [bulkDownloading, setBulkDownloading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [extracting, setExtracting] = useState(false)

  // Upload form state
  const [pickedFile, setPickedFile] = useState<{ bytes: Uint8Array; mime: string; name: string } | null>(null)
  const [formData, setFormData] = useState({
    invoiceNumber: '',
    invoiceDate: new Date().toISOString().split('T')[0],
    partyName: '',
    totalAmount: 0,
    notes: '',
  })
  // Editable line items. Pre-populated by the PDF parser on upload; the user
  // can fix any parser mistakes (or add rows for non-PDF uploads) before save.
  const [formItems, setFormItems] = useState<EditableItem[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    loadRows()
  }, [])

  const loadRows = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.previousInvoice.getAll()
      if (result.success && result.data) {
        setRows(result.data as PreviousInvoice[])
      } else if (result.error) {
        toast.error(result.error)
      }
    } finally {
      setLoading(false)
    }
  }

  const openNew = () => {
    setEditingId(null)
    setPickedFile(null)
    setFormData({
      invoiceNumber: '',
      invoiceDate: new Date().toISOString().split('T')[0],
      partyName: '',
      totalAmount: 0,
      notes: '',
    })
    setFormItems([])
    setShowModal(true)
  }

  const openEdit = async (row: PreviousInvoice) => {
    setEditingId(row.id)
    setPickedFile(null)
    setFormData({
      invoiceNumber: row.invoiceNumber,
      invoiceDate: new Date(row.invoiceDate).toISOString().split('T')[0],
      partyName: row.partyName,
      totalAmount: row.totalAmount,
      notes: row.notes || '',
    })
    // Fetch full row so we can show existing line items for editing. Open the
    // modal first so the UI feels instant; items populate in the background.
    setFormItems([])
    setShowModal(true)
    try {
      const result = await window.electronAPI.previousInvoice.getById(row.id)
      if (result.success && result.data?.items) {
        setFormItems(
          (result.data.items as Array<Record<string, any>>).map(it => ({
            name: it.name ?? '',
            hsnCode: it.hsnCode ?? '',
            quantity: typeof it.quantity === 'number' ? it.quantity : 0,
            unit: it.unit ?? '',
            rate: typeof it.rate === 'number' ? it.rate : 0,
            discount: typeof it.discount === 'number' ? it.discount : 0,
            taxRate: typeof it.taxRate === 'number' ? it.taxRate : 0,
            amount: typeof it.amount === 'number' ? it.amount : 0,
          })),
        )
      }
    } catch {
      // Non-fatal — modal still works for metadata-only edits.
    }
  }

  const blankItem = (): EditableItem => ({
    name: '',
    hsnCode: '',
    quantity: 1,
    unit: '',
    rate: 0,
    discount: 0,
    taxRate: 0,
    amount: 0,
  })

  const addItem = () => setFormItems(prev => [...prev, blankItem()])

  const removeItem = (idx: number) =>
    setFormItems(prev => prev.filter((_, i) => i !== idx))

  const updateItem = (idx: number, patch: Partial<EditableItem>) =>
    setFormItems(prev => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))

  const handleFilePick = async (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type) && file.type !== '') {
      toast.error(`Unsupported file type: ${file.type || 'unknown'}`)
      return
    }
    const buf = new Uint8Array(await file.arrayBuffer())
    const mime = file.type || 'application/octet-stream'
    setPickedFile({ bytes: buf, mime, name: file.name })

    // Claude Vision (same path Purchase uses) — returns metadata AND
    // structured line items in one shot, works for any invoice template
    // without regex fragility. Excel/CSV uploads skip extraction; user fills
    // the form manually.
    const isExtractable = mime === 'application/pdf' || mime.startsWith('image/')
    if (!isExtractable) return

    setExtracting(true)
    try {
      // OCR providers reject PDFs — rasterise page 1 to PNG first.
      let extractBytes: Uint8Array = buf
      let extractMime = mime
      if (mime === 'application/pdf') {
        try {
          extractBytes = await renderPdfFirstPage(buf)
          extractMime = 'image/png'
        } catch (err) {
          toast.error(`Couldn't read PDF for extraction: ${err instanceof Error ? err.message : 'unknown'}`)
          return
        }
      }
      const result = await window.electronAPI.purchase.extractFromImage({
        fileBytes: new Uint8Array(extractBytes),
        mimeType: extractMime,
      } as any)
      if (!result.success || !result.data) {
        toast.info('Auto-fill unavailable. Enter details manually.')
        return
      }
      const ex = result.data
      const normalizedDate = normalizeExtractedDate(ex.billDate)
      setFormData((prev) => ({
        invoiceNumber: ex.billNumber || prev.invoiceNumber,
        invoiceDate: normalizedDate || prev.invoiceDate,
        partyName: ex.supplierName || prev.partyName,
        totalAmount: ex.totalAmount && ex.totalAmount > 0 ? ex.totalAmount : prev.totalAmount,
        notes: prev.notes,
      }))
      if (ex.items && ex.items.length > 0) {
        setFormItems(
          ex.items.map((it: any) => ({
            name: it.name ?? '',
            hsnCode: it.hsnCode ?? '',
            quantity: typeof it.quantity === 'number' ? it.quantity : 0,
            unit: '',
            rate: typeof it.rate === 'number' ? it.rate : 0,
            discount: 0,
            taxRate: typeof it.taxRate === 'number' ? it.taxRate : 0,
            amount: typeof it.total === 'number'
              ? it.total
              : (it.quantity || 0) * (it.rate || 0),
          })),
        )
        toast.success(`Extracted ${ex.items.length} item${ex.items.length === 1 ? '' : 's'} — review before saving`)
      } else {
        toast.success('Auto-filled from file — add line items manually if needed')
      }
    } finally {
      setExtracting(false)
    }
  }

  const handleSave = async () => {
    if (!formData.invoiceNumber.trim()) {
      toast.error('Invoice number is required')
      return
    }
    if (!formData.invoiceDate || isNaN(new Date(formData.invoiceDate).getTime())) {
      toast.error('Invoice date is required and must be a valid date')
      return
    }
    if (!formData.partyName.trim()) {
      toast.error('Party name is required')
      return
    }
    if (formData.totalAmount <= 0) {
      toast.error('Total amount must be greater than 0')
      return
    }

    // Build the items payload — drop blank rows so parser-generated placeholders
    // don't pollute the DB. A row counts as real if it has any non-empty value.
    const itemsPayload = formItems
      .filter(it => it.name.trim() !== '' || it.quantity > 0 || it.rate > 0 || it.amount > 0)
      .map(it => ({
        name: it.name.trim(),
        hsnCode: it.hsnCode.trim() || null,
        quantity: it.quantity,
        unit: it.unit.trim() || null,
        rate: it.rate,
        discount: it.discount,
        taxRate: it.taxRate,
        amount: it.amount,
      }))

    setSaving(true)
    try {
      if (editingId) {
        const result = await window.electronAPI.previousInvoice.update(editingId, {
          invoiceNumber: formData.invoiceNumber.trim(),
          invoiceDate: formData.invoiceDate,
          partyName: formData.partyName.trim(),
          totalAmount: formData.totalAmount,
          notes: formData.notes.trim() || null,
          items: itemsPayload,
        })
        if (!result.success) {
          toast.error(result.error || 'Failed to update')
          return
        }
        toast.success('Previous invoice updated')
      } else {
        if (!pickedFile) {
          toast.error('Please pick a file to upload')
          return
        }
        const result = await window.electronAPI.previousInvoice.create({
          invoiceNumber: formData.invoiceNumber.trim(),
          invoiceDate: formData.invoiceDate,
          partyName: formData.partyName.trim(),
          totalAmount: formData.totalAmount,
          notes: formData.notes.trim() || null,
          fileData: pickedFile.bytes,
          fileMimeType: pickedFile.mime,
          fileName: pickedFile.name,
          items: itemsPayload,
        })
        if (!result.success) {
          toast.error(result.error || 'Failed to upload')
          return
        }
        toast.success('Previous invoice uploaded')
      }
      setShowModal(false)
      await loadRows()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (row: PreviousInvoice) => {
    const ok = await confirm({
      title: 'Delete previous invoice?',
      message: `${row.invoiceNumber} — ${row.partyName}. This permanently removes the uploaded file. Continue?`,
      confirmText: 'Delete',
      danger: true,
    })
    if (!ok) return
    const result = await window.electronAPI.previousInvoice.delete(row.id)
    if (!result.success) {
      toast.error(result.error || 'Failed to delete')
      return
    }
    toast.success('Deleted')
    await loadRows()
  }

  // Build DispatchOpts so DownloadMenu can offer PDF / PNG / JPEG / Excel / CSV / Print
  // for a stored previous-invoice file. The PDF blob is the source of truth for
  // PDF/PNG/JPEG/Print; the Excel/CSV path reads structured items from the DB
  // (populated at upload time by the extractor).
  const buildDownloadOpts = (row: PreviousInvoice): DispatchOpts => {
    let cached: { bytes: Uint8Array; filename: string } | null = null
    const getPdf = async () => {
      if (cached) return cached
      const result = await window.electronAPI.previousInvoice.getFile(row.id)
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to fetch file')
      }
      cached = { bytes: result.data.fileData, filename: result.data.fileName }
      return cached
    }
    const getTable = async (): Promise<TableData> => {
      const { filename } = await getPdf()
      const baseName = filename.replace(/\.[^./\\]+$/, '')

      // Fetch full row (including items) from the DB. Items were extracted at
      // upload time and stored in PreviousInvoiceItem — no PDF re-parsing.
      const result = await window.electronAPI.previousInvoice.getById(row.id)
      const items: Array<Record<string, any>> = (result.success && result.data?.items) || []

      if (items.length === 0) {
        // No items stored (e.g. rows uploaded before items were captured, or
        // ones where the extractor returned none). Fall back to a single
        // metadata row so the Excel/CSV is at least useful.
        return {
          baseName,
          headers: ['Invoice No.', 'Invoice Date', 'Party', 'Total Amount', 'File'],
          rows: [[
            row.invoiceNumber,
            new Date(row.invoiceDate).toLocaleDateString('en-GB'),
            row.partyName,
            row.totalAmount,
            filename,
          ]],
        }
      }

      const subtotal = items.reduce((s, it) => s + (it.quantity || 0) * (it.rate || 0), 0)
      const tax = items.reduce((s, it) => {
        const taxable = (it.quantity || 0) * (it.rate || 0)
        return s + taxable * ((it.taxRate || 0) / 100)
      }, 0)
      const meta: Array<[string, string | number]> = [
        ['Invoice', row.invoiceNumber],
        ['Date', new Date(row.invoiceDate).toLocaleDateString('en-GB')],
        ['Customer', row.partyName],
      ]
      const metaSuffix: Array<[string, string | number]> = [
        ['Subtotal', subtotal],
        ['Tax', tax],
        ['Total', row.totalAmount],
      ]
      const headers = ['Item', 'HSN/SAC', 'Qty', 'Rate', 'Discount', 'Tax %', 'Amount']
      const rowsOut: (string | number)[][] = items.map(it => [
        it.name ?? '',
        it.hsnCode ?? '',
        it.quantity ?? 0,
        it.rate ?? 0,
        it.discount ?? 0,
        it.taxRate ?? 0,
        it.amount ?? (it.quantity || 0) * (it.rate || 0),
      ])
      return { baseName, meta, metaSuffix, headers, rows: rowsOut }
    }
    return { getPdf, getTable }
  }

  const handleView = async (row: PreviousInvoice) => {
    const result = await window.electronAPI.previousInvoice.getFile(row.id)
    if (!result.success || !result.data) {
      toast.error(result.error || 'Failed to fetch file')
      return
    }
    const blob = new Blob([result.data.fileData as BlobPart], { type: result.data.fileMimeType })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    // Revoke later — too early and the new window can't read it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const handleBulkDownloadFiles = async (matching: PreviousInvoice[]) => {
    if (matching.length === 0) {
      toast.info('No invoices to download')
      return
    }
    setBulkDownloading(true)
    try {
      const items = matching.map(r => ({ id: r.id, filename: r.fileName }))
      const result = await bulkDownloadPdfs({
        items,
        zipFilename: buildZipFilename('Previous_Invoices', matching[0]?.partyName || 'all'),
        getBytes: async (id) => {
          const res = await window.electronAPI.previousInvoice.getFile(id)
          if (!res.success || !res.data) return null
          return res.data.fileData
        },
      })
      if (result.added > 0) {
        toast.success(`Downloaded ${result.added} file${result.added === 1 ? '' : 's'}${result.failed ? ` (${result.failed} failed)` : ''}`)
      } else {
        toast.error('Failed to download any files')
      }
    } catch (error) {
      console.error('Bulk download error:', error)
      toast.error('Failed to bulk-download files')
    } finally {
      setBulkDownloading(false)
    }
  }

  const handleBulkDownloadExcel = async (matching: PreviousInvoice[]) => {
    if (matching.length === 0) {
      toast.info('No invoices to download')
      return
    }
    setBulkDownloading(true)
    try {
      const headers = ['Invoice #', 'Date', 'Party', 'Total', 'File', 'File Type', 'Notes']
      const rows: (string | number)[][] = matching.map(r => ([
        r.invoiceNumber,
        new Date(r.invoiceDate).toLocaleDateString('en-GB'),
        r.partyName,
        r.totalAmount,
        r.fileName,
        formatFileSize(r.fileMimeType),
        r.notes || '',
      ]))
      const today = new Date().toISOString().slice(0, 10)
      const filename = `Previous_Invoices_${today}.xlsx`
      await bulkDownloadExcel({
        filename,
        sheets: [{
          name: 'Previous Invoices',
          meta: [['Generated', new Date().toLocaleString()]],
          headers,
          rows,
        }],
      })
      toast.success(`Exported ${matching.length} record${matching.length === 1 ? '' : 's'} to Excel`)
    } catch (error) {
      console.error('Bulk Excel error:', error)
      toast.error('Failed to export Excel')
    } finally {
      setBulkDownloading(false)
    }
  }

  const getDateRange = (): { start: Date | null; end: Date | null } => {
    if (dateFilter === 'all') return { start: null, end: null }
    if (dateFilter === 'custom') {
      const start = customStart ? new Date(customStart) : null
      const end = customEnd ? new Date(customEnd) : null
      if (start) start.setHours(0, 0, 0, 0)
      if (end) end.setHours(23, 59, 59, 999)
      return { start, end }
    }
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    if (dateFilter === '7d') start.setDate(start.getDate() - 6)
    else if (dateFilter === '1m') start.setDate(start.getDate() - 29)
    else if (dateFilter === '1q') start.setMonth(start.getMonth() - 3)
    else if (dateFilter === '1y') start.setDate(start.getDate() - 364)
    return { start, end }
  }

  const { start: dateStart, end: dateEnd } = getDateRange()

  const filteredRows = rows.filter(row => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const matches = row.invoiceNumber.toLowerCase().includes(q) ||
        row.partyName.toLowerCase().includes(q)
      if (!matches) return false
    }
    if (dateStart || dateEnd) {
      const d = new Date(row.invoiceDate)
      if (dateStart && d < dateStart) return false
      if (dateEnd && d > dateEnd) return false
    }
    return true
  })

  const { sortedItems, sortKey, sortDir, toggleSort } = useSortable(
    filteredRows,
    [
      // Assigned at upload time, unique and monotonic — the trustworthy
      // identity column. Same invoiceNumber across fiscal years can collide,
      // serialNumber never does, so it's the safe default sort.
      { key: 'serialNumber', accessor: r => r.serialNumber ?? 0 },
      // Treat invoice numbers as a single numeric sequence regardless of prefix:
      // "146" → 146, "NS/SL/25-26/146" → 146.
      { key: 'invoiceNumber', accessor: r => parseInt(r.invoiceNumber.match(/\d+$/)?.[0] ?? '0', 10) },
      { key: 'invoiceDate', accessor: r => new Date(r.invoiceDate).getTime() },
      { key: 'partyName', accessor: r => r.partyName },
      { key: 'totalAmount', accessor: r => r.totalAmount },
    ],
    { key: 'serialNumber', dir: 'desc' },
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Previous Invoices</h1>
        <button onClick={openNew} className="btn btn-primary inline-flex items-center gap-2">
          <Upload className="w-4 h-4" />
          Upload Invoice
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          className="input max-w-md flex-1 min-w-[240px]"
          placeholder="Search by invoice number or party name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <select
          className="input w-auto"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}
        >
          <option value="all">All Dates</option>
          <option value="7d">Last 7 Days</option>
          <option value="1m">Last Month</option>
          <option value="1q">Last Quarter</option>
          <option value="1y">Last Year</option>
          <option value="custom">Custom Range</option>
        </select>
        {dateFilter === 'custom' && (
          <>
            <DateInput
              className="input w-auto"
              value={customStart}
              onChange={(e) => setCustomStart(e.target.value)}
            />
            <span className="text-gray-500 dark:text-gray-400">to</span>
            <DateInput
              className="input w-auto"
              value={customEnd}
              onChange={(e) => setCustomEnd(e.target.value)}
            />
          </>
        )}
        {dateFilter !== 'all' && (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {filteredRows.length} {filteredRows.length === 1 ? 'invoice' : 'invoices'}
          </span>
        )}
        {filteredRows.length > 0 && (
          <BulkDownloadMenu
            count={filteredRows.length}
            busy={bulkDownloading}
            onPdfs={() => handleBulkDownloadFiles(filteredRows)}
            onExcel={() => handleBulkDownloadExcel(filteredRows)}
          />
        )}
      </div>

      <div className="card">
        {loading ? (
          <TableSkeleton rows={6} columns={6} />
        ) : filteredRows.length === 0 ? (
          searchQuery.trim() || dateFilter !== 'all' ? (
            <EmptyState
              icon={SearchIcon}
              title="No previous invoices match your filters"
              description={searchQuery.trim() ? `Nothing matched "${searchQuery}".` : 'No invoices in this date range.'}
            />
          ) : (
            <EmptyState
              icon={Archive}
              title="No previous invoices yet"
              description="Upload old invoices from before you started using this app. They'll be searchable and downloadable here."
              action={{ label: '+ Upload your first invoice', onClick: openNew }}
            />
          )
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="#" sortKey="serialNumber" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Invoice #" sortKey="invoiceNumber" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Date" sortKey="invoiceDate" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Party" sortKey="partyName" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Amount" sortKey="totalAmount" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <th className="table-header sticky top-0 z-10">File</th>
                  <th className="table-header sticky top-0 z-10">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedItems.map(row => (
                  <tr key={row.id} className="border-t">
                    <td className="table-cell text-sm text-gray-500 dark:text-gray-400">{row.serialNumber ?? '—'}</td>
                    <td className="table-cell font-medium">
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        className="text-primary-600 hover:underline dark:text-primary-300"
                      >
                        {row.invoiceNumber}
                      </button>
                    </td>
                    <td className="table-cell">{new Date(row.invoiceDate).toLocaleDateString('en-GB')}</td>
                    <td className="table-cell">{row.partyName}</td>
                    <td className="table-cell">{formatCurrency(row.totalAmount)}</td>
                    <td className="table-cell text-sm">
                      <div className="truncate max-w-[220px]" title={row.fileName}>{row.fileName}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{formatFileSize(row.fileMimeType)}</div>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleView(row)}
                          title="Open file"
                          className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        <span
                          className="inline-flex items-center justify-center p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300"
                          title="Download as PDF / image / Excel / CSV / Print"
                        >
                          <DownloadMenu getOpts={() => buildDownloadOpts(row)} />
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDelete(row)}
                          title="Delete"
                          className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upload / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl bg-white dark:bg-gray-800 rounded-xl shadow-2xl">
            <div className="px-6 py-4 border-b dark:border-gray-700">
              <h2 className="text-xl font-bold">{editingId ? 'Edit Previous Invoice' : 'Upload Previous Invoice'}</h2>
              {!editingId && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  PDF, image, Excel or CSV. All fields required.
                </p>
              )}
            </div>

            <div className="px-6 py-4 space-y-4">
              {!editingId && (
                <div>
                  <label className="label">File *</label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT_ATTR}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) handleFilePick(f)
                      e.target.value = ''
                    }}
                  />
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="btn btn-secondary inline-flex items-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      {pickedFile ? 'Replace file' : 'Choose file'}
                    </button>
                    {pickedFile && (
                      <span className="text-sm text-gray-600 dark:text-gray-300 truncate">
                        {pickedFile.name}
                      </span>
                    )}
                    {extracting && (
                      <span className="inline-flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400">
                        <Sparkles className="w-4 h-4 animate-pulse" />
                        Extracting…
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Invoice Number *</label>
                  <input
                    type="text"
                    className="input"
                    value={formData.invoiceNumber}
                    onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Date *</label>
                  <DateInput
                    className="input"
                    value={formData.invoiceDate}
                    onChange={(e) => setFormData({ ...formData, invoiceDate: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="label">Party Name *</label>
                <input
                  type="text"
                  className="input"
                  value={formData.partyName}
                  onChange={(e) => setFormData({ ...formData, partyName: e.target.value })}
                />
              </div>

              <div>
                <label className="label">Total Amount *</label>
                <NumberInput
                  className="input"
                  value={formData.totalAmount}
                  onChange={(v) => setFormData({ ...formData, totalAmount: v })}
                />
              </div>

              <div>
                <label className="label">Notes</label>
                <textarea
                  className="input"
                  rows={3}
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Line Items</label>
                  <button
                    type="button"
                    onClick={addItem}
                    className="text-sm text-primary-600 hover:underline dark:text-primary-300"
                  >
                    + Add Row
                  </button>
                </div>
                {formItems.length === 0 ? (
                  <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                    No line items. Click "+ Add Row" to add manually, or upload a PDF for auto-extraction.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-[1fr_70px_60px_80px_60px_90px_32px] gap-2 text-xs text-gray-500 dark:text-gray-400 px-1">
                      <span>Item</span>
                      <span>HSN</span>
                      <span>Qty</span>
                      <span>Rate</span>
                      <span>Tax %</span>
                      <span>Amount</span>
                      <span></span>
                    </div>
                    {formItems.map((item, idx) => (
                      <div
                        key={idx}
                        className="grid grid-cols-[1fr_70px_60px_80px_60px_90px_32px] gap-2 items-center"
                      >
                        <input
                          type="text"
                          className="input"
                          value={item.name}
                          onChange={(e) => updateItem(idx, { name: e.target.value })}
                        />
                        <input
                          type="text"
                          className="input"
                          value={item.hsnCode}
                          onChange={(e) => updateItem(idx, { hsnCode: e.target.value })}
                        />
                        <NumberInput
                          className="input"
                          value={item.quantity}
                          onChange={(v) => updateItem(idx, { quantity: v })}
                        />
                        <NumberInput
                          className="input"
                          value={item.rate}
                          onChange={(v) => updateItem(idx, { rate: v })}
                        />
                        <NumberInput
                          className="input"
                          value={item.taxRate}
                          onChange={(v) => updateItem(idx, { taxRate: v })}
                        />
                        <NumberInput
                          className="input"
                          value={item.amount}
                          onChange={(v) => updateItem(idx, { amount: v })}
                        />
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="p-1.5 rounded hover:bg-red-50 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400"
                          title="Remove row"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t dark:border-gray-700 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                disabled={saving}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || extracting}
                className="btn btn-primary"
              >
                {saving ? 'Saving…' : extracting ? 'Extracting…' : editingId ? 'Save Changes' : 'Upload'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PreviousInvoices
