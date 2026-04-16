import { useEffect, useState } from 'react'
import { SalesInvoice } from '../types'
import { downloadInvoicePDF, InvoiceTemplate } from '../utils/generateInvoicePDF'
import { formatCurrency } from '../utils/currency'
import NumberInput from '../components/NumberInput'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'

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

const Sales = () => {
  const [invoices, setInvoices] = useState<SalesInvoice[]>([])
  const [filter, setFilter] = useState<'ALL' | 'INVOICE' | 'QUOTATION'>('ALL')
  const [showModal, setShowModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [viewingInvoice, setViewingInvoice] = useState<SalesInvoice | null>(null)
  const [editingInvoice, setEditingInvoice] = useState<SalesInvoice | null>(null)
  const [parties, setParties] = useState<Party[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState<InvoiceTemplate>('classic')
  const [searchQuery, setSearchQuery] = useState('')
  const toast = useToast()
  const confirm = useConfirm()

  // Form state
  const [formData, setFormData] = useState({
    partyId: '',
    type: 'INVOICE' as 'INVOICE' | 'QUOTATION',
    status: 'DRAFT' as string,
    invoiceDate: new Date().toISOString().split('T')[0],
    invoiceNo: '',
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

  useEffect(() => {
    loadInvoices()
    loadParties()
    loadItems()
    loadTemplate()
  }, [filter])

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
    const result = await window.electronAPI.sales.getAll(filter === 'ALL' ? undefined : filter)
    if (result.success && result.data) {
      setInvoices(result.data)
    }
  }

  const handleDownloadPDF = async (invoiceId: string) => {
    try {
      // Fetch full invoice details with items
      const result = await window.electronAPI.sales.getById(invoiceId)
      if (result.success && result.data) {
        const invoice = result.data

        // Get company details
        const companyResult = await window.electronAPI.company.get()
        const company = companyResult.success ? companyResult.data : undefined

        // Convert logo file to base64 for PDF generation (resized to save space)
        if (company?.logoPath) {
          try {
            const logoUrl = `local-resource://${company.logoPath.replace(/\\/g, '/')}`
            const response = await fetch(logoUrl)
            const blob = await response.blob()
            // Resize using canvas — 200x200 is plenty for a 22mm logo on PDF
            const img = new Image()
            const imgUrl = URL.createObjectURL(blob)
            const logoBase64 = await new Promise<string>((resolve, reject) => {
              img.onload = () => {
                const canvas = document.createElement('canvas')
                canvas.width = 600
                canvas.height = 600
                const ctx = canvas.getContext('2d')!
                ctx.drawImage(img, 0, 0, 600, 600)
                URL.revokeObjectURL(imgUrl)
                resolve(canvas.toDataURL('image/png'))
              }
              img.onerror = reject
              img.src = imgUrl
            })
            company.logoBase64 = logoBase64
          } catch {
            // Logo file missing or unreadable, skip it
          }
        }

        // Pass all invoice fields (including GST data) to PDF generator
        const pdfData = {
          ...invoice,
          party: invoice.party,
          items: invoice.items || [],
          company
        } as any

        downloadInvoicePDF(pdfData, selectedTemplate)
      } else {
        toast.error('Failed to load invoice details')
      }
    } catch (error) {
      console.error('Error generating PDF:', error)
      toast.error('Failed to generate PDF')
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

  const handleConvertToInvoice = async (id: string) => {
    const result = await window.electronAPI.sales.convertQuoteToInvoice(id)
    if (result.success) {
      toast.success('Quotation converted to invoice successfully!')
      loadInvoices()
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
        partyId: fullInvoice.party?.id || '',
        type: fullInvoice.type,
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

    if (!formData.partyId) {
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
        partyId: formData.partyId,
        type: formData.type,
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
      partyId: '',
      type: 'INVOICE',
      status: 'DRAFT',
      invoiceDate: new Date().toISOString().split('T')[0],
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
      setFormData(prev => ({ ...prev, invoiceNumber: result.data }))
    }
    setShowModal(true)
  }

  const isOverdue = (invoice: SalesInvoice): boolean => {
    if (invoice.status === 'PAID') return false
    if (!invoice.dueDate) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const due = new Date(invoice.dueDate)
    due.setHours(0, 0, 0, 0)
    return due < today
  }

  const totals = calculateTotals()

  // Filter invoices by search query
  const filteredInvoices = invoices.filter((invoice) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    const matchesNumber = invoice.invoiceNumber?.toLowerCase().includes(query)
    const matchesParty = invoice.party?.name?.toLowerCase().includes(query)
    return matchesNumber || matchesParty
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Sales & Invoices</h1>
        <button
          onClick={handleNewInvoice}
          className="btn btn-primary"
        >
          + New Invoice
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex space-x-2">
        {['ALL', 'INVOICE', 'QUOTATION'].map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab as any)}
            className={`px-4 py-2 rounded-lg font-medium ${
              filter === tab ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Search Input */}
      <div>
        <input
          type="text"
          className="input max-w-md"
          placeholder="Search by invoice number or party name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Invoices Table */}
      <div className="card">
        {filteredInvoices.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            {searchQuery.trim() ? (
              <p className="text-lg mb-4">No invoices match your search</p>
            ) : (
              <>
                <p className="text-lg mb-4">No invoices yet</p>
                <button
                  onClick={handleNewInvoice}
                  className="btn btn-primary"
                >
                  Create Your First Invoice
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="table-header">Invoice #</th>
                  <th className="table-header">Date</th>
                  <th className="table-header">Party</th>
                  <th className="table-header">Type</th>
                  <th className="table-header">Amount</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((invoice) => (
                  <tr key={invoice.id} className="border-t">
                    <td className="table-cell font-medium">{invoice.invoiceNumber}</td>
                    <td className="table-cell">{new Date(invoice.invoiceDate).toLocaleDateString()}</td>
                    <td className="table-cell">{invoice.party?.name}</td>
                    <td className="table-cell">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        invoice.type === 'INVOICE' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                      }`}>
                        {invoice.type}
                      </span>
                    </td>
                    <td className="table-cell">{formatCurrency(invoice.totalAmount)}</td>
                    <td className="table-cell">
                      {isOverdue(invoice) ? (
                        <span className="px-2 py-1 rounded-full text-xs bg-red-600 text-white font-bold">
                          OVERDUE
                        </span>
                      ) : (
                        <span className={`px-2 py-1 rounded-full text-xs ${
                          invoice.status === 'PAID' ? 'bg-green-100 text-green-700' :
                          invoice.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {invoice.status}
                        </span>
                      )}
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleView(invoice.id)}
                          className="text-primary-600 hover:text-primary-700"
                        >
                          View
                        </button>
                        <button
                          onClick={() => handleEdit(invoice)}
                          className="text-green-600 hover:text-green-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDownloadPDF(invoice.id)}
                          className="text-blue-600 hover:text-blue-700 font-medium"
                          title="Download PDF"
                        >
                          PDF
                        </button>
                        {invoice.type === 'QUOTATION' && (
                          <button onClick={() => handleConvertToInvoice(invoice.id)} className="text-purple-600 hover:text-purple-700">
                            Convert
                          </button>
                        )}
                        <button onClick={() => handleDelete(invoice.id)} className="text-red-600 hover:text-red-700">
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
          <div className="bg-white rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">{editingInvoice ? 'Edit Invoice' : 'Create New Invoice'}</h2>
                <button onClick={() => { setShowModal(false); resetForm(); }} className="text-gray-500 hover:text-gray-700 text-2xl">
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
                    <select
                      className="input"
                      value={formData.partyId}
                      onChange={(e) => setFormData({...formData, partyId: e.target.value})}
                      required
                    >
                      <option value="">Select Customer</option>
                      {parties.map(party => (
                        <option key={party.id} value={party.id}>{party.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label">Type *</label>
                    <select
                      className="input"
                      value={formData.type}
                      onChange={(e) => setFormData({...formData, type: e.target.value as 'INVOICE' | 'QUOTATION'})}
                    >
                      <option value="INVOICE">Invoice</option>
                      <option value="QUOTATION">Quotation</option>
                    </select>
                  </div>

                  <div>
                    <label className="label">Status *</label>
                    <select
                      className="input"
                      value={formData.status}
                      onChange={(e) => setFormData({...formData, status: e.target.value})}
                    >
                      <option value="DRAFT">Draft</option>
                      <option value="PAID">Paid</option>
                      <option value="PARTIAL">Partial</option>
                      <option value="OVERDUE">Overdue</option>
                    </select>
                  </div>

                  <div>
                    <label className="label">Invoice Date *</label>
                    <input
                      type="date"
                      className="input"
                      value={formData.invoiceDate}
                      onChange={(e) => setFormData({...formData, invoiceDate: e.target.value})}
                      required
                    />
                  </div>

                  <div>
                    <label className="label">Due Date</label>
                    <input
                      type="date"
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
                    <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed">
                      <p className="text-gray-500 mb-2">No items added yet</p>
                      <button type="button" onClick={addInvoiceItem} className="text-primary-600 hover:text-primary-700">
                        Click "+ Add Item" to add your first item
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {invoiceItems.map((item, index) => (
                        <div key={index} className="flex gap-3 items-end p-4 bg-gray-50 rounded-lg">
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
                              className="input bg-gray-100"
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
                  <div className="bg-gray-50 p-4 rounded-lg">
                    <div className="space-y-2 max-w-sm ml-auto">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Subtotal:</span>
                        <span className="font-medium">{formatCurrency(totals.subtotal)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Tax:</span>
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
                    className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800"
                  >
                    <span className={`transform transition-transform ${showAdditionalFields ? 'rotate-180' : ''}`}>
                      ▼
                    </span>
                    Additional Fields
                  </button>

                  {showAdditionalFields && (
                    <div className="grid grid-cols-2 gap-4 mt-3 p-4 bg-gray-50 rounded-lg">
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
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Invoice Details</h2>
                <button onClick={() => { setShowViewModal(false); setViewingInvoice(null); }} className="text-gray-500 hover:text-gray-700 text-2xl">
                  ×
                </button>
              </div>

              {/* Invoice Header */}
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <p className="text-sm text-gray-500">Invoice Number</p>
                  <p className="font-semibold text-lg">{viewingInvoice.invoiceNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Type</p>
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    viewingInvoice.type === 'INVOICE' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
                  }`}>
                    {viewingInvoice.type}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Date</p>
                  <p className="font-medium">{new Date(viewingInvoice.invoiceDate).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    viewingInvoice.status === 'PAID' ? 'bg-green-100 text-green-700' :
                    viewingInvoice.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700' :
                    'bg-red-100 text-red-700'
                  }`}>
                    {viewingInvoice.status}
                  </span>
                </div>
              </div>

              {/* Customer Info */}
              <div className="bg-gray-50 p-4 rounded-lg mb-6">
                <p className="text-sm text-gray-500 mb-1">Customer</p>
                <p className="font-semibold">{viewingInvoice.party?.name}</p>
                {viewingInvoice.party?.phone && <p className="text-sm text-gray-600">{viewingInvoice.party.phone}</p>}
                {viewingInvoice.party?.email && <p className="text-sm text-gray-600">{viewingInvoice.party.email}</p>}
                {viewingInvoice.party?.billingAddress && <p className="text-sm text-gray-600">{viewingInvoice.party.billingAddress}</p>}
              </div>

              {/* Items */}
              <div className="mb-6">
                <h3 className="font-semibold mb-3">Items</h3>
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th className="table-header">Item</th>
                      <th className="table-header">HSN/SKU</th>
                      <th className="table-header">Qty</th>
                      <th className="table-header">Rate</th>
                      <th className="table-header">Tax %</th>
                      <th className="table-header">Total</th>
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
              <div className="bg-gray-50 p-4 rounded-lg mb-6">
                <div className="space-y-2 max-w-sm ml-auto">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Subtotal:</span>
                    <span className="font-medium">{formatCurrency(viewingInvoice.subtotal || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax:</span>
                    <span className="font-medium">{formatCurrency(viewingInvoice.taxAmount || 0)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold border-t pt-2">
                    <span>Total:</span>
                    <span>{formatCurrency(viewingInvoice.totalAmount)}</span>
                  </div>
                  {viewingInvoice.amountPaid !== undefined && viewingInvoice.amountPaid > 0 && (
                    <>
                      <div className="flex justify-between text-green-600">
                        <span>Paid:</span>
                        <span>{formatCurrency(viewingInvoice.amountPaid)}</span>
                      </div>
                      <div className="flex justify-between text-red-600 font-bold">
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
                  <p className="text-sm text-gray-500 mb-1">Notes</p>
                  <p className="text-gray-700">{viewingInvoice.notes}</p>
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
                <button
                  onClick={() => handleDownloadPDF(viewingInvoice.id)}
                  className="btn btn-primary"
                >
                  Download PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Sales
