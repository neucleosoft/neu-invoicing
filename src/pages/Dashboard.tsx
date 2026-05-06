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
  ShoppingCart,
  BarChart3,
} from 'lucide-react'
import { DashboardMetrics, SalesInvoice, Item } from '../types'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { formatCurrency } from '../utils/currency'
import { formatInvoiceStatus } from '../utils/invoiceStatus'
import { useStore } from '../store/useStore'
import MetricCard from '../components/MetricCard'

const chartRangeLabel = (days: number) => {
  if (days === 7) return 'Last 7 Days'
  if (days === 30) return 'Last 30 Days'
  if (days === 90) return 'Last 90 Days'
  if (days === 365) return 'Last 1 Year'
  return `Last ${days} Days`
}

interface LatestTransaction {
  id: string
  date: string
  type: 'Invoice' | 'Payment In' | 'Payment Out' | 'Challan'
  number: string
  party: string
  amount: number
}

// Pick whichever side of the transaction this payment has — customer for PAYMENT_IN,
// supplier for PAYMENT_OUT. Both are direct relations on PaymentTransaction post-split.
const getPaymentPartyName = (payment: any) =>
  payment.customer?.name ||
  payment.supplier?.name ||
  'Unknown'

const Dashboard = () => {
  const darkMode = useStore((s) => s.darkMode)
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null)
  const [recentInvoices, setRecentInvoices] = useState<SalesInvoice[]>([])
  const [lowStockItems, setLowStockItems] = useState<Item[]>([])
  const [salesChart, setSalesChart] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [cashBankBalance, setCashBankBalance] = useState(0)
  const [overdueCount, setOverdueCount] = useState(0)
  const [latestTransactions, setLatestTransactions] = useState<LatestTransaction[]>([])
  const [chartRange, setChartRange] = useState<7 | 30 | 90 | 365>(30)
  const [chartLoading, setChartLoading] = useState(false)

  useEffect(() => {
    loadDashboardData()
  }, [])

  useEffect(() => {
    let cancelled = false
    setChartLoading(true)
    window.electronAPI.dashboard.getSalesChartData(chartRange)
      .then((res) => {
        if (cancelled) return
        if (res.success && res.data) setSalesChart(res.data)
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [chartRange])

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

      // Sales chart is loaded by a dedicated effect keyed on chartRange.

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
              party: inv.customer?.name || 'Unknown',
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
              party: getPaymentPartyName(pmt),
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
          <Link to="/invoices" state={{ openNew: true }} className="btn btn-primary dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">+ New Invoice</Link>
          <Link to="/purchase" state={{ openNew: true }} className="btn btn-primary dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">+ New Purchase</Link>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard
          label="Total Receivables"
          value={formatCurrency(metrics?.totalReceivables || 0)}
          icon={Wallet}
          tone="green"
          to="/invoices"
        />
        <MetricCard
          label="Total Payables"
          value={formatCurrency(metrics?.totalPayables || 0)}
          icon={CreditCard}
          tone="red"
          to="/purchase"
        />
        <MetricCard
          label="Total Invoiced (YTD)"
          value={formatCurrency(metrics?.totalSales || 0)}
          icon={TrendingUp}
          tone="blue"
          to="/invoices"
        />
        <MetricCard
          label="Low Stock Alerts"
          value={metrics?.lowStockCount || 0}
          icon={AlertTriangle}
          tone="orange"
          to="/items"
          hint={metrics?.lowStockCount ? 'Items below threshold' : 'All items in stock'}
        />
        <MetricCard
          label="Cash & Bank"
          value={formatCurrency(cashBankBalance)}
          icon={Landmark}
          tone="indigo"
          to="/cash-bank"
        />
        <MetricCard
          label="Overdue Invoices"
          value={overdueCount}
          icon={Clock}
          tone="rose"
          to="/invoices"
          hint={overdueCount ? 'Need follow-up' : 'Nothing overdue'}
        />
      </div>

      {/* Invoice Chart and Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Invoice Chart */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">
              Invoice Trend{' '}
              <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                ({chartRangeLabel(chartRange)})
              </span>
            </h2>
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              {([7, 30, 90, 365] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setChartRange(d)}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${
                    chartRange === d
                      ? 'bg-primary-600 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {d === 365 ? '1Y' : `${d}D`}
                </button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={salesChart} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={darkMode ? '#374151' : '#e5e7eb'} />
              <XAxis
                dataKey="label"
                interval="preserveStartEnd"
                minTickGap={chartRange >= 90 ? 40 : 20}
                tick={{ fill: darkMode ? '#9ca3af' : '#6b7280', fontSize: 12 }}
              />
              <YAxis tick={{ fill: darkMode ? '#9ca3af' : '#6b7280', fontSize: 12 }} />
              <Tooltip
                contentStyle={
                  darkMode
                    ? { background: '#1f2937', border: '1px solid #374151', color: '#f3f4f6' }
                    : { background: '#ffffff', border: '1px solid #e5e7eb', color: '#111827' }
                }
                labelStyle={{ color: darkMode ? '#f3f4f6' : '#111827' }}
                itemStyle={{ color: darkMode ? '#f3f4f6' : '#111827' }}
                formatter={(value: number) => [formatCurrency(value), 'Amount']}
              />
              <Area
                type="monotone"
                dataKey="amount"
                stroke="#0ea5e9"
                strokeWidth={2}
                fill="url(#salesGradient)"
                isAnimationActive={!chartLoading}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Recent Invoices */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold">Recent Invoices</h2>
            <Link to="/invoices" className="text-sm text-primary-600 hover:text-primary-700">
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
                    <p className="text-sm text-gray-600 dark:text-gray-400">{invoice.customer?.name}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-medium">{formatCurrency(invoice.totalAmount)}</p>
                    <span className={`text-xs px-2 py-1 rounded-full ${
                      invoice.status === 'PAID' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' :
                      invoice.status === 'PARTIAL' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                    }`}>
                      {formatInvoiceStatus(invoice.status)}
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
                    <td className="table-cell">{new Date(txn.date).toLocaleDateString('en-GB')}</td>
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Link to="/customers" className="flex flex-col items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <Users className="w-8 h-8 mb-2 text-primary-600 dark:text-primary-400" strokeWidth={1.5} />
            <span className="text-sm font-medium">Add Customer</span>
          </Link>
          <Link to="/suppliers" className="flex flex-col items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ShoppingCart className="w-8 h-8 mb-2 text-primary-600 dark:text-primary-400" strokeWidth={1.5} />
            <span className="text-sm font-medium">Add Supplier</span>
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
