import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { triggerSyncAfterChange } from '../sync'

export const setupPaymentHandlers = () => {
  const prisma = getPrisma()

  // Record payment in (from customer)
  ipcMain.handle('payment:recordPaymentIn', async (_, data) => {
    try {
      if (!data.partyId || !data.amount || data.amount <= 0) {
        return { success: false, error: 'Invalid payment: partyId and positive amount required' }
      }

      const payment = await prisma.$transaction(async (tx: any) => {
        const created = await tx.paymentTransaction.create({
          data: {
            type: 'PAYMENT_IN',
            partyId: data.partyId,
            amount: data.amount,
            paymentMode: data.paymentMode || 'CASH',
            paymentDate: new Date(data.paymentDate),
            referenceType: data.referenceType,
            referenceId: data.referenceId,
            salesInvoiceId: data.referenceType === 'INVOICE' ? data.referenceId : null,
            notes: data.notes
          }
        })

        // Update party balance
        await tx.party.update({
          where: { id: data.partyId },
          data: { currentBalance: { decrement: data.amount } }
        })

        // Update invoice if reference is provided
        const invoiceId = data.referenceType === 'INVOICE' ? data.referenceId : null
        if (invoiceId) {
          const invoice = await tx.salesInvoice.findUnique({
            where: { id: invoiceId }
          })

          if (invoice) {
            const newAmountPaid = invoice.amountPaid + data.amount
            const newBalanceDue = invoice.totalAmount - newAmountPaid

            let newStatus = invoice.status
            if (newBalanceDue <= 0) {
              newStatus = 'PAID'
            } else if (newAmountPaid > 0) {
              newStatus = 'PARTIAL'
            }

            await tx.salesInvoice.update({
              where: { id: invoiceId },
              data: {
                amountPaid: newAmountPaid,
                balanceDue: newBalanceDue,
                status: newStatus
              }
            })
          }
        }

        return created
      })

      await triggerSyncAfterChange()
      return { success: true, data: payment }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to record payment'
      }
    }
  })

  // Record payment out (to supplier)
  ipcMain.handle('payment:recordPaymentOut', async (_, data) => {
    try {
      if (!data.partyId || !data.amount || data.amount <= 0) {
        return { success: false, error: 'Invalid payment: partyId and positive amount required' }
      }

      const payment = await prisma.$transaction(async (tx: any) => {
        const created = await tx.paymentTransaction.create({
          data: {
            type: 'PAYMENT_OUT',
            partyId: data.partyId,
            amount: data.amount,
            paymentMode: data.paymentMode || 'CASH',
            paymentDate: new Date(data.paymentDate),
            referenceType: data.referenceType,
            referenceId: data.referenceId,
            purchaseBillId: data.referenceType === 'BILL' ? data.referenceId : null,
            notes: data.notes
          }
        })

        // Update party balance (decrement = we paid the supplier, reducing what we owe)
        await tx.party.update({
          where: { id: data.partyId },
          data: { currentBalance: { decrement: data.amount } }
        })

        // Update purchase bill if reference is provided
        const billId = data.referenceType === 'BILL' ? data.referenceId : null
        if (billId) {
          const bill = await tx.purchaseBill.findUnique({
            where: { id: billId }
          })

          if (bill) {
            const newAmountPaid = bill.amountPaid + data.amount
            const newBalanceDue = bill.totalAmount - newAmountPaid

            let newStatus = bill.status
            if (newBalanceDue <= 0) {
              newStatus = 'PAID'
            } else if (newAmountPaid > 0) {
              newStatus = 'PARTIAL'
            }

            await tx.purchaseBill.update({
              where: { id: billId },
              data: {
                amountPaid: newAmountPaid,
                balanceDue: newBalanceDue,
                status: newStatus
              }
            })
          }
        }

        return created
      })

      await triggerSyncAfterChange()
      return { success: true, data: payment }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to record payment'
      }
    }
  })

  // Get all payments
  ipcMain.handle('payment:getAll', async (_, type?: string) => {
    try {
      const where = type ? { type: type as any } : {}
      const payments = await prisma.paymentTransaction.findMany({
        where,
        include: {
          party: true
        },
        orderBy: { paymentDate: 'desc' }
      })
      return { success: true, data: payments }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch payments'
      }
    }
  })
}
