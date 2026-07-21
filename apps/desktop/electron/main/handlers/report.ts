import { ipcMain } from 'electron'
import { and, asc, desc, eq, gt, gte, lte, type SQL } from '@neu/shared'
import { getDb, schema } from '../db'
import { attachCustomerAndItems } from './docLoaders'
import { creditNoteNet, notCancelled, notDeleted } from './softDelete'

export const setupReportHandlers = () => {
  const db = getDb()

  // Sales Report
  ipcMain.handle('report:getSalesReport', async (_, filters: any) => {
    try {
      const conds: (SQL | undefined)[] = [
        eq(schema.salesInvoice.type, 'INVOICE'),
        notDeleted(schema.salesInvoice.deletedAt),
        notCancelled(schema.salesInvoice.cancelledAt),
      ]
      if (filters.startDate) conds.push(gte(schema.salesInvoice.invoiceDate, new Date(filters.startDate)))
      if (filters.endDate) conds.push(lte(schema.salesInvoice.invoiceDate, new Date(filters.endDate)))
      if (filters.customerId) conds.push(eq(schema.salesInvoice.customerId, filters.customerId))
      if (filters.status) conds.push(eq(schema.salesInvoice.status, filters.status))

      const headers = await db
        .select()
        .from(schema.salesInvoice)
        .where(and(...conds))
        .orderBy(desc(schema.salesInvoice.invoiceDate))
      const invoices = await attachCustomerAndItems(db, headers, schema.salesInvoiceItem, 'salesInvoiceId')

      // Calculate totals
      const totals = {
        subtotal: invoices.reduce((sum, inv) => sum + inv.subtotal, 0),
        discount: invoices.reduce((sum, inv) => sum + inv.discount, 0),
        taxAmount: invoices.reduce((sum, inv) => sum + inv.taxAmount, 0),
        totalAmount: invoices.reduce((sum, inv) => sum + inv.totalAmount, 0),
        amountPaid: invoices.reduce((sum, inv) => sum + inv.amountPaid, 0),
        balanceDue: invoices.reduce((sum, inv) => sum + inv.balanceDue, 0)
      }

      // Net out credit notes for the same period (a return/reversal reduces sales).
      // amountPaid/balanceDue/discount are receivable-side — left as-is.
      const cn = await creditNoteNet(db, {
        gte: filters.startDate ? new Date(filters.startDate) : undefined,
        lte: filters.endDate ? new Date(filters.endDate) : undefined,
        customerId: filters.customerId || undefined,
      })
      totals.subtotal += cn.subtotal
      totals.taxAmount += cn.taxAmount
      totals.totalAmount += cn.totalAmount

      return { success: true, data: { invoices, totals } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate sales report'
      }
    }
  })

  // Stock Summary
  ipcMain.handle('report:getStockSummary', async () => {
    try {
      const items = await db
        .select()
        .from(schema.item)
        .where(and(eq(schema.item.trackStock, true), notDeleted(schema.item.deletedAt)))
        .orderBy(asc(schema.item.name))

      const stockData = items.map(item => ({
        ...item,
        stockValue: item.currentStock * item.purchasePrice,
        status: item.currentStock <= item.lowStockWarning ? 'Low Stock' : 'In Stock'
      }))

      const totalStockValue = stockData.reduce((sum, item) => sum + item.stockValue, 0)

      return {
        success: true,
        data: {
          items: stockData,
          totalStockValue
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate stock summary'
      }
    }
  })

  // Outstanding Receivables
  ipcMain.handle('report:getReceivables', async () => {
    try {
      const customers = await db
        .select()
        .from(schema.customer)
        .where(and(gt(schema.customer.currentBalance, 0), notDeleted(schema.customer.deletedAt)))
        .orderBy(desc(schema.customer.currentBalance))

      const customerIds = customers.map((c) => c.id)
      const openInvoices = customerIds.length
        ? await db
            .select()
            .from(schema.salesInvoice)
            .where(and(
              gt(schema.salesInvoice.balanceDue, 0),
              notDeleted(schema.salesInvoice.deletedAt),
            ))
            .orderBy(asc(schema.salesInvoice.invoiceDate))
        : []
      const invoicesByCustomer = new Map<string, any[]>()
      for (const inv of openInvoices) {
        if (!inv.customerId) continue
        if (!invoicesByCustomer.has(inv.customerId)) invoicesByCustomer.set(inv.customerId, [])
        invoicesByCustomer.get(inv.customerId)!.push(inv)
      }

      const parties = customers.map((c) => ({ ...c, salesInvoices: invoicesByCustomer.get(c.id) ?? [] }))
      const totalReceivables = customers.reduce((sum, customer) => sum + customer.currentBalance, 0)

      return {
        success: true,
        data: {
          parties,
          totalReceivables
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate receivables report'
      }
    }
  })

  // Outstanding Payables
  ipcMain.handle('report:getPayables', async () => {
    try {
      const suppliers = await db
        .select()
        .from(schema.supplier)
        .where(and(gt(schema.supplier.currentBalance, 0), notDeleted(schema.supplier.deletedAt)))
        .orderBy(desc(schema.supplier.currentBalance))

      const openBills = suppliers.length
        ? await db
            .select()
            .from(schema.purchaseBill)
            .where(and(
              gt(schema.purchaseBill.balanceDue, 0),
              notDeleted(schema.purchaseBill.deletedAt),
            ))
            .orderBy(asc(schema.purchaseBill.billDate))
        : []
      const billsBySupplier = new Map<string, any[]>()
      for (const bill of openBills) {
        if (!billsBySupplier.has(bill.supplierId)) billsBySupplier.set(bill.supplierId, [])
        billsBySupplier.get(bill.supplierId)!.push(bill)
      }

      const parties = suppliers.map((s) => ({ ...s, purchaseBills: billsBySupplier.get(s.id) ?? [] }))
      const totalPayables = suppliers.reduce((sum, supplier) => sum + supplier.currentBalance, 0)

      return {
        success: true,
        data: {
          parties,
          totalPayables
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate payables report'
      }
    }
  })

  // Tax Report
  ipcMain.handle('report:getTaxReport', async (_, filters: any) => {
    try {
      // Tax collected on sales
      const invConds: (SQL | undefined)[] = [
        eq(schema.salesInvoice.type, 'INVOICE'),
        notDeleted(schema.salesInvoice.deletedAt),
        notCancelled(schema.salesInvoice.cancelledAt),
      ]
      if (filters.startDate) invConds.push(gte(schema.salesInvoice.invoiceDate, new Date(filters.startDate)))
      if (filters.endDate) invConds.push(lte(schema.salesInvoice.invoiceDate, new Date(filters.endDate)))

      const salesRows = await db
        .select({
          invoiceDate: schema.salesInvoice.invoiceDate,
          invoiceNumber: schema.salesInvoice.invoiceNumber,
          taxAmount: schema.salesInvoice.taxAmount,
          totalAmount: schema.salesInvoice.totalAmount,
          customerName: schema.customer.name,
        })
        .from(schema.salesInvoice)
        .leftJoin(schema.customer, eq(schema.salesInvoice.customerId, schema.customer.id))
        .where(and(...invConds))
      const salesInvoices = salesRows.map((r) => ({
        invoiceDate: r.invoiceDate,
        invoiceNumber: r.invoiceNumber,
        taxAmount: r.taxAmount,
        totalAmount: r.totalAmount,
        customer: { name: r.customerName ?? '' },
      }))

      // Tax paid on purchases — same date range on billDate
      const billConds: (SQL | undefined)[] = [
        notDeleted(schema.purchaseBill.deletedAt),
        notCancelled(schema.purchaseBill.cancelledAt),
      ]
      if (filters.startDate) billConds.push(gte(schema.purchaseBill.billDate, new Date(filters.startDate)))
      if (filters.endDate) billConds.push(lte(schema.purchaseBill.billDate, new Date(filters.endDate)))

      const billRows = await db
        .select({
          billDate: schema.purchaseBill.billDate,
          billNumber: schema.purchaseBill.billNumber,
          taxAmount: schema.purchaseBill.taxAmount,
          totalAmount: schema.purchaseBill.totalAmount,
          supplierName: schema.supplier.name,
        })
        .from(schema.purchaseBill)
        .leftJoin(schema.supplier, eq(schema.purchaseBill.supplierId, schema.supplier.id))
        .where(and(...billConds))
      const purchaseBills = billRows.map((r) => ({
        billDate: r.billDate,
        billNumber: r.billNumber,
        taxAmount: r.taxAmount,
        totalAmount: r.totalAmount,
        supplier: { name: r.supplierName ?? '' },
      }))

      // Credit notes reduce the tax you collected (a return gives the GST back).
      const cnTax = await creditNoteNet(db, {
        gte: filters.startDate ? new Date(filters.startDate) : undefined,
        lte: filters.endDate ? new Date(filters.endDate) : undefined,
      })
      const taxCollected = salesInvoices.reduce((sum, inv) => sum + inv.taxAmount, 0) + cnTax.taxAmount
      const taxPaid = purchaseBills.reduce((sum, bill) => sum + bill.taxAmount, 0)
      const netTax = taxCollected - taxPaid

      return {
        success: true,
        data: {
          salesInvoices,
          purchaseBills,
          taxCollected,
          taxPaid,
          netTax
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate tax report'
      }
    }
  })
}
