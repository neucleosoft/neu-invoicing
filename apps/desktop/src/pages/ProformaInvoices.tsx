import { useEffect, useState } from 'react'
import { FileText, Search as SearchIcon } from 'lucide-react'
import SearchableSelect from '../components/SearchableSelect'

import { ProformaInvoice, ProformaInvoiceStatus } from '../types'
import { getInvoicePDFBytes } from '../utils/generateInvoicePDF'
import DownloadMenu from '../components/DownloadMenu'
import BulkDownloadMenu from '../components/BulkDownloadMenu'
import { DispatchOpts, TableData } from '../utils/downloadHelpers'
import { bulkDownloadPdfs, bulkDownloadExcel, buildZipFilename } from '../utils/bulkDownloadPdfs'
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
import { useSortable } from '../hooks/useSortable'
import SortHeader from '../components/SortHeader'
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

interface ProformaInvoiceFormItem {
  itemId: string
  hsnCode: string
  quantity: number
  rate: number
  taxRate: number
  discount: number
  amount: number
}


const statusOptions: ProformaInvoiceStatus[] = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']

const statusBadgeClass = (status: string) => {
  switch (status) {
    case 'ACCEPTED':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
    case 'SENT':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    case 'REJECTED':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
    case 'EXPIRED':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
  }
}

const ProformaInvoices = () => {
  const [proformaInvoices, setProformaInvoices] = useState<ProformaInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [viewingProformaInvoice, setViewingProformaInvoice] = useState<ProformaInvoice | null>(null)
  const [editingProformaInvoice, setEditingProformaInvoice] = useState<ProformaInvoice | null>(null)
  const [parties, setParties] = useState<Party[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFilter, setDateFilter] = useState<'all' | '7d' | '1m' | '1q' | '1y' | 'custom'>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [proformaInvoiceItems, setProformaInvoiceItems] = useState<ProformaInvoiceFormItem[]>([])
  const [bulkDownloading, setBulkDownloading] = useState(false)
  const toast = useToast()
  const confirm = useConfirm()
  const { company } = useStore()

  const [formData, setFormData] = useState({
    customerId: '',
    status: 'DRAFT' as ProformaInvoiceStatus,
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: '',
    invoiceNumber: '',
    notes: '',
    termsConditions: '',
    deliveryTime: '',
  })

  useEffect(() => {
    loadProformaInvoices()
    loadParties()
    loadItems()
  }, [])

  const loadProformaInvoices = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.proformaInvoice.getAll()
      if (result.success && result.data) {
        setProformaInvoices(result.data)
      }
    } finally {
      setLoading(false)
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

  const loadProformaInvoicePDFData = async (proformaInvoiceId: string): Promise<any | null> => {
    const result = await window.electronAPI.proformaInvoice.getById(proformaInvoiceId)
    if (!result.success || !result.data) return null
    const company = await loadCompanyForPDF()
    return {
      ...result.data,
      type: 'PROFORMA_INVOICE',
      items: result.data.items || [],
      company,
      amountPaid: 0,
      balanceDue: 0,
    }
  }

  const buildProformaTableData = (pdfData: any, filename: string): TableData => {
    const customer = pdfData.customer || pdfData.party || {}
    const meta: Array<[string, string | number]> = [
      ['Proforma', pdfData.invoiceNumber || ''],
      ['Date', pdfData.invoiceDate ? new Date(pdfData.invoiceDate).toLocaleDateString('en-GB') : ''],
      ['Customer', customer.name || ''],
      ['GSTIN', customer.taxId || ''],
    ]
    const metaSuffix: Array<[string, string | number]> = [
      ['Status', pdfData.status || ''],
      ['Subtotal', pdfData.subtotal || 0],
      ['Tax', pdfData.taxAmount || 0],
      ['Total', pdfData.totalAmount || 0],
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

  const buildDownloadOpts = async (id: string): Promise<DispatchOpts> => {
    const pdfData = await loadProformaInvoicePDFData(id)
    if (!pdfData) throw new Error('Failed to load proforma invoice details')
    let cached: { bytes: Uint8Array; filename: string } | null = null
    const getPdf = async () => {
      if (!cached) cached = await getInvoicePDFBytes(pdfData)
      return cached
    }
    return {
      getPdf,
      getTable: async () => {
        const { filename } = await getPdf()
        return buildProformaTableData(pdfData, filename)
      },
    }
  }

  const handleBulkDownloadPdfs = async (matching: ProformaInvoice[]) => {
    if (matching.length === 0) {
      toast.info('No proforma invoices to download')
      return
    }
    const partyName = matching[0]?.customer?.name || searchQuery || 'all'

    setBulkDownloading(true)
    try {
      const items = matching.map(p => ({
        id: p.id,
        filename: `${p.invoiceNumber.replace(/\//g, '_')}.pdf`,
      }))
      const result = await bulkDownloadPdfs({
        items,
        zipFilename: buildZipFilename('Proforma_Invoices', partyName),
        getBytes: async (id) => {
          const pdfData = await loadProformaInvoicePDFData(id)
          if (!pdfData) return null
          const { bytes } = await getInvoicePDFBytes(pdfData)
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

  const handleBulkDownloadExcel = async (matching: ProformaInvoice[]) => {
    if (matching.length === 0) {
      toast.info('No proforma invoices to download')
      return
    }
    const partyName = matching[0]?.customer?.name || searchQuery || 'all'

    setBulkDownloading(true)
    try {
      const headers = [
        'Proforma #', 'Date', 'Expiry', 'Customer', 'GSTIN',
        'Item', 'HSN/SAC', 'Qty', 'Rate', 'Discount', 'Tax %', 'Amount',
        'Subtotal', 'Tax', 'Total', 'Status',
      ]
      const rows: (string | number)[][] = []
      for (const p of matching) {
        let items: any[] = (p as any).items || []
        if (!items.length) {
          const res = await window.electronAPI.proformaInvoice.getById(p.id)
          if (res.success && res.data) items = (res.data as any).items || []
        }
        const dateStr = p.invoiceDate ? new Date(p.invoiceDate).toLocaleDateString('en-GB') : ''
        const expiryStr = p.dueDate ? new Date(p.dueDate).toLocaleDateString('en-GB') : ''
        const trailer: (string | number)[] = [
          p.subtotal || 0,
          p.taxAmount || 0,
          p.totalAmount || 0,
          p.status || '',
        ]
        if (items.length === 0) {
          rows.push([
            p.invoiceNumber || '',
            dateStr,
            expiryStr,
            p.customer?.name || '',
            p.customer?.taxId || '',
            '', '', 0, 0, 0, 0, 0,
            ...trailer,
          ])
          continue
        }
        for (const it of items) {
          rows.push([
            p.invoiceNumber || '',
            dateStr,
            expiryStr,
            p.customer?.name || '',
            p.customer?.taxId || '',
            it.item?.name || '',
            it.hsnCode || it.item?.hsnCode || it.item?.skuHsn || '',
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
      const filename = `ProformaInvoices_${(partyName || 'all').replace(/[^a-z0-9]+/gi, '_')}_${today}.xlsx`
      await bulkDownloadExcel({
        filename,
        sheets: [{
          name: 'Proforma Invoices',
          meta: [['Generated', new Date().toLocaleString()]],
          headers,
          rows,
        }],
      })
      toast.success(`Exported ${matching.length} proforma invoice${matching.length === 1 ? '' : 's'} to Excel`)
    } catch (error) {
      console.error('Bulk Excel error:', error)
      toast.error('Failed to bulk-download Excel')
    } finally {
      setBulkDownloading(false)
    }
  }

  const handleShare = async (proformaInvoiceId: string, target: ShareTarget) => {
    try {
      const pdfData = await loadProformaInvoicePDFData(proformaInvoiceId)
      if (!pdfData) {
        toast.error('Failed to load proforma invoice details')
        return
      }
      const { bytes, filename } = await getInvoicePDFBytes(pdfData)
      const subject =
        `Proforma Invoice ${pdfData.invoiceNumber} from ${pdfData.company?.name || ''}`.trim()
      await sharePdf(bytes, filename, target, toast, {
        subject,
        phone: pdfData.customer?.phone,
        email: pdfData.customer?.email,
        partyName: pdfData.customer?.name,
      })
    } catch (error) {
      console.error('Error sharing proforma invoice:', error)
      toast.error('Failed to share proforma invoice')
    }
  }

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({ message: 'Delete this proforma invoice? It will be marked Deleted and left out of totals and reports. You can restore it anytime.', danger: true })
    if (confirmed) {
      const result = await window.electronAPI.proformaInvoice.delete(id)
      if (result.success) {
        loadProformaInvoices()
      } else {
        toast.error('Failed to delete proforma invoice: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const handleRestore = async (id: string) => {
    const result = await window.electronAPI.proformaInvoice.restore(id)
    if (result.success) {
      loadProformaInvoices()
    } else {
      toast.error('Failed to restore proforma invoice: ' + (result.error || 'Unknown error'))
    }
  }

  const handleConvertToInvoice = async (id: string) => {
    const result = await window.electronAPI.proformaInvoice.convertToInvoice(id)
    if (result.success) {
      toast.success('Proforma invoice converted to invoice successfully!')
      setShowViewModal(false)
      setViewingProformaInvoice(null)
      loadProformaInvoices()
    } else {
      toast.error('Failed to convert proforma invoice: ' + (result.error || 'Unknown error'))
    }
  }

  const handleView = async (id: string) => {
    const result = await window.electronAPI.proformaInvoice.getById(id)
    if (result.success && result.data) {
      setViewingProformaInvoice(result.data)
      setShowViewModal(true)
    }
  }

  const handleEdit = async (proformaInvoice: ProformaInvoice) => {
    const result = await window.electronAPI.proformaInvoice.getById(proformaInvoice.id)
    if (result.success && result.data) {
      const fullProformaInvoice = result.data
      setEditingProformaInvoice(fullProformaInvoice)
      setFormData({
        invoiceNumber: fullProformaInvoice.invoiceNumber || '',
        customerId: fullProformaInvoice.customerId || fullProformaInvoice.customer?.id || '',
        status: (fullProformaInvoice.status as ProformaInvoiceStatus) || 'DRAFT',
        invoiceDate: new Date(fullProformaInvoice.invoiceDate).toISOString().split('T')[0],
        dueDate: fullProformaInvoice.dueDate ? new Date(fullProformaInvoice.dueDate).toISOString().split('T')[0] : '',
        notes: fullProformaInvoice.notes || '',
        termsConditions: fullProformaInvoice.termsConditions || '',
        deliveryTime: fullProformaInvoice.deliveryTime ? new Date(fullProformaInvoice.deliveryTime).toISOString().split('T')[0] : '',
      })
      setProformaInvoiceItems(fullProformaInvoice.items?.map((item: any) => ({
        itemId: item.item?.id || item.itemId,
        hsnCode: item.hsnCode || item.item?.hsnCode || item.item?.skuHsn || '',
        quantity: item.quantity,
        rate: item.rate,
        taxRate: item.taxRate,
        discount: item.discount || 0,
        amount: item.total,
      })) || [])
      setShowModal(true)
    }
  }

  const addProformaInvoiceItem = () => {
    if (proformaInvoiceItems.length >= 1 && proformaInvoiceItems[proformaInvoiceItems.length - 1].itemId === '') {
      toast.info('Please complete the current item first')
      return
    }
    setProformaInvoiceItems([...proformaInvoiceItems, {
      itemId: '',
      hsnCode: '',
      quantity: 1,
      rate: 0,
      taxRate: 0,
      discount: 0,
      amount: 0,
    }])
  }

  const updateProformaInvoiceItem = (index: number, field: string, value: any) => {
    const newItems = [...proformaInvoiceItems]
    newItems[index] = { ...newItems[index], [field]: value }

    if (field === 'itemId') {
      const item = items.find(i => i.id === value)
      if (item) {
        newItems[index].rate = item.salePrice
        newItems[index].taxRate = item.taxRate
        newItems[index].hsnCode = item.hsnCode || item.skuHsn || ''
      }
    }

    const qty = newItems[index].quantity || 0
    const rate = newItems[index].rate || 0
    const discount = newItems[index].discount || 0
    const taxRate = newItems[index].taxRate || 0
    newItems[index].amount = (qty * rate - discount) * (1 + taxRate / 100)

    setProformaInvoiceItems(newItems)
  }

  const removeProformaInvoiceItem = (index: number) => {
    setProformaInvoiceItems(proformaInvoiceItems.filter((_, i) => i !== index))
  }

  const calculateTotals = () => {
    const subtotal = proformaInvoiceItems.reduce((sum, item) => {
      const qty = item.quantity || 0
      const rate = item.rate || 0
      const discount = item.discount || 0
      return sum + (qty * rate - discount)
    }, 0)

    const taxAmount = proformaInvoiceItems.reduce((sum, item) => {
      const qty = item.quantity || 0
      const rate = item.rate || 0
      const discount = item.discount || 0
      const taxRate = item.taxRate || 0
      return sum + ((qty * rate - discount) * taxRate / 100)
    }, 0)

    return {
      subtotal,
      taxAmount,
      total: subtotal + taxAmount,
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.customerId) {
      toast.info('Please select a customer')
      return
    }

    if (proformaInvoiceItems.length === 0) {
      toast.info('Please add at least one item')
      return
    }

    const { subtotal, taxAmount, total } = calculateTotals()

    const proformaInvoiceData = {
      invoiceNumber: formData.invoiceNumber,
      customerId: formData.customerId,
      status: formData.status,
      invoiceDate: formData.invoiceDate,
      dueDate: formData.dueDate || null,
      deliveryTime: formData.deliveryTime || null,
      notes: formData.notes,
      termsConditions: formData.termsConditions,
      items: proformaInvoiceItems,
      subtotalAmount: subtotal,
      taxAmount,
      totalAmount: total,
    }

    if (editingProformaInvoice) {
      const result = await window.electronAPI.proformaInvoice.update(editingProformaInvoice.id, proformaInvoiceData)
      if (result.success) {
        toast.success('Proforma invoice updated successfully!')
        setShowModal(false)
        resetForm()
        loadProformaInvoices()
      } else {
        toast.error('Failed to update proforma invoice: ' + (result.error || 'Unknown error'))
      }
    } else {
      const result = await window.electronAPI.proformaInvoice.create(proformaInvoiceData)
      if (result.success) {
        toast.success('Proforma invoice created successfully!')
        setShowModal(false)
        resetForm()
        loadProformaInvoices()
      } else {
        toast.error('Failed to create proforma invoice: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const resetForm = () => {
    setFormData({
      customerId: '',
      status: 'DRAFT',
      invoiceDate: new Date().toISOString().split('T')[0],
      dueDate: '',
      invoiceNumber: '',
      notes: '',
      termsConditions: '',
      deliveryTime: '',
    })
    setProformaInvoiceItems([])
    setEditingProformaInvoice(null)
  }

  const handleNewProformaInvoice = async () => {
    const result = await window.electronAPI.proformaInvoice.generateNumber()
    if (result.success) {
      setFormData(prev => ({
        ...prev,
        invoiceNumber: result.data || '',
        status: 'DRAFT',
        termsConditions: company?.termsConditions || '',
      }))
    }
    setShowModal(true)
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

  const filteredProformaInvoices = proformaInvoices.filter((proformaInvoice) => {
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      const matchesNumber = proformaInvoice.invoiceNumber?.toLowerCase().includes(query)
      const matchesParty = proformaInvoice.customer?.name?.toLowerCase().includes(query)
      if (!matchesNumber && !matchesParty) return false
    }
    if (dateStart || dateEnd) {
      const d = new Date(proformaInvoice.invoiceDate)
      if (dateStart && d < dateStart) return false
      if (dateEnd && d > dateEnd) return false
    }
    return true
  })

  const { sortedItems: sortedProformaInvoices, sortKey, sortDir, toggleSort } = useSortable(filteredProformaInvoices, [
    { key: 'invoiceNumber', accessor: (i) => i.invoiceNumber },
    { key: 'invoiceDate', accessor: (i) => new Date(i.invoiceDate).getTime() },
    { key: 'dueDate', accessor: (i) => i.dueDate ? new Date(i.dueDate).getTime() : 0 },
    { key: 'party', accessor: (i) => i.customer?.name || '' },
    { key: 'totalAmount', accessor: (i) => i.totalAmount },
    { key: 'status', accessor: (i) => i.status || '' },
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Proforma Invoices</h1>
        <button onClick={handleNewProformaInvoice} className="btn btn-primary">
          + New Proforma Invoice
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          className="input max-w-md flex-1 min-w-[240px]"
          placeholder="Search by PI number or party name..."
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
            {filteredProformaInvoices.length} {filteredProformaInvoices.length === 1 ? 'proforma' : 'proformas'}
          </span>
        )}
        {filteredProformaInvoices.length > 0 && (
          <BulkDownloadMenu
            count={filteredProformaInvoices.length}
            busy={bulkDownloading}
            onPdfs={() => handleBulkDownloadPdfs(filteredProformaInvoices)}
            onExcel={() => handleBulkDownloadExcel(filteredProformaInvoices)}
          />
        )}
      </div>

      <div className="card">
        {loading ? (
          <TableSkeleton rows={6} columns={8} />
        ) : filteredProformaInvoices.length === 0 ? (
          searchQuery.trim() || dateFilter !== 'all' ? (
            <EmptyState
              icon={SearchIcon}
              title="No proforma invoices match your filters"
              description={searchQuery.trim() ? `Nothing matched "${searchQuery}".` : 'No proforma invoices in this date range.'}
            />
          ) : (
            <EmptyState
              icon={FileText}
              title="No proforma invoices yet"
              description="Create your first proforma invoice to share expected pricing with customers before billing."
              action={{ label: '+ Create your first proforma invoice', onClick: handleNewProformaInvoice }}
            />
          )
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <table className="table">
              <thead>
                <tr>
                  <th className="table-header sticky top-0 z-10">S.No</th>
                  <SortHeader label="PI #" sortKey="invoiceNumber" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Date" sortKey="invoiceDate" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Expiry" sortKey="dueDate" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Party" sortKey="party" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Amount" sortKey="totalAmount" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Status" sortKey="status" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <th className="table-header sticky top-0 z-10">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedProformaInvoices.map((proformaInvoice, index) => {
                  const isDeleted = !!proformaInvoice.deletedAt
                  return (
                  <tr key={proformaInvoice.id} className={`border-t ${isDeleted ? 'opacity-60' : ''}`}>
                    <td className="table-cell">{index + 1}</td>
                    <td className="table-cell font-medium">{proformaInvoice.invoiceNumber}</td>
                    <td className="table-cell">{new Date(proformaInvoice.invoiceDate).toLocaleDateString('en-GB')}</td>
                    <td className="table-cell">{proformaInvoice.dueDate ? new Date(proformaInvoice.dueDate).toLocaleDateString('en-GB') : '-'}</td>
                    <td className="table-cell">{proformaInvoice.customer?.name}</td>
                    <td className="table-cell">{formatCurrency(proformaInvoice.totalAmount)}</td>
                    <td className="table-cell">
                      {isDeleted ? (
                        <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                          Deleted
                        </span>
                      ) : (
                        <span className={`px-2 py-1 rounded-full text-xs ${statusBadgeClass(proformaInvoice.status)}`}>
                          {proformaInvoice.status}
                        </span>
                      )}
                    </td>
                    <td className="table-cell">
                      {isDeleted ? (
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleView(proformaInvoice.id)}
                            className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                          >
                            View
                          </button>
                          <button
                            onClick={() => handleRestore(proformaInvoice.id)}
                            className="text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                          >
                            Restore
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleView(proformaInvoice.id)}
                            className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                          >
                            View
                          </button>
                          <button
                            onClick={() => handleEdit(proformaInvoice)}
                            className="text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                          >
                            Edit
                          </button>
                          <DownloadMenu getOpts={() => buildDownloadOpts(proformaInvoice.id)} />
                          <ShareMenu
                            onShare={(target) => handleShare(proformaInvoice.id, target)}
                            phone={proformaInvoice.customer?.phone}
                            email={proformaInvoice.customer?.email}
                            partyName={proformaInvoice.customer?.name}
                          />
                          <button
                            onClick={() => handleConvertToInvoice(proformaInvoice.id)}
                            className="text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
                          >
                            Convert
                          </button>
                          <button
                            onClick={() => handleDelete(proformaInvoice.id)}
                            className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">
                  {editingProformaInvoice ? 'Edit' : 'Create New'} Proforma Invoice
                </h2>
                <button onClick={() => { setShowModal(false); resetForm(); }} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl">
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Proforma Invoice Number *</label>
                    <input
                      type="text"
                      className="input"
                      value={formData.invoiceNumber}
                      onChange={(e) => setFormData({ ...formData, invoiceNumber: e.target.value })}
                      placeholder="Auto-generated"
                      required
                    />
                  </div>

                  <div>
                    <label className="label">Customer *</label>
                    <SearchableSelect
                      value={formData.customerId}
                      onChange={(id) => setFormData({ ...formData, customerId: id })}
                      options={parties.map((p) => ({ id: p.id, name: p.name }))}
                      placeholder="Select Customer"
                      required
                    />
                  </div>

                  <div>
                    <label className="label">Status *</label>
                    <select
                      className="input"
                      value={formData.status}
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as ProformaInvoiceStatus })}
                    >
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status.charAt(0) + status.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label">PI Date *</label>
                    <DateInput
                      className="input"
                      value={formData.invoiceDate}
                      onChange={(e) => setFormData({ ...formData, invoiceDate: e.target.value })}
                      required
                    />
                  </div>

                  <div>
                    <label className="label">Expiry Date</label>
                    <DateInput
                      className="input"
                      value={formData.dueDate}
                      onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                    />
                  </div>

                  <div>
                    <label className="label">Delivery Time</label>
                    <DateInput
                      className="input"
                      value={formData.deliveryTime}
                      onChange={(e) => setFormData({ ...formData, deliveryTime: e.target.value })}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">PI Items</h3>
                    <button type="button" onClick={addProformaInvoiceItem} className="btn btn-secondary text-sm">
                      + Add Item
                    </button>
                  </div>

                  {proformaInvoiceItems.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 dark:bg-gray-900/40 rounded-lg border-2 border-dashed">
                      <p className="text-gray-500 dark:text-gray-400 mb-2">No items added yet</p>
                      <button type="button" onClick={addProformaInvoiceItem} className="text-primary-600 hover:text-primary-700">
                        Click "+ Add Item" to add your first item
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {proformaInvoiceItems.map((item, index) => (
                        <div key={index} className="flex gap-3 items-end p-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
                          <div className="flex-1">
                            <label className="label text-xs">Item</label>
                            <select
                              className="input"
                              value={item.itemId}
                              onChange={(e) => updateProformaInvoiceItem(index, 'itemId', e.target.value)}
                              required
                            >
                              <option value="">Select Item</option>
                              {items.map((i) => (
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
                              onChange={(e) => updateProformaInvoiceItem(index, 'hsnCode', e.target.value)}
                              placeholder="HSN/SKU"
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Qty</label>
                            <NumberInput
                              className="input"
                              value={item.quantity}
                              onChange={(val) => updateProformaInvoiceItem(index, 'quantity', val)}
                              min={1}
                              required
                            />
                          </div>

                          <div className="w-32">
                            <label className="label text-xs">Rate</label>
                            <NumberInput
                              className="input"
                              value={item.rate}
                              onChange={(val) => updateProformaInvoiceItem(index, 'rate', val)}
                              min={0}
                              required
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Disc</label>
                            <NumberInput
                              className="input"
                              value={item.discount}
                              onChange={(val) => updateProformaInvoiceItem(index, 'discount', val)}
                              min={0}
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Tax %</label>
                            <NumberInput
                              className="input"
                              value={item.taxRate}
                              onChange={(val) => updateProformaInvoiceItem(index, 'taxRate', val)}
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
                            onClick={() => removeProformaInvoiceItem(index)}
                            className="btn btn-danger h-10 px-3"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {proformaInvoiceItems.length > 0 && (
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

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Notes</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="Proforma invoice notes..."
                    />
                  </div>

                  <div>
                    <label className="label">Terms & Conditions</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={formData.termsConditions}
                      onChange={(e) => setFormData({ ...formData, termsConditions: e.target.value })}
                      placeholder="Terms that appear on proforma invoice..."
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t">
                  <button
                    type="button"
                    onClick={() => { setShowModal(false); resetForm() }}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {editingProformaInvoice ? 'Update Proforma Invoice' : 'Create Proforma Invoice'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {showViewModal && viewingProformaInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Proforma Invoice Details</h2>
                <button onClick={() => { setShowViewModal(false); setViewingProformaInvoice(null) }} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl">
                  ×
                </button>
              </div>

              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">PI Number</p>
                  <p className="font-semibold text-lg">{viewingProformaInvoice.invoiceNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
                  <span className={`px-2 py-1 rounded-full text-xs ${statusBadgeClass(viewingProformaInvoice.status)}`}>
                    {viewingProformaInvoice.status}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">PI Date</p>
                  <p className="font-medium">{new Date(viewingProformaInvoice.invoiceDate).toLocaleDateString('en-GB')}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Expiry Date</p>
                  <p className="font-medium">{viewingProformaInvoice.dueDate ? new Date(viewingProformaInvoice.dueDate).toLocaleDateString('en-GB') : '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Delivery Time</p>
                  <p className="font-medium">{viewingProformaInvoice.deliveryTime ? new Date(viewingProformaInvoice.deliveryTime).toLocaleDateString('en-GB') : '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Document Type</p>
                  <p className="font-medium">Proforma Invoice</p>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg mb-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Customer</p>
                <p className="font-semibold">{viewingProformaInvoice.customer?.name}</p>
                {viewingProformaInvoice.customer?.phone && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingProformaInvoice.customer.phone}</p>}
                {viewingProformaInvoice.customer?.email && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingProformaInvoice.customer.email}</p>}
                {viewingProformaInvoice.customer?.billingAddress && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingProformaInvoice.customer.billingAddress}</p>}
              </div>

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
                    {viewingProformaInvoice.items?.map((item, index) => (
                      <tr key={index} className="border-t">
                        <td className="table-cell">{index + 1}</td>
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

              <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg mb-6">
                <div className="space-y-2 max-w-sm ml-auto">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Subtotal:</span>
                    <span className="font-medium">{formatCurrency(viewingProformaInvoice.subtotal || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Tax:</span>
                    <span className="font-medium">{formatCurrency(viewingProformaInvoice.taxAmount || 0)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold border-t pt-2">
                    <span>Total:</span>
                    <span>{formatCurrency(viewingProformaInvoice.totalAmount)}</span>
                  </div>
                </div>
              </div>

              {viewingProformaInvoice.notes && (
                <div className="mb-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Notes</p>
                  <p className="text-gray-700 dark:text-gray-300">{viewingProformaInvoice.notes}</p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  onClick={() => { setShowViewModal(false); setViewingProformaInvoice(null) }}
                  className="btn btn-secondary"
                >
                  Close
                </button>
                <DownloadMenu
                  variant="button"
                  getOpts={() => buildDownloadOpts(viewingProformaInvoice.id)}
                />
                <ShareMenu
                  variant="button"
                  onShare={(target) => handleShare(viewingProformaInvoice.id, target)}
                  phone={viewingProformaInvoice.customer?.phone}
                  email={viewingProformaInvoice.customer?.email}
                  partyName={viewingProformaInvoice.customer?.name}
                />
                <button
                  onClick={() => handleConvertToInvoice(viewingProformaInvoice.id)}
                  className="btn btn-primary"
                >
                  Convert to Invoice
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ProformaInvoices
