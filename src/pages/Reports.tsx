import { useState } from 'react'
import { formatCurrency } from '../utils/currency'
import { useToast } from '../components/Toast'

const Reports = () => {
  const [activeReport, setActiveReport] = useState<'sales' | 'stock' | 'receivables' | 'payables' | 'tax'>('sales')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [reportData, setReportData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  const reports = [
    { id: 'sales', name: 'Sales Report', icon: '📊' },
    { id: 'stock', name: 'Stock Summary', icon: '📦' },
    { id: 'receivables', name: 'Receivables', icon: '💰' },
    { id: 'payables', name: 'Payables', icon: '💳' },
    { id: 'tax', name: 'Tax Report', icon: '📄' }
  ]

  const handleGenerateReport = async () => {
    setLoading(true)
    setReportData(null)

    const filters = {
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      status: statusFilter || undefined
    }

    let result
    try {
      switch (activeReport) {
        case 'sales':
          result = await window.electronAPI.report.getSalesReport(filters)
          break
        case 'stock':
          result = await window.electronAPI.report.getStockSummary()
          break
        case 'receivables':
          result = await window.electronAPI.report.getReceivables()
          break
        case 'payables':
          result = await window.electronAPI.report.getPayables()
          break
        case 'tax':
          result = await window.electronAPI.report.getTaxReport(filters)
          break
      }

      if (result?.success) {
        setReportData(result.data)
      } else {
        toast.error('Failed to generate report: ' + (result?.error || 'Unknown error'))
      }
    } catch (error) {
      toast.error('Error generating report')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Reports</h1>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Report Navigation */}
        <div className="card lg:col-span-1">
          <h2 className="text-lg font-semibold mb-4">Report Types</h2>
          <div className="space-y-2">
            {reports.map((report) => (
              <button
                key={report.id}
                onClick={() => setActiveReport(report.id as any)}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                  activeReport === report.id
                    ? 'bg-primary-50 text-primary-700 font-medium'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="text-xl">{report.icon}</span>
                <span>{report.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Report Content */}
        <div className="card lg:col-span-3">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold">
              {reports.find((r) => r.id === activeReport)?.name}
            </h2>
            <button onClick={handleGenerateReport} disabled={loading} className="btn btn-primary">
              {loading ? 'Generating...' : 'Generate Report'}
            </button>
          </div>

          {/* Filters */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="label">Start Date</label>
                <input
                  type="date"
                  className="input"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <label className="label">End Date</label>
                <input
                  type="date"
                  className="input"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Status</label>
                <select
                  className="input"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">All</option>
                  <option value="PAID">Paid</option>
                  <option value="PARTIAL">Partial</option>
                  <option value="DRAFT">Draft</option>
                </select>
              </div>
            </div>
          </div>

          {/* Report Preview Area */}
          <div className="mt-6 p-6 bg-gray-50 rounded-lg">
            {!reportData ? (
              <div className="text-center py-8">
                <p className="text-gray-600">
                  Configure filters above and click "Generate Report" to view the report.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Report Results</h3>
                {activeReport === 'sales' && reportData && (
                  <div className="space-y-2">
                    <p><strong>Total Sales:</strong> {formatCurrency(reportData.totalSales || 0)}</p>
                    <p><strong>Total Tax:</strong> {formatCurrency(reportData.totalTax || 0)}</p>
                    <p><strong>Invoice Count:</strong> {reportData.invoiceCount || 0}</p>
                  </div>
                )}
                {activeReport === 'stock' && Array.isArray(reportData) && (
                  <div className="overflow-auto max-h-[calc(100vh-280px)]">
                    <table className="table w-full">
                      <thead>
                        <tr>
                          <th className="table-header sticky top-0 z-10">Item</th>
                          <th className="table-header sticky top-0 z-10">Current Stock</th>
                          <th className="table-header sticky top-0 z-10">Low Stock Warning</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.map((item: any) => (
                          <tr key={item.id} className="border-t">
                            <td className="table-cell">{item.name}</td>
                            <td className="table-cell">{item.currentStock}</td>
                            <td className="table-cell">{item.lowStockWarning}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {activeReport === 'receivables' && Array.isArray(reportData) && (
                  <div className="overflow-auto max-h-[calc(100vh-280px)]">
                    <table className="table w-full">
                      <thead>
                        <tr>
                          <th className="table-header sticky top-0 z-10">Customer</th>
                          <th className="table-header sticky top-0 z-10">Balance Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.map((party: any) => (
                          <tr key={party.id} className="border-t">
                            <td className="table-cell">{party.name}</td>
                            <td className="table-cell">{formatCurrency(party.currentBalance || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {activeReport === 'payables' && Array.isArray(reportData) && (
                  <div className="overflow-auto max-h-[calc(100vh-280px)]">
                    <table className="table w-full">
                      <thead>
                        <tr>
                          <th className="table-header sticky top-0 z-10">Supplier</th>
                          <th className="table-header sticky top-0 z-10">Balance Due</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.map((party: any) => (
                          <tr key={party.id} className="border-t">
                            <td className="table-cell">{party.name}</td>
                            <td className="table-cell">{formatCurrency(Math.abs(party.currentBalance) || 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {activeReport === 'tax' && reportData && (
                  <div className="space-y-2">
                    <p><strong>Total Tax Collected:</strong> {formatCurrency(reportData.totalTaxCollected || 0)}</p>
                    <p><strong>Total Tax Paid:</strong> {formatCurrency(reportData.totalTaxPaid || 0)}</p>
                    <p><strong>Net Tax:</strong> {formatCurrency((reportData.totalTaxCollected - reportData.totalTaxPaid) || 0)}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default Reports
