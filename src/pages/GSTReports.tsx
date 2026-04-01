import { useState, useEffect } from 'react'
import { formatCurrency } from '../utils/currency'
import type { GSTR1Data, GSTR3BData, HSNSummaryItem, GSTReportFilters } from '../types'

type ReportType = 'dashboard' | 'gstr1' | 'gstr2' | 'gstr3b' | 'gstr9' | 'hsn'
type DatePreset = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'lastQuarter' | 'thisYear' | 'custom'

const GSTReports = () => {
  const [activeReport, setActiveReport] = useState<ReportType>('dashboard')
  const [datePreset, setDatePreset] = useState<DatePreset>('thisMonth')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [companyGST, setCompanyGST] = useState<{ gstin?: string; legalName?: string; stateCode?: string; stateName?: string } | null>(null)

  // Report data states
  const [gstr1Data, setGstr1Data] = useState<GSTR1Data | null>(null)
  const [gstr3bData, setGstr3bData] = useState<GSTR3BData | null>(null)
  const [gstr2Data, setGstr2Data] = useState<any>(null)
  const [gstr9Data, setGstr9Data] = useState<any>(null)
  const [hsnData, setHsnData] = useState<HSNSummaryItem[]>([])

  // Drill-down state
  const [drillDownSection, setDrillDownSection] = useState<string | null>(null)
  const [drillDownInvoices, setDrillDownInvoices] = useState<any[]>([])

  // Initialize dates based on preset
  useEffect(() => {
    const now = new Date()
    let start: Date
    let end: Date

    switch (datePreset) {
      case 'thisMonth':
        start = new Date(now.getFullYear(), now.getMonth(), 1)
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
        break
      case 'lastMonth':
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1)
        end = new Date(now.getFullYear(), now.getMonth(), 0)
        break
      case 'thisQuarter':
        const currentQuarter = Math.floor(now.getMonth() / 3)
        start = new Date(now.getFullYear(), currentQuarter * 3, 1)
        end = new Date(now.getFullYear(), (currentQuarter + 1) * 3, 0)
        break
      case 'lastQuarter':
        const lastQuarter = Math.floor(now.getMonth() / 3) - 1
        const lastQuarterYear = lastQuarter < 0 ? now.getFullYear() - 1 : now.getFullYear()
        const adjustedQuarter = lastQuarter < 0 ? 3 : lastQuarter
        start = new Date(lastQuarterYear, adjustedQuarter * 3, 1)
        end = new Date(lastQuarterYear, (adjustedQuarter + 1) * 3, 0)
        break
      case 'thisYear':
        // Indian Financial Year (April to March)
        const fiscalYearStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
        start = new Date(fiscalYearStart, 3, 1) // April 1st
        end = new Date(fiscalYearStart + 1, 2, 31) // March 31st
        break
      case 'custom':
        return // Don't update dates for custom
      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1)
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    }

    setStartDate(start.toISOString().split('T')[0])
    setEndDate(end.toISOString().split('T')[0])
  }, [datePreset])

  // Fetch company GST details on mount
  useEffect(() => {
    const fetchCompanyGST = async () => {
      const result = await window.electronAPI.gstReport.getCompanyGSTDetails()
      if (result.success && result.data) {
        setCompanyGST(result.data)
      }
    }
    fetchCompanyGST()
  }, [])

  const getFilters = (): GSTReportFilters => ({
    startDate,
    endDate
  })

  const handleGenerateReport = async (reportType: ReportType) => {
    if (!startDate || !endDate) {
      alert('Please select a date range')
      return
    }

    setLoading(true)
    const filters = getFilters()

    try {
      switch (reportType) {
        case 'gstr1': {
          const result = await window.electronAPI.gstReport.getGSTR1(filters)
          if (result.success && result.data) {
            setGstr1Data(result.data)
            setActiveReport('gstr1')
          } else {
            alert('Failed to generate GSTR-1: ' + (result.error || 'Unknown error'))
          }
          break
        }
        case 'gstr2': {
          const result = await window.electronAPI.gstReport.getGSTR2(filters)
          if (result.success && result.data) {
            setGstr2Data(result.data)
            setActiveReport('gstr2')
          } else {
            alert('Failed to generate GSTR-2: ' + (result.error || 'Unknown error'))
          }
          break
        }
        case 'gstr3b': {
          const result = await window.electronAPI.gstReport.getGSTR3B(filters)
          if (result.success && result.data) {
            setGstr3bData(result.data)
            setActiveReport('gstr3b')
          } else {
            alert('Failed to generate GSTR-3B: ' + (result.error || 'Unknown error'))
          }
          break
        }
        case 'gstr9': {
          const result = await window.electronAPI.gstReport.getGSTR9(filters)
          if (result.success && result.data) {
            setGstr9Data(result.data)
            setActiveReport('gstr9')
          } else {
            alert('Failed to generate GSTR-9: ' + (result.error || 'Unknown error'))
          }
          break
        }
        case 'hsn': {
          const result = await window.electronAPI.gstReport.getHSNSummary(filters)
          if (result.success && result.data) {
            setHsnData(result.data)
            setActiveReport('hsn')
          } else {
            alert('Failed to generate HSN Summary: ' + (result.error || 'Unknown error'))
          }
          break
        }
      }
    } catch (error) {
      alert('Error generating report')
    } finally {
      setLoading(false)
    }
  }

  const handleExportJSON = async (reportType: string, data: any) => {
    try {
      const result = await window.electronAPI.gstReport.exportToJSON(reportType, data)
      if (result.success && result.data) {
        const blob = new Blob([result.data], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${reportType}_${startDate}_${endDate}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch (error) {
      alert('Failed to export')
    }
  }

  const handleExportExcel = async (reportType: 'GSTR1' | 'GSTR3B') => {
    try {
      let result
      if (reportType === 'GSTR1' && gstr1Data) {
        result = await window.electronAPI.gstReport.exportGSTR1ToExcel(gstr1Data)
      } else if (reportType === 'GSTR3B' && gstr3bData) {
        result = await window.electronAPI.gstReport.exportGSTR3BToExcel(gstr3bData)
      }

      if (result?.success && result.data) {
        alert(`Excel file saved to: ${result.data}`)
      } else {
        alert('Failed to export: ' + (result?.error || 'Unknown error'))
      }
    } catch (error) {
      alert('Failed to export to Excel')
    }
  }

  const handleDrillDown = (sectionCode: string, invoices: any[]) => {
    setDrillDownSection(sectionCode)
    setDrillDownInvoices(invoices)
  }

  const closeDrillDown = () => {
    setDrillDownSection(null)
    setDrillDownInvoices([])
  }

  // Report card component
  const ReportCard = ({
    title,
    description,
    icon,
    reportType,
    color
  }: {
    title: string
    description: string
    icon: string
    reportType: ReportType
    color: string
  }) => (
    <button
      onClick={() => handleGenerateReport(reportType)}
      disabled={loading}
      className={`p-6 rounded-xl border-2 text-left transition-all hover:shadow-lg hover:scale-[1.02] ${color}`}
    >
      <div className="text-4xl mb-3">{icon}</div>
      <h3 className="text-lg font-bold text-gray-900 mb-1">{title}</h3>
      <p className="text-sm text-gray-600">{description}</p>
    </button>
  )

  // Summary metric component
  const SummaryMetric = ({
    label,
    value,
    type = 'default'
  }: {
    label: string
    value: number
    type?: 'default' | 'positive' | 'negative'
  }) => (
    <div className="bg-white p-4 rounded-lg border">
      <p className="text-sm text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${
        type === 'positive' ? 'text-green-600' :
        type === 'negative' ? 'text-red-600' :
        'text-gray-900'
      }`}>
        {formatCurrency(value)}
      </p>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">GST Reports</h1>
          {companyGST?.gstin && (
            <p className="text-gray-600 mt-1">GSTIN: {companyGST.gstin} | {companyGST.stateName}</p>
          )}
        </div>
        <button
          onClick={() => setActiveReport('dashboard')}
          className="btn btn-secondary"
        >
          Back to Dashboard
        </button>
      </div>

      {/* Date Range Selector */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="label">Period</label>
            <select
              className="input"
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value as DatePreset)}
            >
              <option value="thisMonth">This Month</option>
              <option value="lastMonth">Last Month</option>
              <option value="thisQuarter">This Quarter</option>
              <option value="lastQuarter">Last Quarter</option>
              <option value="thisYear">This Financial Year</option>
              <option value="custom">Custom Range</option>
            </select>
          </div>
          <div>
            <label className="label">Start Date</label>
            <input
              type="date"
              className="input"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value)
                setDatePreset('custom')
              }}
            />
          </div>
          <div>
            <label className="label">End Date</label>
            <input
              type="date"
              className="input"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value)
                setDatePreset('custom')
              }}
            />
          </div>
        </div>
      </div>

      {/* Report Dashboard */}
      {activeReport === 'dashboard' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <ReportCard
            title="GSTR-1"
            description="Details of outward supplies (Sales)"
            icon="📤"
            reportType="gstr1"
            color="border-blue-200 bg-blue-50 hover:border-blue-400"
          />
          <ReportCard
            title="GSTR-2"
            description="Details of inward supplies (Purchases)"
            icon="📥"
            reportType="gstr2"
            color="border-purple-200 bg-purple-50 hover:border-purple-400"
          />
          <ReportCard
            title="GSTR-3B"
            description="Monthly summary return"
            icon="📋"
            reportType="gstr3b"
            color="border-green-200 bg-green-50 hover:border-green-400"
          />
          <ReportCard
            title="GSTR-9"
            description="Annual return"
            icon="📊"
            reportType="gstr9"
            color="border-orange-200 bg-orange-50 hover:border-orange-400"
          />
          <ReportCard
            title="HSN Summary"
            description="HSN-wise summary of supplies"
            icon="📑"
            reportType="hsn"
            color="border-gray-200 bg-gray-50 hover:border-gray-400"
          />
        </div>
      )}

      {/* GSTR-1 Report View */}
      {activeReport === 'gstr1' && gstr1Data && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">GSTR-1 - Outward Supplies</h2>
            <div className="flex gap-2">
              <button
                onClick={() => handleExportExcel('GSTR1')}
                className="btn btn-primary"
              >
                Export Excel
              </button>
              <button
                onClick={() => handleExportJSON('GSTR1', gstr1Data)}
                className="btn btn-secondary"
              >
                Export JSON
              </button>
            </div>
          </div>

          {/* Document Summary */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryMetric label="Total Invoices" value={gstr1Data.docSummary.totalInvoices} />
              <SummaryMetric label="Total Taxable Value" value={gstr1Data.docSummary.totalTaxableValue} />
              <SummaryMetric label="Total IGST" value={gstr1Data.docSummary.totalIgst} />
              <SummaryMetric label="Total CGST" value={gstr1Data.docSummary.totalCgst} />
              <SummaryMetric label="Total SGST" value={gstr1Data.docSummary.totalSgst} />
              <SummaryMetric label="Total Tax" value={gstr1Data.docSummary.totalTax} />
              <SummaryMetric label="Total Value" value={gstr1Data.docSummary.totalValue} />
            </div>
          </div>

          {/* Sections */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Section-wise Breakup</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left font-semibold">Section</th>
                    <th className="px-4 py-3 text-right font-semibold">Invoices</th>
                    <th className="px-4 py-3 text-right font-semibold">Taxable Value</th>
                    <th className="px-4 py-3 text-right font-semibold">IGST</th>
                    <th className="px-4 py-3 text-right font-semibold">CGST</th>
                    <th className="px-4 py-3 text-right font-semibold">SGST</th>
                    <th className="px-4 py-3 text-center font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(gstr1Data.sections).map(([key, section]) => (
                    <tr key={key} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{section.sectionName}</td>
                      <td className="px-4 py-3 text-right">{section.invoiceCount}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(section.totalTaxableValue)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(section.totalIgst)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(section.totalCgst)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(section.totalSgst)}</td>
                      <td className="px-4 py-3 text-center">
                        {section.invoiceCount > 0 && (
                          <button
                            onClick={() => handleDrillDown(section.sectionCode, section.invoices)}
                            className="text-primary-600 hover:text-primary-800 text-sm font-medium"
                          >
                            View Details
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* HSN Summary */}
          {gstr1Data.hsnSummary.length > 0 && (
            <div className="card">
              <h3 className="text-lg font-semibold mb-4">HSN Summary</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-3 text-left font-semibold">HSN Code</th>
                      <th className="px-4 py-3 text-left font-semibold">Description</th>
                      <th className="px-4 py-3 text-right font-semibold">Qty</th>
                      <th className="px-4 py-3 text-right font-semibold">Taxable Value</th>
                      <th className="px-4 py-3 text-right font-semibold">IGST</th>
                      <th className="px-4 py-3 text-right font-semibold">CGST</th>
                      <th className="px-4 py-3 text-right font-semibold">SGST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gstr1Data.hsnSummary.map((hsn, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="px-4 py-3 font-mono">{hsn.hsnCode}</td>
                        <td className="px-4 py-3">{hsn.description}</td>
                        <td className="px-4 py-3 text-right">{hsn.totalQuantity} {hsn.uqc}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(hsn.taxableValue)}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(hsn.igstAmount)}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(hsn.cgstAmount)}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(hsn.sgstAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* GSTR-3B Report View */}
      {activeReport === 'gstr3b' && gstr3bData && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">GSTR-3B - Monthly Summary Return</h2>
            <div className="flex gap-2">
              <button
                onClick={() => handleExportExcel('GSTR3B')}
                className="btn btn-primary"
              >
                Export Excel
              </button>
              <button
                onClick={() => handleExportJSON('GSTR3B', gstr3bData)}
                className="btn btn-secondary"
              >
                Export JSON
              </button>
            </div>
          </div>

          {/* 3.1 - Outward Supplies */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">3.1 - Details of Outward Supplies and Inward Supplies Liable to Reverse Charge</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left font-semibold">Nature of Supplies</th>
                    <th className="px-4 py-3 text-right font-semibold">Taxable Value</th>
                    <th className="px-4 py-3 text-right font-semibold">IGST</th>
                    <th className="px-4 py-3 text-right font-semibold">CGST</th>
                    <th className="px-4 py-3 text-right font-semibold">SGST/UTGST</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="px-4 py-3">(a) Outward taxable supplies (other than zero rated, nil rated and exempted)</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.outwardSupplies.taxable.total.taxableValue)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.outwardSupplies.taxable.total.igst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.outwardSupplies.taxable.total.cgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.outwardSupplies.taxable.total.sgst)}</td>
                  </tr>
                  <tr className="border-t bg-gray-50">
                    <td className="px-4 py-3 pl-8">- Inter-State supplies</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.outwardSupplies.taxable.interState.taxableValue)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.outwardSupplies.taxable.interState.igst)}</td>
                    <td className="px-4 py-3 text-right">-</td>
                    <td className="px-4 py-3 text-right">-</td>
                  </tr>
                  <tr className="border-t bg-gray-50">
                    <td className="px-4 py-3 pl-8">- Intra-State supplies</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.outwardSupplies.taxable.intraState.taxableValue)}</td>
                    <td className="px-4 py-3 text-right">-</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.outwardSupplies.taxable.intraState.cgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.outwardSupplies.taxable.intraState.sgst)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* 3.2 - Inward Supplies RCM */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">3.2 - Inward Supplies Liable to Reverse Charge</h3>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <SummaryMetric label="Taxable Value" value={gstr3bData.inwardRCM.taxableValue} />
              <SummaryMetric label="IGST" value={gstr3bData.inwardRCM.igst} />
              <SummaryMetric label="CGST" value={gstr3bData.inwardRCM.cgst} />
              <SummaryMetric label="SGST" value={gstr3bData.inwardRCM.sgst} />
              <SummaryMetric label="Cess" value={gstr3bData.inwardRCM.cess} />
            </div>
          </div>

          {/* 4 - Eligible ITC */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">4 - Eligible ITC</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left font-semibold">Details</th>
                    <th className="px-4 py-3 text-right font-semibold">IGST</th>
                    <th className="px-4 py-3 text-right font-semibold">CGST</th>
                    <th className="px-4 py-3 text-right font-semibold">SGST/UTGST</th>
                    <th className="px-4 py-3 text-right font-semibold">Cess</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="px-4 py-3 text-green-600 font-medium">(A) ITC Available (whether in full or part)</td>
                    <td className="px-4 py-3 text-right text-green-600">{formatCurrency(gstr3bData.itc.eligible.igst)}</td>
                    <td className="px-4 py-3 text-right text-green-600">{formatCurrency(gstr3bData.itc.eligible.cgst)}</td>
                    <td className="px-4 py-3 text-right text-green-600">{formatCurrency(gstr3bData.itc.eligible.sgst)}</td>
                    <td className="px-4 py-3 text-right text-green-600">{formatCurrency(gstr3bData.itc.eligible.cess)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="px-4 py-3 text-red-600">(B) ITC Reversed</td>
                    <td className="px-4 py-3 text-right text-red-600">{formatCurrency(gstr3bData.itc.ineligible.igst)}</td>
                    <td className="px-4 py-3 text-right text-red-600">{formatCurrency(gstr3bData.itc.ineligible.cgst)}</td>
                    <td className="px-4 py-3 text-right text-red-600">{formatCurrency(gstr3bData.itc.ineligible.sgst)}</td>
                    <td className="px-4 py-3 text-right text-red-600">{formatCurrency(gstr3bData.itc.ineligible.cess)}</td>
                  </tr>
                  <tr className="border-t bg-green-50 font-bold">
                    <td className="px-4 py-3">(C) Net ITC Available (A - B)</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.itc.net.igst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.itc.net.cgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.itc.net.sgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.itc.net.cess)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* 6 - Tax Payable */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">6 - Payment of Tax</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left font-semibold">Description</th>
                    <th className="px-4 py-3 text-right font-semibold">IGST</th>
                    <th className="px-4 py-3 text-right font-semibold">CGST</th>
                    <th className="px-4 py-3 text-right font-semibold">SGST/UTGST</th>
                    <th className="px-4 py-3 text-right font-semibold">Cess</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="px-4 py-3">Total Tax Liability</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.taxLiability.output.igst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.taxLiability.output.cgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.taxLiability.output.sgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr3bData.taxLiability.output.cess)}</td>
                  </tr>
                  <tr className="border-t bg-red-50 font-bold">
                    <td className="px-4 py-3 text-red-700">Tax Payable (After ITC Utilization)</td>
                    <td className="px-4 py-3 text-right text-red-700">{formatCurrency(gstr3bData.taxLiability.netPayable.igst)}</td>
                    <td className="px-4 py-3 text-right text-red-700">{formatCurrency(gstr3bData.taxLiability.netPayable.cgst)}</td>
                    <td className="px-4 py-3 text-right text-red-700">{formatCurrency(gstr3bData.taxLiability.netPayable.sgst)}</td>
                    <td className="px-4 py-3 text-right text-red-700">{formatCurrency(gstr3bData.taxLiability.netPayable.cess)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="mt-4 p-4 bg-red-100 rounded-lg">
              <p className="text-xl font-bold text-red-700">
                Total Tax Payable: {formatCurrency(gstr3bData.taxLiability.totalPayable)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* GSTR-2 Report View */}
      {activeReport === 'gstr2' && gstr2Data && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">GSTR-2 - Inward Supplies (Purchases)</h2>
            <div className="flex gap-2">
              <button
                onClick={() => handleExportJSON('GSTR2', gstr2Data)}
                className="btn btn-secondary"
              >
                Export JSON
              </button>
            </div>
          </div>

          {/* Summary */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryMetric label="Total Bills" value={gstr2Data.docSummary.totalBills} />
              <SummaryMetric label="Total Taxable Value" value={gstr2Data.docSummary.totalTaxableValue} />
              <SummaryMetric label="Total Tax" value={gstr2Data.docSummary.totalTax} />
              <SummaryMetric label="Total Value" value={gstr2Data.docSummary.totalValue} />
            </div>
          </div>

          {/* ITC Summary */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">ITC Summary</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-4 bg-green-50 rounded-lg">
                <h4 className="font-semibold text-green-800 mb-2">Eligible ITC</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="text-gray-600">IGST:</span>
                  <span className="text-right text-green-700 font-medium">{formatCurrency(gstr2Data.eligibleITC.igst)}</span>
                  <span className="text-gray-600">CGST:</span>
                  <span className="text-right text-green-700 font-medium">{formatCurrency(gstr2Data.eligibleITC.cgst)}</span>
                  <span className="text-gray-600">SGST:</span>
                  <span className="text-right text-green-700 font-medium">{formatCurrency(gstr2Data.eligibleITC.sgst)}</span>
                </div>
              </div>
              <div className="p-4 bg-red-50 rounded-lg">
                <h4 className="font-semibold text-red-800 mb-2">Ineligible ITC</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="text-gray-600">IGST:</span>
                  <span className="text-right text-red-700 font-medium">{formatCurrency(gstr2Data.ineligibleITC.igst)}</span>
                  <span className="text-gray-600">CGST:</span>
                  <span className="text-right text-red-700 font-medium">{formatCurrency(gstr2Data.ineligibleITC.cgst)}</span>
                  <span className="text-gray-600">SGST:</span>
                  <span className="text-right text-red-700 font-medium">{formatCurrency(gstr2Data.ineligibleITC.sgst)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Reconciliation Placeholder */}
          <div className="card bg-yellow-50 border-yellow-200">
            <h3 className="text-lg font-semibold mb-2 text-yellow-800">GSTR-2A/2B Reconciliation</h3>
            <p className="text-yellow-700 mb-4">
              Upload your GSTR-2A/2B data from the GST portal to match with your purchase records.
            </p>
            <button className="btn btn-secondary" disabled>
              Upload GSTR-2A/2B (Coming Soon)
            </button>
          </div>
        </div>
      )}

      {/* GSTR-9 Report View */}
      {activeReport === 'gstr9' && gstr9Data && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">GSTR-9 - Annual Return</h2>
            <div className="flex gap-2">
              <button
                onClick={() => handleExportJSON('GSTR9', gstr9Data)}
                className="btn btn-secondary"
              >
                Export JSON
              </button>
            </div>
          </div>

          {/* Part II - Outward Supplies */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Part II - Details of Outward Supplies Made During the FY</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left font-semibold">Nature of Supplies</th>
                    <th className="px-4 py-3 text-right font-semibold">Taxable Value</th>
                    <th className="px-4 py-3 text-right font-semibold">CGST</th>
                    <th className="px-4 py-3 text-right font-semibold">SGST</th>
                    <th className="px-4 py-3 text-right font-semibold">IGST</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="px-4 py-3">B2B Supplies</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.outwardSupplies.b2b.taxableValue)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.outwardSupplies.b2b.cgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.outwardSupplies.b2b.sgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.outwardSupplies.b2b.igst)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="px-4 py-3">B2C Supplies</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.outwardSupplies.b2c.taxableValue)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.outwardSupplies.b2c.cgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.outwardSupplies.b2c.sgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.outwardSupplies.b2c.igst)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="px-4 py-3">Exports</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.outwardSupplies.exports.taxableValue)}</td>
                    <td className="px-4 py-3 text-right">-</td>
                    <td className="px-4 py-3 text-right">-</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.outwardSupplies.exports.igst)}</td>
                  </tr>
                  <tr className="border-t font-bold bg-gray-50">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.outwardSupplies.total.taxableValue)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.outwardSupplies.total.cgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.outwardSupplies.total.sgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.outwardSupplies.total.igst)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Part III - Inward Supplies */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Part III - Details of Inward Supplies During the FY</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left font-semibold">Nature of Supplies</th>
                    <th className="px-4 py-3 text-right font-semibold">Taxable Value</th>
                    <th className="px-4 py-3 text-right font-semibold">CGST</th>
                    <th className="px-4 py-3 text-right font-semibold">SGST</th>
                    <th className="px-4 py-3 text-right font-semibold">IGST</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t">
                    <td className="px-4 py-3">From Registered Suppliers</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.inwardSupplies.fromRegistered.taxableValue)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.inwardSupplies.fromRegistered.cgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.inwardSupplies.fromRegistered.sgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.inwardSupplies.fromRegistered.igst)}</td>
                  </tr>
                  <tr className="border-t">
                    <td className="px-4 py-3">From Unregistered Suppliers</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.inwardSupplies.fromUnregistered.taxableValue)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.inwardSupplies.fromUnregistered.cgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.inwardSupplies.fromUnregistered.sgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.inwardSupplies.fromUnregistered.igst)}</td>
                  </tr>
                  <tr className="border-t font-bold bg-gray-50">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.inwardSupplies.total.taxableValue)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.inwardSupplies.total.cgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.inwardSupplies.total.sgst)}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(gstr9Data.inwardSupplies.total.igst)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Part IV - ITC Claimed */}
          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Part IV - ITC Claimed During the FY</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryMetric label="IGST" value={gstr9Data.itcClaimed.igst} type="positive" />
              <SummaryMetric label="CGST" value={gstr9Data.itcClaimed.cgst} type="positive" />
              <SummaryMetric label="SGST" value={gstr9Data.itcClaimed.sgst} type="positive" />
              <SummaryMetric label="Cess" value={gstr9Data.itcClaimed.cess} type="positive" />
            </div>
          </div>
        </div>
      )}

      {/* HSN Summary View */}
      {activeReport === 'hsn' && hsnData.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold">HSN Summary</h2>
            <div className="flex gap-2">
              <button
                onClick={() => handleExportJSON('HSN', hsnData)}
                className="btn btn-secondary"
              >
                Export JSON
              </button>
            </div>
          </div>

          <div className="card">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left font-semibold">HSN Code</th>
                    <th className="px-4 py-3 text-left font-semibold">Description</th>
                    <th className="px-4 py-3 text-left font-semibold">UQC</th>
                    <th className="px-4 py-3 text-right font-semibold">Quantity</th>
                    <th className="px-4 py-3 text-right font-semibold">Taxable Value</th>
                    <th className="px-4 py-3 text-right font-semibold">IGST</th>
                    <th className="px-4 py-3 text-right font-semibold">CGST</th>
                    <th className="px-4 py-3 text-right font-semibold">SGST</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {hsnData.map((hsn, idx) => (
                    <tr key={idx} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono">{hsn.hsnCode}</td>
                      <td className="px-4 py-3">{hsn.description}</td>
                      <td className="px-4 py-3">{hsn.uqc}</td>
                      <td className="px-4 py-3 text-right">{hsn.totalQuantity}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(hsn.taxableValue)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(hsn.igstAmount)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(hsn.cgstAmount)}</td>
                      <td className="px-4 py-3 text-right">{formatCurrency(hsn.sgstAmount)}</td>
                      <td className="px-4 py-3 text-right font-semibold">{formatCurrency(hsn.totalValue)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-100 font-bold">
                    <td colSpan={4} className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(hsnData.reduce((s, h) => s + h.taxableValue, 0))}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(hsnData.reduce((s, h) => s + h.igstAmount, 0))}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(hsnData.reduce((s, h) => s + h.cgstAmount, 0))}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(hsnData.reduce((s, h) => s + h.sgstAmount, 0))}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(hsnData.reduce((s, h) => s + h.totalValue, 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Drill-down Modal */}
      {drillDownSection && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden m-4">
            <div className="p-4 border-b flex items-center justify-between">
              <h3 className="text-lg font-bold">{drillDownSection} Invoices</h3>
              <button onClick={closeDrillDown} className="text-gray-500 hover:text-gray-700">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 overflow-auto max-h-[60vh]">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-2 text-left">Invoice No.</th>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-left">Party</th>
                    <th className="px-4 py-2 text-left">GSTIN</th>
                    <th className="px-4 py-2 text-right">Taxable</th>
                    <th className="px-4 py-2 text-right">Tax</th>
                    <th className="px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {drillDownInvoices.map((inv: any) => (
                    <tr key={inv.id} className="border-t">
                      <td className="px-4 py-2 font-medium">{inv.invoiceNumber}</td>
                      <td className="px-4 py-2">{new Date(inv.invoiceDate).toLocaleDateString()}</td>
                      <td className="px-4 py-2">{inv.party?.name}</td>
                      <td className="px-4 py-2 font-mono text-sm">{inv.party?.taxId || '-'}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(inv.subtotal - (inv.discount || 0))}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(inv.taxAmount)}</td>
                      <td className="px-4 py-2 text-right font-semibold">{formatCurrency(inv.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-xl shadow-xl">
            <div className="flex items-center space-x-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
              <span className="text-lg">Generating Report...</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GSTReports
