import { useEffect, useState } from 'react'
import { PaymentTransaction } from '../types'
import { formatCurrency } from '../utils/currency'
import NumberInput from '../components/NumberInput'
import DateInput from '../components/DateInput'
import { useToast } from '../components/ToastContext'
import { useConfirm } from '../components/ConfirmDialogContext'
import SearchableSelect from '../components/SearchableSelect'

interface Party {
  id: string
  name: string
  type: string
  currentBalance: number
}

const Payments = () => {
  const [payments, setPayments] = useState<PaymentTransaction[]>([])
  const [filter, setFilter] = useState<'ALL' | 'PAYMENT_IN' | 'PAYMENT_OUT'>('ALL')
  const [showModal, setShowModal] = useState(false)
  const [paymentType, setPaymentType] = useState<'PAYMENT_IN' | 'PAYMENT_OUT'>('PAYMENT_IN')
  const [parties, setParties] = useState<Party[]>([])
  // When set, the modal is editing this payment instead of creating a new one.
  const [editingPayment, setEditingPayment] = useState<PaymentTransaction | null>(null)

  // Form state. `counterPartyId` holds the customer ID for PAYMENT_IN and the supplier ID
  // for PAYMENT_OUT — same field, polymorphic by `paymentType`. Routed to either
  // `customerId` or `supplierId` on submit.
  const [formData, setFormData] = useState({
    counterPartyId: '',
    amount: 0,
    paymentMode: 'CASH',
    paymentDate: new Date().toISOString().split('T')[0],
    notes: ''
  })

  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    loadPayments()
  }, [filter])

  useEffect(() => {
    loadParties()
  }, [paymentType])

  // Compute a polymorphic `party` for the table render — customer for PAYMENT_IN, supplier
  // for PAYMENT_OUT. The underlying relation is direct on PaymentTransaction post-split.
  const normalizePayment = (payment: any): PaymentTransaction => ({
    ...payment,
    party: payment.customer || payment.supplier,
  })

  const loadPayments = async () => {
    const result = await window.electronAPI.payment.getAll(filter === 'ALL' ? undefined : filter)
    if (result.success && result.data) {
      setPayments(result.data.map(normalizePayment))
    }
  }

  const loadParties = async () => {
    const result = paymentType === 'PAYMENT_IN'
      ? await window.electronAPI.customer.getAll()
      : await window.electronAPI.supplier.getAll()
    if (result.success && result.data) {
      setParties(result.data)
    }
  }

  const openPaymentModal = (type: 'PAYMENT_IN' | 'PAYMENT_OUT') => {
    setEditingPayment(null)
    setPaymentType(type)
    setShowModal(true)
  }

  // Open the modal pre-filled to edit an existing payment.
  const openEditModal = (pmt: PaymentTransaction) => {
    setEditingPayment(pmt)
    setPaymentType(pmt.type)
    setFormData({
      counterPartyId: pmt.customerId || pmt.supplierId || '',
      amount: pmt.amount,
      paymentMode: pmt.paymentMode,
      paymentDate: new Date(pmt.paymentDate).toISOString().split('T')[0],
      notes: pmt.notes || '',
    })
    setShowModal(true)
  }

  const handleCancel = async (pmt: PaymentTransaction) => {
    const ok = await confirm({
      message: 'Cancel this payment? The party balance and any linked invoice/bill are adjusted back, and it is marked Cancelled for your records. This cannot be undone.',
      danger: true,
    })
    if (!ok) return
    const result = await window.electronAPI.payment.cancel(pmt.id)
    if (result.success) {
      toast.success('Payment cancelled')
      loadPayments()
    } else {
      toast.error('Failed to cancel payment: ' + (result.error || 'Unknown error'))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.counterPartyId) {
      toast.info(`Please select a ${paymentType === 'PAYMENT_IN' ? 'customer' : 'supplier'}`)
      return
    }

    if (formData.amount <= 0) {
      toast.info('Amount must be greater than 0')
      return
    }

    const amount = parseFloat(formData.amount.toString())
    const paymentData = paymentType === 'PAYMENT_IN'
      ? {
          customerId: formData.counterPartyId,
          amount,
          paymentMode: formData.paymentMode,
          paymentDate: formData.paymentDate,
          notes: formData.notes
        }
      : {
          supplierId: formData.counterPartyId,
          amount,
          paymentMode: formData.paymentMode,
          paymentDate: formData.paymentDate,
          notes: formData.notes
        }

    let result
    if (editingPayment) {
      result = await window.electronAPI.payment.update(editingPayment.id, paymentData)
    } else if (paymentType === 'PAYMENT_IN') {
      result = await window.electronAPI.payment.recordPaymentIn(paymentData)
    } else {
      result = await window.electronAPI.payment.recordPaymentOut(paymentData)
    }

    if (result.success) {
      toast.success(editingPayment ? 'Payment updated successfully!' : 'Payment recorded successfully!')
      setShowModal(false)
      resetForm()
      loadPayments()
    } else {
      toast.error(
        `Failed to ${editingPayment ? 'update' : 'record'} payment: ` + (result.error || 'Unknown error'),
      )
    }
  }

  const resetForm = () => {
    setEditingPayment(null)
    setFormData({
      counterPartyId: '',
      amount: 0,
      paymentMode: 'CASH',
      paymentDate: new Date().toISOString().split('T')[0],
      notes: ''
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Payments</h1>
        <div className="flex space-x-3">
          <button onClick={() => openPaymentModal('PAYMENT_IN')} className="btn btn-primary">+ Payment In</button>
          <button onClick={() => openPaymentModal('PAYMENT_OUT')} className="btn btn-secondary">+ Payment Out</button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex space-x-2">
        {['ALL', 'PAYMENT_IN', 'PAYMENT_OUT'].map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab as any)}
            className={`px-4 py-2 rounded-lg font-medium ${
              filter === tab ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200'
            }`}
          >
            {tab.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Payments Table */}
      <div className="card">
        <div className="overflow-auto max-h-[calc(100vh-280px)]">
          <table className="table">
            <thead>
              <tr>
                <th className="table-header sticky top-0 z-10">S.No</th>
                <th className="table-header sticky top-0 z-10">Date</th>
                <th className="table-header sticky top-0 z-10">Type</th>
                <th className="table-header sticky top-0 z-10">Party</th>
                <th className="table-header sticky top-0 z-10">Amount</th>
                <th className="table-header sticky top-0 z-10">Mode</th>
                <th className="table-header sticky top-0 z-10">Notes</th>
                <th className="table-header sticky top-0 z-10">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment, index) => (
                <tr key={payment.id} className={`border-t ${payment.cancelledAt ? 'opacity-60' : ''}`}>
                  <td className="table-cell">{index + 1}</td>
                  <td className="table-cell">{new Date(payment.paymentDate).toLocaleDateString('en-GB')}</td>
                  <td className="table-cell">
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      payment.type === 'PAYMENT_IN' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    }`}>
                      {payment.type}
                    </span>
                  </td>
                  <td className="table-cell">{payment.party?.name}</td>
                  <td className="table-cell font-medium">{formatCurrency(payment.amount)}</td>
                  <td className="table-cell">{payment.paymentMode.replace('_', ' ')}</td>
                  <td className="table-cell">{payment.notes || '-'}</td>
                  <td className="table-cell">
                    {payment.cancelledAt ? (
                      <span className="px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        Cancelled
                      </span>
                    ) : (
                      <>
                        <button
                          onClick={() => openEditModal(payment)}
                          className="text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300 mr-3"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleCancel(payment)}
                          className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg max-w-md w-full">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">
                  {editingPayment
                    ? paymentType === 'PAYMENT_IN' ? 'Edit Payment In' : 'Edit Payment Out'
                    : paymentType === 'PAYMENT_IN' ? 'Record Payment In' : 'Record Payment Out'}
                </h2>
                <button onClick={() => { setShowModal(false); resetForm(); }} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl">
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">
                    {paymentType === 'PAYMENT_IN' ? 'Customer' : 'Supplier'} *
                  </label>
                  <SearchableSelect
                    value={formData.counterPartyId}
                    onChange={(id) => setFormData({...formData, counterPartyId: id})}
                    options={parties.map(p => ({
                      id: p.id,
                      name: p.name,
                      subtitle: `Balance: ${formatCurrency(Math.abs(p.currentBalance))}`,
                    }))}
                    placeholder={`Select ${paymentType === 'PAYMENT_IN' ? 'Customer' : 'Supplier'}`}
                    required
                  />
                </div>

                <div>
                  <label className="label">Amount *</label>
                  <NumberInput
                    className="input"
                    value={formData.amount}
                    onChange={(val) => setFormData({...formData, amount: val})}
                    min={0.01}
                    required
                  />
                </div>

                <div>
                  <label className="label">Payment Mode *</label>
                  <select
                    className="input"
                    value={formData.paymentMode}
                    onChange={(e) => setFormData({...formData, paymentMode: e.target.value})}
                  >
                    <option value="CASH">Cash</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                    <option value="CARD">Card</option>
                    <option value="CHEQUE">Cheque</option>
                    <option value="UPI">UPI</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>

                <div>
                  <label className="label">Payment Date *</label>
                  <DateInput
                    className="input"
                    value={formData.paymentDate}
                    onChange={(e) => setFormData({...formData, paymentDate: e.target.value})}
                    required
                  />
                </div>

                <div>
                  <label className="label">Notes</label>
                  <textarea
                    className="input"
                    rows={2}
                    value={formData.notes}
                    onChange={(e) => setFormData({...formData, notes: e.target.value})}
                    placeholder="Optional notes..."
                  />
                </div>

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
                    {editingPayment ? 'Update Payment' : 'Record Payment'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Payments
