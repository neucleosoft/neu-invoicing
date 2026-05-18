import { useEffect, useState } from 'react'
import { Package } from 'lucide-react'
import { Supplier, SupplierItem, Item } from '../types'
import NumberInput from './NumberInput'
import { useToast } from './ToastContext'
import { useConfirm } from './ConfirmDialogContext'
import { TableSkeleton } from './Skeleton'
import EmptyState from './EmptyState'

interface SupplierItemsModalProps {
  supplier: Supplier
  onClose: () => void
}

const emptyForm = {
  name: '',
  hsnCode: '',
  unit: 'pcs',
  lastPurchasePrice: 0,
  defaultTaxRate: 0,
  linkedItemId: '',
}

const SupplierItemsModal = ({ supplier, onClose }: SupplierItemsModalProps) => {
  const [items, setItems] = useState<SupplierItem[]>([])
  const [loading, setLoading] = useState(true)
  const [linkableItems, setLinkableItems] = useState<Item[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState(emptyForm)
  const [submitting, setSubmitting] = useState(false)

  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    loadItems()
    loadLinkableItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier.id])

  const loadItems = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.supplierItem.getAll(supplier.id)
      if (result.success && result.data) {
        setItems(result.data)
      }
    } finally {
      setLoading(false)
    }
  }

  const loadLinkableItems = async () => {
    const result = await window.electronAPI.item.getAll()
    if (result.success && result.data) {
      setLinkableItems(result.data)
    }
  }

  const handleStartAdd = () => {
    setFormData(emptyForm)
    setEditingId(null)
    setShowForm(true)
  }

  const handleStartEdit = (item: SupplierItem) => {
    setFormData({
      name: item.name,
      hsnCode: item.hsnCode || '',
      unit: item.unit,
      lastPurchasePrice: item.lastPurchasePrice,
      defaultTaxRate: item.defaultTaxRate,
      linkedItemId: item.linkedItemId || '',
    })
    setEditingId(item.id)
    setShowForm(true)
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingId(null)
    setFormData(emptyForm)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim()) {
      toast.info('Item name is required')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        supplierId: supplier.id,
        name: formData.name.trim(),
        hsnCode: formData.hsnCode.trim() || undefined,
        unit: formData.unit.trim() || 'pcs',
        lastPurchasePrice: formData.lastPurchasePrice,
        defaultTaxRate: formData.defaultTaxRate,
        // Empty string in the select means "no link" — backend wants null/undefined.
        linkedItemId: formData.linkedItemId || undefined,
      }
      const result = editingId
        ? await window.electronAPI.supplierItem.update(editingId, payload)
        : await window.electronAPI.supplierItem.create(payload)
      if (result.success) {
        toast.success(editingId ? 'Item updated' : 'Item added to catalog')
        handleCancel()
        loadItems()
      } else {
        toast.error(result.error || 'Failed to save item')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (item: SupplierItem) => {
    const confirmed = await confirm({
      message: `Delete "${item.name}" from ${supplier.name}'s catalog?`,
      danger: true,
    })
    if (!confirmed) return
    const result = await window.electronAPI.supplierItem.delete(item.id)
    if (result.success) {
      toast.success('Item removed')
      loadItems()
    } else {
      toast.error(result.error || 'Could not delete item')
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-5xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-2xl font-bold">{supplier.name}</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">Items catalog</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {!showForm && (
            <div className="flex justify-end mb-4">
              <button onClick={handleStartAdd} className="btn btn-primary text-sm">
                + Add item
              </button>
            </div>
          )}

          {showForm && (
            <form
              onSubmit={handleSubmit}
              className="mb-6 p-4 rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 space-y-3"
            >
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
                    autoFocus
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
                      <option key={it.id} value={it.id}>
                        {it.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Link only if this is the same SKU you also sell — purchases will then bump its stock.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                <button type="button" onClick={handleCancel} className="btn btn-secondary text-sm">
                  Cancel
                </button>
                <button type="submit" disabled={submitting} className="btn btn-primary text-sm">
                  {submitting ? 'Saving…' : editingId ? 'Save changes' : 'Add to catalog'}
                </button>
              </div>
            </form>
          )}

          {loading ? (
            <TableSkeleton rows={4} columns={6} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Package}
              title="No items yet"
              description={
                showForm
                  ? 'Fill the form above to add this supplier\u2019s first item.'
                  : 'Items appear here as you save bills from this supplier (AI extraction creates them automatically). You can also add one manually.'
              }
              action={showForm ? undefined : { label: '+ Add item manually', onClick: handleStartAdd }}
            />
          ) : (
            <div className="overflow-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="table-header">Name</th>
                    <th className="table-header">HSN</th>
                    <th className="table-header">Unit</th>
                    <th className="table-header">Last price</th>
                    <th className="table-header">Tax %</th>
                    <th className="table-header">Linked sellable item</th>
                    <th className="table-header">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-t">
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
                        <button onClick={() => handleStartEdit(item)} className="text-primary-600 hover:text-primary-700 mr-3">
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
      </div>
    </div>
  )
}

export default SupplierItemsModal
