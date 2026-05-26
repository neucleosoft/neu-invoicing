import { useEffect, useState } from 'react'
import { formatCurrency } from '../utils/currency'
import { getChallanPDFBytes, buildChallanFilename } from '../utils/pdfmakeChallan'
import DownloadMenu from '../components/DownloadMenu'
import BulkDownloadMenu from '../components/BulkDownloadMenu'
import { DispatchOpts, TableData } from '../utils/downloadHelpers'
import { bulkDownloadPdfs, bulkDownloadExcel, buildZipFilename } from '../utils/bulkDownloadPdfs'
import { loadCompanyForPDF } from '../utils/loadCompanyForPDF'
import { sharePdf, ShareTarget } from '../utils/sharePdf'
import ShareMenu from '../components/ShareMenu'
import NumberInput from '../components/NumberInput'
import DateInput from '../components/DateInput'
import { useToast } from '../components/ToastContext'
import { useConfirm } from '../components/ConfirmDialogContext'
import EmptyState from '../components/EmptyState'
import { Truck, Search as SearchIcon } from 'lucide-react'
import SearchableSelect from '../components/SearchableSelect'
import { useStore } from '../store/useStore'

interface Challan {
  id: string
  challanNumber: string
  challanDate: string
  // RETURNABLE = goods sent for repair/job-work (will come back).
  // NON_RETURNABLE = goods sent for sale (can convert to invoice).
  // CONVERTED is set programmatically once a non-returnable challan becomes an invoice.
  status: 'RETURNABLE' | 'NON_RETURNABLE' | 'CONVERTED'
  customerId?: string
  totalAmount: number
  subtotal?: number
  taxAmount?: number
  transportMode?: string
  vehicleNumber?: string
  notes?: string
  termsConditions?: string
  convertedToInvoiceId?: string
  poNumber?: string
  ewayBillNo?: string
  warrantyPeriod?: string
  dispatchedThrough?: string
  customer?: {
    id?: string
    name: string
    email?: string
    phone?: string
    billingAddress?: string
  }
  items?: Array<{
    item: {
      name: string
      unit?: string
    }
    quantity: number
    rate: number
    taxRate: number
    discount: number
    total: number
    hsnCode?: string
  }>
}

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

interface ChallanItem {
  itemId: string
  hsnCode: string
  quantity: number
  rate: number
  taxRate: number
  discount: number
  amount: number
}


const DeliveryChallan = () => {
  const [challans, setChallans] = useState<Challan[]>([])
  const [showModal, setShowModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [viewingChallan, setViewingChallan] = useState<Challan | null>(null)
  const [editingChallan, setEditingChallan] = useState<Challan | null>(null)
  const [parties, setParties] = useState<Party[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [dateFilter, setDateFilter] = useState<'all' | '7d' | '1m' | '1q' | '1y' | 'custom'>('all')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [bulkDownloading, setBulkDownloading] = useState(false)

  // Form state
  const [formData, setFormData] = useState({
    customerId: '',
    challanNumber: '',
    challanDate: new Date().toISOString().split('T')[0],
    status: 'NON_RETURNABLE' as string,
    transportMode: '',
    vehicleNumber: '',
    notes: '',
    termsConditions: '',
    poNumber: '',
    ewayBillNo: '',
    warrantyPeriod: '',
    dispatchedThrough: '',
  })
  const [showAdditionalFields, setShowAdditionalFields] = useState(false)

  const [challanItems, setChallanItems] = useState<ChallanItem[]>([])
  const toast = useToast()
  const confirm = useConfirm()
  const { company } = useStore()

  useEffect(() => {
    loadChallans()
    loadParties()
    loadItems()
  }, [])

  const loadChallans = async () => {
    const result = await window.electronAPI.challan.getAll()
    if (result.success && result.data) {
      setChallans(result.data)
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
    const confirmed = await confirm({ message: 'Are you sure you want to delete this delivery challan?', danger: true })
    if (confirmed) {
      const result = await window.electronAPI.challan.delete(id)
      if (result.success) {
        loadChallans()
      } else {
        toast.error('Failed to delete challan: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const handleConvertToInvoice = async (id: string) => {
    const confirmed = await confirm({ message: 'Convert this delivery challan to a sales invoice?', danger: true })
    if (confirmed) {
      const result = await window.electronAPI.challan.convertToInvoice(id)
      if (result.success) {
        toast.success('Challan converted to invoice successfully!')
        loadChallans()
      } else {
        toast.error('Failed to convert challan: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const handleView = async (id: string) => {
    const result = await window.electronAPI.challan.getById(id)
    if (result.success && result.data) {
      setViewingChallan(result.data)
      setShowViewModal(true)
    }
  }

  const loadChallanPDFData = async (challanId: string): Promise<any | null> => {
    const result = await window.electronAPI.challan.getById(challanId)
    if (!result.success || !result.data) return null
    const company = await loadCompanyForPDF()
    return { ...result.data, company }
  }

  const buildChallanTableData = (challanData: any): TableData => {
    const customer = challanData.customer || challanData.party || {}
    const meta: Array<[string, string | number]> = [
      ['Challan', challanData.challanNumber || ''],
      ['Date', challanData.challanDate ? new Date(challanData.challanDate).toLocaleDateString('en-GB') : ''],
      ['Customer', customer.name || ''],
      ['GSTIN', customer.taxId || ''],
    ]
    const metaSuffix: Array<[string, string | number]> = [
      ['Status', challanData.status || ''],
      ['Subtotal', challanData.subtotal || 0],
      ['Tax', challanData.taxAmount || 0],
      ['Total', challanData.totalAmount || 0],
    ]
    const headers = ['Item', 'HSN', 'Qty', 'Rate', 'Tax %', 'Amount']
    const rows: (string | number)[][] = (challanData.items || []).map((it: any) => [
      it.item?.name || '',
      it.hsnCode || it.item?.hsnCode || it.item?.skuHsn || '',
      it.quantity || 0,
      it.rate || 0,
      it.taxRate || 0,
      it.total || 0,
    ])
    return { baseName: buildChallanFilename(challanData).replace(/\.pdf$/i, ''), meta, metaSuffix, headers, rows }
  }

  const buildDownloadOpts = async (id: string): Promise<DispatchOpts> => {
    const challanData = await loadChallanPDFData(id)
    if (!challanData) throw new Error('Failed to load challan details')
    let cached: { bytes: Uint8Array; filename: string } | null = null
    const getPdf = async () => {
      if (!cached) {
        const bytes = await getChallanPDFBytes(challanData)
        cached = { bytes, filename: buildChallanFilename(challanData) }
      }
      return cached
    }
    return {
      getPdf,
      getTable: async () => buildChallanTableData(challanData),
    }
  }

  const handleBulkDownloadPdfs = async (matching: Challan[]) => {
    if (matching.length === 0) {
      toast.info('No delivery challans to download')
      return
    }
    const partyName = matching[0]?.customer?.name || searchTerm || 'all'

    setBulkDownloading(true)
    try {
      const items = matching.map(c => ({
        id: c.id,
        filename: `${c.challanNumber.replace(/\//g, '_')}.pdf`,
      }))
      const result = await bulkDownloadPdfs({
        items,
        zipFilename: buildZipFilename('Delivery_Challans', partyName),
        getBytes: async (id) => {
          const challanData = await loadChallanPDFData(id)
          if (!challanData) return null
          return await getChallanPDFBytes(challanData)
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

  const handleBulkDownloadExcel = async (matching: Challan[]) => {
    if (matching.length === 0) {
      toast.info('No delivery challans to download')
      return
    }
    const partyName = matching[0]?.customer?.name || searchTerm || 'all'

    setBulkDownloading(true)
    try {
      const headers = [
        'Challan #', 'Date', 'Customer', 'Type',
        'Item', 'HSN/SAC', 'Qty', 'Rate', 'Discount', 'Tax %', 'Amount',
        'Subtotal', 'Tax', 'Total', 'Vehicle', 'Transport Mode',
      ]
      const rows: (string | number)[][] = []
      for (const c of matching) {
        let items: any[] = c.items || []
        if (!items.length) {
          const res = await window.electronAPI.challan.getById(c.id)
          if (res.success && res.data) items = (res.data as any).items || []
        }
        const dateStr = c.challanDate ? new Date(c.challanDate).toLocaleDateString('en-GB') : ''
        const trailer: (string | number)[] = [
          c.subtotal || 0,
          c.taxAmount || 0,
          c.totalAmount || 0,
          c.vehicleNumber || '',
          c.transportMode || '',
        ]
        if (items.length === 0) {
          rows.push([
            c.challanNumber || '',
            dateStr,
            c.customer?.name || '',
            c.status || '',
            '', '', 0, 0, 0, 0, 0,
            ...trailer,
          ])
          continue
        }
        for (const it of items) {
          rows.push([
            c.challanNumber || '',
            dateStr,
            c.customer?.name || '',
            c.status || '',
            it.item?.name || '',
            it.hsnCode || (it.item as any)?.hsnCode || (it.item as any)?.skuHsn || '',
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
      const filename = `Delivery_Challans_${(partyName || 'all').replace(/[^a-z0-9]+/gi, '_')}_${today}.xlsx`
      await bulkDownloadExcel({
        filename,
        sheets: [{
          name: 'Delivery Challans',
          meta: [['Generated', new Date().toLocaleString()]],
          headers,
          rows,
        }],
      })
      toast.success(`Exported ${matching.length} challan${matching.length === 1 ? '' : 's'} to Excel`)
    } catch (error) {
      console.error('Bulk Excel error:', error)
      toast.error('Failed to bulk-download Excel')
    } finally {
      setBulkDownloading(false)
    }
  }

  const handleShare = async (challanId: string, target: ShareTarget) => {
    try {
      const challanData = await loadChallanPDFData(challanId)
      if (!challanData) {
        toast.error('Failed to load challan details')
        return
      }
      const bytes = await getChallanPDFBytes(challanData)
      const filename = buildChallanFilename(challanData)
      const subject =
        `Delivery Challan ${challanData.challanNumber} from ${challanData.company?.name || ''}`.trim()
      await sharePdf(bytes, filename, target, toast, {
        subject,
        phone: challanData.customer?.phone,
        email: challanData.customer?.email,
        partyName: challanData.customer?.name,
      })
    } catch (error) {
      console.error('Error sharing challan:', error)
      toast.error('Failed to share challan')
    }
  }

  const handleNewChallan = async () => {
    const result = await window.electronAPI.challan.generateChallanNumber()
    if (result.success) {
      setFormData(prev => ({
        ...prev,
        challanNumber: result.data || '',
        termsConditions: company?.termsConditions || '',
      }))
    }
    setShowModal(true)
  }

  const handleEdit = async (challan: Challan) => {
    const result = await window.electronAPI.challan.getById(challan.id)
    if (result.success && result.data) {
      const fullChallan = result.data
      setEditingChallan(fullChallan)
      setFormData({
        customerId: fullChallan.customerId || fullChallan.customer?.id || '',
        challanNumber: fullChallan.challanNumber || '',
        challanDate: new Date(fullChallan.challanDate).toISOString().split('T')[0],
        status: fullChallan.status || 'NON_RETURNABLE',
        transportMode: fullChallan.transportMode || '',
        vehicleNumber: fullChallan.vehicleNumber || '',
        notes: fullChallan.notes || '',
        termsConditions: fullChallan.termsConditions || '',
        poNumber: fullChallan.poNumber || '',
        ewayBillNo: fullChallan.ewayBillNo || '',
        warrantyPeriod: fullChallan.warrantyPeriod || '',
        dispatchedThrough: fullChallan.dispatchedThrough || '',
      })
      // Auto-expand additional fields if any of them have values
      if (
        fullChallan.transportMode ||
        fullChallan.vehicleNumber ||
        fullChallan.poNumber ||
        fullChallan.ewayBillNo ||
        fullChallan.warrantyPeriod ||
        fullChallan.dispatchedThrough
      ) {
        setShowAdditionalFields(true)
      }
      setChallanItems(fullChallan.items?.map((item: any) => ({
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

  const addChallanItem = () => {
    if (challanItems.length >= 1 && challanItems[challanItems.length - 1].itemId === '') {
      toast.info('Please complete the current item first')
      return
    }
    setChallanItems([...challanItems, {
      itemId: '',
      hsnCode: '',
      quantity: 1,
      rate: 0,
      taxRate: 0,
      discount: 0,
      amount: 0,
    }])
  }

  const updateChallanItem = (index: number, field: string, value: any) => {
    const newItems = [...challanItems]
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

    setChallanItems(newItems)
  }

  const removeChallanItem = (index: number) => {
    setChallanItems(challanItems.filter((_, i) => i !== index))
  }

  const calculateTotals = () => {
    const subtotal = challanItems.reduce((sum, item) => {
      const qty = item.quantity || 0
      const rate = item.rate || 0
      const discount = item.discount || 0
      return sum + (qty * rate - discount)
    }, 0)

    const taxAmount = challanItems.reduce((sum, item) => {
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

    if (challanItems.length === 0) {
      toast.info('Please add at least one item')
      return
    }

    if (editingChallan) {
      // Update existing challan
      const challanData = {
        ...formData,
        items: challanItems,
      }

      const result = await window.electronAPI.challan.update(editingChallan.id, challanData)

      if (result.success) {
        toast.success('Delivery challan updated successfully!')
        setShowModal(false)
        resetForm()
        loadChallans()
      } else {
        toast.error('Failed to update challan: ' + (result.error || 'Unknown error'))
      }
    } else {
      // Create new challan — challanNumber already in formData (pre-filled or user-edited)
      const challanData = {
        ...formData,
        items: challanItems,
      }

      const result = await window.electronAPI.challan.create(challanData)

      if (result.success) {
        toast.success('Delivery challan created successfully!')
        setShowModal(false)
        resetForm()
        loadChallans()
      } else {
        toast.error('Failed to create challan: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const resetForm = () => {
    setFormData({
      customerId: '',
      challanNumber: '',
      challanDate: new Date().toISOString().split('T')[0],
      status: 'NON_RETURNABLE',
      transportMode: '',
      vehicleNumber: '',
      notes: '',
      termsConditions: '',
      poNumber: '',
      ewayBillNo: '',
      warrantyPeriod: '',
      dispatchedThrough: '',
    })
    setChallanItems([])
    setEditingChallan(null)
    setShowAdditionalFields(false)
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

  // Filter challans by search term and date range
  const filteredChallans = challans.filter((challan) => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      const matches = challan.challanNumber.toLowerCase().includes(term) ||
        (challan.customer?.name || '').toLowerCase().includes(term)
      if (!matches) return false
    }
    if (dateStart || dateEnd) {
      const d = new Date(challan.challanDate)
      if (dateStart && d < dateStart) return false
      if (dateEnd && d > dateEnd) return false
    }
    return true
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Delivery Challans</h1>
        <button
          onClick={handleNewChallan}
          className="btn btn-primary"
        >
          + New Challan
        </button>
      </div>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          className="input max-w-md flex-1 min-w-[240px]"
          placeholder="Search by challan number or party name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
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
            {filteredChallans.length} {filteredChallans.length === 1 ? 'challan' : 'challans'}
          </span>
        )}
        {filteredChallans.length > 0 && (
          <BulkDownloadMenu
            count={filteredChallans.length}
            busy={bulkDownloading}
            onPdfs={() => handleBulkDownloadPdfs(filteredChallans)}
            onExcel={() => handleBulkDownloadExcel(filteredChallans)}
          />
        )}
      </div>

      {/* Challans Table */}
      <div className="card">
        {filteredChallans.length === 0 ? (
          searchTerm || dateFilter !== 'all' ? (
            <EmptyState
              icon={SearchIcon}
              title="No challans match your filters"
              description={`Nothing matched "${searchTerm}".`}
            />
          ) : (
            <EmptyState
              icon={Truck}
              title="No delivery challans yet"
              description="Generate challans for dispatched goods with transport details and vehicle tracking."
              action={{ label: '+ Create your first challan', onClick: handleNewChallan }}
            />
          )
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <table className="table">
              <thead>
                <tr>
                  <th className="table-header sticky top-0 z-10">S.No</th>
                  <th className="table-header sticky top-0 z-10">Challan #</th>
                  <th className="table-header sticky top-0 z-10">Date</th>
                  <th className="table-header sticky top-0 z-10">Party</th>
                  <th className="table-header sticky top-0 z-10">Amount</th>
                  <th className="table-header sticky top-0 z-10">Status</th>
                  <th className="table-header sticky top-0 z-10">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredChallans.map((challan, index) => (
                  <tr key={challan.id} className="border-t">
                    <td className="table-cell">{index + 1}</td>
                    <td className="table-cell font-medium">{challan.challanNumber}</td>
                    <td className="table-cell">{new Date(challan.challanDate).toLocaleDateString('en-GB')}</td>
                    <td className="table-cell">{challan.customer?.name}</td>
                    <td className="table-cell">{formatCurrency(challan.totalAmount)}</td>
                    <td className="table-cell">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        challan.status === 'RETURNABLE' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                        challan.status === 'NON_RETURNABLE' ? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300' :
                        'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                      }`}>
                        {challan.status === 'RETURNABLE' ? 'Returnable' :
                         challan.status === 'NON_RETURNABLE' ? 'Non-Returnable' :
                         'Converted'}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleView(challan.id)}
                          className="text-primary-600 hover:text-primary-700"
                        >
                          View
                        </button>
                        <DownloadMenu getOpts={() => buildDownloadOpts(challan.id)} />
                        <ShareMenu
                          onShare={(target) => handleShare(challan.id, target)}
                          phone={challan.customer?.phone}
                          email={challan.customer?.email}
                          partyName={challan.customer?.name}
                        />
                        {challan.status !== 'CONVERTED' && (
                          <button
                            onClick={() => handleEdit(challan)}
                            className="text-green-600 hover:text-green-700"
                          >
                            Edit
                          </button>
                        )}
                        {challan.status === 'NON_RETURNABLE' && (
                          <button
                            onClick={() => handleConvertToInvoice(challan.id)}
                            className="text-purple-600 hover:text-purple-700"
                          >
                            Convert
                          </button>
                        )}
                        {challan.status !== 'CONVERTED' && (
                          <button
                            onClick={() => handleDelete(challan.id)}
                            className="text-red-600 hover:text-red-700"
                          >
                            Delete
                          </button>
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

      {/* Create/Edit Challan Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">{editingChallan ? 'Edit Delivery Challan' : 'Create New Delivery Challan'}</h2>
                <button onClick={() => { setShowModal(false); resetForm(); }} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl">
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Challan Number *</label>
                    <input
                      type="text"
                      className="input"
                      value={formData.challanNumber}
                      onChange={(e) => setFormData({...formData, challanNumber: e.target.value})}
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
                      <option value="NON_RETURNABLE">Non-Returnable</option>
                      <option value="RETURNABLE">Returnable</option>
                    </select>
                  </div>

                  <div>
                    <label className="label">Challan Date *</label>
                    <DateInput
                      className="input"
                      value={formData.challanDate}
                      onChange={(e) => setFormData({...formData, challanDate: e.target.value})}
                      required
                    />
                  </div>
                </div>

                {/* Items Section */}
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">Challan Items</h3>
                    <button type="button" onClick={addChallanItem} className="btn btn-secondary text-sm">
                      + Add Item
                    </button>
                  </div>

                  {challanItems.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 dark:bg-gray-900/40 rounded-lg border-2 border-dashed">
                      <p className="text-gray-500 dark:text-gray-400 mb-2">No items added yet</p>
                      <button type="button" onClick={addChallanItem} className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300">
                        Click "+ Add Item" to add your first item
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {challanItems.map((item, index) => (
                        <div key={index} className="flex gap-3 items-end p-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
                          <div className="flex-1">
                            <label className="label text-xs">Item</label>
                            <select
                              className="input"
                              value={item.itemId}
                              onChange={(e) => updateChallanItem(index, 'itemId', e.target.value)}
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
                              onChange={(e) => updateChallanItem(index, 'hsnCode', e.target.value)}
                              placeholder="HSN/SKU"
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Qty</label>
                            <NumberInput
                              className="input"
                              value={item.quantity}
                              onChange={(val) => updateChallanItem(index, 'quantity', val)}
                              min={1}
                              required
                            />
                          </div>

                          <div className="w-32">
                            <label className="label text-xs">Rate</label>
                            <NumberInput
                              className="input"
                              value={item.rate}
                              onChange={(val) => updateChallanItem(index, 'rate', val)}
                              min={0}
                              required
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Disc</label>
                            <NumberInput
                              className="input"
                              value={item.discount}
                              onChange={(val) => updateChallanItem(index, 'discount', val)}
                              min={0}
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Tax %</label>
                            <NumberInput
                              className="input"
                              value={item.taxRate}
                              onChange={(val) => updateChallanItem(index, 'taxRate', val)}
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
                            onClick={() => removeChallanItem(index)}
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
                {challanItems.length > 0 && (
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

                {/* Notes & Terms */}
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
                      placeholder="Terms that appear on challan..."
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
                        <label className="label">e-Way Bill No</label>
                        <input type="text" className="input" value={formData.ewayBillNo}
                          onChange={(e) => setFormData({...formData, ewayBillNo: e.target.value})}
                          placeholder="e-Way Bill number" />
                      </div>
                      <div>
                        <label className="label">Vehicle Number</label>
                        <input type="text" className="input" value={formData.vehicleNumber}
                          onChange={(e) => setFormData({...formData, vehicleNumber: e.target.value})}
                          placeholder="e.g., MH-12-AB-1234" />
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
                      <div>
                        <label className="label">Transport Mode</label>
                        <select
                          className="input"
                          value={formData.transportMode}
                          onChange={(e) => setFormData({...formData, transportMode: e.target.value})}
                        >
                          <option value="">Select Mode</option>
                          <option value="Road">Road</option>
                          <option value="Rail">Rail</option>
                          <option value="Air">Air</option>
                          <option value="Ship">Ship</option>
                        </select>
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
                    {editingChallan ? 'Update Challan' : 'Create Challan'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* View Challan Modal */}
      {showViewModal && viewingChallan && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Delivery Challan Details</h2>
                <button onClick={() => { setShowViewModal(false); setViewingChallan(null); }} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl">
                  ×
                </button>
              </div>

              {/* Challan Header */}
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Challan Number</p>
                  <p className="font-semibold text-lg">{viewingChallan.challanNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    viewingChallan.status === 'RETURNABLE' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                    viewingChallan.status === 'NON_RETURNABLE' ? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300' :
                    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                  }`}>
                    {viewingChallan.status === 'RETURNABLE' ? 'Returnable' :
                     viewingChallan.status === 'NON_RETURNABLE' ? 'Non-Returnable' :
                     'Converted'}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Date</p>
                  <p className="font-medium">{new Date(viewingChallan.challanDate).toLocaleDateString('en-GB')}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Transport Mode</p>
                  <p className="font-medium">{viewingChallan.transportMode || 'N/A'}</p>
                </div>
                {viewingChallan.vehicleNumber && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Vehicle Number</p>
                    <p className="font-medium">{viewingChallan.vehicleNumber}</p>
                  </div>
                )}
                {viewingChallan.convertedToInvoiceId && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Converted to Invoice</p>
                    <p className="font-medium text-blue-600 dark:text-blue-400">{viewingChallan.convertedToInvoiceId}</p>
                  </div>
                )}
              </div>

              {/* Customer Info */}
              <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg mb-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Customer</p>
                <p className="font-semibold">{viewingChallan.customer?.name}</p>
                {viewingChallan.customer?.phone && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingChallan.customer.phone}</p>}
                {viewingChallan.customer?.email && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingChallan.customer.email}</p>}
                {viewingChallan.customer?.billingAddress && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingChallan.customer.billingAddress}</p>}
              </div>

              {/* Items */}
              <div className="mb-6">
                <h3 className="font-semibold mb-3">Items</h3>
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th className="table-header sticky top-0 z-10">S.No</th>
                      <th className="table-header sticky top-0 z-10">Item</th>
                      <th className="table-header sticky top-0 z-10">Qty</th>
                      <th className="table-header sticky top-0 z-10">Rate</th>
                      <th className="table-header sticky top-0 z-10">Tax %</th>
                      <th className="table-header sticky top-0 z-10">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingChallan.items?.map((item, index) => (
                      <tr key={index} className="border-t">
                        <td className="table-cell">{index + 1}</td>
                        <td className="table-cell">{item.item?.name}</td>
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
                    <span className="font-medium">{formatCurrency(viewingChallan.subtotal || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Tax:</span>
                    <span className="font-medium">{formatCurrency(viewingChallan.taxAmount || 0)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold border-t pt-2">
                    <span>Total:</span>
                    <span>{formatCurrency(viewingChallan.totalAmount)}</span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {viewingChallan.notes && (
                <div className="mb-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Notes</p>
                  <p className="text-gray-700 dark:text-gray-300">{viewingChallan.notes}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  onClick={() => { setShowViewModal(false); setViewingChallan(null); }}
                  className="btn btn-secondary"
                >
                  Close
                </button>
                <DownloadMenu
                  variant="button"
                  getOpts={() => buildDownloadOpts(viewingChallan.id)}
                />
                <ShareMenu
                  variant="button"
                  onShare={(target) => handleShare(viewingChallan.id, target)}
                  phone={viewingChallan.customer?.phone}
                  email={viewingChallan.customer?.email}
                  partyName={viewingChallan.customer?.name}
                />
                {viewingChallan.status === 'NON_RETURNABLE' && (
                  <button
                    onClick={() => {
                      setShowViewModal(false)
                      setViewingChallan(null)
                      handleConvertToInvoice(viewingChallan.id)
                    }}
                    className="btn btn-primary"
                  >
                    Convert to Invoice
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DeliveryChallan
