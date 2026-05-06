import { useEffect, useMemo, useState } from 'react'
import { Item, Supplier, SupplierItem } from '../types'
import NumberInput from '../components/NumberInput'
import { useToast } from '../components/ToastContext'
import { useConfirm } from '../components/ConfirmDialogContext'
import EmptyState from '../components/EmptyState'
import { TableSkeleton } from '../components/Skeleton'
import { Package, Search as SearchIcon, Loader2 } from 'lucide-react'

const emptyForm = {
  supplierId: '',
  name: '',
  hsnCode: '',
  unit: 'pcs',
  lastPurchasePrice: 0,
  defaultTaxRate: 0,
  linkedItemId: '',
}

const SupplierItems = () => {
  const [items, setItems] = useState<SupplierItem[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [linkableItems, setLinkableItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [supplierFilter, setSupplierFilter] = useState<string>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingItem, setEditingItem] = useState<SupplierItem | null>(null)
  const [formData, setFormData] = useState(emptyForm)

  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    loadAll()
  }, [])

  const loadAll = async () => {
    setLoading(true)
    try {
      const [itemsRes, suppliersRes, sellableRes] = await Promise.all([
        window.electronAPI.supplierItem.getAll(),
        window.electronAPI.supplier.getAll(),
        window.electronAPI.item.getAll(),
      ])
      if (itemsRes.success && itemsRes.data) setItems(itemsRes.data)
      if (suppliersRes.success && suppliersRes.data) setSuppliers(suppliersRes.data)
      if (sellableRes.success && sellableRes.data) setLinkableItems(sellableRes.data)
    } finally {
      setLoading(false)
    }
  }

  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name || '—'

  const filteredItems = useMemo(() => {
    let list = items
    if (supplierFilter !== 'ALL') {
      list = list.filter((it) => it.supplierId === supplierFilter)
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter((it) =>
        it.name.toLowerCase().includes(q) ||
        supplierName(it.supplierId).toLowerCase().includes(q) ||
        (it.hsnCode && it.hsnCode.toLowerCase().includes(q)) ||
        (it.linkedItem?.name && it.linkedItem.name.toLowerCase().includes(q))
      )
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, suppliers, supplierFilter, searchQuery])

  const resetForm = () => {
    setFormData(emptyForm)
    setEditingItem(null)
  }

  const handleAdd = () => {
    resetForm()
    setShowModal(true)
  }

  const handleEdit = (item: SupplierItem) => {
    setEditingItem(item)
    setFormData({
      supplierId: item.supplierId,
      name: item.name,
      hsnCode: item.hsnCode || '',
      unit: item.unit,
      lastPurchasePrice: item.lastPurchasePrice,
      defaultTaxRate: item.defaultTaxRate,
      linkedItemId: item.linkedItemId || '',
    })
    setShowModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.supplierId) {
      toast.info('Please pick a supplier')
      return
    }
    if (!formData.name.trim()) {
      toast.info('Item name is required')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        supplierId: formData.supplierId,
        name: formData.name.trim(),
        hsnCode: formData.hsnCode.trim() || undefined,
        unit: formData.unit.trim() || 'pcs',
        lastPurchasePrice: formData.lastPurchasePrice,
        defaultTaxRate: formData.defaultTaxRate,
        linkedItemId: formData.linkedItemId || undefined,
      }
      const result = editingItem
        ? await window.electronAPI.supplierItem.update(editingItem.id, payload)
        : await window.electronAPI.supplierItem.create(payload)
      if (result.success) {
        toast.success(editingItem ? 'Item updated' : 'Item added to catalog')
        setShowModal(false)
        resetForm()
        loadAll()
      } else {
        toast.error(result.error || 'Failed to save item')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (item: SupplierItem) => {
    const confirmed = await confirm({
      message: `Delete "${item.name}" from ${supplierName(item.supplierId)}'s catalog?`,
      danger: true,
    })
    if (!confirmed) return
    const result = await window.electronAPI.supplierItem.delete(item.id)
    if (result.success) {
      toast.success('Item removed')
      loadAll()
    } else {
      toast.error(result.error || 'Could not delete item')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Supplier Items</h1>
        <button onClick={handleAdd} className="btn btn-primary">+ Add Supplier Item</button>
      </div>

      {/* Filter + Search */}
      <div className="flex gap-3 flex-wrap">
        <select
          className="input max-w-xs"
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
        >
          <option value="ALL">All suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <div className="relative flex-1 min-w-[240px]">
          <input
            type="text"
            className="input w-full pl-10"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by item name, supplier, HSN, or linked item…"
          />
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500" />
        </div>
      </div>

      {/* Table */}
      <div className="card">
        {loading ? (
          <TableSkeleton rows={6} columns={7} />
        ) : filteredItems.length === 0 ? (
          searchQuery.trim() || supplierFilter !== 'ALL' ? (
            <EmptyState
              icon={SearchIcon}
              title="No supplier items match your filters"
              description="Try a different supplier or clear the search."
            />
          ) : (
            <EmptyState
              icon={Package}
              title="No supplier items yet"
              description="Items appear here automatically when you save bills with AI extraction, or you can add one manually now."
              action={{ label: '+ Add your first supplier item', onClick: handleAdd }}
            />
          )
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <table className="table">
              <thead>
                <tr>
                  <th className="table-header sticky top-0 z-10">Supplier</th>
                  <th className="table-header sticky top-0 z-10">Name</th>
                  <th className="table-header sticky top-0 z-10">HSN</th>
                  <th className="table-header sticky top-0 z-10">Unit</th>
                  <th className="table-header sticky top-0 z-10">Last price</th>
                  <th className="table-header sticky top-0 z-10">Tax %</th>
                  <th className="table-header sticky top-0 z-10">Linked sellable item</th>
                  <th className="table-header sticky top-0 z-10">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="table-cell">{supplierName(item.supplierId)}</td>
                    <td className="table-cell font-medium">{item.name}</td>
                    <td className="table-cell text-sm">{item.hsnCode || '-'}</td>
                    <td className="table-cell">{item.unit}</td>
                    <td className="table-cell">{item.lastPurchasePrice.toFixed(2)}</td>
                    <td className="table-cell">{item.defaultTaxRate}%</td>
                    <td className="table-cell text-sm">
                      {item.linkedItem?.name ? (
                        <span className="text-emerald-700 dark:text-emerald-400">✓ {item.linkedItem.name}</span>
                      ) : (
                        <span className="text-gray-400 dark:text-gray-500">—</span>
                      )}
                    </td>
                    <td className="table-cell">
                      <button onClick={() => handleEdit(item)} className="text-primary-600 hover:text-primary-700 mr-3">
                        Edit
                      </button>
                      <button onClick={() => handleDelete(item)} className="text-red-600 hover:text-red-700">
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

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-2xl font-bold">{editingItem ? 'Edit Supplier Item' : 'Add Supplier Item'}</h2>
              <button
                type="button"
                onClick={() => { setShowModal(false); resetForm() }}
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl leading-none"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div>
                <label className="label">Supplier *</label>
                <select
                  className="input"
                  value={formData.supplierId}
                  onChange={(e) => setFormData({ ...formData, supplierId: e.target.value })}
                  // Locking supplier on edit because moving an item between suppliers would
                  // also force linkedItem reassessment + invalidate any past-bill foreign keys.
                  disabled={!!editingItem}
                  required
                >
                  <option value="">Pick a supplier…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="label">Name *</label>
                  <input
                    type="text"
                    className="input"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder='e.g., "Tube Light 36W"'
                    required
                  />
                </div>
                <div>
                  <label className="label">HSN / SAC</label>
                  <input
                    type="text"
                    className="input"
                    value={formData.hsnCode}
                    onChange={(e) => setFormData({ ...formData, hsnCode: e.target.value })}
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="label">Unit</label>
                  <input
                    type="text"
                    className="input"
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    placeholder="pcs, kg, box…"
                  />
                </div>
                <div>
                  <label className="label">Last purchase price</label>
                  <NumberInput
                    className="input"
                    value={formData.lastPurchasePrice}
                    onChange={(v) => setFormData({ ...formData, lastPurchasePrice: v })}
                    min={0}
                  />
                </div>
                <div>
                  <label className="label">Default tax %</label>
                  <NumberInput
                    className="input"
                    value={formData.defaultTaxRate}
                    onChange={(v) => setFormData({ ...formData, defaultTaxRate: v })}
                    min={0}
                  />
                </div>
                <div className="col-span-2">
                  <label className="label">Link to your sellable item (optional)</label>
                  <select
                    className="input"
                    value={formData.linkedItemId}
                    onChange={(e) => setFormData({ ...formData, linkedItemId: e.target.value })}
                  >
                    <option value="">None — no stock tracking on purchase</option>
                    {linkableItems.map((it) => (
                      <option key={it.id} value={it.id}>{it.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Link only if this is the same SKU you also sell — purchases will then bump its stock.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-gray-200 dark:border-gray-700">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); resetForm() }}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="btn btn-primary inline-flex items-center gap-2"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editingItem
                    ? (submitting ? 'Updating…' : 'Update item')
                    : (submitting ? 'Adding…' : 'Add to catalog')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default SupplierItems
