import { useEffect, useState } from 'react'
import { formatCurrency } from '../utils/currency'
import NumberInput from '../components/NumberInput'
import DateInput from '../components/DateInput'
import { useToast } from '../components/ToastContext'
import { useConfirm } from '../components/ConfirmDialogContext'
import EmptyState from '../components/EmptyState'
import { FileText } from 'lucide-react'
import SearchableSelect from '../components/SearchableSelect'
import { useStore } from '../store/useStore'
import ShareMenu from '../components/ShareMenu'
import { sharePdf, ShareTarget } from '../utils/sharePdf'
import {
  getCreditNotePDFBytes,
  buildCreditNoteFilename,
  CreditNotePDFData,
} from '../utils/pdfmakeCreditNote'
import { loadCompanyForPDF } from '../utils/loadCompanyForPDF'
import DownloadMenu from '../components/DownloadMenu'
import { DispatchOpts, TableData } from '../utils/downloadHelpers'

interface CreditDebitNote {
  id: string
  noteNumber: string
  noteDate: string
  type: 'CREDIT_NOTE' | 'DEBIT_NOTE'
  status: 'ACTIVE' | 'CANCELLED'
  customerId?: string
  subtotal: number
  taxAmount: number
  totalAmount: number
  reason?: string
  notes?: string
  referenceInvoiceId?: string
  customer?: {
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
      hsnCode?: string
      skuHsn?: string
    }
    hsnCode?: string
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
  hsnCode?: string
  skuHsn?: string
}

interface NoteItem {
  itemId: string
  hsnCode: string
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
  const toast = useToast()
  const confirm = useConfirm()
  const { company } = useStore()

  // Form state
  const [formData, setFormData] = useState({
    type: 'CREDIT_NOTE' as 'CREDIT_NOTE' | 'DEBIT_NOTE',
    customerId: '',
    referenceInvoiceId: '',
    noteDate: new Date().toISOString().split('T')[0],
    reason: '',
    notes: '',
    termsConditions: ''
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

  const loadPartyInvoices = async (customerId: string) => {
    if (!customerId) {
      setPartyInvoices([])
      return
    }
    const result = await window.electronAPI.sales.getAll()
    if (result.success && result.data) {
      const filtered = result.data.filter((inv: any) => inv.customerId === customerId)
      setPartyInvoices(filtered.map((inv: any) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        totalAmount: inv.totalAmount,
        balanceDue: inv.balanceDue
      })))
    }
  }

  const handlePartyChange = (customerId: string) => {
    setFormData({ ...formData, customerId, referenceInvoiceId: '' })
    loadPartyInvoices(customerId)
  }

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({ message: 'Are you sure you want to delete this note?', danger: true })
    if (confirmed) {
      const result = await window.electronAPI.creditNote.delete(id)
      if (result.success) {
        loadNotes()
      } else {
        toast.error('Failed to delete note: ' + (result.error || 'Unknown error'))
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

  // Build the PDF input shape from the raw note row and the active company.
  const loadCreditNotePDFData = async (id: string): Promise<CreditNotePDFData | null> => {
    const result = await window.electronAPI.creditNote.getById(id)
    if (!result.success || !result.data) {
      toast.error(result.error || 'Failed to fetch note')
      return null
    }
    const note: any = result.data
    const company = await loadCompanyForPDF()
    const customer = note.customer || {}
    const items = (note.items || []).map((it: any) => {
      const quantity = it.quantity || 0
      const rate = it.rate || 0
      const discount = it.discount || 0
      return {
        item: {
          name: it.item?.name || 'Item',
          unit: it.item?.unit || 'pcs',
          hsnCode: it.hsnCode || it.item?.hsnCode || it.item?.skuHsn || '',
          skuHsn: it.item?.skuHsn,
        },
        quantity,
        rate,
        taxRate: it.taxRate || 0,
        discount,
        total: it.total || 0,
        hsnCode: it.hsnCode || it.item?.hsnCode || it.item?.skuHsn || '',
        taxableAmount: quantity * rate - discount,
      }
    })
    return {
      noteNumber: note.noteNumber,
      noteDate: note.noteDate,
      type: note.type,
      reason: note.reason,
      notes: note.notes,
      termsConditions: note.termsConditions,
      totalAmount: note.totalAmount || 0,
      subtotal: note.subtotal,
      taxAmount: note.taxAmount,
      customer: {
        name: customer.name || '',
        taxId: customer.taxId,
        phone: customer.phone,
        email: customer.email,
        billingAddress: customer.billingAddress,
        shippingAddress: customer.shippingAddress,
      },
      referenceInvoice: note.referenceInvoice
        ? {
            invoiceNumber: note.referenceInvoice.invoiceNumber,
            invoiceDate: note.referenceInvoice.invoiceDate,
            totalAmount: note.referenceInvoice.totalAmount,
          }
        : undefined,
      items,
      company,
    }
  }

  const buildNoteTableData = (data: CreditNotePDFData): TableData => {
    const customer = (data as any).customer || {}
    const meta: Array<[string, string | number]> = [
      ['Note', (data as any).noteNumber || ''],
      ['Type', (data as any).type === 'DEBIT_NOTE' ? 'Debit Note' : 'Credit Note'],
      ['Date', (data as any).noteDate ? new Date((data as any).noteDate).toLocaleDateString('en-GB') : ''],
      ['Customer', customer.name || ''],
      ['GSTIN', customer.taxId || ''],
    ]
    const metaSuffix: Array<[string, string | number]> = [
      ['Subtotal', (data as any).subtotal || 0],
      ['Tax', (data as any).taxAmount || 0],
      ['Total', (data as any).totalAmount || 0],
    ]
    const headers = ['Item', 'HSN', 'Qty', 'Rate', 'Tax %', 'Amount']
    const rows: (string | number)[][] = ((data as any).items || []).map((it: any) => [
      it.item?.name || '',
      it.hsnCode || it.item?.hsnCode || '',
      it.quantity || 0,
      it.rate || 0,
      it.taxRate || 0,
      it.total || 0,
    ])
    return { baseName: buildCreditNoteFilename(data).replace(/\.pdf$/i, ''), meta, metaSuffix, headers, rows }
  }

  const buildDownloadOpts = async (id: string): Promise<DispatchOpts> => {
    const data = await loadCreditNotePDFData(id)
    if (!data) throw new Error('Failed to load note details')
    let cached: { bytes: Uint8Array; filename: string } | null = null
    const getPdf = async () => {
      if (!cached) {
        const bytes = await getCreditNotePDFBytes(data)
        cached = { bytes, filename: buildCreditNoteFilename(data) }
      }
      return cached
    }
    return {
      getPdf,
      getTable: async () => buildNoteTableData(data),
    }
  }

  const handleShare = async (id: string, target: ShareTarget) => {
    try {
      const data = await loadCreditNotePDFData(id)
      if (!data) return
      const bytes = await getCreditNotePDFBytes(data)
      const filename = buildCreditNoteFilename(data)
      const docLabel = data.type === 'DEBIT_NOTE' ? 'Debit Note' : 'Credit Note'
      const subject = `${docLabel} ${data.noteNumber} from ${data.company?.name || ''}`.trim()
      await sharePdf(bytes, filename, target, toast, {
        subject,
        phone: data.customer.phone,
        email: data.customer.email,
        partyName: data.customer.name,
      })
    } catch (err) {
      console.error('Error sharing note:', err)
      toast.error('Failed to share note')
    }
  }

  const handleEdit = async (note: CreditDebitNote) => {
    const result = await window.electronAPI.creditNote.getById(note.id)
    if (result.success && result.data) {
      const fullNote = result.data
      setEditingNote(fullNote)
      setFormData({
        type: fullNote.type,
        customerId: fullNote.customer?.id || '',
        referenceInvoiceId: fullNote.referenceInvoiceId || '',
        noteDate: fullNote.noteDate.split('T')[0],
        reason: fullNote.reason || '',
        notes: fullNote.notes || '',
        termsConditions: (fullNote as any).termsConditions || ''
      })
      if (fullNote.customer?.id) {
        loadPartyInvoices(fullNote.customer.id)
      }
      setNoteItems(fullNote.items?.map((item: any) => ({
        itemId: item.item?.id || item.itemId,
        hsnCode: item.hsnCode || item.item?.hsnCode || item.item?.skuHsn || '',
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
      toast.info('Please complete the current item first')
      return
    }
    setNoteItems([...noteItems, {
      itemId: '',
      hsnCode: '',
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

    // If item selected, populate rate, tax, and HSN/SKU
    if (field === 'itemId') {
      const item = items.find(i => i.id === value)
      if (item) {
        newItems[index].rate = item.salePrice
        newItems[index].taxRate = item.taxRate
        newItems[index].hsnCode = item.hsnCode || item.skuHsn || ''
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

    if (!formData.customerId) {
      toast.info('Please select a party')
      return
    }

    if (noteItems.length === 0) {
      toast.info('Please add at least one item')
      return
    }

    if (editingNote) {
      const noteData = {
        ...formData,
        items: noteItems
      }

      const result = await window.electronAPI.creditNote.update(editingNote.id, noteData)

      if (result.success) {
        toast.success('Note updated successfully!')
        setShowModal(false)
        resetForm()
        loadNotes()
      } else {
        toast.error('Failed to update note: ' + (result.error || 'Unknown error'))
      }
    } else {
      const noteNumResult = await window.electronAPI.creditNote.generateNoteNumber(formData.type)
      if (!noteNumResult.success) {
        toast.error('Failed to generate note number')
        return
      }

      const noteData = {
        ...formData,
        noteNumber: noteNumResult.data,
        items: noteItems
      }

      const result = await window.electronAPI.creditNote.create(noteData)

      if (result.success) {
        toast.success('Note created successfully!')
        setShowModal(false)
        resetForm()
        loadNotes()
      } else {
        toast.error('Failed to create note: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const resetForm = () => {
    setFormData({
      type: 'CREDIT_NOTE',
      customerId: '',
      referenceInvoiceId: '',
      noteDate: new Date().toISOString().split('T')[0],
      reason: '',
      notes: '',
      termsConditions: ''
    })
    setNoteItems([])
    setEditingNote(null)
    setPartyInvoices([])
  }

  const handleNewNote = () => {
    setFormData(prev => ({
      ...prev,
      termsConditions: company?.termsConditions || ''
    }))
    setShowModal(true)
  }

  const filteredNotes = notes.filter(note => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      note.noteNumber.toLowerCase().includes(query) ||
      (note.customer?.name || '').toLowerCase().includes(query)
    )
  })

  const totals = calculateTotals()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Credit / Debit Notes</h1>
        <button
          onClick={handleNewNote}
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
              filter === tab ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
            }`}
          >
            {tab === 'ALL' ? 'ALL' : tab === 'CREDIT_NOTE' ? 'CREDIT NOTE' : 'DEBIT NOTE'}
          </button>
        ))}
      </div>

      {/* Notes Table */}
      <div className="card">
        {filteredNotes.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No credit/debit notes yet"
            description="Issue credit or debit notes to adjust invoices and bills with automatic ledger entries."
            action={{ label: '+ Create your first note', onClick: handleNewNote }}
          />
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <table className="table">
              <thead>
                <tr>
                  <th className="table-header sticky top-0 z-10">Note #</th>
                  <th className="table-header sticky top-0 z-10">Date</th>
                  <th className="table-header sticky top-0 z-10">Type</th>
                  <th className="table-header sticky top-0 z-10">Party</th>
                  <th className="table-header sticky top-0 z-10">Reference Invoice</th>
                  <th className="table-header sticky top-0 z-10">Amount</th>
                  <th className="table-header sticky top-0 z-10">Status</th>
                  <th className="table-header sticky top-0 z-10">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredNotes.map((note) => (
                  <tr key={note.id} className="border-t">
                    <td className="table-cell font-medium">{note.noteNumber}</td>
                    <td className="table-cell">{new Date(note.noteDate).toLocaleDateString('en-GB')}</td>
                    <td className="table-cell">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        note.type === 'CREDIT_NOTE' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                      }`}>
                        {note.type === 'CREDIT_NOTE' ? 'CREDIT NOTE' : 'DEBIT NOTE'}
                      </span>
                    </td>
                    <td className="table-cell">{note.customer?.name}</td>
                    <td className="table-cell">
                      {note.referenceInvoice?.invoiceNumber || '-'}
                    </td>
                    <td className="table-cell">{formatCurrency(note.totalAmount)}</td>
                    <td className="table-cell">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        note.status === 'ACTIVE' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
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
                        <DownloadMenu getOpts={() => buildDownloadOpts(note.id)} />
                        <ShareMenu
                          onShare={(target) => handleShare(note.id, target)}
                          phone={note.customer?.phone}
                          email={note.customer?.email}
                          partyName={note.customer?.name}
                        />
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
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-6xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">{editingNote ? 'Edit Note' : 'Create New Note'}</h2>
                <button onClick={() => { setShowModal(false); resetForm(); }} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl">
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
                    <SearchableSelect
                      value={formData.customerId}
                      onChange={(id) => handlePartyChange(id)}
                      options={parties.map(p => ({ id: p.id, name: p.name }))}
                      placeholder="Select Party"
                      required
                    />
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
                    <DateInput
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
                    <div className="text-center py-8 bg-gray-50 dark:bg-gray-900/40 rounded-lg border-2 border-dashed">
                      <p className="text-gray-500 dark:text-gray-400 mb-2">No items added yet</p>
                      <button type="button" onClick={addNoteItem} className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300">
                        Click "+ Add Item" to add your first item
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {noteItems.map((item, index) => (
                        <div key={index} className="flex gap-3 items-end p-4 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
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

                          <div className="w-32">
                            <label className="label text-xs">HSN/SKU</label>
                            <input
                              type="text"
                              className="input"
                              value={item.hsnCode}
                              onChange={(e) => updateNoteItem(index, 'hsnCode', e.target.value)}
                              placeholder="HSN/SKU"
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Qty</label>
                            <NumberInput
                              className="input"
                              value={item.quantity}
                              onChange={(val) => updateNoteItem(index, 'quantity', val)}
                              min={1}
                              required
                            />
                          </div>

                          <div className="w-32">
                            <label className="label text-xs">Rate</label>
                            <NumberInput
                              className="input"
                              value={item.rate}
                              onChange={(val) => updateNoteItem(index, 'rate', val)}
                              min={0}
                              required
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Disc</label>
                            <NumberInput
                              className="input"
                              value={item.discount}
                              onChange={(val) => updateNoteItem(index, 'discount', val)}
                              min={0}
                            />
                          </div>

                          <div className="w-24">
                            <label className="label text-xs">Tax %</label>
                            <NumberInput
                              className="input"
                              value={item.taxRate}
                              onChange={(val) => updateNoteItem(index, 'taxRate', val)}
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
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                      placeholder="Internal notes..."
                    />
                  </div>

                  <div>
                    <label className="label">Terms & Conditions</label>
                    <textarea
                      className="input"
                      rows={3}
                      value={formData.termsConditions}
                      onChange={(e) => setFormData({ ...formData, termsConditions: e.target.value })}
                      placeholder="Terms that appear on note..."
                    />
                  </div>
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
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Note Details</h2>
                <button onClick={() => { setShowViewModal(false); setViewingNote(null); }} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl">
                  ×
                </button>
              </div>

              {/* Note Header */}
              <div className="grid grid-cols-2 gap-6 mb-6">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Note Number</p>
                  <p className="font-semibold text-lg">{viewingNote.noteNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Type</p>
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    viewingNote.type === 'CREDIT_NOTE' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                  }`}>
                    {viewingNote.type === 'CREDIT_NOTE' ? 'CREDIT NOTE' : 'DEBIT NOTE'}
                  </span>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Date</p>
                  <p className="font-medium">{new Date(viewingNote.noteDate).toLocaleDateString('en-GB')}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Status</p>
                  <span className={`px-2 py-1 rounded-full text-xs ${
                    viewingNote.status === 'ACTIVE' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                  }`}>
                    {viewingNote.status}
                  </span>
                </div>
              </div>

              {/* Party Info */}
              <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg mb-6">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Party</p>
                <p className="font-semibold">{viewingNote.customer?.name}</p>
                {viewingNote.customer?.phone && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingNote.customer.phone}</p>}
                {viewingNote.customer?.email && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingNote.customer.email}</p>}
                {viewingNote.customer?.billingAddress && <p className="text-sm text-gray-600 dark:text-gray-400">{viewingNote.customer.billingAddress}</p>}
              </div>

              {/* Reference Invoice */}
              {viewingNote.referenceInvoice && (
                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg mb-6">
                  <p className="text-sm text-blue-600 dark:text-blue-400 mb-1">Reference Invoice</p>
                  <p className="font-semibold">{viewingNote.referenceInvoice.invoiceNumber}</p>
                  <div className="flex gap-4 mt-1 text-sm text-blue-700 dark:text-blue-300">
                    <span>Total: {formatCurrency(viewingNote.referenceInvoice.totalAmount)}</span>
                    <span>Balance Due: {formatCurrency(viewingNote.referenceInvoice.balanceDue)}</span>
                  </div>
                </div>
              )}

              {/* Reason */}
              {viewingNote.reason && (
                <div className="mb-6">
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Reason</p>
                  <p className="text-gray-700 dark:text-gray-300">{viewingNote.reason}</p>
                </div>
              )}

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
                      <th className="table-header sticky top-0 z-10">Discount</th>
                      <th className="table-header sticky top-0 z-10">Tax %</th>
                      <th className="table-header sticky top-0 z-10">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingNote.items?.map((item, index) => (
                      <tr key={index} className="border-t">
                        <td className="table-cell">{item.item?.name}</td>
                        <td className="table-cell text-gray-500">{item.hsnCode || item.item?.hsnCode || item.item?.skuHsn || '-'}</td>
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
              <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg mb-6">
                <div className="space-y-2 max-w-sm ml-auto">
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Subtotal:</span>
                    <span className="font-medium">{formatCurrency(viewingNote.subtotal || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600 dark:text-gray-400">Tax:</span>
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
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Notes</p>
                  <p className="text-gray-700 dark:text-gray-300">{viewingNote.notes}</p>
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
                <ShareMenu
                  variant="button"
                  onShare={(target) => handleShare(viewingNote.id, target)}
                  phone={viewingNote.customer?.phone}
                  email={viewingNote.customer?.email}
                  partyName={viewingNote.customer?.name}
                />
                <DownloadMenu
                  variant="button"
                  getOpts={() => buildDownloadOpts(viewingNote.id)}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default CreditNotes
