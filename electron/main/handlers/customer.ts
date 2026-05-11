import { ipcMain } from 'electron'
import { getPrisma } from '../database'

export const setupCustomerHandlers = () => {
  const prisma = getPrisma()

  // Get all customers. The Customer Prisma model maps to the legacy `Party`
  // table, which historically also stored suppliers (`type='SUPPLIER'`). Filter
  // those out so they don't pollute the Customers UI.
  ipcMain.handle('customer:getAll', async () => {
    try {
      const customers = await prisma.customer.findMany({
        where: { type: 'CUSTOMER' },
        orderBy: { name: 'asc' }
      })
      return { success: true, data: customers }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch customers'
      }
    }
  })

  // Get customer by ID (with recent sales)
  ipcMain.handle('customer:getById', async (_, id: string) => {
    try {
      const customer = await prisma.customer.findUnique({
        where: { id },
        include: {
          salesInvoices: {
            orderBy: { invoiceDate: 'desc' },
            take: 10
          }
        }
      })
      return { success: true, data: customer }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch customer'
      }
    }
  })

  // Create customer
  ipcMain.handle('customer:create', async (_, data) => {
    try {
      const customer = await prisma.customer.create({
        data: {
          name: data.name,
          type: data.type || 'CUSTOMER',
          phone: data.phone,
          email: data.email,
          billingAddress: data.billingAddress,
          shippingAddress: data.shippingAddress,
          taxId: data.taxId,
          openingBalance: data.openingBalance || 0,
          currentBalance: data.openingBalance || 0,
          stateCode: data.stateCode,
          stateName: data.stateName,
          gstType: data.gstType || 'REGULAR',
          legalName: data.legalName,
          tradeName: data.tradeName,
          gstStatus: data.gstStatus,
          city: data.city,
          district: data.district,
          pincode: data.pincode,
          fetchedFromGst: data.fetchedFromGst || false,
          lastGstFetch: data.lastGstFetch
        }
      })

      return { success: true, data: customer }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create customer'
      }
    }
  })

  // Update customer
  ipcMain.handle('customer:update', async (_, id: string, data) => {
    try {
      const customer = await prisma.customer.update({
        where: { id },
        data: {
          name: data.name,
          type: data.type,
          phone: data.phone,
          email: data.email,
          billingAddress: data.billingAddress,
          shippingAddress: data.shippingAddress,
          taxId: data.taxId,
          stateCode: data.stateCode,
          stateName: data.stateName,
          gstType: data.gstType,
          legalName: data.legalName,
          tradeName: data.tradeName,
          gstStatus: data.gstStatus,
          city: data.city,
          district: data.district,
          pincode: data.pincode,
          fetchedFromGst: data.fetchedFromGst,
          lastGstFetch: data.lastGstFetch
        }
      })

      return { success: true, data: customer }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update customer'
      }
    }
  })

  // Delete customer (only if no records)
  ipcMain.handle('customer:delete', async (_, id: string) => {
    try {
      const customer = await prisma.customer.findUnique({
        where: { id },
        include: {
          salesInvoices: { take: 1 },
          payments: { take: 1 }
        }
      })

      if (!customer) {
        return { success: false, error: 'Customer not found' }
      }

      if (customer.salesInvoices.length > 0 || customer.payments.length > 0) {
        return {
          success: false,
          error: 'Cannot delete customer with existing invoices or payments. Delete those records first.'
        }
      }

      await prisma.customer.delete({
        where: { id }
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete customer'
      }
    }
  })

  // Customer statement — chronological list of all transactions for a customer
  // within a date range, with running balance (positive = customer owes us).
  ipcMain.handle(
    'customer:getStatement',
    async (_, args: { customerId: string; fromDate: string; toDate: string }) => {
      try {
        const customer = await prisma.customer.findUnique({ where: { id: args.customerId } })
        if (!customer) {
          return { success: false, error: 'Customer not found' }
        }

        const from = new Date(args.fromDate)
        const to = new Date(args.toDate)
        to.setHours(23, 59, 59, 999)

        const [invoices, payments, notes] = await Promise.all([
          prisma.salesInvoice.findMany({
            where: {
              customerId: args.customerId,
              type: 'INVOICE',
              invoiceDate: { lte: to },
            },
            select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true },
          }),
          prisma.paymentTransaction.findMany({
            where: {
              customerId: args.customerId,
              type: 'PAYMENT_IN',
              paymentDate: { lte: to },
            },
            select: {
              id: true,
              paymentDate: true,
              amount: true,
              paymentMode: true,
              salesInvoiceId: true,
            },
          }),
          prisma.creditDebitNote.findMany({
            where: {
              customerId: args.customerId,
              status: 'ACTIVE',
              noteDate: { lte: to },
            },
            select: {
              id: true,
              noteNumber: true,
              noteDate: true,
              type: true,
              totalAmount: true,
              referenceInvoiceId: true,
            },
          }),
        ])

        type Entry = {
          date: Date
          type: 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE' | 'DEBIT_NOTE'
          number: string
          particulars: string
          debit: number
          credit: number
        }

        const entries: Entry[] = []

        invoices.forEach((inv) => {
          entries.push({
            date: inv.invoiceDate,
            type: 'INVOICE',
            number: inv.invoiceNumber,
            particulars: `Invoice ${inv.invoiceNumber}`,
            debit: inv.totalAmount || 0,
            credit: 0,
          })
        })

        payments.forEach((p) => {
          entries.push({
            date: p.paymentDate,
            type: 'PAYMENT',
            number: p.id.slice(-8).toUpperCase(),
            particulars: `Payment received (${p.paymentMode})`,
            debit: 0,
            credit: p.amount || 0,
          })
        })

        notes.forEach((n) => {
          if (n.type === 'CREDIT_NOTE') {
            entries.push({
              date: n.noteDate,
              type: 'CREDIT_NOTE',
              number: n.noteNumber,
              particulars: `Credit Note ${n.noteNumber}`,
              debit: 0,
              credit: n.totalAmount || 0,
            })
          } else if (n.type === 'DEBIT_NOTE') {
            entries.push({
              date: n.noteDate,
              type: 'DEBIT_NOTE',
              number: n.noteNumber,
              particulars: `Debit Note ${n.noteNumber}`,
              debit: n.totalAmount || 0,
              credit: 0,
            })
          }
        })

        entries.sort((a, b) => a.date.getTime() - b.date.getTime())

        let openingBalance = customer.openingBalance ?? 0
        const lines: Array<Entry & { balance: number }> = []
        let running = 0

        for (const e of entries) {
          if (e.date < from) {
            openingBalance += e.debit - e.credit
          } else {
            running = (lines.length === 0 ? openingBalance : lines[lines.length - 1].balance) +
              e.debit -
              e.credit
            lines.push({ ...e, balance: running })
          }
        }

        const totalDebit = lines.reduce((s, l) => s + l.debit, 0)
        const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
        const closingBalance = openingBalance + totalDebit - totalCredit

        return {
          success: true,
          data: {
            customer,
            fromDate: args.fromDate,
            toDate: args.toDate,
            openingBalance,
            lines: lines.map((l) => ({ ...l, date: l.date.toISOString() })),
            totalDebit,
            totalCredit,
            closingBalance,
          },
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to build statement',
        }
      }
    }
  )

  ipcMain.handle('customer:getLedger', async (_, id: string) => {
    try {
      const customer = await prisma.customer.findUnique({
        where: { id },
        include: {
          salesInvoices: {
            orderBy: { invoiceDate: 'desc' }
          },
          payments: {
            orderBy: { paymentDate: 'desc' }
          }
        }
      })

      return { success: true, data: customer }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch ledger'
      }
    }
  })
}
