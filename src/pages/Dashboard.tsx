import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Wallet,
  CreditCard,
  TrendingUp,
  AlertTriangle,
  Landmark,
  Clock,
  Users,
  Package,
  BarChart3,
} from 'lucide-react'
import { DashboardMetrics, SalesInvoice, Item } from '../types'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { formatCurrency } from '../utils/currency'

interface LatestTransaction {
  id: string
  date: string
  type: 'Invoice' | 'Payment In' | 'Payment Out' | 'Challan'
  number: string
  party: string
  amount: number
}

const amountFontSize = (value: string | number): string => {
  const len = String(value).length
  if (len >= 15) return 'text-sm'
  if (len >= 13) return 'text-base'
  if (len >= 11) return 'text-lg'
  return 'text-xl'
}

const Dashboard = () => {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [recentInvoices, setRecentInvoices] = useState<SalesInvoice[]>([])
  const [lowStockItems, setLowStockItems] = useState<Item[]>([])
  const [salesChart, setSalesChart] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cashBankBalance, setCashBankBalance] = useState(0)
  const [overdueCount, setOverdueCount] = useState(0)
  const [latestTransactions, setLatestTransactions] = useState<LatestTransaction[]>([])

  useEffect(() => {
    loadDashboardData()
  }, [])

  const loadDashboardData = async () => {
    try {
      // Load metrics
      const metricsResult = await window.electronAPI.dashboard.getMetrics()
      if (metricsResult.success && metricsResult.data) {
        setMetrics(metricsResult.data)
      }

      // Load recent invoices
      const invoicesResult = await window.electronAPI.dashboard.getRecentInvoices(5)
      if (invoicesResult.success && invoicesResult.data) {
        setRecentInvoices(invoicesResult.data)
      }

      // Load low stock items
      const lowStockResult = await window.electronAPI.item.getLowStock()
      if (lowStockResult.success && lowStockResult.data) {
        setLowStockItems(lowStockResult.data)
      }

      // Load sales chart data
      const chartResult = await window.electronAPI.dashboard.getSalesChartData(6)
      if (chartResult.success && chartResult.data) {
        setSalesChart(chartResult.data)
      }

      // Load cash & bank balance
      try {
        const cashBankResult = await window.electronAPI.cashBank.getTotalBalance()
        if (cashBankResult.success && cashBankResult.data !== undefined) {
          setCashBankBalance(cashBankResult.data.total)
        }
      } catch (err) {
        console.error('Failed to load cash & bank balance:', err)
      }

      // Load all invoices to count overdue ones
      try {
        const allInvoicesResult = await window.electronAPI.sales.getAll()
        if (allInvoicesResult.success && allInvoicesResult.data) {
          const today = new Date()
          today.setHours(0, 0, 0, 0)
          const overdueInvoices = allInvoicesResult.data.filter((inv: any) => {
            if (inv.status === 'PAID') return false
            if (!inv.dueDate) return false
            const due = new Date(inv.dueDate)
            due.setHours(0, 0, 0, 0)
            return due < today
          })
          setOverdueCount(overdueInvoices.length)
        }
      } catch (err) {
        console.error('Failed to load overdue invoices:', err)
      }

      // Load latest transactions (invoices + payments combined)
      try {
        const transactions: LatestTransaction[] = []

        // Get recent invoices for the feed (up to 10)
        const recentInvResult = await window.electronAPI.dashboard.getRecentInvoices(10)
        if (recentInvResult.success && recentInvResult.data) {
          recentInvResult.data.forEach((inv: any) => {
            transactions.push({
              id: `inv-${inv.id}`,
              date: inv.invoiceDate,
              type: 'Invoice',
              number: inv.invoiceNumber,
              party: inv.party?.name || 'Unknown',
              amount: inv.totalAmount
            })
          })
        }

        // Get payments
        const paymentsResult = await window.electronAPI.payment.getAll()
        if (paymentsResult.success && paymentsResult.data) {
          paymentsResult.data.forEach((pmt: any) => {
            transactions.push({
              id: `pmt-${pmt.id}`,
              date: pmt.paymentDate,
              type: pmt.type === 'PAYMENT_IN' ? 'Payment In' : 'Payment Out',
              number: pmt.referenceId || pmt.id?.substring(0, 8) || '-',
              party: pmt.party?.name || 'Unknown',
              amount: pmt.amount
            })
          })
        }

        // Sort by date descending and take latest 10
        transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        setLatestTransactions(transactions.slice(0, 10))
      } catch (err) {
        console.error('Failed to load latest transactions:', err)
      }
    } catch (error) {
      console.error('Error loading dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="text-center py-12">Loading dashboard...</div>
  }

  const getTypeBadgeClass = (type: LatestTransaction['type']) => {
    switch (type) {
      case 'Invoice':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
      case 'Payment In':
        return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
      case 'Payment Out':
        return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
      case 'Challan':
        return 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
        <div className="flex space-x-3">
          <Link to="/sales" className="btn btn-primary">+ New Invoice</Link>
          <Link to="/purchase" className="btn btn-secondary">+ New Purchase</Link>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-6">
        <div className="card bg-gradient-to-br from-green-50 to-green-100 relative">
          <Wallet className="absolute top-4 right-4 w-6 h-6 text-green-600/60" strokeWidth={1.5} />
          <p className="text-sm text-green-600 font-medium pr-8">Total Receivables</p>
          <p className={`${amountFontSize(formatCurrency(metrics?.totalReceivables || 0))} font-bold text-green-700 mt-2`}>
            {formatCurrency(metrics?.totalReceivables || 0)}
          </p>
        </div>

        <div className="card bg-gradient-to-br from-red-50 to-red-100 relative">
          <CreditCard className="absolute top-4 right-4 w-6 h-6 text-red-600/60" strokeWidth={1.5} />
          <p className="text-sm text-red-600 font-medium pr-8">Total Payables</p>
          <p className={`${amountFontSize(formatCurrency(metrics?.totalPayables || 0))} font-bold text-red-700 mt-2`}>
            {formatCurrency(metrics?.totalPayables || 0)}
          </p>
        </div>

        <div className="card bg-gradient-to-br from-blue-50 to-blue-100 relative">
          <TrendingUp className="absolute top-4 right-4 w-6 h-6 text-blue-600/60" strokeWidth={1.5} />
          <p className="text-sm text-blue-600 font-medium pr-8">Total Sales (YTD)</p>
          <p className={`${amountFontSize(formatCurrency(metrics?.totalSales || 0))} font-bold text-blue-700 mt-2`}>
            {formatCurrency(metrics?.totalSales || 0)}
          </p>
        </div>

        <div className="card bg-gradient-to-br from-orange-50 to-orange-100 relative">
          <AlertTriangle className="absolute top-4 right-4 w-6 h-6 text-orange-600/60" strokeWidth={1.5} />
          <p className="text-sm text-orange-600 font-medium pr-8">Low Stock Alerts</p>
          <p className={`${amountFontSize(metrics?.lowStockCount || 0)} font-bold text-orange-700 mt-2`}>
            {metrics?.lowStockCount || 0}
          </p>
        </div>

        <div className="card bg-gradient-to-br from-indigo-50 to-indigo-100 relative">
          <Landmark className="absolute top-4 right-4 w-6 h-6 text-indigo-600/60" strokeWidth={1.5} />
          <p className="text-sm text-indigo-600 font-medium pr-8">Cash & Bank</p>
          <p className={`${amountFontSize(formatCurrency(cashBankBalance))} font-bold text-indigo-700 mt-2`}>
            {formatCurrency(cashBankBalance)}
          </p>
        </div>

        <div className="card bg-gradient-to-br from-rose-50 to-rose-100 relative">
          <Clock className="absolute top-4 right-4 w-6 h-6 text-rose-600/60" strokeWidth={1.5} />
          <p className="text-sm text-rose-600 font-medium pr-8">Overdue Invoices</p>
          <p className={`${amountFontSize(overdueCount)} font-bold text-rose-700 mt-2`}>
            {overdueCount}
          </p>
        </div>
      </div>

      {/* Sales Chart and Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Sales Chart */}
        <div className="card">
          <h2 className="text-xl font-semibold mb-4">Sales Trend (Last 6 Months)</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={salesChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="amount" fill="#0ea5e9" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Recent Invoices */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Recent Invoices</h2>
            <Link to="/sales" className="text-sm text-primary-600 hover:text-primary-700">
              View All →
            </Link>
          </div>
          <div className="space-y-3">
            {recentInvoices.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No invoices yet</p>
            ) : (
              recentInvoices.map((invoice) => (
                <div key={invoice.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <div>
                    <p className="font-medium">{invoice.invoiceNumber}</p>
                    <p className="text-sm text-gray-600 dark:text-gray-400">{invoice.party?.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{formatCurrency(invoice.totalAmount)}</p>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      invoice.status === 'PAID' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                      invoice.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    }`}>
                      {invoice.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Latest Transactions */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Latest Transactions</h2>
        {latestTransactions.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No transactions yet</p>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <table className="table">
              <thead>
                <tr>
                  <th className="table-header sticky top-0 z-10">Date</th>
                  <th className="table-header sticky top-0 z-10">Type</th>
                  <th className="table-header sticky top-0 z-10">Number</th>
                  <th className="table-header sticky top-0 z-10">Party</th>
                  <th className="table-header sticky top-0 z-10">Amount</th>
                </tr>
              </thead>
              <tbody>
                {latestTransactions.map((txn) => (
                  <tr key={txn.id} className="border-t">
                    <td className="table-cell">{new Date(txn.date).toLocaleDateString()}</td>
                    <td className="table-cell">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getTypeBadgeClass(txn.type)}`}>
                        {txn.type}
                      </span>
                    </td>
                    <td className="table-cell font-medium">{txn.number}</td>
                    <td className="table-cell">{txn.party}</td>
                    <td className="table-cell font-medium">{formatCurrency(txn.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Low Stock Items */}
      {lowStockItems.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Low Stock Alerts</h2>
            <Link to="/items" className="text-sm text-primary-600 hover:text-primary-700">
              View All Items →
            </Link>
          </div>
          <div className="overflow-auto max-h-[calc(100vh-280px)]">
            <table className="table">
              <thead>
                <tr>
                  <th className="table-header sticky top-0 z-10">Item Name</th>
                  <th className="table-header sticky top-0 z-10">SKU/HSN</th>
                  <th className="table-header sticky top-0 z-10">Current Stock</th>
                  <th className="table-header sticky top-0 z-10">Warning Level</th>
                  <th className="table-header sticky top-0 z-10">Unit</th>
                </tr>
              </thead>
              <tbody>
                {lowStockItems.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="table-cell font-medium">{item.name}</td>
                    <td className="table-cell">{item.skuHsn || '-'}</td>
                    <td className="table-cell">
                      <span className="text-red-600 font-medium">{item.currentStock}</span>
                    </td>
                    <td className="table-cell">{item.lowStockWarning}</td>
                    <td className="table-cell">{item.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="card">
        <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Link to="/parties" className="flex flex-col items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <Users className="w-8 h-8 mb-2 text-primary-600 dark:text-primary-400" strokeWidth={1.5} />
            <span className="text-sm font-medium">Add Party</span>
          </Link>
          <Link to="/items" className="flex flex-col items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <Package className="w-8 h-8 mb-2 text-primary-600 dark:text-primary-400" strokeWidth={1.5} />
            <span className="text-sm font-medium">Add Item</span>
          </Link>
          <Link to="/payments" className="flex flex-col items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <CreditCard className="w-8 h-8 mb-2 text-primary-600 dark:text-primary-400" strokeWidth={1.5} />
            <span className="text-sm font-medium">Record Payment</span>
          </Link>
          <Link to="/reports" className="flex flex-col items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <BarChart3 className="w-8 h-8 mb-2 text-primary-600 dark:text-primary-400" strokeWidth={1.5} />
            <span className="text-sm font-medium">View Reports</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

export default Dashboard
