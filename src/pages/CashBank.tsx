import { useEffect, useState } from 'react'
import { formatCurrency } from '../utils/currency'
import NumberInput from '../components/NumberInput'
import { useToast } from '../components/Toast'
import { useConfirm } from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'
import { Landmark, Search as SearchIcon } from 'lucide-react'

interface BankAccount {
  id: string
  name: string
  type: 'CASH' | 'BANK'
  accountNumber: string | null
  bankName: string | null
  ifscCode: string | null
  currentBalance: number
  createdAt: string
  updatedAt: string
}

interface TotalBalance {
  cash: number
  bank: number
  total: number
}

const CashBank = () => {
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [totalBalance, setTotalBalance] = useState<TotalBalance>({ cash: 0, bank: 0, total: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null)
  const [showAdjustModal, setShowAdjustModal] = useState(false)
  const [adjustingAccount, setAdjustingAccount] = useState<BankAccount | null>(null)

  const [formData, setFormData] = useState({
    name: '',
    type: 'CASH' as 'CASH' | 'BANK',
    accountNumber: '',
    bankName: '',
    ifscCode: '',
    currentBalance: 0
  })

  const [adjustData, setAdjustData] = useState({
    amount: 0,
    notes: ''
  })

  const toast = useToast()
  const confirm = useConfirm()

  useEffect(() => {
    loadAccounts()
    loadTotalBalance()
  }, [])

  const loadAccounts = async () => {
    const result = await window.electronAPI.cashBank.getAll()
    if (result.success && result.data) {
      setAccounts(result.data)
    }
  }

  const loadTotalBalance = async () => {
    const result = await window.electronAPI.cashBank.getTotalBalance()
    if (result.success && result.data) {
      setTotalBalance(result.data)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const accountData = {
      name: formData.name,
      type: formData.type,
      accountNumber: formData.type === 'BANK' ? formData.accountNumber : null,
      bankName: formData.type === 'BANK' ? formData.bankName : null,
      ifscCode: formData.type === 'BANK' ? formData.ifscCode : null,
      currentBalance: formData.currentBalance
    }

    let result
    if (editingAccount) {
      result = await window.electronAPI.cashBank.update(editingAccount.id, accountData)
    } else {
      result = await window.electronAPI.cashBank.create(accountData)
    }

    if (result.success) {
      setShowModal(false)
      setEditingAccount(null)
      resetForm()
      loadAccounts()
      loadTotalBalance()
    } else {
      toast.error('Failed to save account: ' + (result.error || 'Unknown error'))
    }
  }

  const handleEdit = (account: BankAccount) => {
    setEditingAccount(account)
    setFormData({
      name: account.name,
      type: account.type,
      accountNumber: account.accountNumber || '',
      bankName: account.bankName || '',
      ifscCode: account.ifscCode || '',
      currentBalance: account.currentBalance
    })
    setShowModal(true)
  }

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({ message: 'Are you sure you want to delete this account?', danger: true })
    if (confirmed) {
      const result = await window.electronAPI.cashBank.delete(id)
      if (result.success) {
        loadAccounts()
        loadTotalBalance()
      } else {
        toast.error('Failed to delete account: ' + (result.error || 'Unknown error'))
      }
    }
  }

  const handleOpenAdjust = (account: BankAccount) => {
    setAdjustingAccount(account)
    setAdjustData({ amount: 0, notes: '' })
    setShowAdjustModal(true)
  }

  const handleAdjustSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!adjustingAccount) return

    if (adjustData.amount === 0) {
      toast.info('Amount cannot be zero')
      return
    }

    const result = await window.electronAPI.cashBank.adjustBalance(
      adjustingAccount.id,
      adjustData.amount,
      adjustData.notes || undefined
    )

    if (result.success) {
      setShowAdjustModal(false)
      setAdjustingAccount(null)
      setAdjustData({ amount: 0, notes: '' })
      loadAccounts()
      loadTotalBalance()
    } else {
      toast.error('Failed to adjust balance: ' + (result.error || 'Unknown error'))
    }
  }

  const resetForm = () => {
    setFormData({
      name: '',
      type: 'CASH',
      accountNumber: '',
      bankName: '',
      ifscCode: '',
      currentBalance: 0
    })
  }

  const handleOpenModal = () => {
    resetForm()
    setEditingAccount(null)
    setShowModal(true)
  }

  const filteredAccounts = accounts.filter((account) =>
    account.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Cash & Bank</h1>
        <button onClick={handleOpenModal} className="btn btn-primary">
          + Add Account
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card bg-gradient-to-br from-green-50 to-green-100">
          <div>
            <p className="text-sm text-green-600 font-medium">Total Cash</p>
            <p className="text-3xl font-bold text-green-700 mt-2">
              {formatCurrency(totalBalance.cash)}
            </p>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-blue-50 to-blue-100">
          <div>
            <p className="text-sm text-blue-600 font-medium">Total Bank</p>
            <p className="text-3xl font-bold text-blue-700 mt-2">
              {formatCurrency(totalBalance.bank)}
            </p>
          </div>
        </div>

        <div className="card bg-gradient-to-br from-purple-50 to-purple-100">
          <div>
            <p className="text-sm text-purple-600 font-medium">Total Balance</p>
            <p className="text-3xl font-bold text-purple-700 mt-2">
              {formatCurrency(totalBalance.total)}
            </p>
          </div>
        </div>
      </div>

      {/* Search */}
      <div>
        <input
          type="text"
          placeholder="Search accounts by name..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input max-w-md"
        />
      </div>

      {/* Accounts Table */}
      <div className="card">
        {filteredAccounts.length === 0 ? (
          searchQuery ? (
            <EmptyState
              icon={SearchIcon}
              title="No accounts match your search"
              description={`Nothing matched "${searchQuery}".`}
            />
          ) : (
            <EmptyState
              icon={Landmark}
              title="No accounts yet"
              description="Add your cash box and bank accounts to record deposits, withdrawals, and transfers."
              action={{ label: '+ Add your first account', onClick: handleOpenModal }}
            />
          )
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <table className="table">
              <thead>
                <tr>
                  <th className="table-header sticky top-0 z-10">Name</th>
                  <th className="table-header sticky top-0 z-10">Type</th>
                  <th className="table-header sticky top-0 z-10">Account Number</th>
                  <th className="table-header sticky top-0 z-10">Bank Name</th>
                  <th className="table-header sticky top-0 z-10">Current Balance</th>
                  <th className="table-header sticky top-0 z-10">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAccounts.map((account) => (
                  <tr key={account.id} className="border-t">
                    <td className="table-cell font-medium">{account.name}</td>
                    <td className="table-cell">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        account.type === 'CASH'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                          : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                      }`}>
                        {account.type}
                      </span>
                    </td>
                    <td className="table-cell">{account.accountNumber || '-'}</td>
                    <td className="table-cell">{account.bankName || '-'}</td>
                    <td className="table-cell font-medium">
                      <span className={account.currentBalance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                        {formatCurrency(Math.abs(account.currentBalance))}
                        {account.currentBalance < 0 && ' (-)'}
                      </span>
                    </td>
                    <td className="table-cell">
                      <button
                        onClick={() => handleOpenAdjust(account)}
                        className="text-purple-600 hover:text-purple-700 mr-3"
                      >
                        Adjust
                      </button>
                      <button
                        onClick={() => handleEdit(account)}
                        className="text-primary-600 hover:text-primary-700 mr-3"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(account.id)}
                        className="text-red-600 hover:text-red-700"
                      >
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

      {/* Add/Edit Account Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">
                  {editingAccount ? 'Edit' : 'Add'} Account
                </h2>
                <button
                  onClick={() => { setShowModal(false); setEditingAccount(null); resetForm() }}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl"
                >
                  x
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">Account Name *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                    className="input"
                    placeholder="e.g., Main Cash, HDFC Current Account"
                  />
                </div>

                <div>
                  <label className="label">Type *</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value as 'CASH' | 'BANK' })}
                    className="input"
                  >
                    <option value="CASH">Cash</option>
                    <option value="BANK">Bank</option>
                  </select>
                </div>

                {formData.type === 'BANK' && (
                  <>
                    <div>
                      <label className="label">Account Number</label>
                      <input
                        type="text"
                        value={formData.accountNumber}
                        onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                        className="input"
                        placeholder="e.g., 1234567890"
                      />
                    </div>

                    <div>
                      <label className="label">Bank Name</label>
                      <input
                        type="text"
                        value={formData.bankName}
                        onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                        className="input"
                        placeholder="e.g., HDFC Bank"
                      />
                    </div>

                    <div>
                      <label className="label">IFSC Code</label>
                      <input
                        type="text"
                        value={formData.ifscCode}
                        onChange={(e) => setFormData({ ...formData, ifscCode: e.target.value.toUpperCase() })}
                        className="input"
                        placeholder="e.g., HDFC0001234"
                        maxLength={11}
                      />
                    </div>
                  </>
                )}

                {!editingAccount && (
                  <div>
                    <label className="label">Opening Balance</label>
                    <NumberInput
                      className="input"
                      value={formData.currentBalance}
                      onChange={(val) => setFormData({ ...formData, currentBalance: val })}
                      placeholder="0.00"
                    />
                  </div>
                )}

                <div className="flex justify-end space-x-3 pt-4 border-t">
                  <button
                    type="button"
                    onClick={() => { setShowModal(false); setEditingAccount(null); resetForm() }}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    {editingAccount ? 'Update' : 'Create'} Account
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Balance Modal */}
      {showAdjustModal && adjustingAccount && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg w-full max-w-md">
            <div className="p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Adjust Balance</h2>
                <button
                  onClick={() => { setShowAdjustModal(false); setAdjustingAccount(null) }}
                  className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 text-2xl"
                >
                  x
                </button>
              </div>

              <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-900/40 rounded-lg">
                <p className="text-sm text-gray-600 dark:text-gray-400">Account</p>
                <p className="font-medium">{adjustingAccount.name}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Current Balance:{' '}
                  <span className={adjustingAccount.currentBalance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                    {formatCurrency(Math.abs(adjustingAccount.currentBalance))}
                  </span>
                </p>
              </div>

              <form onSubmit={handleAdjustSubmit} className="space-y-4">
                <div>
                  <label className="label">Amount *</label>
                  <NumberInput
                    className="input"
                    value={adjustData.amount}
                    onChange={(val) => setAdjustData({ ...adjustData, amount: val })}
                    placeholder="Positive to add, negative to subtract"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Use positive value to add funds, negative to subtract.
                  </p>
                </div>

                <div>
                  <label className="label">Notes</label>
                  <textarea
                    value={adjustData.notes}
                    onChange={(e) => setAdjustData({ ...adjustData, notes: e.target.value })}
                    rows={2}
                    className="input"
                    placeholder="Reason for adjustment..."
                  />
                </div>

                {adjustData.amount !== 0 && (
                  <div className="p-3 bg-gray-50 dark:bg-gray-900/40 rounded-lg text-sm">
                    <p className="text-gray-600 dark:text-gray-400">
                      New Balance:{' '}
                      <span className={
                        (adjustingAccount.currentBalance + adjustData.amount) >= 0
                          ? 'text-green-600 dark:text-green-400 font-medium'
                          : 'text-red-600 dark:text-red-400 font-medium'
                      }>
                        {formatCurrency(Math.abs(adjustingAccount.currentBalance + adjustData.amount))}
                      </span>
                    </p>
                  </div>
                )}

                <div className="flex justify-end space-x-3 pt-4 border-t">
                  <button
                    type="button"
                    onClick={() => { setShowAdjustModal(false); setAdjustingAccount(null) }}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Adjust Balance
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

export default CashBank
