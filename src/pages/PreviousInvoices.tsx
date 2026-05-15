import { useEffect, useRef, useState } from 'react'
import { Archive, Search as SearchIcon, Upload, Trash2, Sparkles } from 'lucide-react'
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
  partyGstin?: string | null
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
    partyGstin: '',
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
    ;(async () => {
      const initial = await loadRows()
      // Silently backfill anything missing for Excel exports (GSTIN / items)
      // after the page is rendered. Reload only if something actually changed.
      const updated = await backfillForExcel(initial)
      if (updated) await loadRows()
    })()
    // Run once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadRows = async (): Promise<PreviousInvoice[]> => {
    setLoading(true)
    try {
      const result = await window.electronAPI.previousInvoice.getAll()
      if (result.success && result.data) {
        const list = result.data as PreviousInvoice[]
        setRows(list)
        return list
      } else if (result.error) {
        toast.error(result.error)
      }
      return []
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
      partyGstin: '',
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
      partyGstin: row.partyGstin || '',
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
      // For PDFs with a text layer (app-generated and most digital PDFs), try
      // deterministic text-extraction first — same regex parser used by the
      // backfill script, no API cost, no token-limit truncation, no vision-
      // model misreads of 15-char GSTINs. OCR is the fallback for scanned /
      // image PDFs and direct image uploads.
      let ex: any = null
      let textTried = false
      let textError: string | null = null
      if (mime === 'application/pdf') {
        textTried = true
        const textResult = await (window.electronAPI as any).previousInvoice.extractFromPdfText({
          fileBytes: new Uint8Array(buf),
        })
        if (textResult.success && textResult.data) {
          ex = textResult.data
        } else if (textResult.error && textResult.error !== 'NO_TEXT_LAYER') {
          textError = textResult.error
        }
      }

      // Fall back to OCR if text extraction didn't yield usable data (scanned
      // PDF, image upload, or text-parse error).
      if (!ex) {
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
          // Surface the actual error instead of a generic "unavailable" — the
          // user needs to know whether it's a config problem (missing API key),
          // a rate limit, or a model issue they can retry.
          const ocrError = result.error || 'unknown error'
          const prefix = textTried ? 'Auto-fill failed (text + OCR). ' : 'Auto-fill failed (OCR). '
          const detail = textError ? ` Text parser error: ${textError}.` : ''
          toast.error(`${prefix}OCR error: ${ocrError}.${detail} Enter details manually.`)
          return
        }
        ex = result.data
      }
      const normalizedDate = normalizeExtractedDate(ex.billDate)
      setFormData((prev) => ({
        invoiceNumber: ex.billNumber || prev.invoiceNumber,
        invoiceDate: normalizedDate || prev.invoiceDate,
        partyName: ex.supplierName || prev.partyName,
        partyGstin: ex.supplierGstin || prev.partyGstin,
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

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault()
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

    // On create: if OCR failed / file was Excel-CSV / user skipped items,
    // synthesize a single fallback row carrying the invoice total. Guarantees
    // every imported invoice lands in the DB with at least one line item so
    // Excel/CSV downloads and reporting never show empty data. User can
    // replace it later via Edit (and on edit we respect zero-items intent).
    if (!editingId && itemsPayload.length === 0) {
      itemsPayload.push({
        name: `Invoice ${formData.invoiceNumber.trim() || 'imported'}`,
        hsnCode: null,
        quantity: 1,
        unit: null,
        rate: formData.totalAmount,
        discount: 0,
        taxRate: 0,
        amount: formData.totalAmount,
      })
    }

    setSaving(true)
    try {
      if (editingId) {
        const result = await window.electronAPI.previousInvoice.update(editingId, {
          invoiceNumber: formData.invoiceNumber.trim(),
          invoiceDate: formData.invoiceDate,
          partyName: formData.partyName.trim(),
          partyGstin: formData.partyGstin.trim() || null,
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
          partyGstin: formData.partyGstin.trim() || null,
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

      const noItems = items.length === 0
      // When no items are captured (legacy upload / failed OCR), fall back to
      // a single row carrying the invoice total in the Amount column. The
      // alternative — a row of all blanks — looks broken in the saved Excel.
      const subtotal = noItems
        ? row.totalAmount
        : items.reduce((s, it) => s + (it.quantity || 0) * (it.rate || 0), 0)
      const tax = noItems
        ? 0
        : items.reduce((s, it) => {
            const taxable = (it.quantity || 0) * (it.rate || 0)
            return s + taxable * ((it.taxRate || 0) / 100)
          }, 0)
      // Header shape matches Sales (src/pages/Sales.tsx buildInvoiceTableData)
      // so a merged export lines up. Status has no source on PreviousInvoice
      // (no payment state tracked) — left blank rather than dropped.
      const meta: Array<[string, string | number]> = [
        ['Invoice', row.invoiceNumber],
        ['Date', new Date(row.invoiceDate).toLocaleDateString('en-GB')],
        ['Customer', row.partyName],
        ['GSTIN', row.partyGstin || ''],
      ]
      const metaSuffix: Array<[string, string | number]> = [
        ['Subtotal', subtotal],
        ['Tax', tax],
        ['Total', row.totalAmount],
        ['Status', ''],
      ]
      const headers = ['Item', 'HSN/SAC', 'Qty', 'Rate', 'Discount', 'Tax %', 'Amount']
      const rowsOut: (string | number)[][] = noItems
        ? [['(no line items)', '', 1, row.totalAmount, 0, 0, row.totalAmount]]
        : items.map(it => [
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

  // Silently walk every previous invoice and backfill missing data needed by
  // the Excel export — GSTIN if blank, line items if empty or only the
  // "Invoice <number>" fallback. User-edited items are preserved. Runs once
  // per page mount in the background; rows that already have data are
  // skipped, so once the DB is fully backfilled the loop becomes a no-op.
  const backfillForExcel = async (current: PreviousInvoice[]): Promise<boolean> => {
    let anyUpdated = false
    for (const r of current) {
      const isExtractable =
        r.fileMimeType === 'application/pdf' || r.fileMimeType.startsWith('image/')
      if (!isExtractable) continue
      try {
        const detail = await window.electronAPI.previousInvoice.getById(r.id)
        if (!detail.success || !detail.data) continue
        const existing = detail.data as any
        const existingItems: any[] = existing.items || []
        const hasGstin = !!(existing.partyGstin && String(existing.partyGstin).trim())
        const isFallbackOnly =
          existingItems.length === 1 &&
          typeof existingItems[0].name === 'string' &&
          existingItems[0].name.startsWith('Invoice ')
        const itemsEmpty = existingItems.length === 0 || isFallbackOnly
        if (hasGstin && !itemsEmpty) continue

        const fileRes = await window.electronAPI.previousInvoice.getFile(r.id)
        if (!fileRes.success || !fileRes.data) continue
        const mime = fileRes.data.fileMimeType
        let data: any = null

        // Try deterministic text extraction first for PDFs.
        if (mime === 'application/pdf') {
          const textRes = await (window.electronAPI as any).previousInvoice.extractFromPdfText({
            fileBytes: new Uint8Array(fileRes.data.fileData),
          })
          if (textRes.success && textRes.data) data = textRes.data
        }

        // Fall back to OCR if text extraction didn't yield data.
        if (!data) {
          let extractBytes: Uint8Array = fileRes.data.fileData
          let extractMime = mime
          if (extractMime === 'application/pdf') {
            try {
              extractBytes = await renderPdfFirstPage(extractBytes)
              extractMime = 'image/png'
            } catch {
              continue
            }
          }
          const ex = await window.electronAPI.purchase.extractFromImage({
            fileBytes: new Uint8Array(extractBytes),
            mimeType: extractMime,
          } as any)
          if (!ex.success || !ex.data) continue
          data = ex.data
        }
        const patch: any = {}
        if (!hasGstin && data.supplierGstin) patch.partyGstin = data.supplierGstin
        if (itemsEmpty && Array.isArray(data.items) && data.items.length > 0) {
          patch.items = data.items.map((it: any) => ({
            name: it.name ?? '',
            hsnCode: it.hsnCode ?? null,
            quantity: typeof it.quantity === 'number' ? it.quantity : 0,
            unit: null,
            rate: typeof it.rate === 'number' ? it.rate : 0,
            discount: typeof it.discount === 'number' ? it.discount : 0,
            taxRate: typeof it.taxRate === 'number' ? it.taxRate : 0,
            amount: typeof it.total === 'number'
              ? it.total
              : (it.quantity || 0) * (it.rate || 0),
          }))
        }
        if (Object.keys(patch).length === 0) continue
        const save = await window.electronAPI.previousInvoice.update(r.id, patch)
        if (save.success) anyUpdated = true
      } catch {
        // Skip this row, continue.
      }
    }
    return anyUpdated
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
      // Mirror the Sales bulk shape: one row per line item, document-level
      // fields repeated on each row. Status/Paid/Balance are omitted because
      // PreviousInvoice doesn't track payment state.
      const headers = [
        'Invoice #', 'Date', 'Customer', 'GSTIN',
        'Item', 'HSN/SAC', 'Qty', 'Rate', 'Discount', 'Tax %', 'Amount',
        'Subtotal', 'Tax', 'Total',
      ]
      const rows: (string | number)[][] = []
      for (const r of matching) {
        const dateStr = new Date(r.invoiceDate).toLocaleDateString('en-GB')
        const gstin = r.partyGstin || ''
        // Items were captured at upload time into PreviousInvoiceItem.
        const detail = await window.electronAPI.previousInvoice.getById(r.id)
        const items: Array<Record<string, any>> = (detail.success && detail.data?.items) || []
        const subtotal = items.reduce((s, it) => s + (it.quantity || 0) * (it.rate || 0), 0)
        const tax = items.reduce((s, it) => {
          const taxable = (it.quantity || 0) * (it.rate || 0)
          return s + taxable * ((it.taxRate || 0) / 100)
        }, 0)
        const invoiceTrailer: (string | number)[] = [subtotal, tax, r.totalAmount]
        if (items.length === 0) {
          // No items captured — surface the invoice total in the Amount column
          // so the row carries useful data. Subtotal/Tax mirror the fallback
          // used by single-invoice download.
          rows.push([
            r.invoiceNumber, dateStr, r.partyName, gstin,
            '(no line items)', '', 1, r.totalAmount, 0, 0, r.totalAmount,
            r.totalAmount, 0, r.totalAmount,
          ])
          continue
        }
        for (const it of items) {
          rows.push([
            r.invoiceNumber,
            dateStr,
            r.partyName,
            gstin,
            it.name ?? '',
            it.hsnCode ?? '',
            it.quantity ?? 0,
            it.rate ?? 0,
            it.discount ?? 0,
            it.taxRate ?? 0,
            it.amount ?? (it.quantity || 0) * (it.rate || 0),
            ...invoiceTrailer,
          ])
        }
      }
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
                  <th className="table-header sticky top-0 z-10">Status</th>
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
                      <span
                        className="ml-2 inline-block px-1.5 py-0.5 text-xs rounded bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                        title={row.fileName}
                      >
                        {formatFileSize(row.fileMimeType)}
                      </span>
                    </td>
                    <td className="table-cell">{new Date(row.invoiceDate).toLocaleDateString('en-GB')}</td>
                    <td className="table-cell">{row.partyName}</td>
                    <td className="table-cell">{formatCurrency(row.totalAmount)}</td>
                    <td className="table-cell">
                      <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                        Archived
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => handleView(row)}
                          className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          className="text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                        >
                          Edit
                        </button>
                        <DownloadMenu getOpts={() => buildDownloadOpts(row)} />
                        <button
                          type="button"
                          onClick={() => handleDelete(row)}
                          className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                        >
                          Delete
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

      {/* Upload / Edit modal — laid out to match Purchase Bills */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">
                  {editingId ? 'Edit Previous Invoice' : 'Upload Previous Invoice'}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl"
                >
                  ×
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-6">
                {/* AI Extract from File */}
                {!editingId && (
                  <div className="flex items-center justify-between gap-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <div>
                      <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                        Have a PDF, image, Excel or CSV of the invoice?
                      </p>
                      <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                        We'll store the file and auto-fill the form. Review before saving.
                      </p>
                      {pickedFile && (
                        <p className="text-xs text-green-700 dark:text-green-300 mt-1 font-medium">
                          ✓ {pickedFile.name} ({(pickedFile.bytes.byteLength / 1024).toFixed(1)} KB)
                        </p>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ACCEPT_ATTR}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) handleFilePick(f)
                        e.target.value = ''
                      }}
                      style={{ display: 'none' }}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={extracting}
                      className="btn btn-primary gap-2 flex items-center"
                    >
                      {extracting ? (
                        <>
                          <Sparkles className="w-4 h-4 animate-pulse" />
                          Extracting…
                        </>
                      ) : (
                        <>
                          <Upload className="w-4 h-4" />
                          {pickedFile ? 'Replace File' : 'Choose File'}
                        </>
                      )}
                    </button>
                  </div>
                )}

                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Supplier / Party *</label>
                    <input
                      type="text"
                      className="input"
                      value={formData.partyName}
                      onChange={(e) => setFormData({ ...formData, partyName: e.target.value })}
                      required
                    />
                  </div>

                  <div>
                    <label className="label">Bill Date *</label>
                    <DateInput
                      className="input"
                      value={formData.invoiceDate}
                      onChange={(e) => setFormData({ ...formData, invoiceDate: e.target.value })}
                      required
                    />
                  </div>

                  <div>
                    <label className="label">Supplier GSTIN</label>
                    <input
                      type="text"
                      className="input uppercase"
                      placeholder="15-character GSTIN"
                      maxLength={15}
                      value={formData.partyGstin}
                      onChange={(e) => setFormData({ ...formData, partyGstin: e.target.value.toUpperCase() })}
                    />
                  </div>

                  <div>
                    <label className="label">Invoice Number *</label>
                    <input
                      type="text"
                      className="input"
                      value={formData.invoiceNumber}
                      onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                      placeholder="As printed on the bill"
                      required
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="label">Total Amount *</label>
                    <NumberInput
                      className="input"
                      value={formData.totalAmount}
                      onChange={(v) => setFormData({ ...formData, totalAmount: v })}
                    />
                  </div>
                </div>

                {/* Items Section */}
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">Bill Items</h3>
                    <button type="button" onClick={addItem} className="btn btn-secondary text-sm">
                      + Add Item
                    </button>
                  </div>

                  {formItems.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 dark:bg-gray-900/40 rounded-lg border-2 border-dashed">
                      <p className="text-gray-500 dark:text-gray-400 mb-2">No items added yet</p>
                      <button
                        type="button"
                        onClick={addItem}
                        className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                      >
                        Click "+ Add Item" to add your first item
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {formItems.map((item, idx) => (
                        <div
                          key={idx}
                          className="flex gap-3 items-end p-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg"
                        >
                          <div className="flex-1">
                            <label className="label text-xs">Item</label>
                            <input
                              type="text"
                              className="input"
                              value={item.name}
                              onChange={(e) => updateItem(idx, { name: e.target.value })}
                            />
                          </div>
                          <div className="w-28">
                            <label className="label text-xs">HSN/SAC</label>
                            <input
                              type="text"
                              className="input"
                              value={item.hsnCode}
                              onChange={(e) => updateItem(idx, { hsnCode: e.target.value })}
                            />
                          </div>
                          <div className="w-20">
                            <label className="label text-xs">Qty</label>
                            <NumberInput
                              className="input"
                              value={item.quantity}
                              onChange={(v) => updateItem(idx, { quantity: v })}
                            />
                          </div>
                          <div className="w-28">
                            <label className="label text-xs">Rate</label>
                            <NumberInput
                              className="input"
                              value={item.rate}
                              onChange={(v) => updateItem(idx, { rate: v })}
                            />
                          </div>
                          <div className="w-20">
                            <label className="label text-xs">Tax %</label>
                            <NumberInput
                              className="input"
                              value={item.taxRate}
                              onChange={(v) => updateItem(idx, { taxRate: v })}
                            />
                          </div>
                          <div className="w-32">
                            <label className="label text-xs">Total</label>
                            <NumberInput
                              className="input"
                              value={item.amount}
                              onChange={(v) => updateItem(idx, { amount: v })}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeItem(idx)}
                            className="btn btn-secondary text-red-600 dark:text-red-400 px-3"
                            title="Remove item"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <label className="label">Notes</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={formData.notes}
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    placeholder="Internal notes..."
                  />
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-4 border-t">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    disabled={saving}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving || extracting}
                    className="btn btn-primary"
                  >
                    {saving
                      ? 'Saving…'
                      : extracting
                      ? 'Extracting…'
                      : editingId
                      ? 'Update Previous Invoice'
                      : 'Create Previous Invoice'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PreviousInvoices
