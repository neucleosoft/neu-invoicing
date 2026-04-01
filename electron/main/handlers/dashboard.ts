import { ipcMain } from 'electron'
import { getPrisma } from '../database'

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
          }
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
          }
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
          }
        },
        _sum: {
          totalAmount: true
        }
      })

      // Low Stock Items Count - fetch items and compare fields
      const stockItems = await prisma.item.findMany({
        where: {
          trackStock: true
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
          dueDate: { lt: now }
        }
      })

      // Cash & Bank total
      let cashBankTotal = 0
      try {
        const accounts = await prisma.bankAccount.findMany()
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
          type: 'INVOICE'
        },
        include: {
          party: true
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
          where: { type: 'INVOICE' },
          include: { party: true },
          orderBy: { invoiceDate: 'desc' },
          take: limit
        }),
        prisma.paymentTransaction.findMany({
          include: { party: true },
          orderBy: { paymentDate: 'desc' },
          take: limit
        }),
        prisma.deliveryChallan.findMany({
          include: { party: true },
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
          party: inv.party?.name || '',
          amount: inv.totalAmount
        })
      })

      payments.forEach((p: any) => {
        transactions.push({
          date: p.paymentDate,
          type: p.type === 'PAYMENT_IN' ? 'Payment In' : 'Payment Out',
          number: p.id.slice(-8).toUpperCase(),
          party: p.party?.name || '',
          amount: p.amount
        })
      })

      challans.forEach((c: any) => {
        transactions.push({
          date: c.challanDate,
          type: 'Challan',
          number: c.challanNumber,
          party: c.party?.name || '',
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

  // Get sales chart data
  ipcMain.handle('dashboard:getSalesChartData', async (_, months: number = 6) => {
    try {
      const startDate = new Date()
      startDate.setMonth(startDate.getMonth() - months)

      const invoices = await prisma.salesInvoice.findMany({
        where: {
          type: 'INVOICE',
          invoiceDate: {
            gte: startDate
          }
        },
        select: {
          invoiceDate: true,
          totalAmount: true
        }
      })

      // Group by month
      const monthlyData: { [key: string]: number } = {}

      invoices.forEach(invoice => {
        const monthKey = `${invoice.invoiceDate.getFullYear()}-${String(invoice.invoiceDate.getMonth() + 1).padStart(2, '0')}`
        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = 0
        }
        monthlyData[monthKey] += invoice.totalAmount
      })

      const chartData = Object.entries(monthlyData).map(([month, amount]) => ({
        month,
        amount
      }))

      return { success: true, data: chartData }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch chart data'
      }
    }
  })
}
