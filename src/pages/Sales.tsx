import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SalesInvoice } from '../types'
import { getInvoicePDFBytes, InvoiceTemplate } from '../utils/generateInvoicePDF'
import DownloadMenu from '../components/DownloadMenu'
import BulkDownloadMenu from '../components/BulkDownloadMenu'
import { DispatchOpts, TableData } from '../utils/downloadHelpers'
import { bulkDownloadPdfs, bulkDownloadExcel, buildZipFilename, getBulkRangeStart, BULK_RANGE_OPTIONS, BulkRange } from '../utils/bulkDownloadPdfs'
import { formatInvoiceStatus, getDueCountdown, dueCountdownColorClass } from '../utils/invoiceStatus'
import { loadCompanyForPDF } from '../utils/loadCompanyForPDF'
import { sharePdf, ShareTarget } from '../utils/sharePdf'
import ShareMenu from '../components/ShareMenu'
import { formatCurrency } from '../utils/currency'
import NumberInput from '../components/NumberInput'
import DateInput from '../components/DateInput'
import { useToast } from '../components/ToastContext'
import { useConfirm } from '../components/ConfirmDialogContext'
import EmptyState from '../components/EmptyState'
import { TableSkeleton } from '../components/Skeleton'
import SortHeader from '../components/SortHeader'
import { useSortable } from '../hooks/useSortable'
import { Wallet, Search as SearchIcon } from 'lucide-react'
import SearchableSelect from '../components/SearchableSelect'
import { useStore } from '../store/useStore'

interface Party {
  id: string
  name: string
  type: string
}

interface Item {
  id: string
  name: string
  salePrice: number
  taxRate: number
  hsnCode?: string
  skuHsn?: string
}

interface InvoiceItem {
  itemId: string
  hsnCode: string
  quantity: number
  rate: number
  taxRate: number
  discount: number
  amount: number
}

const invoiceLabels = { singular: 'Invoice', plural: 'Invoices', short: 'invoice' }

const Sales = () => {
  const [invoices, setInvoices] = useState<SalesInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [viewingInvoice, setViewingInvoice] = useState<SalesInvoice | null>(null)
  const [editingInvoice, setEditingInvoice] = useState<SalesInvoice | null>(null)
  const [parties, setParties] = useState<Party[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<InvoiceTemplate>('classic')
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState<'all' | '7d' | '1m' | '1y' | 'custom'>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [bulkDownloading, setBulkDownloading] = useState(false)
  const [bulkRange, setBulkRange] = useState<BulkRange>('all')
  const toast = useToast()
  const confirm = useConfirm()
  const { company } = useStore()

  // Form state
  const [formData, setFormData] = useState({
    customerId: '',
    type: 'INVOICE' as const,
    status: 'DRAFT' as string,
    invoiceDate: new Date().toISOString().split('T')[0],
    invoiceNumber: '',
    dueDate: '',
    notes: '',
    termsConditions: '',
    amountPaid: 0,
    paymentMode: 'CASH' as string,
    poNumber: '',
    ewayBillNo: '',
    vehicleNumber: '',
    warrantyPeriod: '',
    dispatchedThrough: '',
  })
  const [showAdditionalFields, setShowAdditionalFields] = useState(false)

  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([])

  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    loadInvoices()
    loadParties()
    loadItems()
    loadTemplate()
  }, [])

  // Auto-open the create-invoice modal when navigated here from Dashboard's "+ New Invoice"
  useEffect(() => {
    if ((location.state as { openNew?: boolean } | null)?.openNew) {
      handleNewInvoice()
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  // Auto-open the create-invoice modal when navigated here from Dashboard's "+ New Invoice"
  useEffect(() => {
    if ((location.state as { openNew?: boolean } | null)?.openNew) {
      handleNewInvoice()
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  const loadTemplate = async () => {
    try {
      const result = await window.electronAPI.settings.get('invoiceTemplate')
      if (result.success && result.data) {
        setSelectedTemplate(result.data as InvoiceTemplate)
      }
    } catch (error) {
      console.error('Failed to load template setting:', error)
    }
  }

  const loadInvoices = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.sales.getAll()
      if (result.success && result.data) {
        setInvoices(result.data)
      }
    } finally {
      setLoading(false)
    }
  }

  const loadInvoicePDFData = async (invoiceId: string): Promise<any | null> => {
    const result = await window.electronAPI.sales.getById(invoiceId)
    if (!result.success || !result.data) return null
    const company = await loadCompanyForPDF()
    return {
      ...result.data,
      items: result.data.items || [],
      company,
    }
  }

  const buildInvoiceTableData = (pdfData: any, filename: string): TableData => {
    const customer = pdfData.customer || pdfData.party || {}
    // Header order: Invoice, Date, Customer, GSTIN, <line cols>, Status, Subtotal, Tax, Total
    const meta: Array<[string, string | number]> = [
      ['Invoice', pdfData.invoiceNumber || ''],
      ['Date', pdfData.invoiceDate ? new Date(pdfData.invoiceDate).toLocaleDateString('en-GB') : ''],
      ['Customer', customer.name || ''],
      ['GSTIN', customer.taxId || ''],
    ]
    const metaSuffix: Array<[string, string | number]> = [
      ['Subtotal', pdfData.subtotal || 0],
      ['Tax', pdfData.taxAmount || 0],
      ['Total', pdfData.totalAmount || 0],
      ['Status', pdfData.status || ''],
    ]
    const headers = ['Item', 'HSN/SAC', 'Qty', 'Rate', 'Discount', 'Tax %', 'Amount']
    const rows: (string | number)[][] = (pdfData.items || []).map((it: any) => [
      it.item?.name || '',
      it.hsnCode || it.item?.hsnCode || it.item?.skuHsn || '',
      it.quantity || 0,
      it.rate || 0,
      it.discount || 0,
      it.taxRate || 0,
      it.total || 0,
    ])
    return { baseName: filename.replace(/\.pdf$/i, ''), meta, metaSuffix, headers, rows }
  }

  const buildDownloadOpts = async (invoiceId: string): Promise<DispatchOpts> => {
    const pdfData = await loadInvoicePDFData(invoiceId)
    if (!pdfData) throw new Error('Failed to load invoice details')
    let cached: { bytes: Uint8Array; filename: string } | null = null
    const getPdf = async () => {
      if (!cached) cached = await getInvoicePDFBytes(pdfData, selectedTemplate)
      return cached
    }
    return {
      getPdf,
      getTable: async () => {
        const { filename } = await getPdf()
        return buildInvoiceTableData(pdfData, filename)
      },
    }
  }

  const handleBulkDownloadPdfs = async (matching: SalesInvoice[]) => {
    if (matching.length === 0) {
      toast.info('No invoices to download')
      return
    }
    const partyName = matching[0]?.customer?.name || searchQuery || 'all'

    setBulkDownloading(true)
    try {
      const items = matching.map(inv => ({
        id: inv.id,
        filename: `${inv.invoiceNumber.replace(/\//g, '_')}.pdf`,
      }))
      const result = await bulkDownloadPdfs({
        items,
        zipFilename: buildZipFilename('Invoices', partyName),
        getBytes: async (id) => {
          const pdfData = await loadInvoicePDFData(id)
          if (!pdfData) return null
          const { bytes } = await getInvoicePDFBytes(pdfData, selectedTemplate)
          return bytes
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

  // Bulk Excel: single flat sheet — one row per line item with the parent
  // invoice's identity + totals repeated. Line items come from a per-invoice
  // fetch since the list endpoint doesn't always include them.
  const handleBulkDownloadExcel = async (matching: SalesInvoice[]) => {
    if (matching.length === 0) {
      toast.info('No invoices to download')
      return
    }
    const partyName = matching[0]?.customer?.name || searchQuery || 'all'

    setBulkDownloading(true)
    try {
      const headers = [
        'Invoice #', 'Date', 'Customer', 'GSTIN',
        'Item', 'HSN/SAC', 'Qty', 'Rate', 'Discount', 'Tax %', 'Amount',
        'Subtotal', 'Tax', 'Total', 'Paid', 'Balance', 'Status',
      ]
      const rows: (string | number)[][] = []
      for (const inv of matching) {
        let items: any[] = (inv as any).items || []
        if (!items.length) {
          const res = await window.electronAPI.sales.getById(inv.id)
          if (res.success && res.data) items = (res.data as any).items || []
        }
        const dateStr = inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString('en-GB') : ''
        const invoiceTrailer: (string | number)[] = [
          inv.subtotal || 0,
          inv.taxAmount || 0,
          inv.totalAmount || 0,
          inv.amountPaid || 0,
          inv.balanceDue || 0,
          inv.status || '',
        ]
        if (items.length === 0) {
          // Invoice with no line items — still emit one row so it's not lost.
          rows.push([
            inv.invoiceNumber || '',
            dateStr,
            inv.customer?.name || '',
            inv.customer?.taxId || '',
            '', '', 0, 0, 0, 0, 0,
            ...invoiceTrailer,
          ])
          continue
        }
        for (const it of items) {
          rows.push([
            inv.invoiceNumber || '',
            dateStr,
            inv.customer?.name || '',
            inv.customer?.taxId || '',
            it.item?.name || '',
            it.hsnCode || it.item?.hsnCode || it.item?.skuHsn || '',
            it.quantity || 0,
            it.rate || 0,
            it.discount || 0,
            it.taxRate || 0,
            it.total || 0,
            ...invoiceTrailer,
          ])
        }
      }

      const today = new Date().toISOString().slice(0, 10)
      const filename = `Invoices_${(partyName || 'all').replace(/[^a-z0-9]+/gi, '_')}_${today}.xlsx`
      await bulkDownloadExcel({
        filename,
        sheets: [
          {
            name: 'Invoices',
            meta: [['Generated', new Date().toLocaleString()]],
            headers,
            rows,
          },
        ],
      })
      toast.success(`Exported ${matching.length} invoice${matching.length === 1 ? '' : 's'} to Excel`)
    } catch (error) {
      console.error('Bulk Excel error:', error)
      toast.error('Failed to bulk-download Excel')
    } finally {
      setBulkDownloading(false)
    }
  }

  const handleShare = async (invoiceId: string, target: ShareTarget) => {
    try {
      const pdfData = await loadInvoicePDFData(invoiceId)
      if (!pdfData) {
        toast.error('Failed to load invoice details')
        return
      }
      const { bytes, filename } = await getInvoicePDFBytes(pdfData, selectedTemplate)
      const subject = `Invoice ${pdfData.invoiceNumber} from ${pdfData.company?.name || ''}`.trim()
      await sharePdf(bytes, filename, target, toast, {
        subject,
        phone: pdfData.customer?.phone,
        email: pdfData.customer?.email,
        partyName: pdfData.customer?.name,
      })
    } catch (error) {
      console.error('Error sharing invoice:', error)
      toast.error('Failed to share invoice')
    }
  }

  const loadParties = async () => {
    const result = await window.electronAPI.customer.getAll()
    if (result.success && result.data) {
      setParties(result.data)
    }
  }

  const loadItems = async () => {
    const result = await window.electronAPI.item.getAll()
    if (result.success && result.data) {
      setItems(result.data)
    }
  }

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({ message: 'Are you sure you want to delete this invoice?', danger: true })
    if (confirmed) {
      const result = await window.electronAPI.sales.delete(id)
      if (result.success) {
        loadInvoices()
      } else {
        toast.error('Failed to delete invoice: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const handleView = async (id: string) => {
    const result = await window.electronAPI.sales.getById(id)
    if (result.success && result.data) {
      setViewingInvoice(result.data)
      setShowViewModal(true)
    }
  }

  const handleEdit = async (invoice: SalesInvoice) => {
    const result = await window.electronAPI.sales.getById(invoice.id)
    if (result.success && result.data) {
      const fullInvoice = result.data
      setEditingInvoice(fullInvoice)
      setFormData({
        invoiceNumber: fullInvoice.invoiceNumber || '',
        customerId: fullInvoice.customerId || fullInvoice.customer?.id || '',
        type: 'INVOICE',
        status: fullInvoice.status || 'DRAFT',
        invoiceDate: new Date(fullInvoice.invoiceDate).toISOString().split('T')[0],
        dueDate: fullInvoice.dueDate ? new Date(fullInvoice.dueDate).toISOString().split('T')[0] : '',
        notes: fullInvoice.notes || '',
        termsConditions: fullInvoice.termsConditions || '',
        amountPaid: 0,
        paymentMode: 'CASH',
        poNumber: fullInvoice.poNumber || '',
        ewayBillNo: fullInvoice.ewayBillNo || '',
        vehicleNumber: fullInvoice.vehicleNumber || '',
        warrantyPeriod: fullInvoice.warrantyPeriod || '',
        dispatchedThrough: fullInvoice.dispatchedThrough || '',
      })
      // Show the additional fields section if any of them have values
      if (fullInvoice.poNumber || fullInvoice.ewayBillNo || fullInvoice.vehicleNumber || fullInvoice.warrantyPeriod || fullInvoice.dispatchedThrough) {
        setShowAdditionalFields(true)
      }
      setInvoiceItems(fullInvoice.items?.map((item: any) => ({
        itemId: item.item?.id || item.itemId,
        hsnCode: item.hsnCode || item.item?.hsnCode || item.item?.skuHsn || '',
        quantity: item.quantity,
        rate: item.rate,
        taxRate: item.taxRate,
        discount: item.discount || 0,
        amount: item.total
      })) || [])
      setShowModal(true)
    }
  }

  const addInvoiceItem = () => {
    if (invoiceItems.length >= 1 && invoiceItems[invoiceItems.length - 1].itemId === '') {
      toast.info('Please complete the current item first')
      return
    }
    setInvoiceItems([...invoiceItems, {
      itemId: '',
      hsnCode: '',
      quantity: 1,
      rate: 0,
      taxRate: 0,
      discount: 0,
      amount: 0
    }])
  }

  const updateInvoiceItem = (index: number, field: string, value: any) => {
    const newItems = [...invoiceItems]
    newItems[index] = { ...newItems[index], [field]: value }

    // If item selected, populate rate, tax, and HSN code
    if (field === 'itemId') {
      const item = items.find(i => i.id === value)
      if (item) {
        newItems[index].rate = item.salePrice
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

    setInvoiceItems(newItems)
  }

  const removeInvoiceItem = (index: number) => {
    setInvoiceItems(invoiceItems.filter((_, i) => i !== index))
  }

  const calculateTotals = () => {
    const subtotal = invoiceItems.reduce((sum, item) => {
      const qty = item.quantity || 0
      const rate = item.rate || 0
      const discount = item.discount || 0
      return sum + (qty * rate - discount)
    }, 0)

    const taxAmount = invoiceItems.reduce((sum, item) => {
      const qty = item.quantity || 0
      const rate = item.rate || 0
      const discount = item.discount || 0
      const taxRate = item.taxRate || 0
      return sum + ((qty * rate - discount) * taxRate / 100)
    }, 0)

    const total = subtotal + taxAmount

    return { subtotal, taxAmount, total }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.customerId) {
      toast.info('Please select a customer')
      return
    }

    if (invoiceItems.length === 0) {
      toast.info('Please add at least one item')
      return
    }

    const { subtotal, taxAmount, total } = calculateTotals()

    if (editingInvoice) {
      // Update existing invoice
      const invoiceData = {
        invoiceNumber: formData.invoiceNumber,
        customerId: formData.customerId,
        type: 'INVOICE',
        status: formData.status,
        invoiceDate: formData.invoiceDate,
        dueDate: formData.dueDate,
        notes: formData.notes,
        termsConditions: formData.termsConditions,
        poNumber: formData.poNumber,
        ewayBillNo: formData.ewayBillNo,
        vehicleNumber: formData.vehicleNumber,
        warrantyPeriod: formData.warrantyPeriod,
        dispatchedThrough: formData.dispatchedThrough,
        items: invoiceItems,
        subtotalAmount: subtotal,
        taxAmount: taxAmount,
        totalAmount: total
      }

      const result = await window.electronAPI.sales.update(editingInvoice.id, invoiceData)

      if (result.success) {
        toast.success('Invoice updated successfully!')
        setShowModal(false)
        resetForm()
        loadInvoices()
      } else {
        toast.error('Failed to update invoice: ' + (result.error || 'Unknown error'))
      }
    } else {
      // Create new invoice — invoiceNumber already in formData (pre-filled or user-edited)
      const invoiceData = {
        ...formData,
        items: invoiceItems,
        subtotalAmount: subtotal,
        taxAmount: taxAmount,
        totalAmount: total,
        balanceDue: total - (formData.amountPaid || 0),
        amountPaid: formData.amountPaid || 0,
        paymentMode: formData.paymentMode,
        status: formData.status
      }

      const result = await window.electronAPI.sales.create(invoiceData)

      if (result.success) {
        toast.success('Invoice created successfully!')
        setShowModal(false)
        resetForm()
        loadInvoices()
      } else {
        toast.error('Failed to create invoice: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const resetForm = () => {
    setFormData({
      customerId: '',
      type: 'INVOICE',
      status: 'DRAFT',
      invoiceDate: new Date().toISOString().split('T')[0],
      invoiceNumber: '',
      dueDate: '',
      notes: '',
      termsConditions: '',
      amountPaid: 0,
      paymentMode: 'CASH',
      poNumber: '',
      ewayBillNo: '',
      vehicleNumber: '',
      warrantyPeriod: '',
      dispatchedThrough: '',
    })
    setInvoiceItems([])
    setEditingInvoice(null)
    setShowAdditionalFields(false)
  }

  const handleNewInvoice = async () => {
    const result = await window.electronAPI.sales.generateInvoiceNumber()
      if (result.success) {
        setFormData(prev => ({
          ...prev,
          invoiceNumber: result.data || '',
          type: 'INVOICE',
          termsConditions: company?.termsConditions || '',
        }))
      }
    setShowModal(true)
  }

  const totals = calculateTotals()

  // Compute date-range bounds from the selected preset
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
    if (dateFilter === '7d') start.setDate(start.getDate() - 6) // last 7 days inclusive of today
    else if (dateFilter === '1m') start.setDate(start.getDate() - 29) // last 30 days
    else if (dateFilter === '1y') start.setDate(start.getDate() - 364) // last 365 days
    return { start, end }
  }

  const { start: dateStart, end: dateEnd } = getDateRange()

  // Filter invoices by search query and date range
  const filteredInvoices = invoices.filter((invoice) => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      const matchesNumber = invoice.invoiceNumber?.toLowerCase().includes(query)
      const matchesParty = invoice.customer?.name?.toLowerCase().includes(query)
      if (!matchesNumber && !matchesParty) return false
    }
    if (dateStart || dateEnd) {
      const invDate = new Date(invoice.invoiceDate)
      if (dateStart && invDate < dateStart) return false
      if (dateEnd && invDate > dateEnd) return false
    }
    return true
  })

  const { sortedItems: sortedInvoices, sortKey, sortDir, toggleSort } = useSortable(filteredInvoices, [
    { key: 'invoiceNumber', accessor: (i) => i.invoiceNumber },
    { key: 'invoiceDate', accessor: (i) => new Date(i.invoiceDate).getTime() },
    { key: 'party', accessor: (i) => i.customer?.name || '' },
    { key: 'totalAmount', accessor: (i) => i.totalAmount },
    { key: 'status', accessor: (i) => i.status || '' },
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Invoices</h1>
        <button
          onClick={handleNewInvoice}
          className="btn btn-primary"
        >
          + New Invoice
        </button>
      </div>

      {/* Search + Date Filter */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          className="input max-w-md flex-1 min-w-[240px]"
          placeholder={`Search by ${invoiceLabels.short} number or party name...`}
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
            {filteredInvoices.length} {filteredInvoices.length === 1 ? 'invoice' : 'invoices'}
          </span>
        )}
        {searchQuery.trim() && filteredInvoices.length > 0 && (() => {
          const rangeStart = getBulkRangeStart(bulkRange)
          const bulkFiltered = rangeStart
            ? filteredInvoices.filter(inv => new Date(inv.invoiceDate) >= rangeStart)
            : filteredInvoices
          return (
            <>
              <select
                className="input w-auto"
                value={bulkRange}
                onChange={(e) => setBulkRange(e.target.value as BulkRange)}
              >
                {BULK_RANGE_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <BulkDownloadMenu
                count={bulkFiltered.length}
                busy={bulkDownloading}
                onPdfs={() => handleBulkDownloadPdfs(bulkFiltered)}
                onExcel={() => handleBulkDownloadExcel(bulkFiltered)}
              />
            </>
          )
        })()}
      </div>

      {/* Invoices Table */}
      <div className="card">
        {loading ? (
          <TableSkeleton rows={6} columns={7} />
        ) : filteredInvoices.length === 0 ? (
          searchQuery.trim() || dateFilter !== 'all' ? (
            <EmptyState
              icon={SearchIcon}
              title="No invoices match your filters"
              description={searchQuery.trim()
                ? `Nothing matched "${searchQuery}" in the selected date range.`
                : 'No invoices fall within the selected date range.'}
            />
          ) : (
            <EmptyState
              icon={Wallet}
              title={`No ${invoiceLabels.plural.toLowerCase()} yet`}
              description="Create your first invoice to start billing customers and tracking payments."
              action={{ label: `+ Create your first ${invoiceLabels.singular.toLowerCase()}`, onClick: handleNewInvoice }}
            />
          )
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="Invoice #" sortKey="invoiceNumber" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Date" sortKey="invoiceDate" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Party" sortKey="party" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Amount" sortKey="totalAmount" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Status" sortKey="status" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <th className="table-header sticky top-0 z-10">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedInvoices.map((invoice) => (
                  <tr key={invoice.id} className="border-t">
                    <td className="table-cell font-medium">{invoice.invoiceNumber}</td>
                    <td className="table-cell">{new Date(invoice.invoiceDate).toLocaleDateString('en-GB')}</td>
                    <td className="table-cell">{invoice.customer?.name}</td>
                    <td className="table-cell">{formatCurrency(invoice.totalAmount)}</td>
                    <td className="table-cell">
                      <div className="flex flex-col items-start gap-1">
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          invoice.status === 'PAID' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                          invoice.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                          'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                        }`}>
                          {formatInvoiceStatus(invoice.status)}
                        </span>
                        {(() => {
                          const cd = getDueCountdown(
                            invoice.dueDate,
                            invoice.status,
                            invoice.amountPaid,
                            invoice.totalAmount
                          )
                          return cd ? (
                            <span className={`text-xs font-medium ${dueCountdownColorClass[cd.tone]}`}>
                              {cd.text}
                            </span>
                          ) : null
                        })()}
                      </div>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleView(invoice.id)}
                          className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                        >
                          View
                        </button>
                        <button
                          onClick={() => handleEdit(invoice)}
                          className="text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                        >
                          Edit
                        </button>
                        <DownloadMenu getOpts={() => buildDownloadOpts(invoice.id)} />
                        <ShareMenu
                          onShare={(target) => handleShare(invoice.id, target)}
                          phone={invoice.customer?.phone}
                          email={invoice.customer?.email}
                          partyName={invoice.customer?.name}
                        />
                        <button onClick={() => handleDelete(invoice.id)} className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300">
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

      {/* Create/Edit Invoice Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">
                  {editingInvoice ? 'Edit' : 'Create New'} Invoice
                </h2>
                <button onClick={() => { setShowModal(false); resetForm(); }} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl">
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Invoice Number *</label>
                    <input
                      type="text"
                      className="input"
                      value={formData.invoiceNumber}
                      onChange={(e) => setFormData({...formData, invoiceNumber: e.target.value})}
                      placeholder="Auto-generated"
                      required
                    />
                  </div>

                  <div>
                    <label className="label">Customer *</label>
                    <SearchableSelect
                      value={formData.customerId}
                      onChange={(id) => setFormData({...formData, customerId: id})}
                      options={parties.map(p => ({ id: p.id, name: p.name }))}
                      placeholder="Select Customer"
                      required
                    />
                  </div>

                  <div>
                    <label className="label">Status *</label>
                    <select
                      className="input"
                      value={formData.status}
                      onChange={(e) => setFormData({...formData, status: e.target.value})}
                    >
                      <option value="DRAFT">Unpaid</option>
                      <option value="PAID">Paid</option>
                      <option value="PARTIAL">Partial</option>
                      <option value="OVERDUE">Overdue</option>
                    </select>
                  </div>

                  <div>
                    <label className="label">Invoice Date *</label>
                    <DateInput
                      className="input"
                      value={formData.invoiceDate}
                      onChange={(e) => setFormData({...formData, invoiceDate: e.target.value})}
                      required
                    />
                  </div>

                  <div>
                    <label className="label">Due Date</label>
                    <DateInput
                      className="input"
                      value={formData.dueDate}
                      onChange={(e) => setFormData({...formData, dueDate: e.target.value})}
                    />
                  </div>
                </div>

                {/* Items Section */}
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">Invoice Items</h3>
                    <button type="button" onClick={addInvoiceItem} className="btn btn-secondary text-sm">
                      + Add Item
                    </button>
                  </div>

                  {invoiceItems.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 dark:bg-gray-900/40 rounded-lg border-2 border-dashed">
                      <p className="text-gray-500 dark:text-gray-400 mb-2">No items added yet</p>
                      <button type="button" onClick={addInvoiceItem} className="text-primary-600 hover:text-primary-700">
                        Click "+ Add Item" to add your first item
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {invoiceItems.map((item, index) => (
                        <div key={index} className="flex gap-3 items-end p-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
                          <div className="flex-1">
                            <label className="label text-xs">Item</label>
                            <select
                              className="input"
                              value={item.itemId}
                              onChange={(e) => updateInvoiceItem(index, 'itemId', e.target.value)}
                              required
                            >
                              <option value="">Select Item</option>
                              {items.map(i => (
                                <option key={i.id} value={i.id}>{i.name}</option>
                              ))}
                            </select>
                          </div>

                          <div className="w-32">
                            <label className="label text-xs">HSN/SKU</label>
                            <input
                              type="text"
                              className="input"
                              value={item.hsnCode}
                              onChange={(e) => updateInvoiceItem(index, 'hsnCode', e.target.value)}
                              placeholder="HSN/SKU"
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Qty</label>
                            <NumberInput
                              className="input"
                              value={item.quantity}
                              onChange={(val) => updateInvoiceItem(index, 'quantity', val)}
                              min={1}
                              required
                            />
                          </div>

                          <div className="w-32">
                            <label className="label text-xs">Rate</label>
                            <NumberInput
                              className="input"
                              value={item.rate}
                              onChange={(val) => updateInvoiceItem(index, 'rate', val)}
                              min={0}
                              required
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Disc</label>
                            <NumberInput
                              className="input"
                              value={item.discount}
                              onChange={(val) => updateInvoiceItem(index, 'discount', val)}
                              min={0}
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Tax %</label>
                            <NumberInput
                              className="input"
                              value={item.taxRate}
                              onChange={(val) => updateInvoiceItem(index, 'taxRate', val)}
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
                            onClick={() => removeInvoiceItem(index)}
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
                {invoiceItems.length > 0 && (
                  <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg">
                    <div className="space-y-2 max-w-sm ml-auto">
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Subtotal:</span>
                        <span className="font-medium">{formatCurrency(totals.subtotal)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600 dark:text-gray-400">Tax:</span>
                        <span className="font-medium">{formatCurrency(totals.taxAmount)}</span>
                      </div>
                      <div className="flex justify-between text-lg font-bold border-t pt-2">
                        <span>Total:</span>
                        <span>{formatCurrency(totals.total)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Payment Fields (only when creating, not editing) */}
                {!editingInvoice && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Amount Paid</label>
                      <NumberInput
                        className="input"
                        value={formData.amountPaid}
                        onChange={(val) => setFormData({...formData, amountPaid: val})}
                        min={0}
                      />
                    </div>
                    <div>
                      <label className="label">Payment Mode</label>
                      <select
                        className="input"
                        value={formData.paymentMode}
                        onChange={(e) => setFormData({...formData, paymentMode: e.target.value})}
                      >
                        <option value="CASH">Cash</option>
                        <option value="BANK_TRANSFER">Bank Transfer</option>
                        <option value="CARD">Card</option>
                        <option value="UPI">UPI</option>
                        <option value="CHEQUE">Cheque</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Notes */}
                <div className="grid grid-cols-2 gap-4">
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

                  <div>
                    <label className="label">Terms & Conditions</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={formData.termsConditions}
                      onChange={(e) => setFormData({...formData, termsConditions: e.target.value})}
                      placeholder="Terms that appear on invoice..."
                    />
                  </div>
                </div>

                {/* Additional Fields (collapsible) */}
                <div>
                  <button
                    type="button"
                    onClick={() => setShowAdditionalFields(!showAdditionalFields)}
                    className="flex items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                  >
                    <span className={`transform transition-transform ${showAdditionalFields ? 'rotate-180' : ''}`}>
                      ▼
                    </span>
                    Additional Fields
                  </button>

                  {showAdditionalFields && (
                    <div className="grid grid-cols-2 gap-4 mt-3 p-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
                      <div>
                        <label className="label">P.O. Number</label>
                        <input type="text" className="input" value={formData.poNumber}
                          onChange={(e) => setFormData({...formData, poNumber: e.target.value})}
                          placeholder="Customer's purchase order number" />
                      </div>
                      <div>
                        <label className="label">E-Way Bill No</label>
                        <input type="text" className="input" value={formData.ewayBillNo}
                          onChange={(e) => setFormData({...formData, ewayBillNo: e.target.value})}
                          placeholder="E-Way Bill number" />
                      </div>
                      <div>
                        <label className="label">Vehicle Number</label>
                        <input type="text" className="input" value={formData.vehicleNumber}
                          onChange={(e) => setFormData({...formData, vehicleNumber: e.target.value})}
                          placeholder="Transport vehicle number" />
                      </div>
                      <div>
                        <label className="label">Warranty Period</label>
                        <input type="text" className="input" value={formData.warrantyPeriod}
                          onChange={(e) => setFormData({...formData, warrantyPeriod: e.target.value})}
                          placeholder="e.g. 12 Months" />
                      </div>
                      <div>
                        <label className="label">Dispatched Through</label>
                        <input type="text" className="input" value={formData.dispatchedThrough}
                          onChange={(e) => setFormData({...formData, dispatchedThrough: e.target.value})}
                          placeholder="Transport company / courier" />
                      </div>
                    </div>
                  )}
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
                    {editingInvoice ? 'Update Invoice' : 'Create Invoice'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* View Invoice Modal */}
      {showViewModal && viewingInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Invoice Details</h2>
                <button onClick={() => { setShowViewModal(false); setViewingInvoice(null); }} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl">
                  ×
                </button>
              </div>

              {/* Invoice Header */}
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Invoice Number</p>
                  <p className="font-semibold text-lg">{viewingInvoice.invoiceNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Type</p>
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    viewingInvoice.type === 'INVOICE' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                  }`}>
                    {viewingInvoice.type}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Date</p>
                  <p className="font-medium">{new Date(viewingInvoice.invoiceDate).toLocaleDateString('en-GB')}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Due Date</p>
                  <p className="font-medium">
                    {viewingInvoice.dueDate
                      ? new Date(viewingInvoice.dueDate).toLocaleDateString('en-GB')
                      : '—'}
                  </p>
                  {(() => {
                    const cd = getDueCountdown(
                      viewingInvoice.dueDate,
                      viewingInvoice.status,
                      viewingInvoice.amountPaid,
                      viewingInvoice.totalAmount
                    )
                    return cd ? (
                      <p className={`text-xs font-medium mt-0.5 ${dueCountdownColorClass[cd.tone]}`}>
                        {cd.text}
                      </p>
                    ) : null
                  })()}
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    viewingInvoice.status === 'PAID' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                    viewingInvoice.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  }`}>
                    {formatInvoiceStatus(viewingInvoice.status)}
                  </span>
                </div>
              </div>

              {/* Customer Info */}
              <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg mb-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Customer</p>
                <p className="font-semibold">{viewingInvoice.customer?.name}</p>
                {viewingInvoice.customer?.phone && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingInvoice.customer.phone}</p>}
                {viewingInvoice.customer?.email && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingInvoice.customer.email}</p>}
                {viewingInvoice.customer?.billingAddress && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingInvoice.customer.billingAddress}</p>}
              </div>

              {/* Items */}
              <div className="mb-6">
                <h3 className="font-semibold mb-3">Items</h3>
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th className="table-header sticky top-0 z-10">Item</th>
                      <th className="table-header sticky top-0 z-10">HSN/SKU</th>
                      <th className="table-header sticky top-0 z-10">Qty</th>
                      <th className="table-header sticky top-0 z-10">Rate</th>
                      <th className="table-header sticky top-0 z-10">Tax %</th>
                      <th className="table-header sticky top-0 z-10">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingInvoice.items?.map((item, index) => (
                      <tr key={index} className="border-t">
                        <td className="table-cell">{item.item?.name}</td>
                        <td className="table-cell text-gray-500">{item.hsnCode || '-'}</td>
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
                    <span className="font-medium">{formatCurrency(viewingInvoice.subtotal || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Tax:</span>
                    <span className="font-medium">{formatCurrency(viewingInvoice.taxAmount || 0)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold border-t pt-2">
                    <span>Total:</span>
                    <span>{formatCurrency(viewingInvoice.totalAmount)}</span>
                  </div>
                  {viewingInvoice.amountPaid !== undefined && viewingInvoice.amountPaid > 0 && (
                    <>
                      <div className="flex justify-between text-green-600 dark:text-green-400">
                        <span>Paid:</span>
                        <span>{formatCurrency(viewingInvoice.amountPaid)}</span>
                      </div>
                      <div className="flex justify-between text-red-600 dark:text-red-400 font-bold">
                        <span>Balance Due:</span>
                        <span>{formatCurrency(viewingInvoice.balanceDue || 0)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Notes */}
              {viewingInvoice.notes && (
                <div className="mb-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Notes</p>
                  <p className="text-gray-700 dark:text-gray-300">{viewingInvoice.notes}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  onClick={() => { setShowViewModal(false); setViewingInvoice(null); }}
                  className="btn btn-secondary"
                >
                  Close
                </button>
                <ShareMenu
                  variant="button"
                  onShare={(target) => handleShare(viewingInvoice.id, target)}
                  phone={viewingInvoice.customer?.phone}
                  email={viewingInvoice.customer?.email}
                  partyName={viewingInvoice.customer?.name}
                />
                <DownloadMenu
                  variant="button"
                  getOpts={() => buildDownloadOpts(viewingInvoice.id)}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Sales
