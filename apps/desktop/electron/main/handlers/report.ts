import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { notCancelled, notDeleted } from './softDelete'

export const setupReportHandlers = () => {
  const prisma = getPrisma()

  // Sales Report
  ipcMain.handle('report:getSalesReport', async (_, filters: any) => {
    try {
      const where: any = {
        type: 'INVOICE',
        ...notDeleted,
        ...notCancelled
      }

      if (filters.startDate) {
        where.invoiceDate = {
          ...where.invoiceDate,
          gte: new Date(filters.startDate)
        }
      }

      if (filters.endDate) {
        where.invoiceDate = {
          ...where.invoiceDate,
          lte: new Date(filters.endDate)
        }
      }

      if (filters.customerId) {
        where.customerId = filters.customerId
      }

      if (filters.status) {
        where.status = filters.status
      }

      const invoices = await prisma.salesInvoice.findMany({
        where,
        include: {
          customer: true,
          items: {
            include: {
              item: true
            }
          }
        },
        orderBy: { invoiceDate: 'desc' }
      })

      // Calculate totals
      const totals = {
        subtotal: invoices.reduce((sum, inv) => sum + inv.subtotal, 0),
        discount: invoices.reduce((sum, inv) => sum + inv.discount, 0),
        taxAmount: invoices.reduce((sum, inv) => sum + inv.taxAmount, 0),
        totalAmount: invoices.reduce((sum, inv) => sum + inv.totalAmount, 0),
        amountPaid: invoices.reduce((sum, inv) => sum + inv.amountPaid, 0),
        balanceDue: invoices.reduce((sum, inv) => sum + inv.balanceDue, 0)
      }

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
      const items = await prisma.item.findMany({
        where: {
          trackStock: true,
          ...notDeleted
        },
        orderBy: { name: 'asc' }
      })

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
      const customers = await prisma.customer.findMany({
        where: {
          currentBalance: {
            gt: 0
          },
          ...notDeleted
        },
        include: {
          salesInvoices: {
            where: {
              balanceDue: {
                gt: 0
              },
              ...notDeleted
            },
            orderBy: { invoiceDate: 'asc' }
          }
        },
        orderBy: { currentBalance: 'desc' }
      })

      const totalReceivables = customers.reduce((sum, customer) => sum + customer.currentBalance, 0)

      return {
        success: true,
        data: {
          parties: customers,
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
      const suppliers = await prisma.supplier.findMany({
        where: {
          currentBalance: {
            gt: 0
          },
          ...notDeleted
        },
        include: {
          purchaseBills: {
            where: {
              balanceDue: {
                gt: 0
              },
              ...notDeleted
            },
            orderBy: { billDate: 'asc' }
          }
        },
        orderBy: { currentBalance: 'desc' }
      })

      const totalPayables = suppliers.reduce((sum, supplier) => sum + supplier.currentBalance, 0)

      return {
        success: true,
        data: {
          parties: suppliers,
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
      const where: any = {}

      if (filters.startDate) {
        where.invoiceDate = {
          ...where.invoiceDate,
          gte: new Date(filters.startDate)
        }
      }

      if (filters.endDate) {
        where.invoiceDate = {
          ...where.invoiceDate,
          lte: new Date(filters.endDate)
        }
      }

      // Tax collected on sales
      const salesInvoices = await prisma.salesInvoice.findMany({
        where: {
          ...where,
          type: 'INVOICE',
          ...notDeleted,
          ...notCancelled
        },
        select: {
          invoiceDate: true,
          invoiceNumber: true,
          taxAmount: true,
          totalAmount: true,
          customer: {
            select: {
              name: true
            }
          }
        }
      })

      // Tax paid on purchases — build billDate filter from same date range
      const billWhere: any = {}
      if (filters.startDate) {
        billWhere.billDate = { ...billWhere.billDate, gte: new Date(filters.startDate) }
      }
      if (filters.endDate) {
        billWhere.billDate = { ...billWhere.billDate, lte: new Date(filters.endDate) }
      }

      const purchaseBills = await prisma.purchaseBill.findMany({
        where: { ...billWhere, ...notDeleted, ...notCancelled },
        select: {
          billDate: true,
          billNumber: true,
          taxAmount: true,
          totalAmount: true,
          supplier: {
            select: {
              name: true
            }
          }
        }
      })

      const taxCollected = salesInvoices.reduce((sum, inv) => sum + inv.taxAmount, 0)
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
