import { useEffect, useState, useMemo } from 'react'
import { Item } from '../types'
import { formatCurrency } from '../utils/currency'
import NumberInput from '../components/NumberInput'
import { useToast } from '../components/ToastContext'
import { useConfirm } from '../components/ConfirmDialogContext'
import EmptyState from '../components/EmptyState'
import { TableSkeleton } from '../components/Skeleton'
import { Package, Search as SearchIcon, Loader2 } from 'lucide-react'

const Items = () => {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    skuHsn: '',
    type: 'PRODUCT' as 'PRODUCT' | 'SERVICE',
    unit: 'pcs',
    salePrice: 0,
    purchasePrice: 0,
    taxRate: 0,
    trackStock: false,
    currentStock: 0,
    lowStockWarning: 10
  })
  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    loadItems()
  }, [])

  const loadItems = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.item.getAll()
      if (result.success && result.data) {
        setItems(result.data)
      }
    } finally {
      setLoading(false)
    }
  }

  // Filter items by search query
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items
    const q = searchQuery.toLowerCase()
    return items.filter((item) =>
      item.name.toLowerCase().includes(q) ||
      (item.skuHsn && item.skuHsn.toLowerCase().includes(q)) ||
      ((item as any).hsnCode && (item as any).hsnCode.toLowerCase().includes(q))
    )
  }, [items, searchQuery])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      if (editingItem) {
        await window.electronAPI.item.update(editingItem.id, formData)
      } else {
        await window.electronAPI.item.create(formData)
      }
      setShowModal(false)
      setEditingItem(null)
      resetForm()
      loadItems()
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = (item: Item) => {
    setEditingItem(item)
    setFormData({
      name: item.name,
      skuHsn: item.skuHsn || '',
      type: item.type,
      unit: item.unit,
      salePrice: item.salePrice,
      purchasePrice: item.purchasePrice,
      taxRate: item.taxRate,
      trackStock: item.trackStock,
      currentStock: item.currentStock,
      lowStockWarning: item.lowStockWarning
    })
    setShowModal(true)
  }

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({ message: 'Are you sure you want to delete this item?', danger: true })
    if (confirmed) {
      const result = await window.electronAPI.item.delete(id)
      if (result.success) {
        loadItems()
      } else {
        toast.error('Failed to delete item: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      skuHsn: '',
      type: 'PRODUCT',
      unit: 'pcs',
      salePrice: 0,
      purchasePrice: 0,
      taxRate: 0,
      trackStock: false,
      currentStock: 0,
      lowStockWarning: 10
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Items & Inventory</h1>
        <button onClick={() => setShowModal(true)} className="btn btn-primary">
          + Add Item
        </button>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by name, SKU/HSN, or HSN code..."
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

      {/* Items Table */}
      <div className="card">
        {loading ? (
          <TableSkeleton rows={6} columns={7} />
        ) : filteredItems.length === 0 ? (
          searchQuery.trim() ? (
            <EmptyState
              icon={SearchIcon}
              title="No items match your search"
              description={`Nothing matched "${searchQuery}".`}
            />
          ) : (
            <EmptyState
              icon={Package}
              title="No items yet"
              description="Add products and services to your catalog to use them on invoices and bills."
              action={{ label: '+ Add your first item', onClick: () => setShowModal(true) }}
            />
          )
        ) : (
        <div className="overflow-auto max-h-[calc(100vh-280px)]">
          <table className="table">
            <thead>
              <tr>
                <th className="table-header sticky top-0 z-10">Name</th>
                <th className="table-header sticky top-0 z-10">SKU/HSN</th>
                <th className="table-header sticky top-0 z-10">Type</th>
                <th className="table-header sticky top-0 z-10">Sale Price</th>
                <th className="table-header sticky top-0 z-10">Stock</th>
                <th className="table-header sticky top-0 z-10">Unit</th>
                <th className="table-header sticky top-0 z-10">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.id} className="border-t">
                  <td className="table-cell font-medium">{item.name}</td>
                  <td className="table-cell">{item.skuHsn || '-'}</td>
                  <td className="table-cell">
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      item.type === 'PRODUCT' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                    }`}>
                      {item.type}
                    </span>
                  </td>
                  <td className="table-cell">{formatCurrency(item.salePrice)}</td>
                  <td className="table-cell">
                    {item.trackStock ? (
                      <span className={item.currentStock <= item.lowStockWarning ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
                        {item.currentStock}
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    )}
                  </td>
                  <td className="table-cell">{item.unit}</td>
                  <td className="table-cell">
                    <button onClick={() => handleEdit(item)} className="text-primary-600 hover:text-primary-700 mr-3">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(item.id)} className="text-red-600 hover:text-red-700">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-2xl font-bold mb-4">{editingItem ? 'Edit' : 'Add'} Item</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Item Name *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  className="input"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">SKU/HSN Code</label>
                  <input
                    type="text"
                    value={formData.skuHsn}
                    onChange={(e) => setFormData({ ...formData, skuHsn: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Type *</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                    className="input"
                  >
                    <option value="PRODUCT">Product</option>
                    <option value="SERVICE">Service</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">Sale Price *</label>
                  <NumberInput
                    className="input"
                    value={formData.salePrice}
                    onChange={(val) => setFormData({ ...formData, salePrice: val })}
                    min={0}
                    required
                  />
                </div>
                <div>
                  <label className="label">Purchase Price</label>
                  <NumberInput
                    className="input"
                    value={formData.purchasePrice}
                    onChange={(val) => setFormData({ ...formData, purchasePrice: val })}
                    min={0}
                  />
                </div>
                <div>
                  <label className="label">Tax Rate (%)</label>
                  <NumberInput
                    className="input"
                    value={formData.taxRate}
                    onChange={(val) => setFormData({ ...formData, taxRate: val })}
                    min={0}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Unit</label>
                  <select
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    className="input"
                  >
                    <option value="pcs">Pieces (pcs)</option>
                    <option value="kg">Kilograms (kg)</option>
                    <option value="g">Grams (g)</option>
                    <option value="l">Liters (l)</option>
                    <option value="m">Meters (m)</option>
                    <option value="hrs">Hours (hrs)</option>
                    <option value="box">Box</option>
                    <option value="carton">Carton</option>
                  </select>
                </div>
                <div className="flex items-center">
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.trackStock}
                      onChange={(e) => setFormData({ ...formData, trackStock: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <span className="text-sm font-medium">Track Stock</span>
                  </label>
                </div>
              </div>

              {formData.trackStock && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Current Stock</label>
                    <NumberInput
                      className="input"
                      value={formData.currentStock}
                      onChange={(val) => setFormData({ ...formData, currentStock: val })}
                      min={0}
                    />
                  </div>
                  <div>
                    <label className="label">Low Stock Warning</label>
                    <NumberInput
                      className="input"
                      value={formData.lowStockWarning}
                      onChange={(val) => setFormData({ ...formData, lowStockWarning: val })}
                      min={0}
                    />
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-3">
                <button type="button" onClick={() => { setShowModal(false); setEditingItem(null); resetForm() }} className="btn btn-secondary">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary inline-flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingItem ? (submitting ? 'Updating…' : 'Update') : (submitting ? 'Creating…' : 'Create')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Items
