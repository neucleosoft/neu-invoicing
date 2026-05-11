import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { PurchaseOrder, Supplier } from '../types'
import { formatCurrency } from '../utils/currency'
import NumberInput from '../components/NumberInput'
import DateInput from '../components/DateInput'
import { useToast } from '../components/ToastContext'
import { useConfirm } from '../components/ConfirmDialogContext'
import EmptyState from '../components/EmptyState'
import { TableSkeleton } from '../components/Skeleton'
import { ShoppingCart, Search as SearchIcon } from 'lucide-react'
import SearchableSelect from '../components/SearchableSelect'
import ShareMenu from '../components/ShareMenu'
import { sharePdf, ShareTarget } from '../utils/sharePdf'
import {
  getPurchaseOrderPDFBytes,
  buildPurchaseOrderFilename,
  PurchaseOrderPDFData,
} from '../utils/pdfmakePurchaseOrder'
import { loadCompanyForPDF } from '../utils/loadCompanyForPDF'
import DownloadMenu from '../components/DownloadMenu'
import BulkDownloadMenu from '../components/BulkDownloadMenu'
import { DispatchOpts, TableData } from '../utils/downloadHelpers'
import { bulkDownloadPdfs, bulkDownloadExcel, buildZipFilename } from '../utils/bulkDownloadPdfs'
import {
  PO_SPECIAL_INSTRUCTIONS_DEFAULT,
  PO_GENERAL_TERMS_DEFAULT,
  PO_SETTINGS_KEYS,
} from '../utils/poDefaults'

interface CatalogItem {
  id: string
  name: string
  purchasePrice: number
  taxRate: number
  hsnCode?: string
  skuHsn?: string
}

interface OrderLine {
  itemId: string
  hsnCode: string
  quantity: number
  rate: number
  taxRate: number
  discount: number
  amount: number
}

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
  SENT: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  ACCEPTED: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  PARTIALLY_RECEIVED: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  RECEIVED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  CLOSED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

// Human-readable label for status; falls back to raw value.
const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  ACCEPTED: 'Accepted',
  PARTIALLY_RECEIVED: 'Partially Received',
  RECEIVED: 'Received',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
}

// Mirrors normalizeBill in Purchase.tsx — backend returns SupplierItem rows on each line.
const normalizeOrder = (order: any): PurchaseOrder => ({
  ...order,
  items: (order.items || []).map((item: any) => ({
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

const PurchaseOrders = () => {
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [viewingOrder, setViewingOrder] = useState<PurchaseOrder | null>(null)
  const [editingOrder, setEditingOrder] = useState<PurchaseOrder | null>(null)
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState<'all' | '7d' | '1m' | '1q' | '1y' | 'custom'>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [bulkDownloading, setBulkDownloading] = useState(false)

  const [formData, setFormData] = useState({
    supplierId: '',
    orderNumber: '',
    orderDate: new Date().toISOString().split('T')[0],
    expectedDate: '',
    billingAddress: '',
    shippingAddress: '',
    vendorQuotationRef: '',
    notes: '',
    termsConditions: '',
    status: 'DRAFT' as PurchaseOrder['status'],
  })

  // Mark Received modal: per-line received qty editor
  const [showReceiveModal, setShowReceiveModal] = useState(false)
  const [receiveLines, setReceiveLines] = useState<
    Array<{ lineId: string; itemName: string; ordered: number; received: number }>
  >([])
  const [savingReceive, setSavingReceive] = useState(false)

  const [taxBreakdown, setTaxBreakdown] = useState<{
    cgst: number
    sgst: number
    igst: number
  }>({ cgst: 0, sgst: 0, igst: 0 })

  const [orderLines, setOrderLines] = useState<OrderLine[]>([])

  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    loadOrders()
    loadSuppliers()
  }, [])

  useEffect(() => {
    if (formData.supplierId) {
      loadCatalog(formData.supplierId)
    } else {
      setCatalog([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.supplierId])

  // Auto-open the create modal when navigated here with state.openNew
  useEffect(() => {
    if ((location.state as { openNew?: boolean } | null)?.openNew) {
      setShowModal(true)
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  const loadOrders = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.purchaseOrder.getAll()
      if (result.success && result.data) {
        setOrders(result.data.map(normalizeOrder))
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

  const loadCatalog = async (supplierId: string) => {
    const result = await window.electronAPI.supplierItem.getAll(supplierId)
    if (result.success && result.data) {
      setCatalog(result.data.map((item: any) => ({
        id: item.id,
        name: item.name,
        purchasePrice: item.lastPurchasePrice || 0,
        taxRate: item.defaultTaxRate || 0,
        hsnCode: item.hsnCode || item.linkedItem?.hsnCode || '',
        skuHsn: item.linkedItem?.skuHsn,
      })))
    }
  }

  const handleDelete = async (id: string) => {
    const ok = await confirm({ message: 'Delete this purchase order?', danger: true })
    if (!ok) return
    const result = await window.electronAPI.purchaseOrder.delete(id)
    if (result.success) {
      loadOrders()
    } else {
      toast.error('Failed to delete: ' + (result.error || 'Unknown error'))
    }
  }

  const handleView = async (id: string) => {
    const result = await window.electronAPI.purchaseOrder.getById(id)
    if (result.success && result.data) {
      setViewingOrder(normalizeOrder(result.data))
      setShowViewModal(true)
    }
  }

  const loadPOPDFData = async (id: string): Promise<PurchaseOrderPDFData | null> => {
    const result = await window.electronAPI.purchaseOrder.getById(id)
    if (!result.success || !result.data) {
      toast.error(result.error || 'Failed to fetch order')
      return null
    }
    const order: any = result.data
    const company = await loadCompanyForPDF()
    const supplier = order.supplier || {}
    // Fetch boilerplate text from Settings (defaults to the seeded Schoolnet text
    // when the user has never opened the Settings → Purchase Orders tab).
    const [siRes, gtRes] = await Promise.all([
      window.electronAPI.settings.get(PO_SETTINGS_KEYS.specialInstructions),
      window.electronAPI.settings.get(PO_SETTINGS_KEYS.generalTerms),
    ])
    const specialInstructions =
      (siRes.success && siRes.data) || PO_SPECIAL_INSTRUCTIONS_DEFAULT
    const generalTerms = (gtRes.success && gtRes.data) || PO_GENERAL_TERMS_DEFAULT
    const items = (order.items || []).map((it: any) => {
      const quantity = it.quantity || 0
      const rate = it.rate || 0
      const discount = it.discount || 0
      const linked = it.supplierItem?.linkedItem
      return {
        item: {
          name: it.supplierItem?.name || linked?.name || 'Item',
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
      orderNumber: order.orderNumber,
      orderDate: order.orderDate,
      expectedDate: order.expectedDate,
      notes: order.notes,
      termsConditions: order.termsConditions,
      billingAddress: order.billingAddress,
      shippingAddress: order.shippingAddress,
      vendorQuotationRef: order.vendorQuotationRef,
      specialInstructions,
      generalTerms,
      totalAmount: order.totalAmount || 0,
      subtotal: order.subtotal,
      taxAmount: order.taxAmount,
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

  const buildOrderTableData = (data: PurchaseOrderPDFData): TableData => {
    const meta: Array<[string, string | number]> = [
      ['Order', data.orderNumber || ''],
      ['Date', data.orderDate ? new Date(data.orderDate).toLocaleDateString('en-GB') : ''],
      ['Supplier', data.supplier?.name || ''],
      ['GSTIN', data.supplier?.taxId || ''],
    ]
    if (data.expectedDate) {
      meta.push(['Expected Date', new Date(data.expectedDate as any).toLocaleDateString('en-GB')])
    }
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
    return { baseName: buildPurchaseOrderFilename(data).replace(/\.pdf$/i, ''), meta, metaSuffix, headers, rows }
  }

  const handleBulkDownloadPdfs = async (matching: PurchaseOrder[]) => {
    if (matching.length === 0) {
      toast.info('No purchase orders to download')
      return
    }
    const partyName = matching[0]?.supplier?.name || searchQuery || 'all'

    setBulkDownloading(true)
    try {
      const items = matching.map(o => ({
        id: o.id,
        filename: `${o.orderNumber.replace(/\//g, '_')}.pdf`,
      }))
      const result = await bulkDownloadPdfs({
        items,
        zipFilename: buildZipFilename('Purchase_Orders', partyName),
        getBytes: async (id) => {
          const data = await loadPOPDFData(id)
          if (!data) return null
          return await getPurchaseOrderPDFBytes(data)
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

  const handleBulkDownloadExcel = async (matching: PurchaseOrder[]) => {
    if (matching.length === 0) {
      toast.info('No purchase orders to download')
      return
    }
    const partyName = matching[0]?.supplier?.name || searchQuery || 'all'

    setBulkDownloading(true)
    try {
      const headers = [
        'Order #', 'Date', 'Expected', 'Supplier', 'GSTIN',
        'Item', 'HSN/SAC', 'Qty', 'Rate', 'Discount', 'Tax %', 'Amount',
        'Subtotal', 'Tax', 'Total', 'Status',
      ]
      const rows: (string | number)[][] = []
      for (const o of matching) {
        let items: any[] = (o as any).items || []
        if (!items.length) {
          const res = await window.electronAPI.purchaseOrder.getById(o.id)
          if (res.success && res.data) items = (res.data as any).items || []
        }
        const dateStr = o.orderDate ? new Date(o.orderDate).toLocaleDateString('en-GB') : ''
        const expectedStr = (o as any).expectedDate ? new Date((o as any).expectedDate).toLocaleDateString('en-GB') : ''
        const trailer: (string | number)[] = [
          (o as any).subtotal || 0,
          (o as any).taxAmount || 0,
          o.totalAmount || 0,
          o.status || '',
        ]
        if (items.length === 0) {
          rows.push([
            o.orderNumber || '',
            dateStr,
            expectedStr,
            o.supplier?.name || '',
            (o.supplier as any)?.taxId || '',
            '', '', 0, 0, 0, 0, 0,
            ...trailer,
          ])
          continue
        }
        for (const it of items) {
          rows.push([
            o.orderNumber || '',
            dateStr,
            expectedStr,
            o.supplier?.name || '',
            (o.supplier as any)?.taxId || '',
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
      const filename = `Purchase_Orders_${(partyName || 'all').replace(/[^a-z0-9]+/gi, '_')}_${today}.xlsx`
      await bulkDownloadExcel({
        filename,
        sheets: [{
          name: 'Purchase Orders',
          meta: [['Generated', new Date().toLocaleString()]],
          headers,
          rows,
        }],
      })
      toast.success(`Exported ${matching.length} order${matching.length === 1 ? '' : 's'} to Excel`)
    } catch (error) {
      console.error('Bulk Excel error:', error)
      toast.error('Failed to bulk-download Excel')
    } finally {
      setBulkDownloading(false)
    }
  }

  const buildDownloadOpts = async (id: string): Promise<DispatchOpts> => {
    const data = await loadPOPDFData(id)
    if (!data) throw new Error('Failed to load order details')
    let cached: { bytes: Uint8Array; filename: string } | null = null
    const getPdf = async () => {
      if (!cached) {
        const bytes = await getPurchaseOrderPDFBytes(data)
        cached = { bytes, filename: buildPurchaseOrderFilename(data) }
      }
      return cached
    }
    return {
      getPdf,
      getTable: async () => buildOrderTableData(data),
    }
  }

  const handleShare = async (id: string, target: ShareTarget) => {
    try {
      const data = await loadPOPDFData(id)
      if (!data) return
      const bytes = await getPurchaseOrderPDFBytes(data)
      const filename = buildPurchaseOrderFilename(data)
      const subject = `Purchase Order ${data.orderNumber} from ${data.company?.name || ''}`.trim()
      await sharePdf(bytes, filename, target, toast, {
        subject,
        phone: data.supplier.phone,
        email: data.supplier.email,
        partyName: data.supplier.name,
      })
    } catch (err) {
      console.error('Error sharing PO:', err)
      toast.error('Failed to share PO')
    }
  }

  const handleEdit = async (order: PurchaseOrder) => {
    const result = await window.electronAPI.purchaseOrder.getById(order.id)
    if (!result.success || !result.data) {
      toast.error('Failed to load order')
      return
    }
    const full = normalizeOrder(result.data)
    setEditingOrder(full)
    setFormData({
      supplierId: full.supplierId || full.supplier?.id || '',
      orderNumber: full.orderNumber || '',
      orderDate: new Date(full.orderDate).toISOString().split('T')[0],
      expectedDate: full.expectedDate ? new Date(full.expectedDate).toISOString().split('T')[0] : '',
      billingAddress: full.billingAddress || '',
      shippingAddress: full.shippingAddress || '',
      vendorQuotationRef: full.vendorQuotationRef || '',
      notes: full.notes || '',
      termsConditions: full.termsConditions || '',
      status: full.status,
    })
    setOrderLines((full.items || []).map((it: any) => ({
      itemId: it.itemId,
      hsnCode: it.hsnCode || it.item?.hsnCode || it.item?.skuHsn || '',
      quantity: it.quantity,
      rate: it.rate,
      taxRate: it.taxRate,
      discount: it.discount || 0,
      amount: it.total,
    })))
    setTaxBreakdown({
      cgst: full.cgstAmount || 0,
      sgst: full.sgstAmount || 0,
      igst: full.igstAmount || 0,
    })
    setShowModal(true)
  }

  const addLine = () => {
    const last = orderLines[orderLines.length - 1]
    if (last && !last.itemId) {
      toast.info('Please complete the current item first')
      return
    }
    setOrderLines([...orderLines, { itemId: '', hsnCode: '', quantity: 1, rate: 0, taxRate: 0, discount: 0, amount: 0 }])
  }

  const updateLine = (index: number, field: keyof OrderLine, value: any) => {
    const next = [...orderLines]
    next[index] = { ...next[index], [field]: value }
    if (field === 'itemId') {
      const picked = catalog.find((c) => c.id === value)
      if (picked) {
        next[index].rate = picked.purchasePrice
        next[index].taxRate = picked.taxRate
        next[index].hsnCode = picked.hsnCode || picked.skuHsn || ''
      }
    }
    const qty = next[index].quantity || 0
    const rate = next[index].rate || 0
    const disc = next[index].discount || 0
    const tax = next[index].taxRate || 0
    next[index].amount = (qty * rate - disc) * (1 + tax / 100)
    setOrderLines(next)
  }

  const removeLine = (index: number) => {
    setOrderLines(orderLines.filter((_, i) => i !== index))
  }

  const calculateTotals = () => {
    const subtotal = orderLines.reduce((sum, l) => sum + ((l.quantity || 0) * (l.rate || 0) - (l.discount || 0)), 0)
    const computedTax = orderLines.reduce((sum, l) => {
      const taxable = (l.quantity || 0) * (l.rate || 0) - (l.discount || 0)
      return sum + (taxable * (l.taxRate || 0)) / 100
    }, 0)
    const breakdownTotal = taxBreakdown.cgst + taxBreakdown.sgst + taxBreakdown.igst
    const taxAmount = breakdownTotal > 0 ? breakdownTotal : computedTax
    return { subtotal, taxAmount, total: subtotal + taxAmount }
  }

  const resetForm = () => {
    setFormData({
      supplierId: '',
      orderNumber: '',
      orderDate: new Date().toISOString().split('T')[0],
      expectedDate: '',
      billingAddress: '',
      shippingAddress: '',
      vendorQuotationRef: '',
      notes: '',
      termsConditions: '',
      status: 'DRAFT',
    })
    setOrderLines([])
    setEditingOrder(null)
    setTaxBreakdown({ cgst: 0, sgst: 0, igst: 0 })
  }

  // Mark Received modal helpers
  const openReceiveModal = (order: PurchaseOrder) => {
    setReceiveLines(
      (order.items || []).map((it: any) => ({
        lineId: it.id,
        itemName: it.item?.name || it.supplierItem?.name || 'Item',
        ordered: it.quantity,
        received: it.receivedQuantity || 0,
      })),
    )
    setShowReceiveModal(true)
  }

  const handleSaveReceive = async () => {
    if (!viewingOrder) return
    setSavingReceive(true)
    try {
      const lineUpdates = receiveLines.map((l) => ({ lineId: l.lineId, receivedQuantity: l.received }))
      const result = await window.electronAPI.purchaseOrder.markAsReceived(viewingOrder.id, lineUpdates)
      if (result.success && result.data) {
        toast.success('Receipt recorded')
        setViewingOrder(normalizeOrder(result.data))
        setShowReceiveModal(false)
        loadOrders()
      } else {
        toast.error(result.error || 'Failed to save receipt')
      }
    } finally {
      setSavingReceive(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.supplierId) {
      toast.info('Please select a supplier')
      return
    }
    if (orderLines.length === 0) {
      toast.info('Please add at least one item')
      return
    }
    const blank = orderLines.find((l) => !l.itemId)
    if (blank) {
      toast.info('Each line must have an item picked from the supplier catalog')
      return
    }
    const { subtotal, taxAmount, total } = calculateTotals()

    if (editingOrder) {
      const payload = {
        ...formData,
        items: orderLines,
        subtotal,
        taxAmount,
        cgstAmount: taxBreakdown.cgst,
        sgstAmount: taxBreakdown.sgst,
        igstAmount: taxBreakdown.igst,
        totalAmount: total,
      }
      const result = await window.electronAPI.purchaseOrder.update(editingOrder.id, payload)
      if (result.success) {
        toast.success('Purchase order updated')
        setShowModal(false)
        resetForm()
        loadOrders()
      } else {
        toast.error('Failed to update: ' + (result.error || 'Unknown error'))
      }
    } else {
      let orderNumber = formData.orderNumber.trim()
      if (!orderNumber) {
        const numRes = await window.electronAPI.purchaseOrder.generateOrderNumber()
        if (!numRes.success) {
          toast.error('Failed to generate order number: ' + (numRes.error || 'unknown error'))
          return
        }
        orderNumber = numRes.data || ''
      }
      const payload = {
        ...formData,
        orderNumber,
        items: orderLines,
        subtotal,
        taxAmount,
        cgstAmount: taxBreakdown.cgst,
        sgstAmount: taxBreakdown.sgst,
        igstAmount: taxBreakdown.igst,
        totalAmount: total,
      }
      const result = await window.electronAPI.purchaseOrder.create(payload)
      if (result.success) {
        toast.success('Purchase order created')
        setShowModal(false)
        resetForm()
        loadOrders()
      } else {
        toast.error('Failed to create: ' + (result.error || 'Unknown error'))
      }
    }
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

  const filteredOrders = orders.filter((o) => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      const matches = (o.orderNumber?.toLowerCase().includes(q)) ||
        (o.supplier?.name?.toLowerCase().includes(q))
      if (!matches) return false
    }
    if (dateStart || dateEnd) {
      const d = new Date(o.orderDate)
      if (dateStart && d < dateStart) return false
      if (dateEnd && d > dateEnd) return false
    }
    return true
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Purchase Orders</h1>
        <button onClick={() => setShowModal(true)} className="btn btn-primary">+ New Purchase Order</button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          className="input max-w-md flex-1 min-w-[240px]"
          placeholder="Search by order number or supplier name..."
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
            {filteredOrders.length} {filteredOrders.length === 1 ? 'order' : 'orders'}
          </span>
        )}
        {filteredOrders.length > 0 && (
          <BulkDownloadMenu
            count={filteredOrders.length}
            busy={bulkDownloading}
            onPdfs={() => handleBulkDownloadPdfs(filteredOrders)}
            onExcel={() => handleBulkDownloadExcel(filteredOrders)}
          />
        )}
      </div>

      <div className="card">
        {loading ? (
          <TableSkeleton rows={6} columns={6} />
        ) : filteredOrders.length === 0 ? (
          searchQuery.trim() || dateFilter !== 'all' ? (
            <EmptyState
              icon={SearchIcon}
              title="No purchase orders match your filters"
              description={searchQuery.trim() ? `Nothing matched "${searchQuery}".` : 'No purchase orders in this date range.'}
            />
          ) : (
            <EmptyState
              icon={ShoppingCart}
              title="No purchase orders yet"
              description="Send purchase orders to suppliers before goods arrive — convert each PO to a bill once received."
              action={{ label: '+ Create your first purchase order', onClick: () => setShowModal(true) }}
            />
          )
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <table className="table">
              <thead>
                <tr>
                  <th className="table-header sticky top-0 z-10">Order #</th>
                  <th className="table-header sticky top-0 z-10">Order Date</th>
                  <th className="table-header sticky top-0 z-10">Expected</th>
                  <th className="table-header sticky top-0 z-10">Supplier</th>
                  <th className="table-header sticky top-0 z-10">Amount</th>
                  <th className="table-header sticky top-0 z-10">Status</th>
                  <th className="table-header sticky top-0 z-10">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((order) => (
                  <tr key={order.id} className="border-t">
                    <td className="table-cell font-medium">{order.orderNumber}</td>
                    <td className="table-cell">{new Date(order.orderDate).toLocaleDateString('en-GB')}</td>
                    <td className="table-cell">
                      {order.expectedDate ? new Date(order.expectedDate).toLocaleDateString('en-GB') : '-'}
                    </td>
                    <td className="table-cell">{order.supplier?.name}</td>
                    <td className="table-cell">{formatCurrency(order.totalAmount)}</td>
                    <td className="table-cell">
                      <span className={`px-2 py-1 rounded-full text-xs ${STATUS_BADGE[order.status] || STATUS_BADGE.DRAFT}`}>
                        {STATUS_LABEL[order.status] || order.status}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <button onClick={() => handleView(order.id)} className="text-primary-600 hover:text-primary-700">View</button>
                        <button
                          onClick={() => handleEdit(order)}
                          className="text-green-600 hover:text-green-700"
                        >
                          Edit
                        </button>
                        <DownloadMenu getOpts={() => buildDownloadOpts(order.id)} />
                        <ShareMenu
                          onShare={(target) => handleShare(order.id, target)}
                          phone={order.supplier?.phone}
                          email={order.supplier?.email}
                          partyName={order.supplier?.name}
                        />
                        <button onClick={() => handleDelete(order.id)} className="text-red-600 hover:text-red-700">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">{editingOrder ? 'Edit Purchase Order' : 'Create New Purchase Order'}</h2>
                <button onClick={() => { setShowModal(false); resetForm() }} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl">×</button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Supplier *</label>
                    <SearchableSelect
                      value={formData.supplierId}
                      onChange={(id) => {
                        if (id !== formData.supplierId) {
                          setOrderLines((prev) => prev.map((l) => ({ ...l, itemId: '' })))
                        }
                        setFormData({ ...formData, supplierId: id })
                      }}
                      options={suppliers.map((s) => ({ id: s.id, name: s.name }))}
                      placeholder="Select Supplier"
                      required
                    />
                  </div>

                  <div>
                    <label className="label">Status</label>
                    <select
                      className="input"
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as PurchaseOrder['status'] })}
                    >
                      <option value="DRAFT">Draft</option>
                      <option value="SENT">Sent</option>
                      <option value="ACCEPTED">Accepted (vendor confirmed)</option>
                      <option value="PARTIALLY_RECEIVED">Partially Received</option>
                      <option value="RECEIVED">Received</option>
                      <option value="CLOSED">Closed</option>
                      <option value="CANCELLED">Cancelled</option>
                    </select>
                  </div>

                  <div>
                    <label className="label">Order Date *</label>
                    <DateInput
                      className="input"
                      value={formData.orderDate}
                      onChange={(e) => setFormData({ ...formData, orderDate: e.target.value })}
                      required
                    />
                  </div>

                  <div>
                    <label className="label">Expected Delivery Date</label>
                    <DateInput
                      className="input"
                      value={formData.expectedDate}
                      onChange={(e) => setFormData({ ...formData, expectedDate: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="label">Order Number</label>
                    <input
                      type="text"
                      className="input"
                      value={formData.orderNumber}
                      onChange={(e) => setFormData({ ...formData, orderNumber: e.target.value })}
                      placeholder="Auto-generated if left blank"
                      readOnly={!!editingOrder}
                    />
                  </div>

                  <div>
                    <label className="label">Vendor Quotation Ref</label>
                    <input
                      type="text"
                      className="input"
                      value={formData.vendorQuotationRef}
                      onChange={(e) => setFormData({ ...formData, vendorQuotationRef: e.target.value })}
                      placeholder='e.g. "QUOT-2026-042 02.03.2026" (optional)'
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Billing Address</label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Where supplier should send the invoice. Leave blank to use your company default.
                    </p>
                    <textarea
                      className="input"
                      rows={3}
                      value={formData.billingAddress}
                      onChange={(e) => setFormData({ ...formData, billingAddress: e.target.value })}
                      placeholder="HQ / billing address"
                    />
                  </div>
                  <div>
                    <label className="label">Shipping Address</label>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Where goods should be delivered. Often a warehouse, separate from billing.
                    </p>
                    <textarea
                      className="input"
                      rows={3}
                      value={formData.shippingAddress}
                      onChange={(e) => setFormData({ ...formData, shippingAddress: e.target.value })}
                      placeholder="Warehouse / delivery address"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">Order Items</h3>
                    <button type="button" onClick={addLine} className="btn btn-secondary text-sm">+ Add Item</button>
                  </div>

                  {orderLines.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 dark:bg-gray-900/40 rounded-lg border-2 border-dashed">
                      <p className="text-gray-500 dark:text-gray-400 mb-2">No items added yet</p>
                      <button type="button" onClick={addLine} className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300">
                        Click "+ Add Item" to add your first item
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {orderLines.map((line, index) => (
                        <div key={index} className="flex gap-3 items-end p-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
                          <div className="flex-1">
                            <label className="label text-xs">Item</label>
                            <select
                              className="input"
                              value={line.itemId}
                              onChange={(e) => updateLine(index, 'itemId', e.target.value)}
                              required
                              disabled={!formData.supplierId}
                            >
                              <option value="">{formData.supplierId ? 'Select Item' : 'Pick a supplier first'}</option>
                              {catalog.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </div>

                          <div className="w-32">
                            <label className="label text-xs">HSN/SKU</label>
                            <input
                              type="text"
                              className="input"
                              value={line.hsnCode}
                              onChange={(e) => updateLine(index, 'hsnCode', e.target.value)}
                              placeholder="HSN/SKU"
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Qty</label>
                            <NumberInput className="input" value={line.quantity} onChange={(v) => updateLine(index, 'quantity', v)} min={1} required />
                          </div>

                          <div className="w-32">
                            <label className="label text-xs">Rate</label>
                            <NumberInput className="input" value={line.rate} onChange={(v) => updateLine(index, 'rate', v)} min={0} required />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Disc</label>
                            <NumberInput className="input" value={line.discount} onChange={(v) => updateLine(index, 'discount', v)} min={0} />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Tax %</label>
                            <NumberInput className="input" value={line.taxRate} onChange={(v) => updateLine(index, 'taxRate', v)} min={0} />
                          </div>

                          <div className="w-32">
                            <label className="label text-xs">Amount</label>
                            <input type="text" className="input bg-gray-100 dark:bg-gray-700" value={formatCurrency(line.amount)} readOnly />
                          </div>

                          <button type="button" onClick={() => removeLine(index)} className="btn btn-danger h-10 px-3">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {orderLines.length > 0 && (
                  <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg">
                    <div className="space-y-2 max-w-sm ml-auto">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Subtotal:</span>
                        <span className="font-medium">{formatCurrency(totals.subtotal)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-600 dark:text-gray-400">CGST:</span>
                        <NumberInput className="input w-32 text-right" value={taxBreakdown.cgst} onChange={(v) => setTaxBreakdown({ ...taxBreakdown, cgst: v || 0 })} min={0} />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-600 dark:text-gray-400">SGST:</span>
                        <NumberInput className="input w-32 text-right" value={taxBreakdown.sgst} onChange={(v) => setTaxBreakdown({ ...taxBreakdown, sgst: v || 0 })} min={0} />
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-gray-600 dark:text-gray-400">IGST:</span>
                        <NumberInput className="input w-32 text-right" value={taxBreakdown.igst} onChange={(v) => setTaxBreakdown({ ...taxBreakdown, igst: v || 0 })} min={0} />
                      </div>
                      <div className="flex justify-between border-t pt-2">
                        <span className="text-gray-600 dark:text-gray-400">Tax (total):</span>
                        <span className="font-medium">{formatCurrency(totals.taxAmount)}</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {(taxBreakdown.cgst + taxBreakdown.sgst + taxBreakdown.igst) > 0
                          ? 'Using bill-level CGST/SGST/IGST. Per-item tax % is ignored while these are set.'
                          : 'Tax is computed from per-item Tax %. Fill CGST/SGST/IGST above to override.'}
                      </p>
                      <div className="flex justify-between text-lg font-bold border-t pt-2">
                        <span>Total:</span>
                        <span>{formatCurrency(totals.total)}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Notes</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="Internal notes shown on the PO PDF..."
                    />
                  </div>
                  <div>
                    <label className="label">Terms &amp; Conditions</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={formData.termsConditions}
                      onChange={(e) => setFormData({ ...formData, termsConditions: e.target.value })}
                      placeholder="Overrides company default terms (optional)"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t">
                  <button type="button" onClick={() => { setShowModal(false); resetForm() }} className="btn btn-secondary">Cancel</button>
                  <button type="submit" className="btn btn-primary">{editingOrder ? 'Update Purchase Order' : 'Create Purchase Order'}</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* View Modal */}
      {showViewModal && viewingOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Purchase Order Details</h2>
                <button onClick={() => { setShowViewModal(false); setViewingOrder(null) }} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl">×</button>
              </div>

              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Order Number</p>
                  <p className="font-semibold text-lg">{viewingOrder.orderNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
                  <span className={`px-2 py-1 rounded-full text-xs ${STATUS_BADGE[viewingOrder.status] || STATUS_BADGE.DRAFT}`}>
                    {STATUS_LABEL[viewingOrder.status] || viewingOrder.status}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Order Date</p>
                  <p className="font-medium">{new Date(viewingOrder.orderDate).toLocaleDateString('en-GB')}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Expected Date</p>
                  <p className="font-medium">{viewingOrder.expectedDate ? new Date(viewingOrder.expectedDate).toLocaleDateString('en-GB') : '-'}</p>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg mb-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Supplier</p>
                <p className="font-semibold">{viewingOrder.supplier?.name}</p>
                {viewingOrder.supplier?.phone && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingOrder.supplier.phone}</p>}
                {viewingOrder.supplier?.email && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingOrder.supplier.email}</p>}
              </div>

              <div className="mb-6">
                <h3 className="font-semibold mb-3">Items</h3>
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th className="table-header sticky top-0 z-10">Item</th>
                      <th className="table-header sticky top-0 z-10">HSN/SKU</th>
                      <th className="table-header sticky top-0 z-10">Qty</th>
                      <th className="table-header sticky top-0 z-10">Received</th>
                      <th className="table-header sticky top-0 z-10">Rate</th>
                      <th className="table-header sticky top-0 z-10">Tax %</th>
                      <th className="table-header sticky top-0 z-10">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingOrder.items?.map((item: any, index: number) => {
                      const received = item.receivedQuantity || 0
                      const ordered = item.quantity || 0
                      const fullyReceived = received >= ordered
                      const partialReceived = received > 0 && received < ordered
                      return (
                        <tr key={index} className="border-t">
                          <td className="table-cell">{item.item?.name}</td>
                          <td className="table-cell text-gray-500">{item.hsnCode || item.item?.hsnCode || item.item?.skuHsn || '-'}</td>
                          <td className="table-cell">{ordered}</td>
                          <td className="table-cell">
                            <span
                              className={
                                fullyReceived
                                  ? 'text-green-700 dark:text-green-400 font-medium'
                                  : partialReceived
                                  ? 'text-yellow-700 dark:text-yellow-400 font-medium'
                                  : 'text-gray-500 dark:text-gray-400'
                              }
                            >
                              {received} of {ordered}
                            </span>
                          </td>
                          <td className="table-cell">{formatCurrency(item.rate)}</td>
                          <td className="table-cell">{item.taxRate}%</td>
                          <td className="table-cell">{formatCurrency(item.total)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg mb-6">
                <div className="space-y-2 max-w-sm ml-auto">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Subtotal:</span>
                    <span className="font-medium">{formatCurrency(viewingOrder.subtotal || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Tax:</span>
                    <span className="font-medium">{formatCurrency(viewingOrder.taxAmount || 0)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold border-t pt-2">
                    <span>Total:</span>
                    <span>{formatCurrency(viewingOrder.totalAmount)}</span>
                  </div>
                </div>
              </div>

              {viewingOrder.notes && (
                <div className="mb-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Notes</p>
                  <p className="text-gray-700 dark:text-gray-300">{viewingOrder.notes}</p>
                </div>
              )}

              {viewingOrder.bills && viewingOrder.bills.length > 0 && (
                <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <p className="text-sm text-amber-800 dark:text-amber-200 font-medium mb-1">
                    {viewingOrder.bills.length} bill{viewingOrder.bills.length === 1 ? '' : 's'} against this PO:
                  </p>
                  <ul className="text-sm text-amber-700 dark:text-amber-300 list-disc ml-5">
                    {viewingOrder.bills.map((b) => (
                      <li key={b.id}>{b.billNumber} — {formatCurrency(b.totalAmount)} ({b.status})</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button onClick={() => { setShowViewModal(false); setViewingOrder(null) }} className="btn btn-secondary">Close</button>
                {viewingOrder.status !== 'CLOSED' && viewingOrder.status !== 'CANCELLED' && (
                  <button
                    onClick={() => openReceiveModal(viewingOrder)}
                    className="btn btn-secondary"
                  >
                    Mark Received
                  </button>
                )}
                <ShareMenu
                  variant="button"
                  onShare={(target) => handleShare(viewingOrder.id, target)}
                  phone={viewingOrder.supplier?.phone}
                  email={viewingOrder.supplier?.email}
                  partyName={viewingOrder.supplier?.name}
                />
                <DownloadMenu
                  variant="button"
                  getOpts={() => buildDownloadOpts(viewingOrder.id)}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mark Received Modal — per-line received quantity editor. PO doesn't touch
          stock or balances; the linked Bill (created later) is what posts to books. */}
      {showReceiveModal && viewingOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold">Mark Received</h2>
                <button
                  onClick={() => setShowReceiveModal(false)}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl"
                >×</button>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                Enter the quantity received for each line. Status updates automatically based on totals — full
                across all lines = Received; some across any line = Partially Received.
              </p>

              <div className="space-y-3 mb-6">
                {receiveLines.map((line, index) => (
                  <div
                    key={line.lineId}
                    className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-900/40 rounded-lg"
                  >
                    <div className="flex-1">
                      <p className="font-medium">{line.itemName}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Ordered: {line.ordered}</p>
                    </div>
                    <div className="w-32">
                      <label className="label text-xs">Received</label>
                      <NumberInput
                        className="input"
                        value={line.received}
                        onChange={(v) => {
                          const next = [...receiveLines]
                          next[index] = { ...next[index], received: v || 0 }
                          setReceiveLines(next)
                        }}
                        min={0}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = [...receiveLines]
                        next[index] = { ...next[index], received: line.ordered }
                        setReceiveLines(next)
                      }}
                      className="text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 self-end pb-2"
                    >
                      All
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => setShowReceiveModal(false)}
                  className="btn btn-secondary"
                  disabled={savingReceive}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveReceive}
                  className="btn btn-primary"
                  disabled={savingReceive}
                >
                  {savingReceive ? 'Saving…' : 'Save Receipt'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default PurchaseOrders
