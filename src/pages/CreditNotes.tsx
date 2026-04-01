import { useEffect, useState } from 'react'
import { formatCurrency } from '../utils/currency'

interface CreditDebitNote {
  id: string
  noteNumber: string
  noteDate: string
  type: 'CREDIT_NOTE' | 'DEBIT_NOTE'
  status: 'ACTIVE' | 'CANCELLED'
  subtotal: number
  taxAmount: number
  totalAmount: number
  reason?: string
  notes?: string
  referenceInvoiceId?: string
  party?: {
    id: string
    name: string
    email?: string
    phone?: string
    billingAddress?: string
  }
  referenceInvoice?: {
    id: string
    invoiceNumber: string
    totalAmount: number
    balanceDue: number
  }
  items?: Array<{
    item: {
      id: string
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

interface NoteItem {
  itemId: string
  quantity: number
  rate: number
  discount: number
  taxRate: number
  amount: number
}

interface PartyInvoice {
  id: string
  invoiceNumber: string
  totalAmount: number
  balanceDue: number
}

const CreditNotes = () => {
  const [notes, setNotes] = useState<CreditDebitNote[]>([])
  const [filter, setFilter] = useState<'ALL' | 'CREDIT_NOTE' | 'DEBIT_NOTE'>('ALL')
  const [showModal, setShowModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [viewingNote, setViewingNote] = useState<CreditDebitNote | null>(null)
  const [editingNote, setEditingNote] = useState<CreditDebitNote | null>(null)
  const [parties, setParties] = useState<Party[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [partyInvoices, setPartyInvoices] = useState<PartyInvoice[]>([])
  const [searchQuery, setSearchQuery] = useState('')

  // Form state
  const [formData, setFormData] = useState({
    type: 'CREDIT_NOTE' as 'CREDIT_NOTE' | 'DEBIT_NOTE',
    partyId: '',
    referenceInvoiceId: '',
    noteDate: new Date().toISOString().split('T')[0],
    reason: '',
    notes: ''
  })

  const [noteItems, setNoteItems] = useState<NoteItem[]>([])

  useEffect(() => {
    loadNotes()
    loadParties()
    loadItems()
  }, [filter])

  const loadNotes = async () => {
    const result = await window.electronAPI.creditNote.getAll(filter === 'ALL' ? undefined : filter)
    if (result.success && result.data) {
      setNotes(result.data)
    }
  }

  const loadParties = async () => {
    const result = await window.electronAPI.party.getAll()
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

  const loadPartyInvoices = async (partyId: string) => {
    if (!partyId) {
      setPartyInvoices([])
      return
    }
    const result = await window.electronAPI.sales.getAll('INVOICE')
    if (result.success && result.data) {
      const filtered = result.data.filter((inv: any) => inv.partyId === partyId)
      setPartyInvoices(filtered.map((inv: any) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        totalAmount: inv.totalAmount,
        balanceDue: inv.balanceDue
      })))
    }
  }

  const handlePartyChange = (partyId: string) => {
    setFormData({ ...formData, partyId, referenceInvoiceId: '' })
    loadPartyInvoices(partyId)
  }

  const handleDelete = async (id: string) => {
    const confirmed = window.confirm('Are you sure you want to delete this note?')
    if (confirmed) {
      const result = await window.electronAPI.creditNote.delete(id)
      if (result.success) {
        loadNotes()
      } else {
        alert('Failed to delete note: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const handleView = async (id: string) => {
    const result = await window.electronAPI.creditNote.getById(id)
    if (result.success && result.data) {
      setViewingNote(result.data)
      setShowViewModal(true)
    }
  }

  const handleEdit = async (note: CreditDebitNote) => {
    const result = await window.electronAPI.creditNote.getById(note.id)
    if (result.success && result.data) {
      const fullNote = result.data
      setEditingNote(fullNote)
      setFormData({
        type: fullNote.type,
        partyId: fullNote.party?.id || '',
        referenceInvoiceId: fullNote.referenceInvoiceId || '',
        noteDate: fullNote.noteDate.split('T')[0],
        reason: fullNote.reason || '',
        notes: fullNote.notes || ''
      })
      if (fullNote.party?.id) {
        loadPartyInvoices(fullNote.party.id)
      }
      setNoteItems(fullNote.items?.map((item: any) => ({
        itemId: item.item?.id || item.itemId,
        quantity: item.quantity,
        rate: item.rate,
        discount: item.discount || 0,
        taxRate: item.taxRate,
        amount: item.total
      })) || [])
      setShowModal(true)
    }
  }

  const addNoteItem = () => {
    if (noteItems.length >= 1 && noteItems[noteItems.length - 1].itemId === '') {
      alert('Please complete the current item first')
      return
    }
    setNoteItems([...noteItems, {
      itemId: '',
      quantity: 1,
      rate: 0,
      discount: 0,
      taxRate: 0,
      amount: 0
    }])
  }

  const updateNoteItem = (index: number, field: string, value: any) => {
    const newItems = [...noteItems]
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
    const discount = newItems[index].discount || 0
    const taxRate = newItems[index].taxRate || 0
    const taxableAmount = qty * rate - discount
    newItems[index].amount = taxableAmount + (taxableAmount * taxRate / 100)

    setNoteItems(newItems)
  }

  const removeNoteItem = (index: number) => {
    setNoteItems(noteItems.filter((_, i) => i !== index))
  }

  const calculateTotals = () => {
    const subtotal = noteItems.reduce((sum, item) => {
      const qty = item.quantity || 0
      const rate = item.rate || 0
      const discount = item.discount || 0
      return sum + (qty * rate - discount)
    }, 0)

    const taxAmount = noteItems.reduce((sum, item) => {
      const qty = item.quantity || 0
      const rate = item.rate || 0
      const discount = item.discount || 0
      const taxRate = item.taxRate || 0
      const taxableAmount = qty * rate - discount
      return sum + (taxableAmount * taxRate / 100)
    }, 0)

    const total = subtotal + taxAmount

    return { subtotal, taxAmount, total }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.partyId) {
      alert('Please select a party')
      return
    }

    if (noteItems.length === 0) {
      alert('Please add at least one item')
      return
    }

    if (editingNote) {
      const noteData = {
        ...formData,
        items: noteItems
      }

      const result = await window.electronAPI.creditNote.update(editingNote.id, noteData)

      if (result.success) {
        alert('Note updated successfully!')
        setShowModal(false)
        resetForm()
        loadNotes()
      } else {
        alert('Failed to update note: ' + (result.error || 'Unknown error'))
      }
    } else {
      const noteNumResult = await window.electronAPI.creditNote.generateNoteNumber(formData.type)
      if (!noteNumResult.success) {
        alert('Failed to generate note number')
        return
      }

      const noteData = {
        ...formData,
        noteNumber: noteNumResult.data,
        items: noteItems
      }

      const result = await window.electronAPI.creditNote.create(noteData)

      if (result.success) {
        alert('Note created successfully!')
        setShowModal(false)
        resetForm()
        loadNotes()
      } else {
        alert('Failed to create note: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const resetForm = () => {
    setFormData({
      type: 'CREDIT_NOTE',
      partyId: '',
      referenceInvoiceId: '',
      noteDate: new Date().toISOString().split('T')[0],
      reason: '',
      notes: ''
    })
    setNoteItems([])
    setEditingNote(null)
    setPartyInvoices([])
  }

  const filteredNotes = notes.filter(note => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      note.noteNumber.toLowerCase().includes(query) ||
      (note.party?.name || '').toLowerCase().includes(query)
    )
  })

  const totals = calculateTotals()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Credit / Debit Notes</h1>
        <button
          onClick={() => setShowModal(true)}
          className="btn btn-primary"
        >
          + New Note
        </button>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          className="input max-w-sm"
          placeholder="Search by note number or party name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Filter Tabs */}
      <div className="flex space-x-2">
        {(['ALL', 'CREDIT_NOTE', 'DEBIT_NOTE'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-4 py-2 rounded-lg font-medium ${
              filter === tab ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-700'
            }`}
          >
            {tab === 'ALL' ? 'ALL' : tab === 'CREDIT_NOTE' ? 'CREDIT NOTE' : 'DEBIT NOTE'}
          </button>
        ))}
      </div>

      {/* Notes Table */}
      <div className="card">
        {filteredNotes.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <p className="text-lg mb-4">No credit/debit notes yet</p>
            <button
              onClick={() => setShowModal(true)}
              className="btn btn-primary"
            >
              Create Your First Note
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th className="table-header">Note #</th>
                  <th className="table-header">Date</th>
                  <th className="table-header">Type</th>
                  <th className="table-header">Party</th>
                  <th className="table-header">Reference Invoice</th>
                  <th className="table-header">Amount</th>
                  <th className="table-header">Status</th>
                  <th className="table-header">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredNotes.map((note) => (
                  <tr key={note.id} className="border-t">
                    <td className="table-cell font-medium">{note.noteNumber}</td>
                    <td className="table-cell">{new Date(note.noteDate).toLocaleDateString()}</td>
                    <td className="table-cell">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        note.type === 'CREDIT_NOTE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {note.type === 'CREDIT_NOTE' ? 'CREDIT NOTE' : 'DEBIT NOTE'}
                      </span>
                    </td>
                    <td className="table-cell">{note.party?.name}</td>
                    <td className="table-cell">
                      {note.referenceInvoice?.invoiceNumber || '-'}
                    </td>
                    <td className="table-cell">{formatCurrency(note.totalAmount)}</td>
                    <td className="table-cell">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        note.status === 'ACTIVE' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                      }`}>
                        {note.status}
                      </span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => handleView(note.id)}
                          className="text-primary-600 hover:text-primary-700"
                        >
                          View
                        </button>
                        <button
                          onClick={() => handleEdit(note)}
                          className="text-green-600 hover:text-green-700"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(note.id)}
                          className="text-red-600 hover:text-red-700"
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

      {/* Create/Edit Note Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">{editingNote ? 'Edit Note' : 'Create New Note'}</h2>
                <button onClick={() => { setShowModal(false); resetForm(); }} className="text-gray-500 hover:text-gray-700 text-2xl">
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Basic Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Type *</label>
                    <select
                      className="input"
                      value={formData.type}
                      onChange={(e) => setFormData({ ...formData, type: e.target.value as 'CREDIT_NOTE' | 'DEBIT_NOTE' })}
                    >
                      <option value="CREDIT_NOTE">Credit Note</option>
                      <option value="DEBIT_NOTE">Debit Note</option>
                    </select>
                  </div>

                  <div>
                    <label className="label">Party *</label>
                    <select
                      className="input"
                      value={formData.partyId}
                      onChange={(e) => handlePartyChange(e.target.value)}
                      required
                    >
                      <option value="">Select Party</option>
                      {parties.map(party => (
                        <option key={party.id} value={party.id}>{party.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label">Reference Invoice</label>
                    <select
                      className="input"
                      value={formData.referenceInvoiceId}
                      onChange={(e) => setFormData({ ...formData, referenceInvoiceId: e.target.value })}
                    >
                      <option value="">None</option>
                      {partyInvoices.map(inv => (
                        <option key={inv.id} value={inv.id}>
                          {inv.invoiceNumber} ({formatCurrency(inv.totalAmount)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="label">Note Date *</label>
                    <input
                      type="date"
                      className="input"
                      value={formData.noteDate}
                      onChange={(e) => setFormData({ ...formData, noteDate: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {/* Reason */}
                <div>
                  <label className="label">Reason</label>
                  <textarea
                    className="input"
                    rows={2}
                    value={formData.reason}
                    onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                    placeholder="Reason for credit/debit note..."
                  />
                </div>

                {/* Items Section */}
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">Items</h3>
                    <button type="button" onClick={addNoteItem} className="btn btn-secondary text-sm">
                      + Add Item
                    </button>
                  </div>

                  {noteItems.length === 0 ? (
                    <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-dashed">
                      <p className="text-gray-500 mb-2">No items added yet</p>
                      <button type="button" onClick={addNoteItem} className="text-primary-600 hover:text-primary-700">
                        Click "+ Add Item" to add your first item
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {noteItems.map((item, index) => (
                        <div key={index} className="flex gap-3 items-end p-4 bg-gray-50 rounded-lg">
                          <div className="flex-1">
                            <label className="label text-xs">Item</label>
                            <select
                              className="input"
                              value={item.itemId}
                              onChange={(e) => updateNoteItem(index, 'itemId', e.target.value)}
                              required
                            >
                              <option value="">Select Item</option>
                              {items.map(i => (
                                <option key={i.id} value={i.id}>{i.name}</option>
                              ))}
                            </select>
                          </div>

                          <div className="w-20">
                            <label className="label text-xs">Qty</label>
                            <input
                              type="number"
                              className="input"
                              value={item.quantity}
                              onChange={(e) => updateNoteItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                              min="1"
                              step="1"
                              required
                            />
                          </div>

                          <div className="w-28">
                            <label className="label text-xs">Rate</label>
                            <input
                              type="number"
                              className="input"
                              value={item.rate}
                              onChange={(e) => updateNoteItem(index, 'rate', parseFloat(e.target.value) || 0)}
                              min="0"
                              step="0.01"
                              required
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Discount</label>
                            <input
                              type="number"
                              className="input"
                              value={item.discount}
                              onChange={(e) => updateNoteItem(index, 'discount', parseFloat(e.target.value) || 0)}
                              min="0"
                              step="0.01"
                            />
                          </div>

                          <div className="w-20">
                            <label className="label text-xs">Tax %</label>
                            <input
                              type="number"
                              className="input"
                              value={item.taxRate}
                              onChange={(e) => updateNoteItem(index, 'taxRate', parseFloat(e.target.value) || 0)}
                              min="0"
                              step="0.01"
                            />
                          </div>

                          <div className="w-28">
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
                            onClick={() => removeNoteItem(index)}
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
                {noteItems.length > 0 && (
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
                    onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
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
                    {editingNote ? 'Update Note' : 'Create Note'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* View Note Modal */}
      {showViewModal && viewingNote && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Note Details</h2>
                <button onClick={() => { setShowViewModal(false); setViewingNote(null); }} className="text-gray-500 hover:text-gray-700 text-2xl">
                  ×
                </button>
              </div>

              {/* Note Header */}
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <p className="text-sm text-gray-500">Note Number</p>
                  <p className="font-semibold text-lg">{viewingNote.noteNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Type</p>
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    viewingNote.type === 'CREDIT_NOTE' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {viewingNote.type === 'CREDIT_NOTE' ? 'CREDIT NOTE' : 'DEBIT NOTE'}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Date</p>
                  <p className="font-medium">{new Date(viewingNote.noteDate).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status</p>
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    viewingNote.status === 'ACTIVE' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                  }`}>
                    {viewingNote.status}
                  </span>
                </div>
              </div>

              {/* Party Info */}
              <div className="bg-gray-50 p-4 rounded-lg mb-6">
                <p className="text-sm text-gray-500 mb-1">Party</p>
                <p className="font-semibold">{viewingNote.party?.name}</p>
                {viewingNote.party?.phone && <p className="text-sm text-gray-600">{viewingNote.party.phone}</p>}
                {viewingNote.party?.email && <p className="text-sm text-gray-600">{viewingNote.party.email}</p>}
                {viewingNote.party?.billingAddress && <p className="text-sm text-gray-600">{viewingNote.party.billingAddress}</p>}
              </div>

              {/* Reference Invoice */}
              {viewingNote.referenceInvoice && (
                <div className="bg-blue-50 p-4 rounded-lg mb-6">
                  <p className="text-sm text-blue-600 mb-1">Reference Invoice</p>
                  <p className="font-semibold">{viewingNote.referenceInvoice.invoiceNumber}</p>
                  <div className="flex gap-4 mt-1 text-sm text-blue-700">
                    <span>Total: {formatCurrency(viewingNote.referenceInvoice.totalAmount)}</span>
                    <span>Balance Due: {formatCurrency(viewingNote.referenceInvoice.balanceDue)}</span>
                  </div>
                </div>
              )}

              {/* Reason */}
              {viewingNote.reason && (
                <div className="mb-6">
                  <p className="text-sm text-gray-500 mb-1">Reason</p>
                  <p className="text-gray-700">{viewingNote.reason}</p>
                </div>
              )}

              {/* Items */}
              <div className="mb-6">
                <h3 className="font-semibold mb-3">Items</h3>
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th className="table-header">Item</th>
                      <th className="table-header">Qty</th>
                      <th className="table-header">Rate</th>
                      <th className="table-header">Discount</th>
                      <th className="table-header">Tax %</th>
                      <th className="table-header">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingNote.items?.map((item, index) => (
                      <tr key={index} className="border-t">
                        <td className="table-cell">{item.item?.name}</td>
                        <td className="table-cell">{item.quantity}</td>
                        <td className="table-cell">{formatCurrency(item.rate)}</td>
                        <td className="table-cell">{formatCurrency(item.discount)}</td>
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
                    <span className="font-medium">{formatCurrency(viewingNote.subtotal || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Tax:</span>
                    <span className="font-medium">{formatCurrency(viewingNote.taxAmount || 0)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold border-t pt-2">
                    <span>Total:</span>
                    <span>{formatCurrency(viewingNote.totalAmount)}</span>
                  </div>
                </div>
              </div>

              {/* Notes */}
              {viewingNote.notes && (
                <div className="mb-4">
                  <p className="text-sm text-gray-500 mb-1">Notes</p>
                  <p className="text-gray-700">{viewingNote.notes}</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  onClick={() => { setShowViewModal(false); setViewingNote(null); }}
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

export default CreditNotes
