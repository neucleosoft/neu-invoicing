import { useEffect, useState } from 'react'
import { formatCurrency } from '../utils/currency'
import { downloadChallanPDF } from '../utils/generateChallanPDF'
import NumberInput from '../components/NumberInput'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'

interface Challan {
  id: string
  challanNumber: string
  challanDate: string
  status: 'PENDING' | 'DELIVERED' | 'CONVERTED'
  totalAmount: number
  subtotal?: number
  taxAmount?: number
  transportMode?: string
  vehicleNumber?: string
  notes?: string
  convertedToInvoiceId?: string
  party?: {
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
}

interface ChallanItem {
  itemId: string
  quantity: number
  rate: number
  taxRate: number
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

  // Form state
  const [formData, setFormData] = useState({
    partyId: '',
    challanDate: new Date().toISOString().split('T')[0],
    transportMode: '',
    vehicleNumber: '',
    notes: ''
  })

  const [challanItems, setChallanItems] = useState<ChallanItem[]>([])
  const toast = useToast()
  const confirm = useConfirm()

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

  const handleDownloadPDF = async (challanId: string) => {
    const result = await window.electronAPI.challan.getById(challanId)
    if (result.success && result.data) {
      const companyResult = await window.electronAPI.company.get()
      const company = companyResult.success ? companyResult.data : undefined

      // Convert logo to base64 resized (200x200 is plenty for PDF)
      if (company?.logoPath) {
        try {
          const logoUrl = `local-resource://${company.logoPath.replace(/\\/g, '/')}`
          const response = await fetch(logoUrl)
          const blob = await response.blob()
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
          ;(company as any).logoBase64 = logoBase64
        } catch {
          // Logo file missing or unreadable, skip it
        }
      }

      downloadChallanPDF({ ...result.data, company } as any)
    }
  }

  const handleEdit = async (challan: Challan) => {
    const result = await window.electronAPI.challan.getById(challan.id)
    if (result.success && result.data) {
      const fullChallan = result.data
      setEditingChallan(fullChallan)
      setFormData({
        partyId: fullChallan.party?.id || fullChallan.partyId || '',
        challanDate: new Date(fullChallan.challanDate).toISOString().split('T')[0],
        transportMode: fullChallan.transportMode || '',
        vehicleNumber: fullChallan.vehicleNumber || '',
        notes: fullChallan.notes || ''
      })
      setChallanItems(fullChallan.items?.map((item: any) => ({
        itemId: item.item?.id || item.itemId,
        quantity: item.quantity,
        rate: item.rate,
        taxRate: item.taxRate,
        amount: item.total
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
      quantity: 1,
      rate: 0,
      taxRate: 0,
      amount: 0
    }])
  }

  const updateChallanItem = (index: number, field: string, value: any) => {
    const newItems = [...challanItems]
    newItems[index] = { ...newItems[index], [field]: value }

    // If item selected, populate rate and tax
    if (field === 'itemId') {
      const item = items.find(i => i.id === value)
      if (item) {
        newItems[index].rate = item.salePrice
        newItems[index].taxRate = item.taxRate
      }
    }

    // Calculate amount
    const qty = newItems[index].quantity || 0
    const rate = newItems[index].rate || 0
    const taxRate = newItems[index].taxRate || 0
    newItems[index].amount = qty * rate * (1 + taxRate / 100)

    setChallanItems(newItems)
  }

  const removeChallanItem = (index: number) => {
    setChallanItems(challanItems.filter((_, i) => i !== index))
  }

  const calculateTotals = () => {
    const subtotal = challanItems.reduce((sum, item) => {
      const qty = item.quantity || 0
      const rate = item.rate || 0
      return sum + (qty * rate)
    }, 0)

    const taxAmount = challanItems.reduce((sum, item) => {
      const qty = item.quantity || 0
      const rate = item.rate || 0
      const taxRate = item.taxRate || 0
      return sum + (qty * rate * taxRate / 100)
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

    if (challanItems.length === 0) {
      toast.info('Please add at least one item')
      return
    }

    if (editingChallan) {
      // Update existing challan
      const challanData = {
        ...formData,
        items: challanItems
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
      // Create new challan
      const challanNumResult = await window.electronAPI.challan.generateChallanNumber()
      if (!challanNumResult.success) {
        toast.error('Failed to generate challan number')
        return
      }

      const challanData = {
        ...formData,
        challanNumber: challanNumResult.data,
        items: challanItems
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
      partyId: '',
      challanDate: new Date().toISOString().split('T')[0],
      transportMode: '',
      vehicleNumber: '',
      notes: ''
    })
    setChallanItems([])
    setEditingChallan(null)
  }

  const totals = calculateTotals()

  // Filter challans by search term
  const filteredChallans = challans.filter((challan) => {
    if (!searchTerm) return true
    const term = searchTerm.toLowerCase()
    return (
      challan.challanNumber.toLowerCase().includes(term) ||
      (challan.party?.name || '').toLowerCase().includes(term)
    )
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Delivery Challans</h1>
        <button
          onClick={() => setShowModal(true)}
          className="btn btn-primary"
        >
          + New Challan
        </button>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          className="input max-w-md"
          placeholder="Search by challan number or party name..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {/* Challans Table */}
      <div className="card">
        {filteredChallans.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg mb-4">{searchTerm ? 'No challans match your search' : 'No delivery challans yet'}</p>
            {!searchTerm && (
              <button
                onClick={() => setShowModal(true)}
                className="btn btn-primary"
              >
                Create Your First Delivery Challan
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="table-header">Challan #</th>
                  <th className="table-header">Date</th>
                  <th className="table-header">Party</th>
                  <th className="table-header">Amount</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredChallans.map((challan) => (
                  <tr key={challan.id} className="border-t">
                    <td className="table-cell font-medium">{challan.challanNumber}</td>
                    <td className="table-cell">{new Date(challan.challanDate).toLocaleDateString()}</td>
                    <td className="table-cell">{challan.party?.name}</td>
                    <td className="table-cell">{formatCurrency(challan.totalAmount)}</td>
                    <td className="table-cell">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        challan.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                        challan.status === 'DELIVERED' ? 'bg-green-100 text-green-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {challan.status}
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
                        <button
                          onClick={() => handleDownloadPDF(challan.id)}
                          className="text-indigo-600 hover:text-indigo-700"
                        >
                          PDF
                        </button>
                        {challan.status !== 'CONVERTED' && (
                          <button
                            onClick={() => handleEdit(challan)}
                            className="text-green-600 hover:text-green-700"
                          >
                            Edit
                          </button>
                        )}
                        {(challan.status === 'PENDING' || challan.status === 'DELIVERED') && (
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
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">{editingChallan ? 'Edit Delivery Challan' : 'Create New Delivery Challan'}</h2>
                <button onClick={() => { setShowModal(false); resetForm(); }} className="text-gray-500 hover:text-gray-700 text-2xl">
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
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
                    <label className="label">Challan Date *</label>
                    <input
                      type="date"
                      className="input"
                      value={formData.challanDate}
                      onChange={(e) => setFormData({...formData, challanDate: e.target.value})}
                      required
                    />
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

                  <div>
                    <label className="label">Vehicle Number</label>
                    <input
                      type="text"
                      className="input"
                      value={formData.vehicleNumber}
                      onChange={(e) => setFormData({...formData, vehicleNumber: e.target.value})}
                      placeholder="e.g., MH-12-AB-1234"
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
                    <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed">
                      <p className="text-gray-500 mb-2">No items added yet</p>
                      <button type="button" onClick={addChallanItem} className="text-primary-600 hover:text-primary-700">
                        Click "+ Add Item" to add your first item
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {challanItems.map((item, index) => (
                        <div key={index} className="flex gap-3 items-end p-4 bg-gray-50 rounded-lg">
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
                              className="input bg-gray-100"
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
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Delivery Challan Details</h2>
                <button onClick={() => { setShowViewModal(false); setViewingChallan(null); }} className="text-gray-500 hover:text-gray-700 text-2xl">
                  ×
                </button>
              </div>

              {/* Challan Header */}
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <p className="text-sm text-gray-500">Challan Number</p>
                  <p className="font-semibold text-lg">{viewingChallan.challanNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    viewingChallan.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                    viewingChallan.status === 'DELIVERED' ? 'bg-green-100 text-green-700' :
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {viewingChallan.status}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Date</p>
                  <p className="font-medium">{new Date(viewingChallan.challanDate).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Transport Mode</p>
                  <p className="font-medium">{viewingChallan.transportMode || 'N/A'}</p>
                </div>
                {viewingChallan.vehicleNumber && (
                  <div>
                    <p className="text-sm text-gray-500">Vehicle Number</p>
                    <p className="font-medium">{viewingChallan.vehicleNumber}</p>
                  </div>
                )}
                {viewingChallan.convertedToInvoiceId && (
                  <div>
                    <p className="text-sm text-gray-500">Converted to Invoice</p>
                    <p className="font-medium text-blue-600">{viewingChallan.convertedToInvoiceId}</p>
                  </div>
                )}
              </div>

              {/* Customer Info */}
              <div className="bg-gray-50 p-4 rounded-lg mb-6">
                <p className="text-sm text-gray-500 mb-1">Customer</p>
                <p className="font-semibold">{viewingChallan.party?.name}</p>
                {viewingChallan.party?.phone && <p className="text-sm text-gray-600">{viewingChallan.party.phone}</p>}
                {viewingChallan.party?.email && <p className="text-sm text-gray-600">{viewingChallan.party.email}</p>}
                {viewingChallan.party?.billingAddress && <p className="text-sm text-gray-600">{viewingChallan.party.billingAddress}</p>}
              </div>

              {/* Items */}
              <div className="mb-6">
                <h3 className="font-semibold mb-3">Items</h3>
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th className="table-header">Item</th>
                      <th className="table-header">Qty</th>
                      <th className="table-header">Rate</th>
                      <th className="table-header">Tax %</th>
                      <th className="table-header">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingChallan.items?.map((item, index) => (
                      <tr key={index} className="border-t">
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
              <div className="bg-gray-50 p-4 rounded-lg mb-6">
                <div className="space-y-2 max-w-sm ml-auto">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Subtotal:</span>
                    <span className="font-medium">{formatCurrency(viewingChallan.subtotal || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax:</span>
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
                  <p className="text-sm text-gray-500 mb-1">Notes</p>
                  <p className="text-gray-700">{viewingChallan.notes}</p>
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
                <button
                  onClick={() => handleDownloadPDF(viewingChallan.id)}
                  className="btn btn-secondary"
                >
                  Download PDF
                </button>
                {(viewingChallan.status === 'PENDING' || viewingChallan.status === 'DELIVERED') && (
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
