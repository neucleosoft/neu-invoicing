import { ipcMain } from 'electron'
import { and, asc, desc, eq, gte, inArray, lt, sql } from '@neu/shared'
import { getDb, schema } from '../db'
import { creditNoteNet, notCancelled, notDeleted } from './softDelete'

export const setupDashboardHandlers = () => {
  const db = getDb()

  // Get dashboard metrics
  ipcMain.handle('dashboard:getMetrics', async () => {
    try {
      // Total Receivables (Outstanding from customers)
      const [receivables] = await db
        .select({ sum: sql<number | null>`sum(${schema.salesInvoice.balanceDue})` })
        .from(schema.salesInvoice)
        .where(and(
          eq(schema.salesInvoice.type, 'INVOICE'),
          inArray(schema.salesInvoice.status, ['DRAFT', 'PARTIAL', 'OVERDUE']),
          notDeleted(schema.salesInvoice.deletedAt),
          notCancelled(schema.salesInvoice.cancelledAt),
        ))

      // Total Payables (Outstanding to suppliers)
      const [payables] = await db
        .select({ sum: sql<number | null>`sum(${schema.purchaseBill.balanceDue})` })
        .from(schema.purchaseBill)
        .where(and(
          inArray(schema.purchaseBill.status, ['DRAFT', 'PARTIAL', 'OVERDUE']),
          notDeleted(schema.purchaseBill.deletedAt),
          notCancelled(schema.purchaseBill.cancelledAt),
        ))

      // Total Sales (Current fiscal year)
      const currentYear = new Date().getFullYear()
      const [company] = await db.select().from(schema.company).limit(1)
      const fiscalYearStart = company?.fiscalYearStart || 4

      let fiscalYearStartDate: Date
      if (new Date().getMonth() + 1 >= fiscalYearStart) {
        fiscalYearStartDate = new Date(currentYear, fiscalYearStart - 1, 1)
      } else {
        fiscalYearStartDate = new Date(currentYear - 1, fiscalYearStart - 1, 1)
      }

      const [totalSales] = await db
        .select({ sum: sql<number | null>`sum(${schema.salesInvoice.totalAmount})` })
        .from(schema.salesInvoice)
        .where(and(
          eq(schema.salesInvoice.type, 'INVOICE'),
          gte(schema.salesInvoice.invoiceDate, fiscalYearStartDate),
          notDeleted(schema.salesInvoice.deletedAt),
          notCancelled(schema.salesInvoice.cancelledAt),
        ))

      // Net out credit notes issued this FY so returns/reversals don't inflate sales.
      const cnFy = await creditNoteNet(db, { gte: fiscalYearStartDate })

      // Low Stock Items Count - fetch items and compare fields
      const stockItems = await db
        .select({ currentStock: schema.item.currentStock, lowStockWarning: schema.item.lowStockWarning })
        .from(schema.item)
        .where(and(eq(schema.item.trackStock, true), notDeleted(schema.item.deletedAt)))
      const lowStockItems = stockItems.filter(item => item.currentStock <= item.lowStockWarning).length

      // Overdue invoices count
      const now = new Date()
      const [overdue] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.salesInvoice)
        .where(and(
          eq(schema.salesInvoice.type, 'INVOICE'),
          inArray(schema.salesInvoice.status, ['DRAFT', 'PARTIAL']),
          lt(schema.salesInvoice.dueDate, now),
          notDeleted(schema.salesInvoice.deletedAt),
          notCancelled(schema.salesInvoice.cancelledAt),
        ))

      // Cash & Bank total
      let cashBankTotal = 0
      try {
        const accounts = await db.select().from(schema.bankAccount).where(notDeleted(schema.bankAccount.deletedAt))
        cashBankTotal = accounts.reduce((sum: number, a: any) => sum + a.currentBalance, 0)
      } catch {}

      return {
        success: true,
        data: {
          totalReceivables: receivables?.sum || 0,
          totalPayables: payables?.sum || 0,
          totalSales: (totalSales?.sum || 0) + cnFy.totalAmount,
          lowStockCount: lowStockItems,
          overdueCount: overdue?.count || 0,
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
      const rows = await db
        .select({ invoice: schema.salesInvoice, customer: schema.customer })
        .from(schema.salesInvoice)
        .leftJoin(schema.customer, eq(schema.salesInvoice.customerId, schema.customer.id))
        .where(and(
          eq(schema.salesInvoice.type, 'INVOICE'),
          notDeleted(schema.salesInvoice.deletedAt),
          notCancelled(schema.salesInvoice.cancelledAt),
        ))
        .orderBy(desc(schema.salesInvoice.invoiceDate))
        .limit(limit)

      const invoices = rows.map((r: any) => ({ ...r.invoice, customer: r.customer }))
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
        db
          .select({ row: schema.salesInvoice, customer: schema.customer })
          .from(schema.salesInvoice)
          .leftJoin(schema.customer, eq(schema.salesInvoice.customerId, schema.customer.id))
          .where(and(
            eq(schema.salesInvoice.type, 'INVOICE'),
            notDeleted(schema.salesInvoice.deletedAt),
            notCancelled(schema.salesInvoice.cancelledAt),
          ))
          .orderBy(desc(schema.salesInvoice.invoiceDate))
          .limit(limit),
        db
          .select({ row: schema.paymentTransaction, customer: schema.customer, supplier: schema.supplier })
          .from(schema.paymentTransaction)
          .leftJoin(schema.customer, eq(schema.paymentTransaction.customerId, schema.customer.id))
          .leftJoin(schema.supplier, eq(schema.paymentTransaction.supplierId, schema.supplier.id))
          .where(and(
            notDeleted(schema.paymentTransaction.deletedAt),
            notCancelled(schema.paymentTransaction.cancelledAt),
          ))
          .orderBy(desc(schema.paymentTransaction.paymentDate))
          .limit(limit),
        db
          .select({ row: schema.deliveryChallan, customer: schema.customer })
          .from(schema.deliveryChallan)
          .leftJoin(schema.customer, eq(schema.deliveryChallan.customerId, schema.customer.id))
          .where(and(
            notDeleted(schema.deliveryChallan.deletedAt),
            notCancelled(schema.deliveryChallan.cancelledAt),
          ))
          .orderBy(desc(schema.deliveryChallan.challanDate))
          .limit(limit)
          .catch(() => [] as any[]),
      ])

      const transactions: any[] = []

      invoices.forEach((r: any) => {
        transactions.push({
          date: r.row.invoiceDate,
          type: 'Invoice',
          number: r.row.invoiceNumber,
          party: r.customer?.name || '',
          amount: r.row.totalAmount
        })
      })

      payments.forEach((r: any) => {
        transactions.push({
          date: r.row.paymentDate,
          type: r.row.type === 'PAYMENT_IN' ? 'Payment In' : 'Payment Out',
          number: r.row.id.slice(-8).toUpperCase(),
          party: r.row.type === 'PAYMENT_OUT'
            ? r.supplier?.name || ''
            : r.customer?.name || '',
          amount: r.row.amount
        })
      })

      challans.forEach((r: any) => {
        transactions.push({
          date: r.row.challanDate,
          type: 'Challan',
          number: r.row.challanNumber,
          party: r.customer?.name || '',
          amount: r.row.totalAmount
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
        const [earliest] = await db
          .select({ invoiceDate: schema.salesInvoice.invoiceDate })
          .from(schema.salesInvoice)
          .where(and(eq(schema.salesInvoice.type, 'INVOICE'), notDeleted(schema.salesInvoice.deletedAt)))
          .orderBy(asc(schema.salesInvoice.invoiceDate))
          .limit(1)
        if (!earliest) {
          // No invoices yet — fall back to a 30-day empty chart so the UI isn't blank
          startDate = new Date(today)
          startDate.setDate(startDate.getDate() - 29)
        } else {
          startDate = new Date(earliest.invoiceDate)
          startDate.setHours(0, 0, 0, 0)
        }
      }

      const invoices = await db
        .select({ invoiceDate: schema.salesInvoice.invoiceDate, totalAmount: schema.salesInvoice.totalAmount })
        .from(schema.salesInvoice)
        .where(and(
          eq(schema.salesInvoice.type, 'INVOICE'),
          gte(schema.salesInvoice.invoiceDate, startDate),
          notDeleted(schema.salesInvoice.deletedAt),
          notCancelled(schema.salesInvoice.cancelledAt),
        ))

      // Credit notes net the chart per bucket, keyed on their own noteDate (a
      // CREDIT_NOTE subtracts, a DEBIT_NOTE adds).
      const chartNotes = await db
        .select({ noteDate: schema.creditDebitNote.noteDate, type: schema.creditDebitNote.type, totalAmount: schema.creditDebitNote.totalAmount })
        .from(schema.creditDebitNote)
        .where(and(
          gte(schema.creditDebitNote.noteDate, startDate),
          notDeleted(schema.creditDebitNote.deletedAt),
          notCancelled(schema.creditDebitNote.cancelledAt),
          eq(schema.creditDebitNote.status, 'ACTIVE'),
        ))

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

        chartNotes.forEach((n: any) => {
          const key = monthKey(n.noteDate)
          if (key in monthlyData) monthlyData[key] += (n.type === 'DEBIT_NOTE' ? 1 : -1) * n.totalAmount
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

      chartNotes.forEach((n: any) => {
        const key = dayKey(n.noteDate)
        if (key in dailyData) dailyData[key] += (n.type === 'DEBIT_NOTE' ? 1 : -1) * n.totalAmount
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
