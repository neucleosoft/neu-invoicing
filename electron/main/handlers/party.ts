import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { triggerSyncAfterChange } from '../sync'

export const setupPartyHandlers = () => {
  const prisma = getPrisma()

  // Get all parties
  ipcMain.handle('party:getAll', async (_, type?: string) => {
    try {
      const where = type ? { type: type as any } : {}
      const parties = await prisma.party.findMany({
        where,
        orderBy: { name: 'asc' }
      })
      return { success: true, data: parties }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch parties'
      }
    }
  })

  // Get party by ID
  ipcMain.handle('party:getById', async (_, id: string) => {
    try {
      const party = await prisma.party.findUnique({
        where: { id },
        include: {
          salesInvoices: {
            orderBy: { invoiceDate: 'desc' },
            take: 10
          },
          purchaseBills: {
            orderBy: { billDate: 'desc' },
            take: 10
          }
        }
      })
      return { success: true, data: party }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch party'
      }
    }
  })

  // Create party
  ipcMain.handle('party:create', async (_, data) => {
    try {
      const party = await prisma.party.create({
        data: {
          name: data.name,
          type: data.type,
          phone: data.phone,
          email: data.email,
          billingAddress: data.billingAddress,
          shippingAddress: data.shippingAddress,
          taxId: data.taxId,
          openingBalance: data.openingBalance || 0,
          currentBalance: data.openingBalance || 0,
          // GST-specific fields
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

      await triggerSyncAfterChange()
      return { success: true, data: party }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create party'
      }
    }
  })

  // Update party
  ipcMain.handle('party:update', async (_, id: string, data) => {
    try {
      const party = await prisma.party.update({
        where: { id },
        data: {
          name: data.name,
          type: data.type,
          phone: data.phone,
          email: data.email,
          billingAddress: data.billingAddress,
          shippingAddress: data.shippingAddress,
          taxId: data.taxId,
          // GST-specific fields
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

      await triggerSyncAfterChange()
      return { success: true, data: party }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update party'
      }
    }
  })

  // Delete party
  ipcMain.handle('party:delete', async (_, id: string) => {
    try {
      // Check if party has related records
      const party = await prisma.party.findUnique({
        where: { id },
        include: {
          salesInvoices: { take: 1 },
          purchaseBills: { take: 1 },
          payments: { take: 1 }
        }
      })

      if (!party) {
        return { success: false, error: 'Party not found' }
      }

      if (party.salesInvoices.length > 0 || party.purchaseBills.length > 0 || party.payments.length > 0) {
        return {
          success: false,
          error: 'Cannot delete party with existing invoices, bills, or payments. Delete those records first.'
        }
      }

      await prisma.party.delete({
        where: { id }
      })

      await triggerSyncAfterChange()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete party'
      }
    }
  })

  // Get party ledger
  // Customer statement — chronological list of all transactions for a party
  // within a date range, with running balance (positive = party owes us).
  ipcMain.handle(
    'party:getStatement',
    async (_, args: { partyId: string; fromDate: string; toDate: string }) => {
      try {
        const party = await prisma.party.findUnique({ where: { id: args.partyId } })
        if (!party) {
          return { success: false, error: 'Party not found' }
        }

        const from = new Date(args.fromDate)
        const to = new Date(args.toDate)
        // Make `to` end-of-day so transactions on toDate are included.
        to.setHours(23, 59, 59, 999)

        // Fetch all relevant transactions in one go (we need pre-range data
        // for the opening balance plus everything in-range).
        const [invoices, payments, notes] = await Promise.all([
          prisma.salesInvoice.findMany({
            where: {
              partyId: args.partyId,
              type: 'INVOICE',
              invoiceDate: { lte: to },
            },
            select: { id: true, invoiceNumber: true, invoiceDate: true, totalAmount: true },
          }),
          prisma.paymentTransaction.findMany({
            where: {
              partyId: args.partyId,
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
              partyId: args.partyId,
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

        // Split into pre-range (folded into opening balance) and in-range (line items).
        let openingBalance = 0
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
            party,
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

  ipcMain.handle('party:getLedger', async (_, id: string) => {
    try {
      const party = await prisma.party.findUnique({
        where: { id },
        include: {
          salesInvoices: {
            orderBy: { invoiceDate: 'desc' }
          },
          purchaseBills: {
            orderBy: { billDate: 'desc' }
          },
          payments: {
            orderBy: { paymentDate: 'desc' }
          }
        }
      })

      return { success: true, data: party }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch ledger'
      }
    }
  })
}
