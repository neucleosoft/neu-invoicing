import { useEffect, useState } from 'react'
import { PaymentTransaction } from '../types'
import { formatCurrency } from '../utils/currency'
import NumberInput from '../components/NumberInput'
import { useToast } from '../components/Toast'

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

  // Form state
  const [formData, setFormData] = useState({
    partyId: '',
    amount: 0,
    paymentMode: 'CASH',
    paymentDate: new Date().toISOString().split('T')[0],
    notes: ''
  })

  const toast = useToast()

  useEffect(() => {
    loadPayments()
  }, [filter])

  useEffect(() => {
    loadParties()
  }, [paymentType])

  const loadPayments = async () => {
    const result = await window.electronAPI.payment.getAll(filter === 'ALL' ? undefined : filter)
    if (result.success && result.data) {
      setPayments(result.data)
    }
  }

  const loadParties = async () => {
    // Load customers for Payment In, suppliers for Payment Out
    const partyType = paymentType === 'PAYMENT_IN' ? 'CUSTOMER' : 'SUPPLIER'
    const result = await window.electronAPI.party.getAll(partyType)
    if (result.success && result.data) {
      setParties(result.data)
    }
  }

  const openPaymentModal = (type: 'PAYMENT_IN' | 'PAYMENT_OUT') => {
    setPaymentType(type)
    setShowModal(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.partyId) {
      toast.info(`Please select a ${paymentType === 'PAYMENT_IN' ? 'customer' : 'supplier'}`)
      return
    }

    if (formData.amount <= 0) {
      toast.info('Amount must be greater than 0')
      return
    }

    const paymentData = {
      ...formData,
      amount: parseFloat(formData.amount.toString())
    }

    let result
    if (paymentType === 'PAYMENT_IN') {
      result = await window.electronAPI.payment.recordPaymentIn(paymentData)
    } else {
      result = await window.electronAPI.payment.recordPaymentOut(paymentData)
    }

    if (result.success) {
      toast.success('Payment recorded successfully!')
      setShowModal(false)
      resetForm()
      loadPayments()
    } else {
      toast.error('Failed to record payment: ' + (result.error || 'Unknown error'))
    }
  }

  const resetForm = () => {
    setFormData({
      partyId: '',
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
              filter === tab ? 'bg-primary-600 text-white' : 'bg-gray-200 text-gray-700'
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
                <th className="table-header sticky top-0 z-10">Date</th>
                <th className="table-header sticky top-0 z-10">Type</th>
                <th className="table-header sticky top-0 z-10">Party</th>
                <th className="table-header sticky top-0 z-10">Amount</th>
                <th className="table-header sticky top-0 z-10">Mode</th>
                <th className="table-header sticky top-0 z-10">Notes</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((payment) => (
                <tr key={payment.id} className="border-t">
                  <td className="table-cell">{new Date(payment.paymentDate).toLocaleDateString()}</td>
                  <td className="table-cell">
                    <span className={`px-2 py-1 rounded-full text-xs ${
                      payment.type === 'PAYMENT_IN' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {payment.type}
                    </span>
                  </td>
                  <td className="table-cell">{payment.party?.name}</td>
                  <td className="table-cell font-medium">{formatCurrency(payment.amount)}</td>
                  <td className="table-cell">{payment.paymentMode.replace('_', ' ')}</td>
                  <td className="table-cell">{payment.notes || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payment Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">
                  {paymentType === 'PAYMENT_IN' ? 'Record Payment In' : 'Record Payment Out'}
                </h2>
                <button onClick={() => { setShowModal(false); resetForm(); }} className="text-gray-500 hover:text-gray-700 text-2xl">
                  ×
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">
                    {paymentType === 'PAYMENT_IN' ? 'Customer' : 'Supplier'} *
                  </label>
                  <select
                    className="input"
                    value={formData.partyId}
                    onChange={(e) => setFormData({...formData, partyId: e.target.value})}
                    required
                  >
                    <option value="">Select {paymentType === 'PAYMENT_IN' ? 'Customer' : 'Supplier'}</option>
                    {parties.map(party => (
                      <option key={party.id} value={party.id}>
                        {party.name} (Balance: {formatCurrency(Math.abs(party.currentBalance))})
                      </option>
                    ))}
                  </select>
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
                  <input
                    type="date"
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
                    Record Payment
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
