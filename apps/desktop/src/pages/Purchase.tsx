import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ExtractedBillData, PurchaseBill, Supplier } from '../types'
import { formatCurrency } from '../utils/currency'
import { formatInvoiceStatus } from '../utils/invoiceStatus'
import NumberInput from '../components/NumberInput'
import DateInput from '../components/DateInput'
import { useToast } from '../components/ToastContext'
import { useConfirm } from '../components/ConfirmDialogContext'
import EmptyState from '../components/EmptyState'
import { TableSkeleton } from '../components/Skeleton'
import { Camera, ShoppingCart, Search as SearchIcon } from 'lucide-react'
import SearchableSelect from '../components/SearchableSelect'
import ShareMenu from '../components/ShareMenu'
import { sharePdf, ShareTarget } from '../utils/sharePdf'
import { validateGSTIN } from '../utils/gstValidation'
import {
  getPurchaseBillPDFBytes,
  buildPurchaseBillFilename,
  PurchaseBillPDFData,
} from '../utils/pdfmakePurchaseBill'
import { loadCompanyForPDF } from '../utils/loadCompanyForPDF'
import DownloadMenu from '../components/DownloadMenu'
import BulkDownloadMenu from '../components/BulkDownloadMenu'
import { DispatchOpts, TableData } from '../utils/downloadHelpers'
import { bulkDownloadPdfs, bulkDownloadExcel, buildZipFilename } from '../utils/bulkDownloadPdfs'
import { renderPdfFirstPage } from '../utils/pdfRender'

interface Item {
  id: string
  name: string
  purchasePrice: number
  taxRate: number
  hsnCode?: string
  skuHsn?: string
}

interface BillItem {
  itemId: string
  hsnCode: string
  quantity: number
  rate: number
  taxRate: number
  discount: number
  amount: number
  // Underscore prefix signals: not persisted, only for UI hints during extraction
  _extractedName?: string
}

const normalizeBill = (bill: any): PurchaseBill => ({
  ...bill,
  // Items still need real normalization — backend returns SupplierItem rows we want to read
  // as if they were the bill line's `.item`, with linkedItem filling in stock-tracked fields
  // when present.
  items: (bill.items || []).map((item: any) => ({
    ...item,
    itemId: item.supplierItemId || item.supplierItem?.id || '',
    item: item.supplierItem?.linkedItem || {
      id: item.supplierItem?.id,
      name: item.supplierItem?.name,
      purchasePrice: item.supplierItem?.lastPurchasePrice || item.rate || 0,
      taxRate: item.supplierItem?.defaultTaxRate || item.taxRate || 0,
      hsnCode: item.supplierItem?.hsnCode || item.hsnCode || '',
      skuHsn: item.supplierItem?.linkedItem?.skuHsn,
    },
  })),
})

const Purchase = () => {
  const [bills, setBills] = useState<PurchaseBill[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [viewingBill, setViewingBill] = useState<PurchaseBill | null>(null)
  const [editingBill, setEditingBill] = useState<PurchaseBill | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState<'all' | '7d' | '1m' | '1q' | '1y' | 'custom'>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [bulkDownloading, setBulkDownloading] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    supplierId: '',
    billNumber: '',
    // The supplier's own invoice number (e.g., "HARI-2024-001"). Separate from our internal
    // billNumber, which is unique-constrained and auto-generated.
    supplierInvoiceNumber: '',
    billDate: new Date().toISOString().split('T')[0],
    notes: '',
    // Optional link back to the originating PurchaseOrder. When set, the PO is closed
    // by the backend on bill save. Bills can also be standalone (cash/walk-in purchases).
    purchaseOrderId: '',
  })

  // Open POs for the currently-selected supplier (populated when supplier changes).
  // Drives the "Reference PO" dropdown on the bill form.
  const [openPOs, setOpenPOs] = useState<Array<{ id: string; orderNumber: string; orderDate: string | Date; totalAmount: number }>>([])

  // Bill-level tax breakdown (CGST + SGST for intra-state, IGST for inter-state).
  // Some invoice photos show tax only as separate CGST/SGST/IGST totals at the bottom
  // (no per-item tax column). When ANY of these is non-zero, line items keep taxRate=0
  // and the bill-level total tax = cgst + sgst + igst. When all three are 0, the form
  // falls back to per-item tax calculation (existing behavior).
  const [taxBreakdown, setTaxBreakdown] = useState<{
    cgst: number
    sgst: number
    igst: number
  }>({ cgst: 0, sgst: 0, igst: 0 })

  const [billItems, setBillItems] = useState<BillItem[]>([])

  // AI extraction state
  const [extracting, setExtracting] = useState(false)
  const [attachmentBytes, setAttachmentBytes] = useState<Uint8Array | null>(null)
  const [attachmentMimeType, setAttachmentMimeType] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Set when AI extraction returns a supplier name we couldn't match — drives the inline "+ Create supplier" panel.
  const [unmatchedSupplier, setUnmatchedSupplier] = useState<{
    name: string
    gstin?: string
    address?: string
    city?: string
    pincode?: string
    phone?: string
    email?: string
  } | null>(null)
  const [creatingSupplier, setCreatingSupplier] = useState(false)

  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    loadBills()
    loadSuppliers()
  }, [])

  // Items + open POs are scoped per-supplier — refetch whenever the supplier changes
  // (or clear if none picked).
  useEffect(() => {
    if (formData.supplierId) {
      loadItems(formData.supplierId)
      loadOpenPOs(formData.supplierId)
    } else {
      setItems([])
      setOpenPOs([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.supplierId])

  // Auto-open the create-bill modal when navigated here from Dashboard's "+ New Purchase"
  useEffect(() => {
    if ((location.state as { openNew?: boolean } | null)?.openNew) {
      setShowModal(true)
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  const toast = useToast()
  const confirm = useConfirm()

  const loadBills = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.purchase.getAll()
      if (result.success && result.data) {
        setBills(result.data.map(normalizeBill))
      }
    } finally {
      setLoading(false)
    }
  }

  const loadSuppliers = async () => {
    const result = await window.electronAPI.supplier.getAll()
    if (result.success && result.data) {
      setSuppliers(result.data)
    }
  }

  const loadItems = async (supplierId: string) => {
    const result = await window.electronAPI.supplierItem.getAll(supplierId)
    if (result.success && result.data) {
      setItems(result.data.map((item: any) => ({
        id: item.id,
        name: item.name,
        purchasePrice: item.lastPurchasePrice || 0,
        taxRate: item.defaultTaxRate || 0,
        hsnCode: item.hsnCode || item.linkedItem?.hsnCode || '',
        skuHsn: item.linkedItem?.skuHsn,
      })))
    }
  }

  const handleCancel = async (id: string) => {
    const confirmed = await confirm({
      message: 'Cancel this purchase bill? The supplier balance and any stock it added are reversed, and it is marked Cancelled for your records. This cannot be undone.',
      danger: true,
    })
    if (confirmed) {
      const result = await window.electronAPI.purchase.cancel(id)
      if (result.success) {
        loadBills()
      } else {
        toast.error('Failed to cancel purchase bill: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const handleView = async (id: string) => {
    const result = await window.electronAPI.purchase.getById(id)
    if (result.success && result.data) {
      setViewingBill(normalizeBill(result.data))
      setShowViewModal(true)
    }
  }

  // Build the PDF input shape from the raw bill row and the active company.
  // Falls back to billing supplier->party fields and computes taxableAmount per line.
  const loadPurchaseBillPDFData = async (id: string): Promise<PurchaseBillPDFData | null> => {
    const result = await window.electronAPI.purchase.getById(id)
    if (!result.success || !result.data) {
      toast.error(result.error || 'Failed to fetch bill')
      return null
    }
    const bill: any = result.data
    const company = await loadCompanyForPDF()
    const supplier = bill.supplier || bill.party || {}
    const items = (bill.items || []).map((it: any) => {
      const quantity = it.quantity || 0
      const rate = it.rate || 0
      const discount = it.discount || 0
      const linked = it.supplierItem?.linkedItem
      return {
        item: {
          name: it.supplierItem?.name || linked?.name || it.item?.name || 'Item',
          unit: it.supplierItem?.unit || linked?.unit || 'pcs',
          hsnCode: it.hsnCode || it.supplierItem?.hsnCode || linked?.hsnCode || linked?.skuHsn || '',
          skuHsn: linked?.skuHsn,
        },
        quantity,
        rate,
        taxRate: it.taxRate || 0,
        discount,
        total: it.total || 0,
        hsnCode: it.hsnCode || it.supplierItem?.hsnCode || linked?.hsnCode || linked?.skuHsn || '',
        taxableAmount: quantity * rate - discount,
      }
    })
    return {
      billNumber: bill.billNumber,
      billDate: bill.billDate,
      supplierInvoiceNumber: bill.supplierInvoiceNumber,
      supplierInvoiceDate: bill.supplierInvoiceDate,
      notes: bill.notes,
      totalAmount: bill.totalAmount || 0,
      subtotal: bill.subtotalAmount ?? bill.subtotal,
      taxAmount: bill.taxAmount,
      supplier: {
        name: supplier.name || '',
        taxId: supplier.taxId,
        phone: supplier.phone,
        email: supplier.email,
        billingAddress: supplier.billingAddress,
      },
      items,
      company,
    }
  }

  const buildBillTableData = (data: PurchaseBillPDFData): TableData => {
    const meta: Array<[string, string | number]> = [
      ['Bill', data.billNumber || ''],
      ['Date', data.billDate ? new Date(data.billDate).toLocaleDateString('en-GB') : ''],
      ['Supplier', data.supplier?.name || ''],
      ['GSTIN', data.supplier?.taxId || ''],
    ]
    if (data.supplierInvoiceNumber) meta.push(['Supplier Inv. #', data.supplierInvoiceNumber])
    const metaSuffix: Array<[string, string | number]> = [
      ['Subtotal', data.subtotal || 0],
      ['Tax', data.taxAmount || 0],
      ['Total', data.totalAmount || 0],
    ]
    const headers = ['Item', 'HSN', 'Qty', 'Rate', 'Discount', 'Tax %', 'Amount']
    const rows: (string | number)[][] = (data.items || []).map((it) => [
      it.item?.name || '',
      it.hsnCode || it.item?.hsnCode || it.item?.skuHsn || '',
      it.quantity || 0,
      it.rate || 0,
      it.discount || 0,
      it.taxRate || 0,
      it.total || 0,
    ])
    return { baseName: buildPurchaseBillFilename(data).replace(/\.pdf$/i, ''), meta, metaSuffix, headers, rows }
  }

  const handleBulkDownloadPdfs = async (matching: PurchaseBill[]) => {
    if (matching.length === 0) {
      toast.info('No bills to download')
      return
    }
    const partyName = matching[0]?.supplier?.name || searchQuery || 'all'

    setBulkDownloading(true)
    try {
      const items = matching.map(b => ({
        id: b.id,
        filename: `${b.billNumber.replace(/\//g, '_')}.pdf`,
      }))
      const result = await bulkDownloadPdfs({
        items,
        zipFilename: buildZipFilename('Purchase_Bills', partyName),
        getBytes: async (id) => {
          const data = await loadPurchaseBillPDFData(id)
          if (!data) return null
          return await getPurchaseBillPDFBytes(data)
        },
      })
      if (result.added > 0) {
        toast.success(`Downloaded ${result.added} PDF${result.added === 1 ? '' : 's'}${result.failed ? ` (${result.failed} failed)` : ''}`)
      } else {
        toast.error('Failed to generate any PDFs')
      }
    } catch (error) {
      console.error('Bulk PDF download error:', error)
      toast.error('Failed to bulk-download PDFs')
    } finally {
      setBulkDownloading(false)
    }
  }

  const handleBulkDownloadExcel = async (matching: PurchaseBill[]) => {
    if (matching.length === 0) {
      toast.info('No bills to download')
      return
    }
    const partyName = matching[0]?.supplier?.name || searchQuery || 'all'

    setBulkDownloading(true)
    try {
      const headers = [
        'Bill #', 'Supplier Invoice #', 'Date', 'Supplier', 'GSTIN',
        'Item', 'HSN/SAC', 'Qty', 'Rate', 'Discount', 'Tax %', 'Amount',
        'Subtotal', 'Tax', 'Total', 'Paid', 'Balance', 'Status',
      ]
      const rows: (string | number)[][] = []
      for (const b of matching) {
        let items: any[] = (b as any).items || []
        if (!items.length) {
          const res = await window.electronAPI.purchase.getById(b.id)
          if (res.success && res.data) items = (res.data as any).items || []
        }
        const dateStr = b.billDate ? new Date(b.billDate).toLocaleDateString('en-GB') : ''
        const trailer: (string | number)[] = [
          b.subtotal || 0,
          b.taxAmount || 0,
          b.totalAmount || 0,
          b.amountPaid || 0,
          b.balanceDue || 0,
          b.status || '',
        ]
        if (items.length === 0) {
          rows.push([
            b.billNumber || '',
            b.supplierInvoiceNumber || '',
            dateStr,
            b.supplier?.name || '',
            b.supplier?.taxId || '',
            '', '', 0, 0, 0, 0, 0,
            ...trailer,
          ])
          continue
        }
        for (const it of items) {
          rows.push([
            b.billNumber || '',
            b.supplierInvoiceNumber || '',
            dateStr,
            b.supplier?.name || '',
            b.supplier?.taxId || '',
            it.supplierItem?.name || it.item?.name || '',
            it.hsnCode || it.supplierItem?.hsnCode || it.item?.hsnCode || '',
            it.quantity || 0,
            it.rate || 0,
            it.discount || 0,
            it.taxRate || 0,
            it.total || 0,
            ...trailer,
          ])
        }
      }

      const today = new Date().toISOString().slice(0, 10)
      const filename = `Purchase_Bills_${(partyName || 'all').replace(/[^a-z0-9]+/gi, '_')}_${today}.xlsx`
      await bulkDownloadExcel({
        filename,
        sheets: [{
          name: 'Purchase Bills',
          meta: [['Generated', new Date().toLocaleString()]],
          headers,
          rows,
        }],
      })
      toast.success(`Exported ${matching.length} bill${matching.length === 1 ? '' : 's'} to Excel`)
    } catch (error) {
      console.error('Bulk Excel error:', error)
      toast.error('Failed to bulk-download Excel')
    } finally {
      setBulkDownloading(false)
    }
  }

  const buildDownloadOpts = async (id: string): Promise<DispatchOpts> => {
    const data = await loadPurchaseBillPDFData(id)
    if (!data) throw new Error('Failed to load bill details')
    let cached: { bytes: Uint8Array; filename: string } | null = null
    const getPdf = async () => {
      if (!cached) {
        const bytes = await getPurchaseBillPDFBytes(data)
        cached = { bytes, filename: buildPurchaseBillFilename(data) }
      }
      return cached
    }
    return {
      getPdf,
      getTable: async () => buildBillTableData(data),
    }
  }

  // Fetch the saved supplier attachment (BLOB) for a bill. Centralized so both
  // open-in-window and share-via-X paths use the same fetch + Buffer→Uint8Array conversion.
  const loadAttachment = async (id: string) => {
    let result = await window.electronAPI.purchase.getById(id)
    if (!result.success || !result.data) {
      toast.error(result.error || 'Failed to fetch bill')
      return null
    }
    let bill = result.data as any

    // Synced-in bill: the photo lives on Drive as its own file (S4 image
    // split) — fetch it once, then it's local forever.
    if (!bill.attachmentData && bill.attachmentMimeType) {
      toast.info('Fetching the photo from your Drive…')
      const fetched = await window.electronAPI.sync.fetchBillImage(id)
      if (!fetched.success) {
        toast.error(fetched.error || 'Photo download failed')
        return null
      }
      result = await window.electronAPI.purchase.getById(id)
      if (!result.success || !result.data) return null
      bill = result.data as any
    }

    if (!bill.attachmentData || !bill.attachmentMimeType) {
      toast.info('No attachment saved on this bill')
      return null
    }
    const bytes =
      bill.attachmentData instanceof Uint8Array
        ? bill.attachmentData
        : new Uint8Array(bill.attachmentData)
    return { bill, bytes, mimeType: bill.attachmentMimeType as string }
  }

  // Open the original supplier bill (image/PDF the user uploaded) in a new window.
  const handleOpenAttachment = async (id: string) => {
    const att = await loadAttachment(id)
    if (!att) return
    const blob = new Blob([att.bytes], { type: att.mimeType })
    const url = URL.createObjectURL(blob)
    const opened = window.open(url, '_blank')
    // Revoke after a delay so the new window has time to load. If blocked, fall back to download.
    if (!opened) {
      const a = document.createElement('a')
      a.href = url
      a.download = `${att.bill.billNumber || 'bill'}${att.mimeType === 'application/pdf' ? '.pdf' : ''}`
      a.click()
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const handleShare = async (id: string, target: ShareTarget) => {
    try {
      const data = await loadPurchaseBillPDFData(id)
      if (!data) return
      const bytes = await getPurchaseBillPDFBytes(data)
      const filename = buildPurchaseBillFilename(data)
      const subject = `Bill ${data.billNumber} from ${data.company?.name || ''}`.trim()
      await sharePdf(bytes, filename, target, toast, {
        subject,
        phone: data.supplier.phone,
        email: data.supplier.email,
        partyName: data.supplier.name,
      })
    } catch (err) {
      console.error('Error sharing bill:', err)
      toast.error('Failed to share bill')
    }
  }

  const handleEdit = async (bill: PurchaseBill) => {
    const result = await window.electronAPI.purchase.getById(bill.id)
    if (result.success && result.data) {
      const fullBill = normalizeBill(result.data)
      setEditingBill(fullBill)
      setFormData({
        supplierId: fullBill.supplierId || fullBill.supplier?.id || '',
        billNumber: fullBill.billNumber || '',
        supplierInvoiceNumber: fullBill.supplierInvoiceNumber || '',
        // IPC structured-clone preserves Date objects, so billDate may be a Date instance
        // (not the string the type claims). Wrap in `new Date()` so this works for both shapes.
        billDate: new Date(fullBill.billDate).toISOString().split('T')[0],
        notes: fullBill.notes || '',
        purchaseOrderId: fullBill.purchaseOrderId || '',
      })
      setBillItems(fullBill.items?.map((item: any) => ({
        // normalizeBill already resolved itemId to the SupplierItem.id (the dropdown's value space).
        // The previous fallback `item.item?.id` would resolve to the *linked Item*'s id when one
        // existed — wrong key, dropdown showed blank.
        itemId: item.itemId,
        hsnCode: item.hsnCode || item.item?.hsnCode || item.item?.skuHsn || '',
        quantity: item.quantity,
        rate: item.rate,
        taxRate: item.taxRate,
        discount: item.discount || 0,
        amount: item.total
      })) || [])
      // Reset extraction state — when editing an existing bill, we don't replay extraction.
      // The attachment that's already in the DB stays there (we don't re-send it on update unless
      // a new file is uploaded).
      setAttachmentBytes(null)
      setAttachmentMimeType(null)
      // Recover the bill-level CGST/SGST/IGST breakdown saved with the bill.
      setTaxBreakdown({
        cgst: (fullBill as any).cgstAmount || 0,
        sgst: (fullBill as any).sgstAmount || 0,
        igst: (fullBill as any).igstAmount || 0,
      })
      setShowModal(true)
    }
  }

  // Try to auto-pick the supplier from extracted bill data.
  // GSTIN match wins (definitive). Falls back to case-insensitive name match.
  const findSupplierFromExtraction = (extracted: ExtractedBillData): Supplier | null => {
    if (extracted.supplierGstin) {
      const byGstin = suppliers.find(
        (s) =>
          s.taxId?.toLowerCase().trim() ===
          extracted.supplierGstin?.toLowerCase().trim()
      )
      if (byGstin) return byGstin
    }
    if (extracted.supplierName) {
      const byName = suppliers.find(
        (s) =>
          s.name.toLowerCase().trim() ===
          extracted.supplierName?.toLowerCase().trim()
      )
      if (byName) return byName
    }
    return null
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setExtracting(true)
    try {
      // Read the original file bytes once — these go to the DB as the bill's attachment
      // (preserved as PDF if the user uploaded a PDF, so the audit trail is intact).
      const arrayBuffer = await file.arrayBuffer()
      const originalBytes = new Uint8Array(arrayBuffer)

      // OCR providers like Qianfan-OCR-Fast only accept image MIME types. If the user
      // uploaded a PDF, render its first page to PNG here in the renderer so the backend
      // always sends an image to the OCR API. The original PDF still gets stored as the
      // attachment below.
      let extractBytes = originalBytes
      let extractMimeType = file.type
      if (file.type === 'application/pdf') {
        try {
          extractBytes = await renderPdfFirstPage(originalBytes)
          extractMimeType = 'image/png'
        } catch (err) {
          toast.error(`Failed to read PDF: ${err instanceof Error ? err.message : 'unknown'}`)
          return
        }
      }

      const result = await window.electronAPI.purchase.extractFromImage({
        fileBytes: extractBytes,
        mimeType: extractMimeType
      })

      if (!result.success || !result.data) {
        toast.error(result.error || 'Failed to extract bill data')
        return
      }

      const extracted = result.data

      // Pre-fill header fields from extraction (only fill what we got back).
      const matchedSupplier = findSupplierFromExtraction(extracted)

      // Fetch the matched supplier's catalog *now* so we can preselect existing rows for
      // extracted items that already live in the catalog. Without this, every re-extraction
      // shows "Will save as new item" — even though the backend would correctly dedupe on save.
      let catalogItems: { id: string; name: string; hsnCode?: string | null; defaultTaxRate?: number }[] = []
      if (matchedSupplier) {
        const catalogRes = await window.electronAPI.supplierItem.getAll(matchedSupplier.id)
        if (catalogRes.success && catalogRes.data) {
          catalogItems = catalogRes.data
        }
      }

      setFormData((prev) => ({
        ...prev,
        supplierId: matchedSupplier?.id || prev.supplierId,
        // The number on the supplier's bill is THEIR invoice number, not our internal billNumber
        // (which is unique-constrained and auto-generated on save). Stuffing extracted.billNumber
        // into our billNumber column was the cause of the unique-violation when re-extracting bills.
        supplierInvoiceNumber: extracted.billNumber || prev.supplierInvoiceNumber,
        billDate: extracted.billDate || prev.billDate
      }))

      // Surface inline "+ Create supplier" UI when extraction returned a name we can't match.
      if (!matchedSupplier && extracted.supplierName) {
        setUnmatchedSupplier({
          name: extracted.supplierName,
          gstin: extracted.supplierGstin || undefined,
          address: extracted.supplierAddress || undefined,
          city: extracted.supplierCity || undefined,
          pincode: extracted.supplierPincode || undefined,
          phone: extracted.supplierPhone || undefined,
          email: extracted.supplierEmail || undefined,
        })
      } else {
        setUnmatchedSupplier(null)
      }

      // Pre-fill line items. For each extracted item, try to match against the supplier's catalog
      // using the same normalizer the backend uses (`normalizeItemName` in purchase.ts) so the
      // UI hint and the save-time dedupe never disagree. PDF extraction often returns names
      // with odd whitespace, hyphen-vs-space, or punctuation drift — strict equality misses these.
      if (extracted.items && extracted.items.length > 0) {
        const normalizeItemName = (name: string) =>
          (name || '')
            .toLowerCase()
            .replace(/[-/.]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()

        const findCatalogMatch = (name: string) => {
          const target = normalizeItemName(name)
          if (!target) return undefined
          return catalogItems.find((c) => normalizeItemName(c.name) === target)
        }

        // After extraction we ALWAYS surface tax at the bill level (CGST/SGST/IGST in the
        // totals box) and zero out each item's per-item rate. This mirrors how the photo
        // presents tax — a single breakdown at the bottom rather than a column per line.
        // Source of truth, in order of preference:
        //   1. extracted.cgst/sgst/igstAmount (when the AI returned the breakdown)
        //   2. extracted.taxAmount (single bill-level total) → bucket under IGST
        //   3. fall back to summing what per-item rates the AI fabricated → bucket IGST
        const extractedCgst = (extracted as any).cgstAmount || 0
        const extractedSgst = (extracted as any).sgstAmount || 0
        const extractedIgst = (extracted as any).igstAmount || 0
        const breakdownSum = extractedCgst + extractedSgst + extractedIgst

        let nextBreakdown = { cgst: 0, sgst: 0, igst: 0 }
        if (breakdownSum > 0) {
          nextBreakdown = { cgst: extractedCgst, sgst: extractedSgst, igst: extractedIgst }
        } else if ((extracted.taxAmount || 0) > 0) {
          nextBreakdown = { cgst: 0, sgst: 0, igst: extracted.taxAmount! }
        } else {
          // Last-resort: derive total tax from per-item rates the AI may have inferred,
          // so the user sees the right total even on photos where the breakdown isn't
          // explicit. Lump it into IGST as a single bucket — user can resplit.
          const inferredTotal = extracted.items.reduce((sum, it) => {
            const taxable = (it.quantity || 0) * (it.rate || 0)
            return sum + taxable * ((it.taxRate || 0) / 100)
          }, 0)
          if (inferredTotal > 0) nextBreakdown = { cgst: 0, sgst: 0, igst: inferredTotal }
        }
        setTaxBreakdown(nextBreakdown)

        setBillItems(
          extracted.items.map((item) => {
            const match = findCatalogMatch(item.name || '')
            return {
              itemId: match?.id || '',
              hsnCode: item.hsnCode || match?.hsnCode || '',
              quantity: item.quantity || 0,
              rate: item.rate || 0,
              // Always 0 after extraction: tax now lives in the bill-level breakdown.
              taxRate: 0,
              discount: 0,
              amount: item.total || 0,
              _extractedName: item.name,
            }
          })
        )
      }

      // Save the ORIGINAL bytes (not the converted PNG) as the bill's attachment, so the
      // user's audit trail keeps the source document in its original format.
      setAttachmentBytes(originalBytes)
      setAttachmentMimeType(file.type)

      toast.success('Bill data extracted! Review fields and confirm the supplier and items.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to read file')
    } finally {
      setExtracting(false)
      // Reset the input so re-selecting the same file fires onChange again
      e.target.value = ''
    }
  }

  const handleCreateUnmatchedSupplier = async () => {
    if (!unmatchedSupplier) return
    setCreatingSupplier(true)
    try {
      // Derive stateCode/stateName from the GSTIN's first 2 digits so the supplier's first
      // bill correctly identifies as inter- or intra-state (without this, isInterState
      // defaults to false and CGST/SGST splits go wrong on the first save).
      const gstinValidation = unmatchedSupplier.gstin
        ? validateGSTIN(unmatchedSupplier.gstin)
        : null
      const result = await window.electronAPI.supplier.create({
        name: unmatchedSupplier.name,
        taxId: unmatchedSupplier.gstin,
        billingAddress: unmatchedSupplier.address || undefined,
        city: unmatchedSupplier.city || undefined,
        pincode: unmatchedSupplier.pincode || undefined,
        phone: unmatchedSupplier.phone || undefined,
        email: unmatchedSupplier.email || undefined,
        stateCode: gstinValidation?.valid ? gstinValidation.stateCode : undefined,
        stateName: gstinValidation?.valid ? gstinValidation.stateName : undefined,
      })
      if (result.success && result.data) {
        const created = result.data
        setSuppliers((prev) =>
          [...prev, created].sort((a, b) => a.name.localeCompare(b.name))
        )
        setFormData((prev) => ({ ...prev, supplierId: created.id }))
        setUnmatchedSupplier(null)
        toast.success(`Created supplier "${created.name}"`)
      } else {
        toast.error(result.error || 'Failed to create supplier')
      }
    } finally {
      setCreatingSupplier(false)
    }
  }

  const addBillItem = () => {
    // A row is "incomplete" only if it has neither a picked itemId nor an extracted name.
    // Extracted-but-unmapped rows are valid — backend auto-creates a SupplierItem on save.
    const last = billItems[billItems.length - 1]
    if (last && !last.itemId && !last._extractedName) {
      toast.info('Please complete the current item first')
      return
    }
    setBillItems([...billItems, {
      itemId: '',
      hsnCode: '',
      quantity: 1,
      rate: 0,
      taxRate: 0,
      discount: 0,
      amount: 0
    }])
  }

  const updateBillItem = (index: number, field: string, value: any) => {
    const newItems = [...billItems]
    newItems[index] = { ...newItems[index], [field]: value }

    // If item selected, populate rate, tax, and HSN/SKU
    if (field === 'itemId') {
      const item = items.find(i => i.id === value)
      if (item) {
        newItems[index].rate = item.purchasePrice
        newItems[index].taxRate = item.taxRate
        newItems[index].hsnCode = item.hsnCode || item.skuHsn || ''
      }
    }

    // Calculate amount: (qty * rate - discount) * (1 + taxRate/100)
    const qty = newItems[index].quantity || 0
    const rate = newItems[index].rate || 0
    const discount = newItems[index].discount || 0
    const taxRate = newItems[index].taxRate || 0
    newItems[index].amount = (qty * rate - discount) * (1 + taxRate / 100)

    setBillItems(newItems)
  }

  const removeBillItem = (index: number) => {
    setBillItems(billItems.filter((_, i) => i !== index))
  }

  const calculateTotals = () => {
    const subtotal = billItems.reduce((sum, item) => {
      const qty = item.quantity || 0
      const rate = item.rate || 0
      const discount = item.discount || 0
      return sum + (qty * rate - discount)
    }, 0)

    const computedTax = billItems.reduce((sum, item) => {
      const qty = item.quantity || 0
      const rate = item.rate || 0
      const discount = item.discount || 0
      const taxRate = item.taxRate || 0
      return sum + ((qty * rate - discount) * taxRate / 100)
    }, 0)

    // If the user (or AI extraction) populated any of CGST/SGST/IGST at the bill
    // level, those override per-item tax — but ONLY while every line's own tax
    // rate is 0 (same deactivation rule as mobile: typing a per-line rate takes
    // over, so the two sources can never both apply). Otherwise fall back to
    // per-item computation.
    const breakdownTotal = taxBreakdown.cgst + taxBreakdown.sgst + taxBreakdown.igst
    const useBreakdown = breakdownTotal > 0 && billItems.every((it) => !(it.taxRate || 0))
    const taxAmount = useBreakdown ? breakdownTotal : computedTax
    const total = subtotal + taxAmount

    return { subtotal, taxAmount, total, useBreakdown }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.supplierId) {
      toast.info('Please select a supplier')
      return
    }

    if (billItems.length === 0) {
      toast.info('Please add at least one item')
      return
    }

    // Each line either picks an existing supplier item OR carries an extracted name (auto-creates on save).
    // A blank line with neither would crash backend with "Each purchase line must have a supplier item".
    const blankLine = billItems.find((it) => !it.itemId && !it._extractedName)
    if (blankLine) {
      toast.info('Each line must have an item picked from the supplier catalog')
      return
    }

    const { subtotal, taxAmount, total, useBreakdown } = calculateTotals()

    // Keep _extractedName: backend's resolveSupplierItem reads it to auto-create SupplierItem rows
    // for lines the user didn't map to the catalog (typical AI-extraction path).
    const itemsToSave = billItems

    if (editingBill) {
      // Update existing bill
      const billData = {
        ...formData,
        items: itemsToSave,
        subtotalAmount: subtotal,
        taxAmount: taxAmount,
        // Send the explicit split only while the bill-level breakdown is the
        // active tax source — a stale breakdown from a scan must not override
        // the state-based split once per-line rates take over.
        cgstAmount: useBreakdown ? taxBreakdown.cgst : 0,
        sgstAmount: useBreakdown ? taxBreakdown.sgst : 0,
        igstAmount: useBreakdown ? taxBreakdown.igst : 0,
        totalAmount: total,
        // Only include attachment if a new one was uploaded this session
        ...(attachmentBytes && {
          attachmentData: attachmentBytes,
          attachmentMimeType
        })
      }

      const result = await window.electronAPI.purchase.update(editingBill.id, billData)

      if (result.success) {
        toast.success('Purchase bill updated successfully!')
        setShowModal(false)
        resetForm()
        loadBills()
      } else {
        toast.error('Failed to update purchase bill: ' + (result.error || 'Unknown error'))
      }
    } else {
      // Create new bill — use the extracted/typed bill number if present, otherwise auto-generate
      let billNumber = formData.billNumber.trim()
      if (!billNumber) {
        const billNumResult = await window.electronAPI.purchase.generateBillNumber()
        if (!billNumResult.success) {
          toast.error('Failed to generate bill number')
          return
        }
        billNumber = billNumResult.data || ''
      }

      const billData = {
        ...formData,
        billNumber,
        items: itemsToSave,
        subtotalAmount: subtotal,
        taxAmount: taxAmount,
        // Same rule as update above: the split rides only with an active breakdown.
        cgstAmount: useBreakdown ? taxBreakdown.cgst : 0,
        sgstAmount: useBreakdown ? taxBreakdown.sgst : 0,
        igstAmount: useBreakdown ? taxBreakdown.igst : 0,
        totalAmount: total,
        balanceDue: total,
        status: 'DRAFT',
        attachmentData: attachmentBytes,
        attachmentMimeType
      }

      const result = await window.electronAPI.purchase.create(billData)

      if (result.success) {
        toast.success('Purchase bill created successfully!')
        setShowModal(false)
        resetForm()
        loadBills()
      } else {
        toast.error('Failed to create purchase bill: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const resetForm = () => {
    setFormData({
      supplierId: '',
      billNumber: '',
      supplierInvoiceNumber: '',
      billDate: new Date().toISOString().split('T')[0],
      notes: '',
      purchaseOrderId: '',
    })
    setBillItems([])
    setEditingBill(null)
    setAttachmentBytes(null)
    setAttachmentMimeType(null)
    setUnmatchedSupplier(null)
    setTaxBreakdown({ cgst: 0, sgst: 0, igst: 0 })
  }

  // Load PO summaries for the currently-selected supplier (used by Reference PO dropdown).
  const loadOpenPOs = async (supplierId: string) => {
    const result = await window.electronAPI.purchaseOrder.listOpenForSupplier(supplierId)
    if (result.success && result.data) {
      setOpenPOs(
        result.data.map((po: any) => ({
          id: po.id,
          orderNumber: po.orderNumber,
          orderDate: po.orderDate,
          totalAmount: po.totalAmount,
        })),
      )
    } else {
      setOpenPOs([])
    }
  }

  // When user picks a PO from the Reference dropdown, optionally pre-fill the bill's line
  // items from that PO. If the bill form already has items entered, ask before overwriting
  // (so users don't lose data they've typed).
  const handleSelectPO = async (poId: string) => {
    if (!poId) {
      setFormData((prev) => ({ ...prev, purchaseOrderId: '' }))
      return
    }
    const proceed =
      billItems.length === 0 ||
      (await confirm({
        message: 'Replace the current line items with this PO\'s items?',
      }))
    if (!proceed) {
      // User declined pre-fill but still wants the link
      setFormData((prev) => ({ ...prev, purchaseOrderId: poId }))
      return
    }
    const result = await window.electronAPI.purchaseOrder.getById(poId)
    if (!result.success || !result.data) {
      toast.error('Failed to load PO details')
      return
    }
    const po: any = result.data
    setBillItems(
      (po.items || []).map((it: any) => ({
        // Map PO line → bill line. supplierItemId on the PO maps to itemId on the bill
        // form (per Purchase.tsx's existing convention where itemId is supplierItemId).
        itemId: it.supplierItemId || it.supplierItem?.id || '',
        hsnCode: it.hsnCode || it.supplierItem?.hsnCode || '',
        quantity: it.quantity,
        rate: it.rate,
        taxRate: it.taxRate || 0,
        discount: it.discount || 0,
        amount: it.total || 0,
      })),
    )
    setFormData((prev) => ({ ...prev, purchaseOrderId: poId }))
    toast.info('Items pre-filled from PO. Review and edit to match the supplier\'s actual invoice.')
  }

  const totals = calculateTotals()

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

  // Filter bills by search query and date range
  const filteredBills = bills.filter((bill) => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      const matchesNumber = bill.billNumber?.toLowerCase().includes(query)
      const matchesParty = bill.supplier?.name?.toLowerCase().includes(query)
      if (!matchesNumber && !matchesParty) return false
    }
    if (dateStart || dateEnd) {
      const d = new Date(bill.billDate)
      if (dateStart && d < dateStart) return false
      if (dateEnd && d > dateEnd) return false
    }
    return true
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Purchase Bills</h1>
        <button onClick={() => setShowModal(true)} className="btn btn-primary">+ New Purchase Bill</button>
      </div>

      {/* Search + Date Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          className="input max-w-md flex-1 min-w-[240px]"
          placeholder="Search by bill number or supplier name..."
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
            {filteredBills.length} {filteredBills.length === 1 ? 'bill' : 'bills'}
          </span>
        )}
        {filteredBills.length > 0 && (
          <BulkDownloadMenu
            count={filteredBills.length}
            busy={bulkDownloading}
            onPdfs={() => handleBulkDownloadPdfs(filteredBills)}
            onExcel={() => handleBulkDownloadExcel(filteredBills)}
          />
        )}
      </div>

      {/* Bills Table */}
      <div className="card">
        {loading ? (
          <TableSkeleton rows={6} columns={7} />
        ) : filteredBills.length === 0 ? (
          searchQuery.trim() || dateFilter !== 'all' ? (
            <EmptyState
              icon={SearchIcon}
              title="No bills match your filters"
              description={searchQuery.trim() ? `Nothing matched "${searchQuery}".` : 'No bills in this date range.'}
            />
          ) : (
            <EmptyState
              icon={ShoppingCart}
              title="No purchase bills yet"
              description="Record purchases from suppliers to track payables and stock additions."
              action={{ label: '+ Create your first purchase bill', onClick: () => setShowModal(true) }}
            />
          )
        ) : (
        <div className="overflow-auto max-h-[calc(100vh-280px)]">
          <table className="table">
            <thead>
              <tr>
                <th className="table-header sticky top-0 z-10">S.No</th>
                <th className="table-header sticky top-0 z-10">Bill #</th>
                <th className="table-header sticky top-0 z-10">Date</th>
                <th className="table-header sticky top-0 z-10">Supplier</th>
                <th className="table-header sticky top-0 z-10">Amount</th>
                <th className="table-header sticky top-0 z-10">Status</th>
                <th className="table-header sticky top-0 z-10">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredBills.map((bill, index) => (
                <tr key={bill.id} className={`border-t ${bill.cancelledAt ? 'opacity-60' : ''}`}>
                  <td className="table-cell">{index + 1}</td>
                  <td className="table-cell font-medium">
                    {bill.billNumber}
                    {(bill as any).purchaseOrder?.orderNumber && (
                      <span
                        className="ml-2 inline-block px-1.5 py-0.5 text-xs rounded bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
                        title="Issued against this Purchase Order"
                      >
                        ↩ {(bill as any).purchaseOrder.orderNumber}
                      </span>
                    )}
                  </td>
                  <td className="table-cell">{new Date(bill.billDate).toLocaleDateString('en-GB')}</td>
                  <td className="table-cell">{bill.supplier?.name}</td>
                  <td className="table-cell">{formatCurrency(bill.totalAmount)}</td>
                  <td className="table-cell">
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      bill.cancelledAt ? 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' :
                      bill.status === 'PAID' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                      bill.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    }`}>
                      {bill.cancelledAt ? 'Cancelled' : formatInvoiceStatus(bill.status)}
                    </span>
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleView(bill.id)}
                        className="text-primary-600 hover:text-primary-700"
                      >
                        View
                      </button>
                      {!bill.cancelledAt && (
                        <button
                          onClick={() => handleEdit(bill)}
                          className="text-green-600 hover:text-green-700"
                        >
                          Edit
                        </button>
                      )}
                      {(bill as any).attachmentMimeType && (
                        <button
                          onClick={() => handleOpenAttachment(bill.id)}
                          className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                          title="Open original supplier bill"
                        >
                          Original
                        </button>
                      )}
                      <DownloadMenu getOpts={() => buildDownloadOpts(bill.id)} />
                      <ShareMenu
                        onShare={(target) => handleShare(bill.id, target)}
                        phone={bill.party?.phone}
                        email={bill.party?.email}
                        partyName={bill.party?.name}
                      />
                      {!bill.cancelledAt && (
                        <button onClick={() => handleCancel(bill.id)} className="text-red-600 hover:text-red-700">Cancel</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Create/Edit Purchase Bill Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">{editingBill ? 'Edit Purchase Bill' : 'Create New Purchase Bill'}</h2>
                <button onClick={() => { setShowModal(false); resetForm(); }} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl">
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                {/* AI Extract from Photo */}
                <div className="flex items-center justify-between gap-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <div>
                    <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      Have a photo or PDF of the bill?
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                      We'll auto-fill the form. You'll review before saving.
                    </p>
                    {attachmentBytes && (
                      <p className="text-xs text-green-700 dark:text-green-300 mt-1 font-medium">
                        ✓ Attached ({(attachmentBytes.byteLength / 1024).toFixed(1)} KB, {attachmentMimeType})
                      </p>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={handleFileSelect}
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
                        <span className="animate-spin">⏳</span>
                        Extracting…
                      </>
                    ) : (
                      <>
                        <Camera className="w-4 h-4" />
                        Extract from Photo
                      </>
                    )}
                  </button>
                </div>

                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Supplier *</label>
                    <SearchableSelect
                      value={formData.supplierId}
                      onChange={(id) => {
                        // When supplier changes, the per-supplier catalog reloads — items previously
                        // selected belong to the old supplier and won't exist in the new dropdown.
                        // Reset itemIds so user re-picks. _extractedName stays so extraction lines
                        // still auto-create on save.
                        if (id !== formData.supplierId) {
                          setBillItems((prev) => prev.map((it) => ({ ...it, itemId: '' })))
                        }
                        setFormData({ ...formData, supplierId: id })
                      }}
                      options={suppliers.map((s) => ({ id: s.id, name: s.name }))}
                      placeholder="Select Supplier"
                      required
                    />
                    {unmatchedSupplier && !formData.supplierId && (
                      <div className="mt-2 p-3 rounded-lg border bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
                        <p className="text-xs text-amber-800 dark:text-amber-200 mb-2">
                          Not in your suppliers yet — review and edit before creating:
                        </p>
                        <div className="space-y-2">
                          <input
                            type="text"
                            className="input text-sm"
                            value={unmatchedSupplier.name}
                            onChange={(e) =>
                              setUnmatchedSupplier({ ...unmatchedSupplier, name: e.target.value })
                            }
                            placeholder="Supplier name"
                          />
                          <input
                            type="text"
                            className="input text-sm"
                            value={unmatchedSupplier.gstin || ''}
                            onChange={(e) =>
                              setUnmatchedSupplier({ ...unmatchedSupplier, gstin: e.target.value })
                            }
                            placeholder="GSTIN (optional)"
                          />
                          <textarea
                            className="input text-sm"
                            rows={2}
                            value={unmatchedSupplier.address || ''}
                            onChange={(e) =>
                              setUnmatchedSupplier({ ...unmatchedSupplier, address: e.target.value })
                            }
                            placeholder="Address (optional)"
                          />
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="text"
                              className="input text-sm"
                              value={unmatchedSupplier.city || ''}
                              onChange={(e) =>
                                setUnmatchedSupplier({ ...unmatchedSupplier, city: e.target.value })
                              }
                              placeholder="City"
                            />
                            <input
                              type="text"
                              className="input text-sm"
                              value={unmatchedSupplier.pincode || ''}
                              onChange={(e) =>
                                setUnmatchedSupplier({ ...unmatchedSupplier, pincode: e.target.value })
                              }
                              placeholder="Pincode"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="tel"
                              className="input text-sm"
                              value={unmatchedSupplier.phone || ''}
                              onChange={(e) =>
                                setUnmatchedSupplier({ ...unmatchedSupplier, phone: e.target.value })
                              }
                              placeholder="Phone"
                            />
                            <input
                              type="email"
                              className="input text-sm"
                              value={unmatchedSupplier.email || ''}
                              onChange={(e) =>
                                setUnmatchedSupplier({ ...unmatchedSupplier, email: e.target.value })
                              }
                              placeholder="Email"
                            />
                          </div>
                        </div>
                        <div className="flex gap-2 mt-2">
                          <button
                            type="button"
                            onClick={handleCreateUnmatchedSupplier}
                            disabled={creatingSupplier || !unmatchedSupplier.name.trim()}
                            className="btn btn-primary text-sm"
                          >
                            {creatingSupplier ? 'Creating…' : '+ Create supplier'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setUnmatchedSupplier(null)}
                            className="btn btn-secondary text-sm"
                          >
                            Skip
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="label">Bill Date *</label>
                    <DateInput
                      className="input"
                      value={formData.billDate}
                      onChange={(e) => setFormData({...formData, billDate: e.target.value})}
                      required
                    />
                  </div>

                  {formData.supplierId && openPOs.length > 0 && (
                    <div className="col-span-2">
                      <label className="label">Reference Purchase Order</label>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                        Link this bill to one of {openPOs.length} open PO{openPOs.length === 1 ? '' : 's'} for this supplier.
                        Picking a PO pre-fills the items below — edit them to match the supplier's actual invoice.
                      </p>
                      <select
                        className="input"
                        value={formData.purchaseOrderId}
                        onChange={(e) => handleSelectPO(e.target.value)}
                      >
                        <option value="">No PO (cash / walk-in purchase)</option>
                        {openPOs.map((po) => (
                          <option key={po.id} value={po.id}>
                            {po.orderNumber} — {formatCurrency(po.totalAmount)} ({new Date(po.orderDate).toLocaleDateString('en-GB')})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <label className="label">Supplier's Invoice Number</label>
                    <input
                      type="text"
                      className="input"
                      value={formData.supplierInvoiceNumber}
                      onChange={(e) => setFormData({...formData, supplierInvoiceNumber: e.target.value})}
                      placeholder="As printed on the supplier's bill"
                    />
                  </div>

                  <div>
                    <label className="label">Internal Bill #</label>
                    <input
                      type="text"
                      className="input"
                      value={formData.billNumber}
                      onChange={(e) => setFormData({...formData, billNumber: e.target.value})}
                      placeholder="Auto-generated if left blank"
                      // Editing internal bill # of an existing bill could collide with another row's
                      // unique number — keep it read-only after creation.
                      readOnly={!!editingBill}
                    />
                  </div>
                </div>

                {/* Items Section */}
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">Bill Items</h3>
                    <button type="button" onClick={addBillItem} className="btn btn-secondary text-sm">
                      + Add Item
                    </button>
                  </div>

                  {billItems.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 dark:bg-gray-900/40 rounded-lg border-2 border-dashed">
                      <p className="text-gray-500 dark:text-gray-400 mb-2">No items added yet</p>
                      <button type="button" onClick={addBillItem} className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300">
                        Click "+ Add Item" to add your first item
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {billItems.map((item, index) => (
                        <div key={index} className="flex gap-3 items-end p-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
                          <div className="flex-1">
                            <label className="label text-xs">Item</label>
                            <select
                              className="input"
                              value={item.itemId}
                              onChange={(e) => updateBillItem(index, 'itemId', e.target.value)}
                              // Required only when this row has no extracted name. Extraction-driven
                              // lines may keep itemId empty — backend auto-creates a SupplierItem
                              // row from _extractedName on save.
                              required={!item._extractedName}
                              disabled={!formData.supplierId}
                            >
                              <option value="">
                                {item._extractedName
                                  ? `+ Add "${item._extractedName}" to catalog`
                                  : formData.supplierId
                                  ? 'Select Item'
                                  : 'Pick a supplier first'}
                              </option>
                              {items.map((i) => (
                                <option key={i.id} value={i.id}>{i.name}</option>
                              ))}
                            </select>
                            {item._extractedName && (
                              item.itemId ? (
                                <p className="text-xs mt-1 truncate text-blue-600 dark:text-blue-400" title={item._extractedName}>
                                  From bill: <span className="font-medium">{item._extractedName}</span>
                                </p>
                              ) : (
                                <div className="mt-1">
                                  <input
                                    type="text"
                                    className="input text-xs py-1"
                                    value={item._extractedName}
                                    onChange={(e) => updateBillItem(index, '_extractedName', e.target.value)}
                                    placeholder="New item name"
                                  />
                                  <p className="text-xs mt-0.5 text-emerald-700 dark:text-emerald-400">
                                    ✨ Will save as a new item under this supplier
                                  </p>
                                </div>
                              )
                            )}
                          </div>

                          <div className="w-32">
                            <label className="label text-xs">HSN/SKU</label>
                            <input
                              type="text"
                              className="input"
                              value={item.hsnCode}
                              onChange={(e) => updateBillItem(index, 'hsnCode', e.target.value)}
                              placeholder="HSN/SKU"
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Qty</label>
                            <NumberInput
                              className="input"
                              value={item.quantity}
                              onChange={(val) => updateBillItem(index, 'quantity', val)}
                              min={1}
                              required
                            />
                          </div>

                          <div className="w-32">
                            <label className="label text-xs">Rate</label>
                            <NumberInput
                              className="input"
                              value={item.rate}
                              onChange={(val) => updateBillItem(index, 'rate', val)}
                              min={0}
                              required
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Disc</label>
                            <NumberInput
                              className="input"
                              value={item.discount}
                              onChange={(val) => updateBillItem(index, 'discount', val)}
                              min={0}
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Tax %</label>
                            <NumberInput
                              className="input"
                              value={item.taxRate}
                              onChange={(val) => updateBillItem(index, 'taxRate', val)}
                              min={0}
                            />
                          </div>

                          <div className="w-32">
                            <label className="label text-xs">Amount</label>
                            <input
                              type="text"
                              className="input bg-gray-100 dark:bg-gray-700"
                              value={formatCurrency(item.amount)}
                              readOnly
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => removeBillItem(index)}
                            className="btn btn-danger h-10 px-3"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Totals */}
                {billItems.length > 0 && (
                  <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg">
                    <div className="space-y-2 max-w-sm ml-auto">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Subtotal:</span>
                        <span className="font-medium">{formatCurrency(totals.subtotal)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-600 dark:text-gray-400">CGST:</span>
                        <NumberInput
                          className="input w-32 text-right"
                          value={taxBreakdown.cgst}
                          onChange={(val) => setTaxBreakdown({ ...taxBreakdown, cgst: val || 0 })}
                          min={0}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-600 dark:text-gray-400">SGST:</span>
                        <NumberInput
                          className="input w-32 text-right"
                          value={taxBreakdown.sgst}
                          onChange={(val) => setTaxBreakdown({ ...taxBreakdown, sgst: val || 0 })}
                          min={0}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-600 dark:text-gray-400">IGST:</span>
                        <NumberInput
                          className="input w-32 text-right"
                          value={taxBreakdown.igst}
                          onChange={(val) => setTaxBreakdown({ ...taxBreakdown, igst: val || 0 })}
                          min={0}
                        />
                      </div>
                      <div className="flex justify-between border-t pt-2">
                        <span className="text-gray-600 dark:text-gray-400">Tax (total):</span>
                        <span className="font-medium">{formatCurrency(totals.taxAmount)}</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {totals.taxAmount > 0 && (taxBreakdown.cgst + taxBreakdown.sgst + taxBreakdown.igst) > 0
                          ? 'Using bill-level CGST/SGST/IGST. Per-item tax % is ignored while these are set.'
                          : 'Tax is computed from per-item Tax %. Fill CGST/SGST/IGST above to override with a bill-level breakdown.'}
                      </p>
                      <div className="flex justify-between text-lg font-bold border-t pt-2">
                        <span>Total:</span>
                        <span>{formatCurrency(totals.total)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div>
                  <label className="label">Notes</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={formData.notes}
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    placeholder="Internal notes..."
                  />
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-3 pt-4 border-t">
                  <button
                    type="button"
                    onClick={() => { setShowModal(false); resetForm(); }}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                  >
                    {editingBill ? 'Update Purchase Bill' : 'Create Purchase Bill'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* View Purchase Bill Modal */}
      {showViewModal && viewingBill && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Purchase Bill Details</h2>
                <button onClick={() => { setShowViewModal(false); setViewingBill(null); }} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl">
                  ×
                </button>
              </div>

              {/* Bill Header */}
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Bill Number</p>
                  <p className="font-semibold text-lg">{viewingBill.billNumber}</p>
                  {(viewingBill as any).purchaseOrder?.orderNumber && (
                    <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-1">
                      ↩ Issued against PO {(viewingBill as any).purchaseOrder.orderNumber}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    viewingBill.status === 'PAID' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                    viewingBill.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  }`}>
                    {formatInvoiceStatus(viewingBill.status)}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Date</p>
                  <p className="font-medium">{new Date(viewingBill.billDate).toLocaleDateString('en-GB')}</p>
                </div>
              </div>

              {/* Supplier Info */}
              <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg mb-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Supplier</p>
                <p className="font-semibold">{viewingBill.supplier?.name}</p>
                {viewingBill.supplier?.phone && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingBill.supplier.phone}</p>}
                {viewingBill.supplier?.email && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingBill.supplier.email}</p>}
              </div>

              {/* Items */}
              <div className="mb-6">
                <h3 className="font-semibold mb-3">Items</h3>
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th className="table-header sticky top-0 z-10">S.No</th>
                      <th className="table-header sticky top-0 z-10">Item</th>
                      <th className="table-header sticky top-0 z-10">HSN/SKU</th>
                      <th className="table-header sticky top-0 z-10">Qty</th>
                      <th className="table-header sticky top-0 z-10">Rate</th>
                      <th className="table-header sticky top-0 z-10">Tax %</th>
                      <th className="table-header sticky top-0 z-10">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingBill.items?.map((item: any, index: number) => (
                      <tr key={index} className="border-t">
                        <td className="table-cell">{index + 1}</td>
                        <td className="table-cell">{item.item?.name}</td>
                        <td className="table-cell text-gray-500">{item.hsnCode || item.item?.hsnCode || item.item?.skuHsn || '-'}</td>
                        <td className="table-cell">{item.quantity}</td>
                        <td className="table-cell">{formatCurrency(item.rate)}</td>
                        <td className="table-cell">{item.taxRate}%</td>
                        <td className="table-cell">{formatCurrency(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg mb-6">
                <div className="space-y-2 max-w-sm ml-auto">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Subtotal:</span>
                    <span className="font-medium">{formatCurrency(viewingBill.subtotal || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Tax:</span>
                    <span className="font-medium">{formatCurrency(viewingBill.taxAmount || 0)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold border-t pt-2">
                    <span>Total:</span>
                    <span>{formatCurrency(viewingBill.totalAmount)}</span>
                  </div>
                  {viewingBill.amountPaid !== undefined && viewingBill.amountPaid > 0 && (
                    <>
                      <div className="flex justify-between text-green-600 dark:text-green-400">
                        <span>Paid:</span>
                        <span>{formatCurrency(viewingBill.amountPaid)}</span>
                      </div>
                      <div className="flex justify-between text-red-600 dark:text-red-400 font-bold">
                        <span>Balance Due:</span>
                        <span>{formatCurrency(viewingBill.balanceDue || 0)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Notes */}
              {viewingBill.notes && (
                <div className="mb-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Notes</p>
                  <p className="text-gray-700 dark:text-gray-300">{viewingBill.notes}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  onClick={() => { setShowViewModal(false); setViewingBill(null); }}
                  className="btn btn-secondary"
                >
                  Close
                </button>
                <ShareMenu
                  variant="button"
                  onShare={(target) => handleShare(viewingBill.id, target)}
                  phone={viewingBill.party?.phone}
                  email={viewingBill.party?.email}
                  partyName={viewingBill.party?.name}
                />
                {(viewingBill as any).attachmentMimeType && (
                  <button
                    onClick={() => handleOpenAttachment(viewingBill.id)}
                    className="btn btn-secondary"
                  >
                    Open Original
                  </button>
                )}
                <DownloadMenu
                  variant="button"
                  getOpts={() => buildDownloadOpts(viewingBill.id)}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Purchase
