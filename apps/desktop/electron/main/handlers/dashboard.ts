import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { notCancelled, notDeleted } from './softDelete'

export const setupDashboardHandlers = () => {
  const prisma = getPrisma()

  // Get dashboard metrics
  ipcMain.handle('dashboard:getMetrics', async () => {
    try {
      // Total Receivables (Outstanding from customers)
      const receivables = await prisma.salesInvoice.aggregate({
        where: {
          type: 'INVOICE',
          status: {
            in: ['DRAFT', 'PARTIAL', 'OVERDUE']
          },
          ...notDeleted
        },
        _sum: {
          balanceDue: true
        }
      })

      // Total Payables (Outstanding to suppliers)
      const payables = await prisma.purchaseBill.aggregate({
        where: {
          status: {
            in: ['DRAFT', 'PARTIAL', 'OVERDUE']
          },
          ...notDeleted
        },
        _sum: {
          balanceDue: true
        }
      })

      // Total Sales (Current fiscal year)
      const currentYear = new Date().getFullYear()
      const company = await prisma.company.findFirst()
      const fiscalYearStart = company?.fiscalYearStart || 4

      let fiscalYearStartDate: Date
      if (new Date().getMonth() + 1 >= fiscalYearStart) {
        fiscalYearStartDate = new Date(currentYear, fiscalYearStart - 1, 1)
      } else {
        fiscalYearStartDate = new Date(currentYear - 1, fiscalYearStart - 1, 1)
      }

      const totalSales = await prisma.salesInvoice.aggregate({
        where: {
          type: 'INVOICE',
          invoiceDate: {
            gte: fiscalYearStartDate
          },
          ...notDeleted
        },
        _sum: {
          totalAmount: true
        }
      })

      // Low Stock Items Count - fetch items and compare fields
      const stockItems = await prisma.item.findMany({
        where: {
          trackStock: true,
          ...notDeleted
        },
        select: {
          currentStock: true,
          lowStockWarning: true
        }
      })
      const lowStockItems = stockItems.filter(item => item.currentStock <= item.lowStockWarning).length

      // Overdue invoices count
      const now = new Date()
      const overdueInvoices = await prisma.salesInvoice.count({
        where: {
          type: 'INVOICE',
          status: { in: ['DRAFT', 'PARTIAL'] },
          dueDate: { lt: now },
          ...notDeleted
        }
      })

      // Cash & Bank total
      let cashBankTotal = 0
      try {
        const accounts = await prisma.bankAccount.findMany({ where: { ...notDeleted } })
        cashBankTotal = accounts.reduce((sum: number, a: any) => sum + a.currentBalance, 0)
      } catch {}

      return {
        success: true,
        data: {
          totalReceivables: receivables._sum.balanceDue || 0,
          totalPayables: payables._sum.balanceDue || 0,
          totalSales: totalSales._sum.totalAmount || 0,
          lowStockCount: lowStockItems,
          overdueCount: overdueInvoices,
          cashBankTotal
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch metrics'
      }
    }
  })

  // Get recent invoices
  ipcMain.handle('dashboard:getRecentInvoices', async (_, limit: number = 5) => {
    try {
      const invoices = await prisma.salesInvoice.findMany({
        where: {
          type: 'INVOICE',
          ...notDeleted
        },
        include: {
          customer: true
        },
        orderBy: { invoiceDate: 'desc' },
        take: limit
      })

      return { success: true, data: invoices }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch recent invoices'
      }
    }
  })

  // Get latest transactions (mixed feed)
  ipcMain.handle('dashboard:getLatestTransactions', async (_, limit: number = 10) => {
    try {
      const [invoices, payments, challans] = await Promise.all([
        prisma.salesInvoice.findMany({
          where: { type: 'INVOICE', ...notDeleted },
          include: { customer: true },
          orderBy: { invoiceDate: 'desc' },
          take: limit
        }),
        prisma.paymentTransaction.findMany({
          where: { ...notDeleted, ...notCancelled },
          include: {
            customer: true,
            supplier: true
          },
          orderBy: { paymentDate: 'desc' },
          take: limit
        }),
        prisma.deliveryChallan.findMany({
          where: { ...notDeleted },
          include: { customer: true },
          orderBy: { challanDate: 'desc' },
          take: limit
        }).catch(() => [])
      ])

      const transactions: any[] = []

      invoices.forEach((inv: any) => {
        transactions.push({
          date: inv.invoiceDate,
          type: 'Invoice',
          number: inv.invoiceNumber,
          party: inv.customer?.name || '',
          amount: inv.totalAmount
        })
      })

      payments.forEach((p: any) => {
        transactions.push({
          date: p.paymentDate,
          type: p.type === 'PAYMENT_IN' ? 'Payment In' : 'Payment Out',
          number: p.id.slice(-8).toUpperCase(),
          party: p.type === 'PAYMENT_OUT'
            ? p.supplier?.name || ''
            : p.customer?.name || '',
          amount: p.amount
        })
      })

      challans.forEach((c: any) => {
        transactions.push({
          date: c.challanDate,
          type: 'Challan',
          number: c.challanNumber,
          party: c.customer?.name || '',
          amount: c.totalAmount
        })
      })

      transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

      return { success: true, data: transactions.slice(0, limit) }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch transactions'
      }
    }
  })

  // Get sales chart data. `days > 0` → daily buckets for that lookback window.
  // `days === 0` → "all-time": span starts at the earliest invoice; spans longer
  // than 120 days are bucketed monthly so the chart stays readable.
  ipcMain.handle('dashboard:getSalesChartData', async (_, days: number = 0) => {
    try {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      let startDate: Date
      if (days > 0) {
        startDate = new Date(today)
        startDate.setDate(startDate.getDate() - (days - 1))
      } else {
        const earliest = await prisma.salesInvoice.findFirst({
          where: { type: 'INVOICE', ...notDeleted },
          orderBy: { invoiceDate: 'asc' },
          select: { invoiceDate: true }
        })
        if (!earliest) {
          // No invoices yet — fall back to a 30-day empty chart so the UI isn't blank
          startDate = new Date(today)
          startDate.setDate(startDate.getDate() - 29)
        } else {
          startDate = new Date(earliest.invoiceDate)
          startDate.setHours(0, 0, 0, 0)
        }
      }

      const invoices = await prisma.salesInvoice.findMany({
        where: {
          type: 'INVOICE',
          invoiceDate: { gte: startDate },
          ...notDeleted
        },
        select: { invoiceDate: true, totalAmount: true }
      })

      const spanDays = Math.floor((today.getTime() - startDate.getTime()) / 86_400_000) + 1
      const bucketByMonth = spanDays > 120

      if (bucketByMonth) {
        const monthKey = (d: Date) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

        const monthlyData: { [key: string]: number } = {}
        const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1)
        const end = new Date(today.getFullYear(), today.getMonth(), 1)
        while (cursor <= end) {
          monthlyData[monthKey(cursor)] = 0
          cursor.setMonth(cursor.getMonth() + 1)
        }

        invoices.forEach(invoice => {
          const key = monthKey(invoice.invoiceDate)
          if (key in monthlyData) monthlyData[key] += invoice.totalAmount
        })

        const chartData = Object.entries(monthlyData).map(([key, amount]) => {
          const [yyyy, mm] = key.split('-')
          return { date: key, label: `${mm}/${yyyy.slice(2)}`, amount }
        })
        return { success: true, data: chartData }
      }

      const dayKey = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

      const dailyData: { [key: string]: number } = {}
      const cursor = new Date(startDate)
      for (let i = 0; i < spanDays; i++) {
        dailyData[dayKey(cursor)] = 0
        cursor.setDate(cursor.getDate() + 1)
      }

      invoices.forEach(invoice => {
        const key = dayKey(invoice.invoiceDate)
        if (key in dailyData) dailyData[key] += invoice.totalAmount
      })

      const chartData = Object.entries(dailyData).map(([date, amount]) => {
        const [, mm, dd] = date.split('-')
        return { date, label: `${dd}/${mm}`, amount }
      })

      return { success: true, data: chartData }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch chart data'
      }
    }
  })
}
