import { useEffect, useState } from 'react'
import { PurchaseBill } from '../types'
import { formatCurrency } from '../utils/currency'
import NumberInput from '../components/NumberInput'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'
import { TableSkeleton } from '../components/Skeleton'
import { ShoppingCart, Search as SearchIcon } from 'lucide-react'

interface Party {
  id: string
  name: string
  type: string
}

interface Item {
  id: string
  name: string
  purchasePrice: number
  taxRate: number
}

interface BillItem {
  itemId: string
  quantity: number
  rate: number
  taxRate: number
  discount: number
  amount: number
}

const Purchase = () => {
  const [bills, setBills] = useState<PurchaseBill[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [viewingBill, setViewingBill] = useState<PurchaseBill | null>(null)
  const [editingBill, setEditingBill] = useState<PurchaseBill | null>(null)
  const [suppliers, setSuppliers] = useState<Party[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  // Form state
  const [formData, setFormData] = useState({
    partyId: '',
    billDate: new Date().toISOString().split('T')[0],
    notes: ''
  })

  const [billItems, setBillItems] = useState<BillItem[]>([])

  useEffect(() => {
    loadBills()
    loadSuppliers()
    loadItems()
  }, [])

  const toast = useToast()
  const confirm = useConfirm()

  const loadBills = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.purchase.getAll()
      if (result.success && result.data) {
        setBills(result.data)
      }
    } finally {
      setLoading(false)
    }
  }

  const loadSuppliers = async () => {
    const result = await window.electronAPI.party.getAll('SUPPLIER')
    if (result.success && result.data) {
      setSuppliers(result.data)
    }
  }

  const loadItems = async () => {
    const result = await window.electronAPI.item.getAll()
    if (result.success && result.data) {
      setItems(result.data)
    }
  }

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({ message: 'Are you sure you want to delete this purchase bill?', danger: true })
    if (confirmed) {
      const result = await window.electronAPI.purchase.delete(id)
      if (result.success) {
        loadBills()
      } else {
        toast.error('Failed to delete purchase bill: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const handleView = async (id: string) => {
    const result = await window.electronAPI.purchase.getById(id)
    if (result.success && result.data) {
      setViewingBill(result.data)
      setShowViewModal(true)
    }
  }

  const handleEdit = async (bill: PurchaseBill) => {
    const result = await window.electronAPI.purchase.getById(bill.id)
    if (result.success && result.data) {
      const fullBill = result.data
      setEditingBill(fullBill)
      setFormData({
        partyId: fullBill.party?.id || fullBill.partyId || '',
        billDate: fullBill.billDate.split('T')[0],
        notes: fullBill.notes || ''
      })
      setBillItems(fullBill.items?.map((item: any) => ({
        itemId: item.item?.id || item.itemId,
        quantity: item.quantity,
        rate: item.rate,
        taxRate: item.taxRate,
        discount: item.discount || 0,
        amount: item.total
      })) || [])
      setShowModal(true)
    }
  }

  const addBillItem = () => {
    if (billItems.length >= 1 && billItems[billItems.length - 1].itemId === '') {
      toast.info('Please complete the current item first')
      return
    }
    setBillItems([...billItems, {
      itemId: '',
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

    // If item selected, populate rate and tax
    if (field === 'itemId') {
      const item = items.find(i => i.id === value)
      if (item) {
        newItems[index].rate = item.purchasePrice
        newItems[index].taxRate = item.taxRate
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

    const taxAmount = billItems.reduce((sum, item) => {
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
      toast.info('Please select a supplier')
      return
    }

    if (billItems.length === 0) {
      toast.info('Please add at least one item')
      return
    }

    const { subtotal, taxAmount, total } = calculateTotals()

    if (editingBill) {
      // Update existing bill
      const billData = {
        ...formData,
        items: billItems,
        subtotalAmount: subtotal,
        taxAmount: taxAmount,
        totalAmount: total
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
      // Create new bill
      const billNumResult = await window.electronAPI.purchase.generateBillNumber()
      if (!billNumResult.success) {
        toast.error('Failed to generate bill number')
        return
      }

      const billData = {
        ...formData,
        billNumber: billNumResult.data,
        items: billItems,
        subtotalAmount: subtotal,
        taxAmount: taxAmount,
        totalAmount: total,
        balanceDue: total,
        status: 'DRAFT'
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
      partyId: '',
      billDate: new Date().toISOString().split('T')[0],
      notes: ''
    })
    setBillItems([])
    setEditingBill(null)
  }

  const totals = calculateTotals()

  // Filter bills by search query
  const filteredBills = bills.filter((bill) => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    const matchesNumber = bill.billNumber?.toLowerCase().includes(query)
    const matchesParty = bill.party?.name?.toLowerCase().includes(query)
    return matchesNumber || matchesParty
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Purchase Bills</h1>
        <button onClick={() => setShowModal(true)} className="btn btn-primary">+ New Purchase Bill</button>
      </div>

      {/* Search Input */}
      <div>
        <input
          type="text"
          className="input max-w-md"
          placeholder="Search by bill number or supplier name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Bills Table */}
      <div className="card">
        {loading ? (
          <TableSkeleton rows={6} columns={6} />
        ) : filteredBills.length === 0 ? (
          searchQuery.trim() ? (
            <EmptyState
              icon={SearchIcon}
              title="No bills match your search"
              description={`Nothing matched "${searchQuery}".`}
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
                <th className="table-header sticky top-0 z-10">Bill #</th>
                <th className="table-header sticky top-0 z-10">Date</th>
                <th className="table-header sticky top-0 z-10">Supplier</th>
                <th className="table-header sticky top-0 z-10">Amount</th>
                <th className="table-header sticky top-0 z-10">Status</th>
                <th className="table-header sticky top-0 z-10">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredBills.map((bill) => (
                <tr key={bill.id} className="border-t">
                  <td className="table-cell font-medium">{bill.billNumber}</td>
                  <td className="table-cell">{new Date(bill.billDate).toLocaleDateString()}</td>
                  <td className="table-cell">{bill.party?.name}</td>
                  <td className="table-cell">{formatCurrency(bill.totalAmount)}</td>
                  <td className="table-cell">
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      bill.status === 'PAID' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                      bill.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    }`}>
                      {bill.status}
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
                      <button
                        onClick={() => handleEdit(bill)}
                        className="text-green-600 hover:text-green-700"
                      >
                        Edit
                      </button>
                      <button onClick={() => handleDelete(bill.id)} className="text-red-600 hover:text-red-700">Delete</button>
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
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">{editingBill ? 'Edit Purchase Bill' : 'Create New Purchase Bill'}</h2>
                <button onClick={() => { setShowModal(false); resetForm(); }} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl">
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Supplier *</label>
                    <select
                      className="input"
                      value={formData.partyId}
                      onChange={(e) => setFormData({...formData, partyId: e.target.value})}
                      required
                    >
                      <option value="">Select Supplier</option>
                      {suppliers.map(supplier => (
                        <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label">Bill Date *</label>
                    <input
                      type="date"
                      className="input"
                      value={formData.billDate}
                      onChange={(e) => setFormData({...formData, billDate: e.target.value})}
                      required
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
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    viewingBill.status === 'PAID' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                    viewingBill.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  }`}>
                    {viewingBill.status}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Date</p>
                  <p className="font-medium">{new Date(viewingBill.billDate).toLocaleDateString()}</p>
                </div>
              </div>

              {/* Supplier Info */}
              <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg mb-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Supplier</p>
                <p className="font-semibold">{viewingBill.party?.name}</p>
                {viewingBill.party?.phone && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingBill.party.phone}</p>}
                {viewingBill.party?.email && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingBill.party.email}</p>}
              </div>

              {/* Items */}
              <div className="mb-6">
                <h3 className="font-semibold mb-3">Items</h3>
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th className="table-header sticky top-0 z-10">Item</th>
                      <th className="table-header sticky top-0 z-10">Qty</th>
                      <th className="table-header sticky top-0 z-10">Rate</th>
                      <th className="table-header sticky top-0 z-10">Tax %</th>
                      <th className="table-header sticky top-0 z-10">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingBill.items?.map((item: any, index: number) => (
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
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Purchase
