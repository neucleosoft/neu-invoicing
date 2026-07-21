import { ipcMain } from 'electron'
import {
  and, asc, desc, eq, gte,
  getCashBankTotalsDb,
  getFiscalYearStartMonthDb,
  getLowStockCountDb,
  getOverdueCountDb,
  getTotalPayablesDb,
  getTotalReceivablesDb,
  getTotalSalesThisFYDb,
} from '@neu/shared'
import { getDb, schema } from '../db'
import { notCancelled, notDeleted } from './softDelete'

export const setupDashboardHandlers = () => {
  const db = getDb()

  // Get dashboard metrics — the math lives in @neu/shared (dashboardDb.ts)
  // so mobile's dashboard shows the exact same numbers.
  ipcMain.handle('dashboard:getMetrics', async () => {
    try {
      const fyStartMonth = await getFiscalYearStartMonthDb(db)
      const [totalReceivables, totalPayables, totalSales, lowStockCount, overdueCount, cashBank] =
        await Promise.all([
          getTotalReceivablesDb(db),
          getTotalPayablesDb(db),
          getTotalSalesThisFYDb(db, fyStartMonth),
          getLowStockCountDb(db),
          getOverdueCountDb(db),
          getCashBankTotalsDb(db),
        ])

      return {
        success: true,
        data: {
          totalReceivables,
          totalPayables,
          totalSales,
          lowStockCount,
          overdueCount,
          cashBankTotal: cashBank.total
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
