import { useEffect, useState } from 'react'
import { Quotation, QuotationStatus } from '../types'
import { downloadInvoicePDF, getInvoicePDFBytes } from '../utils/generateInvoicePDF'
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
import { FileText, Search as SearchIcon } from 'lucide-react'
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

interface QuotationItem {
  itemId: string
  hsnCode: string
  quantity: number
  rate: number
  taxRate: number
  discount: number
  amount: number
}

const statusOptions: QuotationStatus[] = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']

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

const Quotations = () => {
  const [quotations, setQuotations] = useState<Quotation[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [viewingQuotation, setViewingQuotation] = useState<Quotation | null>(null)
  const [editingQuotation, setEditingQuotation] = useState<Quotation | null>(null)
  const [parties, setParties] = useState<Party[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [quotationItems, setQuotationItems] = useState<QuotationItem[]>([])
  const toast = useToast()
  const confirm = useConfirm()
  const { company } = useStore()

  const [formData, setFormData] = useState({
    partyId: '',
    status: 'DRAFT' as QuotationStatus,
    invoiceDate: new Date().toISOString().split('T')[0],
    dueDate: '',
    invoiceNumber: '',
    notes: '',
    termsConditions: '',
    deliveryTime: '',
  })

  useEffect(() => {
    loadQuotations()
    loadParties()
    loadItems()
  }, [])

  const loadQuotations = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.quotation.getAll()
      if (result.success && result.data) {
        setQuotations(result.data)
      }
    } finally {
      setLoading(false)
    }
  }

  const loadParties = async () => {
    const result = await window.electronAPI.party.getAll('CUSTOMER')
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

  const loadQuotationPDFData = async (quotationId: string): Promise<any | null> => {
    const result = await window.electronAPI.quotation.getById(quotationId)
    if (!result.success || !result.data) return null
    const company = await loadCompanyForPDF()
    return {
      ...result.data,
      type: 'QUOTATION',
      party: result.data.party,
      items: result.data.items || [],
      company,
    }
  }

  const handleDownloadPDF = async (quotationId: string) => {
    try {
      const pdfData = await loadQuotationPDFData(quotationId)
      if (!pdfData) {
        toast.error('Failed to load quotation details')
        return
      }
      downloadInvoicePDF(pdfData)
    } catch (error) {
      console.error('Error generating quotation PDF:', error)
      toast.error('Failed to generate PDF')
    }
  }

  const handleShare = async (quotationId: string, target: ShareTarget) => {
    try {
      const pdfData = await loadQuotationPDFData(quotationId)
      if (!pdfData) {
        toast.error('Failed to load quotation details')
        return
      }
      const { bytes, filename } = await getInvoicePDFBytes(pdfData)
      const subject = `Quotation ${pdfData.invoiceNumber} from ${pdfData.company?.name || ''}`.trim()
      await sharePdf(bytes, filename, target, toast, {
        subject,
        phone: pdfData.party?.phone,
        email: pdfData.party?.email,
        partyName: pdfData.party?.name,
      })
    } catch (error) {
      console.error('Error sharing quotation:', error)
      toast.error('Failed to share quotation')
    }
  }

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({ message: 'Are you sure you want to delete this quotation?', danger: true })
    if (confirmed) {
      const result = await window.electronAPI.quotation.delete(id)
      if (result.success) {
        loadQuotations()
      } else {
        toast.error('Failed to delete quotation: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const handleConvertToInvoice = async (id: string) => {
    const result = await window.electronAPI.quotation.convertToInvoice(id)
    if (result.success) {
      toast.success('Quotation converted to invoice successfully!')
      setShowViewModal(false)
      setViewingQuotation(null)
      loadQuotations()
    } else {
      toast.error('Failed to convert quotation: ' + (result.error || 'Unknown error'))
    }
  }

  const handleView = async (id: string) => {
    const result = await window.electronAPI.quotation.getById(id)
    if (result.success && result.data) {
      setViewingQuotation(result.data)
      setShowViewModal(true)
    }
  }

  const handleEdit = async (quotation: Quotation) => {
    const result = await window.electronAPI.quotation.getById(quotation.id)
    if (result.success && result.data) {
      const fullQuotation = result.data
      setEditingQuotation(fullQuotation)
      setFormData({
        invoiceNumber: fullQuotation.invoiceNumber || '',
        partyId: fullQuotation.party?.id || '',
        status: (fullQuotation.status as QuotationStatus) || 'DRAFT',
        invoiceDate: new Date(fullQuotation.invoiceDate).toISOString().split('T')[0],
        dueDate: fullQuotation.dueDate ? new Date(fullQuotation.dueDate).toISOString().split('T')[0] : '',
        notes: fullQuotation.notes || '',
        termsConditions: fullQuotation.termsConditions || '',
        deliveryTime: fullQuotation.deliveryTime ? new Date(fullQuotation.deliveryTime).toISOString().split('T')[0] : '',
      })
      setQuotationItems(fullQuotation.items?.map((item: any) => ({
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

  const addQuotationItem = () => {
    if (quotationItems.length >= 1 && quotationItems[quotationItems.length - 1].itemId === '') {
      toast.info('Please complete the current item first')
      return
    }
    setQuotationItems([...quotationItems, {
      itemId: '',
      hsnCode: '',
      quantity: 1,
      rate: 0,
      taxRate: 0,
      discount: 0,
      amount: 0,
    }])
  }

  const updateQuotationItem = (index: number, field: string, value: any) => {
    const newItems = [...quotationItems]
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

    setQuotationItems(newItems)
  }

  const removeQuotationItem = (index: number) => {
    setQuotationItems(quotationItems.filter((_, i) => i !== index))
  }

  const calculateTotals = () => {
    const subtotal = quotationItems.reduce((sum, item) => {
      const qty = item.quantity || 0
      const rate = item.rate || 0
      const discount = item.discount || 0
      return sum + (qty * rate - discount)
    }, 0)

    const taxAmount = quotationItems.reduce((sum, item) => {
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

    if (!formData.partyId) {
      toast.info('Please select a customer')
      return
    }

    if (quotationItems.length === 0) {
      toast.info('Please add at least one item')
      return
    }

    const { subtotal, taxAmount, total } = calculateTotals()

    const quotationData = {
      invoiceNumber: formData.invoiceNumber,
      partyId: formData.partyId,
      status: formData.status,
      invoiceDate: formData.invoiceDate,
      dueDate: formData.dueDate || null,
      deliveryTime: formData.deliveryTime || null,
      notes: formData.notes,
      termsConditions: formData.termsConditions,
      items: quotationItems,
      subtotalAmount: subtotal,
      taxAmount,
      totalAmount: total,
    }

    if (editingQuotation) {
      const result = await window.electronAPI.quotation.update(editingQuotation.id, quotationData)
      if (result.success) {
        toast.success('Quotation updated successfully!')
        setShowModal(false)
        resetForm()
        loadQuotations()
      } else {
        toast.error('Failed to update quotation: ' + (result.error || 'Unknown error'))
      }
    } else {
      const result = await window.electronAPI.quotation.create(quotationData)
      if (result.success) {
        toast.success('Quotation created successfully!')
        setShowModal(false)
        resetForm()
        loadQuotations()
      } else {
        toast.error('Failed to create quotation: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const resetForm = () => {
    setFormData({
      partyId: '',
      status: 'DRAFT',
      invoiceDate: new Date().toISOString().split('T')[0],
      dueDate: '',
      invoiceNumber: '',
      notes: '',
      termsConditions: '',
      deliveryTime: '',
    })
    setQuotationItems([])
    setEditingQuotation(null)
  }

  const handleNewQuotation = async () => {
    const result = await window.electronAPI.quotation.generateQuotationNumber()
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

  const filteredQuotations = quotations.filter((quotation) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    const matchesNumber = quotation.invoiceNumber?.toLowerCase().includes(query)
    const matchesParty = quotation.party?.name?.toLowerCase().includes(query)
    return matchesNumber || matchesParty
  })

  const { sortedItems: sortedQuotations, sortKey, sortDir, toggleSort } = useSortable(filteredQuotations, [
    { key: 'invoiceNumber', accessor: (i) => i.invoiceNumber },
    { key: 'invoiceDate', accessor: (i) => new Date(i.invoiceDate).getTime() },
    { key: 'dueDate', accessor: (i) => i.dueDate ? new Date(i.dueDate).getTime() : 0 },
    { key: 'party', accessor: (i) => i.party?.name || '' },
    { key: 'totalAmount', accessor: (i) => i.totalAmount },
    { key: 'status', accessor: (i) => i.status || '' },
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Quotations</h1>
        <button onClick={handleNewQuotation} className="btn btn-primary">
          + New Quotation
        </button>
      </div>

      <div>
        <input
          type="text"
          className="input max-w-md"
          placeholder="Search by quotation number or party name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      <div className="card">
        {loading ? (
          <TableSkeleton rows={6} columns={7} />
        ) : filteredQuotations.length === 0 ? (
          searchQuery.trim() ? (
            <EmptyState
              icon={SearchIcon}
              title="No quotations match your search"
              description={`Nothing matched "${searchQuery}".`}
            />
          ) : (
            <EmptyState
              icon={FileText}
              title="No quotations yet"
              description="Create your first quotation to share pricing with customers before billing."
              action={{ label: '+ Create your first quotation', onClick: handleNewQuotation }}
            />
          )
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="Quotation #" sortKey="invoiceNumber" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Date" sortKey="invoiceDate" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Expiry" sortKey="dueDate" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Party" sortKey="party" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Amount" sortKey="totalAmount" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <SortHeader label="Status" sortKey="status" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                  <th className="table-header sticky top-0 z-10">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedQuotations.map((quotation) => (
                  <tr key={quotation.id} className="border-t">
                    <td className="table-cell font-medium">{quotation.invoiceNumber}</td>
                    <td className="table-cell">{new Date(quotation.invoiceDate).toLocaleDateString('en-GB')}</td>
                    <td className="table-cell">{quotation.dueDate ? new Date(quotation.dueDate).toLocaleDateString('en-GB') : '-'}</td>
                    <td className="table-cell">{quotation.party?.name}</td>
                    <td className="table-cell">{formatCurrency(quotation.totalAmount)}</td>
                    <td className="table-cell">
                      <span className={`px-2 py-1 rounded-full text-xs ${statusBadgeClass(quotation.status)}`}>
                        {quotation.status}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleView(quotation.id)}
                          className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"
                        >
                          View
                        </button>
                        <button
                          onClick={() => handleEdit(quotation)}
                          className="text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDownloadPDF(quotation.id)}
                          className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                          title="Download PDF"
                        >
                          PDF
                        </button>
                        <ShareMenu
                          onShare={(target) => handleShare(quotation.id, target)}
                          phone={quotation.party?.phone}
                          email={quotation.party?.email}
                          partyName={quotation.party?.name}
                        />
                        <button
                          onClick={() => handleConvertToInvoice(quotation.id)}
                          className="text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300"
                        >
                          Convert
                        </button>
                        <button
                          onClick={() => handleDelete(quotation.id)}
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

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">
                  {editingQuotation ? 'Edit' : 'Create New'} Quotation
                </h2>
                <button onClick={() => { setShowModal(false); resetForm(); }} className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl">
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Quotation Number *</label>
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
                      value={formData.partyId}
                      onChange={(id) => setFormData({ ...formData, partyId: id })}
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
                      onChange={(e) => setFormData({ ...formData, status: e.target.value as QuotationStatus })}
                    >
                      {statusOptions.map((status) => (
                        <option key={status} value={status}>
                          {status.charAt(0) + status.slice(1).toLowerCase()}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label">Quotation Date *</label>
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
                    <h3 className="text-lg font-semibold">Quotation Items</h3>
                    <button type="button" onClick={addQuotationItem} className="btn btn-secondary text-sm">
                      + Add Item
                    </button>
                  </div>

                  {quotationItems.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 dark:bg-gray-900/40 rounded-lg border-2 border-dashed">
                      <p className="text-gray-500 dark:text-gray-400 mb-2">No items added yet</p>
                      <button type="button" onClick={addQuotationItem} className="text-primary-600 hover:text-primary-700">
                        Click "+ Add Item" to add your first item
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {quotationItems.map((item, index) => (
                        <div key={index} className="flex gap-3 items-end p-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
                          <div className="flex-1">
                            <label className="label text-xs">Item</label>
                            <select
                              className="input"
                              value={item.itemId}
                              onChange={(e) => updateQuotationItem(index, 'itemId', e.target.value)}
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
                              onChange={(e) => updateQuotationItem(index, 'hsnCode', e.target.value)}
                              placeholder="HSN/SKU"
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Qty</label>
                            <NumberInput
                              className="input"
                              value={item.quantity}
                              onChange={(val) => updateQuotationItem(index, 'quantity', val)}
                              min={1}
                              required
                            />
                          </div>

                          <div className="w-32">
                            <label className="label text-xs">Rate</label>
                            <NumberInput
                              className="input"
                              value={item.rate}
                              onChange={(val) => updateQuotationItem(index, 'rate', val)}
                              min={0}
                              required
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Disc</label>
                            <NumberInput
                              className="input"
                              value={item.discount}
                              onChange={(val) => updateQuotationItem(index, 'discount', val)}
                              min={0}
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Tax %</label>
                            <NumberInput
                              className="input"
                              value={item.taxRate}
                              onChange={(val) => updateQuotationItem(index, 'taxRate', val)}
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
                            onClick={() => removeQuotationItem(index)}
                            className="btn btn-danger h-10 px-3"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {quotationItems.length > 0 && (
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
                      placeholder="Quotation notes..."
                    />
                  </div>

                  <div>
                    <label className="label">Terms & Conditions</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={formData.termsConditions}
                      onChange={(e) => setFormData({ ...formData, termsConditions: e.target.value })}
                      placeholder="Terms that appear on quotation..."
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
                    {editingQuotation ? 'Update Quotation' : 'Create Quotation'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {showViewModal && viewingQuotation && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Quotation Details</h2>
                <button onClick={() => { setShowViewModal(false); setViewingQuotation(null) }} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl">
                  ×
                </button>
              </div>

              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Quotation Number</p>
                  <p className="font-semibold text-lg">{viewingQuotation.invoiceNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
                  <span className={`px-2 py-1 rounded-full text-xs ${statusBadgeClass(viewingQuotation.status)}`}>
                    {viewingQuotation.status}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Quotation Date</p>
                  <p className="font-medium">{new Date(viewingQuotation.invoiceDate).toLocaleDateString('en-GB')}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Expiry Date</p>
                  <p className="font-medium">{viewingQuotation.dueDate ? new Date(viewingQuotation.dueDate).toLocaleDateString('en-GB') : '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Delivery Time</p>
                  <p className="font-medium">{viewingQuotation.deliveryTime ? new Date(viewingQuotation.deliveryTime).toLocaleDateString('en-GB') : '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Document Type</p>
                  <p className="font-medium">Quotation</p>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg mb-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Customer</p>
                <p className="font-semibold">{viewingQuotation.party?.name}</p>
                {viewingQuotation.party?.phone && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingQuotation.party.phone}</p>}
                {viewingQuotation.party?.email && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingQuotation.party.email}</p>}
                {viewingQuotation.party?.billingAddress && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingQuotation.party.billingAddress}</p>}
              </div>

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
                    {viewingQuotation.items?.map((item, index) => (
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

              <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg mb-6">
                <div className="space-y-2 max-w-sm ml-auto">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Subtotal:</span>
                    <span className="font-medium">{formatCurrency(viewingQuotation.subtotal || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Tax:</span>
                    <span className="font-medium">{formatCurrency(viewingQuotation.taxAmount || 0)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold border-t pt-2">
                    <span>Total:</span>
                    <span>{formatCurrency(viewingQuotation.totalAmount)}</span>
                  </div>
                </div>
              </div>

              {viewingQuotation.notes && (
                <div className="mb-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Notes</p>
                  <p className="text-gray-700 dark:text-gray-300">{viewingQuotation.notes}</p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  onClick={() => { setShowViewModal(false); setViewingQuotation(null) }}
                  className="btn btn-secondary"
                >
                  Close
                </button>
                <button
                  onClick={() => handleDownloadPDF(viewingQuotation.id)}
                  className="btn btn-secondary"
                >
                  Download PDF
                </button>
                <ShareMenu
                  variant="button"
                  onShare={(target) => handleShare(viewingQuotation.id, target)}
                  phone={viewingQuotation.party?.phone}
                  email={viewingQuotation.party?.email}
                  partyName={viewingQuotation.party?.name}
                />
                <button
                  onClick={() => handleConvertToInvoice(viewingQuotation.id)}
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

export default Quotations
