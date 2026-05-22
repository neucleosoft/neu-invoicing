import { useEffect, useState, useMemo } from 'react'
import { Party } from '../types'
import { formatCurrency } from '../utils/currency'
import { validateGSTIN, INDIAN_STATE_CODES } from '../utils/gstValidation'
import NumberInput from '../components/NumberInput'
import { useToast } from '../components/ToastContext'
import { useConfirm } from '../components/ConfirmDialogContext'
import EmptyState from '../components/EmptyState'
import { TableSkeleton } from '../components/Skeleton'
import SortHeader from '../components/SortHeader'
import { useSortable } from '../hooks/useSortable'
import { Users, Search as SearchIcon, Loader2 } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

// Avatar color palette (6 colors)
const AVATAR_COLORS = [
  '#4F46E5', // indigo
  '#0891B2', // cyan
  '#059669', // emerald
  '#D97706', // amber
  '#DC2626', // red
  '#7C3AED', // violet
]

function hashName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash)
}

function getAvatarColor(name: string): string {
  return AVATAR_COLORS[hashName(name) % AVATAR_COLORS.length]
}

const Customers = () => {
  const [customers, setCustomers] = useState<Party[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Party | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    billingAddress: '',
    shippingAddress: '',
    taxId: '',
    openingBalance: 0,
    // GST fields
    legalName: '',
    tradeName: '',
    stateCode: '',
    stateName: '',
    city: '',
    pincode: '',
    gstStatus: '',
    gstType: 'REGULAR'
  })

  // GST Validation state (local validation only - free, no API)
  const [gstValidation, setGstValidation] = useState<{ valid: boolean; error?: string; stateCode?: string; stateName?: string } | null>(null)
  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    loadCustomers()
  }, [])

  const location = useLocation()
  const navigate = useNavigate()

  // Auto-open the create modal when navigated here from Dashboard's Quick Actions
  // tile ("Add Customer").
  useEffect(() => {
    if ((location.state as { openNew?: boolean } | null)?.openNew) {
      handleAddCustomer()
      navigate(location.pathname, { replace: true, state: null })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state])

  // Validate GSTIN as user types
  useEffect(() => {
    if (formData.taxId.length > 0) {
      const result = validateGSTIN(formData.taxId)
      setGstValidation(result)
    } else {
      setGstValidation(null)
    }
  }, [formData.taxId])

  const loadCustomers = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.customer.getAll()
      if (result.success && result.data) {
        setCustomers(result.data)
      }
    } finally {
      setLoading(false)
    }
  }

  // Filter customers by search query
  const filteredCustomers = useMemo(() => {
    if (!searchQuery.trim()) return customers
    const q = searchQuery.toLowerCase()
    return customers.filter((customer) =>
      customer.name.toLowerCase().includes(q) ||
      (customer.phone && customer.phone.toLowerCase().includes(q)) ||
      (customer.email && customer.email.toLowerCase().includes(q)) ||
      (customer.taxId && customer.taxId.toLowerCase().includes(q))
    )
  }, [customers, searchQuery])

  const { sortedItems: sortedCustomers, sortKey, sortDir, toggleSort } = useSortable(filteredCustomers, [
    { key: 'name', accessor: (p) => p.name },
    { key: 'type', accessor: (p) => p.type },
    { key: 'taxId', accessor: (p) => p.taxId || '' },
    { key: 'phone', accessor: (p) => p.phone || '' },
    { key: 'state', accessor: (p) => p.stateName || p.stateCode || '' },
    { key: 'balance', accessor: (p) => p.currentBalance },
  ])

  // Auto-fill state when GSTIN is validated
  useEffect(() => {
    if (gstValidation?.valid && gstValidation.stateCode && gstValidation.stateName) {
      setFormData(prev => ({
        ...prev,
        stateCode: gstValidation.stateCode || prev.stateCode,
        stateName: gstValidation.stateName || prev.stateName
      }))
    }
  }, [gstValidation])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    const baseCustomerData = {
      name: formData.name,
      phone: formData.phone,
      email: formData.email,
      billingAddress: formData.billingAddress,
      shippingAddress: formData.shippingAddress,
      taxId: formData.taxId,
      openingBalance: formData.openingBalance,
      // GST fields
      legalName: formData.legalName || undefined,
      tradeName: formData.tradeName || undefined,
      stateCode: formData.stateCode || undefined,
      stateName: formData.stateName || undefined,
      city: formData.city || undefined,
      pincode: formData.pincode || undefined,
      gstStatus: formData.gstStatus || undefined,
      gstType: formData.gstType,
      fetchedFromGst: formData.legalName ? true : false,
      lastGstFetch: formData.legalName ? new Date().toISOString() : undefined
    }

    try {
      if (editingCustomer) {
        await window.electronAPI.customer.update(editingCustomer.id, {
          ...baseCustomerData,
          type: 'CUSTOMER'
        })
      } else {
        await window.electronAPI.customer.create({
          ...baseCustomerData,
          type: 'CUSTOMER'
        })
      }
      setShowModal(false)
      setEditingCustomer(null)
      resetForm()
      loadCustomers()
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = (customer: Party) => {
    setEditingCustomer(customer)
    setFormData({
      name: customer.name,
      phone: customer.phone || '',
      email: customer.email || '',
      billingAddress: customer.billingAddress || '',
      shippingAddress: customer.shippingAddress || '',
      taxId: customer.taxId || '',
      openingBalance: customer.openingBalance,
      legalName: customer.legalName || '',
      tradeName: customer.tradeName || '',
      stateCode: customer.stateCode || '',
      stateName: customer.stateName || '',
      city: customer.city || '',
      pincode: customer.pincode || '',
      gstStatus: customer.gstStatus || '',
      gstType: customer.gstType || 'REGULAR'
    })
    setGstValidation(null)
    setShowModal(true)
  }

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({ message: 'Are you sure you want to delete this customer?', danger: true })
    if (confirmed) {
      const result = await window.electronAPI.customer.delete(id)
      if (result.success) {
        loadCustomers()
      } else {
        toast.error('Failed to delete customer: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      phone: '',
      email: '',
      billingAddress: '',
      shippingAddress: '',
      taxId: '',
      openingBalance: 0,
      legalName: '',
      tradeName: '',
      stateCode: '',
      stateName: '',
      city: '',
      pincode: '',
      gstStatus: '',
      gstType: 'REGULAR'
    })
    setGstValidation(null)
  }

  const handleAddCustomer = () => {
    resetForm()
    setEditingCustomer(null)
    setShowModal(true)
  }

  // Customer balance: positive = they owe us (To Collect), negative = we owe them (To Pay)
  const getBalanceDisplay = (customer: Party) => {
    const balance = customer.currentBalance

    if (balance === 0) {
      return { label: '', color: 'text-gray-500 dark:text-gray-400', arrow: '' }
    }

    if (balance > 0) {
      return { label: 'To Collect', color: 'text-green-600 dark:text-green-400', arrow: '↑' }
    } else {
      return { label: 'To Pay', color: 'text-red-600 dark:text-red-400', arrow: '↓' }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Customers</h1>
        <div className="flex gap-3">
          <button onClick={handleAddCustomer} className="btn btn-primary">
            + Add Customer
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, phone, email, or GSTIN..."
          className="input w-full pl-10"
        />
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {/* Customers Table */}
      <div className="card">
        {loading ? (
          <TableSkeleton rows={6} columns={7} />
        ) : filteredCustomers.length === 0 ? (
          searchQuery.trim() ? (
            <EmptyState
              icon={SearchIcon}
              title="No customers match your search"
              description={`Nothing matched "${searchQuery}". Try a different name, phone, or GSTIN.`}
            />
          ) : (
            <EmptyState
              icon={Users}
              title="No customers yet"
              description="Add customers to start creating invoices, quotations, and statements."
              action={{
                label: '+ Add your first customer',
                onClick: handleAddCustomer,
              }}
            />
          )
        ) : (
        <div className="overflow-auto max-h-[calc(100vh-280px)]">
          <table className="table">
            <thead>
              <tr>
                <SortHeader label="Name" sortKey="name" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Type" sortKey="type" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                <SortHeader label="GSTIN" sortKey="taxId" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Phone" sortKey="phone" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                <SortHeader label="State" sortKey="state" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                <SortHeader label="Balance" sortKey="balance" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
                <th className="table-header sticky top-0 z-10">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedCustomers.map((customer) => {
                const balanceDisplay = getBalanceDisplay(customer)
                return (
                  <tr key={customer.id} className="border-t">
                    <td className="table-cell">
                      <div className="flex items-center gap-3">
                        {/* Customer Avatar */}
                        <div
                          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                          style={{ backgroundColor: getAvatarColor(customer.name) }}
                        >
                          {customer.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span className="font-medium">{customer.name}</span>
                          {customer.legalName && customer.legalName !== customer.name && (
                            <span className="block text-xs text-gray-500 dark:text-gray-400">{customer.legalName}</span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="table-cell">
                      <span className="px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                        {customer.type}
                      </span>
                    </td>
                    <td className="table-cell">
                      {customer.taxId ? (
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-sm">{customer.taxId}</span>
                          {customer.gstStatus === 'Cancelled' && (
                            <span className="px-1 py-0.5 rounded text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
                              Cancelled
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">-</span>
                      )}
                    </td>
                    <td className="table-cell">{customer.phone || '-'}</td>
                    <td className="table-cell">
                      {customer.stateName || customer.stateCode || '-'}
                    </td>
                    <td className="table-cell">
                      <div className={`flex items-center gap-1 ${balanceDisplay.color}`}>
                        <span className="font-medium">
                          {balanceDisplay.arrow && <span className="mr-0.5">{balanceDisplay.arrow}</span>}
                          {formatCurrency(Math.abs(customer.currentBalance))}
                        </span>
                        {balanceDisplay.label && (
                          <span className="text-xs ml-1">({balanceDisplay.label})</span>
                        )}
                      </div>
                    </td>
                    <td className="table-cell">
                      <button
                        onClick={() => navigate('/customer-ledger', { state: { party: customer } })}
                        className="text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300 mr-3"
                      >
                        Ledger
                      </button>
                      <button onClick={() => handleEdit(customer)} className="text-primary-600 hover:text-primary-700 mr-3">
                        Edit
                      </button>
                      <button onClick={() => handleDelete(customer.id)} className="text-red-600 hover:text-red-700">
                        Delete
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold">{editingCustomer ? 'Edit' : 'Add'} Customer</h2>
              <button
                type="button"
                onClick={() => { setShowModal(false); setEditingCustomer(null); resetForm() }}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">

              {/* GST Lookup Section */}
              <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                <label className="label font-semibold">GSTIN (GST Number)</label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={formData.taxId}
                      onChange={(e) => setFormData({ ...formData, taxId: e.target.value.toUpperCase() })}
                      placeholder="e.g., 27AABCU9603R1ZM"
                      maxLength={15}
                      className={`input font-mono ${
                        gstValidation?.valid === false ? 'border-red-500' :
                        gstValidation?.valid === true ? 'border-green-500' : ''
                      }`}
                    />
                    {/* Validation feedback */}
                    {gstValidation && (
                      <div className={`text-xs mt-1 ${gstValidation.valid ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {gstValidation.valid
                          ? `Valid format - ${gstValidation.stateName}`
                          : gstValidation.error}
                      </div>
                    )}
                  </div>
                </div>

                {/* State auto-selection when GSTIN is valid */}
                {gstValidation?.valid && gstValidation.stateCode && (
                  <div className="mt-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-blue-700 dark:text-blue-300 text-sm flex items-center gap-2">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span>State: <strong>{gstValidation.stateName}</strong> (Code: {gstValidation.stateCode})</span>
                  </div>
                )}
              </div>

              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Display Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="input"
                    placeholder="Business/Person name"
                  />
                </div>
                <div>
                  <label className="label">Type</label>
                  <div className="input flex items-center bg-gray-50 dark:bg-gray-900/40">
                    Customer
                  </div>
                </div>
              </div>

              {/* Contact Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Phone</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="input"
                    placeholder="+91 9876543210"
                  />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="input"
                    placeholder="business@example.com"
                  />
                </div>
              </div>

              {/* Location Info */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">State</label>
                  <select
                    value={formData.stateCode}
                    onChange={(e) => {
                      const code = e.target.value
                      const name = INDIAN_STATE_CODES[code] || ''
                      setFormData({ ...formData, stateCode: code, stateName: name })
                    }}
                    className="input"
                  >
                    <option value="">Select State</option>
                    {Object.entries(INDIAN_STATE_CODES).map(([code, name]) => (
                      <option key={code} value={code}>
                        {code} - {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">City</label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                    className="input"
                    placeholder="City name"
                  />
                </div>
                <div>
                  <label className="label">Pincode</label>
                  <input
                    type="text"
                    value={formData.pincode}
                    onChange={(e) => setFormData({ ...formData, pincode: e.target.value })}
                    className="input"
                    maxLength={6}
                    placeholder="400001"
                  />
                </div>
              </div>

              {/* Addresses */}
              <div>
                <label className="label">Billing Address</label>
                <textarea
                  value={formData.billingAddress}
                  onChange={(e) => setFormData({ ...formData, billingAddress: e.target.value })}
                  rows={2}
                  className="input"
                  placeholder="Complete billing address"
                />
              </div>

              <div>
                <label className="label">Shipping Address</label>
                <textarea
                  value={formData.shippingAddress}
                  onChange={(e) => setFormData({ ...formData, shippingAddress: e.target.value })}
                  rows={2}
                  className="input"
                  placeholder="Complete shipping address (if different)"
                />
              </div>

              {/* GST Type */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">GST Registration Type</label>
                  <select
                    value={formData.gstType}
                    onChange={(e) => setFormData({ ...formData, gstType: e.target.value })}
                    className="input"
                  >
                    <option value="REGULAR">Regular</option>
                    <option value="COMPOSITION">Composition</option>
                    <option value="UNREGISTERED">Unregistered</option>
                    <option value="CONSUMER">Consumer</option>
                    <option value="SEZ">SEZ</option>
                    <option value="DEEMED_EXPORT">Deemed Export</option>
                  </select>
                </div>
                {!editingCustomer && (
                  <div>
                    <label className="label">Opening Balance</label>
                    <NumberInput
                      className="input"
                      value={formData.openingBalance}
                      onChange={(val) => setFormData({ ...formData, openingBalance: val })}
                      placeholder="0.00"
                    />
                  </div>
                )}
              </div>

              {/* Form Actions */}
              <div className="flex justify-end space-x-3 pt-4 border-t">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setEditingCustomer(null); resetForm() }}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary inline-flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingCustomer
                    ? (submitting ? 'Updating…' : 'Update Customer')
                    : (submitting ? 'Creating…' : 'Create Customer')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Customers
