import { ipcMain } from 'electron'
import { getPrisma } from '../database'

// Recompute an invoice/bill payment status from its total and amount paid.
const computeStatus = (total: number, paid: number): 'PAID' | 'PARTIAL' | 'DRAFT' => {
  if (total - paid <= 0) return 'PAID'
  if (paid > 0) return 'PARTIAL'
  return 'DRAFT'
}

// Apply a payment's effect: reduce the party's balance and credit the linked
// invoice/bill. Used when a payment is (re-)applied.
const applyPayment = async (tx: any, p: any) => {
  if (p.type === 'PAYMENT_IN') {
    if (p.customerId) {
      await tx.customer.update({ where: { id: p.customerId }, data: { currentBalance: { decrement: p.amount } } })
    }
    if (p.salesInvoiceId) {
      const inv = await tx.salesInvoice.findUnique({ where: { id: p.salesInvoiceId } })
      if (inv) {
        const paid = inv.amountPaid + p.amount
        await tx.salesInvoice.update({
          where: { id: p.salesInvoiceId },
          data: { amountPaid: paid, balanceDue: inv.totalAmount - paid, status: computeStatus(inv.totalAmount, paid) },
        })
      }
    }
  } else {
    if (p.supplierId) {
      await tx.supplier.update({ where: { id: p.supplierId }, data: { currentBalance: { decrement: p.amount } } })
    }
    if (p.purchaseBillId) {
      const bill = await tx.purchaseBill.findUnique({ where: { id: p.purchaseBillId } })
      if (bill) {
        const paid = bill.amountPaid + p.amount
        await tx.purchaseBill.update({
          where: { id: p.purchaseBillId },
          data: { amountPaid: paid, balanceDue: bill.totalAmount - paid, status: computeStatus(bill.totalAmount, paid) },
        })
      }
    }
  }
}

// Reverse a payment's effect — the exact inverse of applyPayment. Used when a
// payment is deleted or before an update re-applies the new values.
const reversePayment = async (tx: any, p: any) => {
  if (p.type === 'PAYMENT_IN') {
    if (p.customerId) {
      await tx.customer.update({ where: { id: p.customerId }, data: { currentBalance: { increment: p.amount } } })
    }
    if (p.salesInvoiceId) {
      const inv = await tx.salesInvoice.findUnique({ where: { id: p.salesInvoiceId } })
      if (inv) {
        const paid = inv.amountPaid - p.amount
        await tx.salesInvoice.update({
          where: { id: p.salesInvoiceId },
          data: { amountPaid: paid, balanceDue: inv.totalAmount - paid, status: computeStatus(inv.totalAmount, paid) },
        })
      }
    }
  } else {
    if (p.supplierId) {
      await tx.supplier.update({ where: { id: p.supplierId }, data: { currentBalance: { increment: p.amount } } })
    }
    if (p.purchaseBillId) {
      const bill = await tx.purchaseBill.findUnique({ where: { id: p.purchaseBillId } })
      if (bill) {
        const paid = bill.amountPaid - p.amount
        await tx.purchaseBill.update({
          where: { id: p.purchaseBillId },
          data: { amountPaid: paid, balanceDue: bill.totalAmount - paid, status: computeStatus(bill.totalAmount, paid) },
        })
      }
    }
  }
}

export const setupPaymentHandlers = () => {
  const prisma = getPrisma()

  // Record payment in (from customer)
  ipcMain.handle('payment:recordPaymentIn', async (_, data) => {
    try {
      if (!data.customerId || !data.amount || data.amount <= 0) {
        return { success: false, error: 'Invalid payment: customerId and positive amount required' }
      }

      const payment = await prisma.$transaction(async (tx: any) => {
        const created = await tx.paymentTransaction.create({
          data: {
            type: 'PAYMENT_IN',
            customerId: data.customerId,
            amount: data.amount,
            paymentMode: data.paymentMode || 'CASH',
            paymentDate: new Date(data.paymentDate),
            referenceType: data.referenceType,
            referenceId: data.referenceId,
            salesInvoiceId: data.referenceType === 'INVOICE' ? data.referenceId : null,
            notes: data.notes
          }
        })

        // Update customer balance
        await tx.customer.update({
          where: { id: data.customerId },
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
      if (!data.supplierId || !data.amount || data.amount <= 0) {
        return { success: false, error: 'Invalid payment: supplierId and positive amount required' }
      }

      const payment = await prisma.$transaction(async (tx: any) => {
        const created = await tx.paymentTransaction.create({
          data: {
            type: 'PAYMENT_OUT',
            supplierId: data.supplierId,
            amount: data.amount,
            paymentMode: data.paymentMode || 'CASH',
            paymentDate: new Date(data.paymentDate),
            referenceType: data.referenceType,
            referenceId: data.referenceId,
            purchaseBillId: data.referenceType === 'BILL' ? data.referenceId : null,
            notes: data.notes
          }
        })

        // Update supplier balance (decrement = we paid the supplier, reducing what we owe)
        await tx.supplier.update({
          where: { id: data.supplierId },
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
          customer: true,
          supplier: true,
          purchaseBill: {
            include: {
              supplier: true
            }
          }
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

  // Update a payment — reverse the original effect, then apply the new values.
  ipcMain.handle('payment:update', async (_, id: string, data) => {
    try {
      const existing = await prisma.paymentTransaction.findUnique({ where: { id } })
      if (!existing) return { success: false, error: 'Payment not found' }
      if (!data.amount || data.amount <= 0) {
        return { success: false, error: 'A positive amount is required' }
      }

      const updated = await prisma.$transaction(async (tx: any) => {
        await reversePayment(tx, existing)

        const row = await tx.paymentTransaction.update({
          where: { id },
          data: {
            customerId: existing.type === 'PAYMENT_IN' ? data.customerId ?? existing.customerId : existing.customerId,
            supplierId: existing.type === 'PAYMENT_OUT' ? data.supplierId ?? existing.supplierId : existing.supplierId,
            amount: data.amount,
            paymentMode: data.paymentMode || existing.paymentMode,
            paymentDate: data.paymentDate ? new Date(data.paymentDate) : existing.paymentDate,
            notes: data.notes ?? existing.notes,
          },
        })

        await applyPayment(tx, row)
        return row
      })

      return { success: true, data: updated }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update payment'
      }
    }
  })

  // Cancel a payment (Mode B): reverse its effect on balances and the linked
  // invoice/bill, then stamp cancelledAt instead of deleting. The row stays on
  // record, marked Cancelled, forever. Terminal — there is no restore.
  ipcMain.handle('payment:cancel', async (_, id: string) => {
    try {
      const existing = await prisma.paymentTransaction.findUnique({ where: { id } })
      if (!existing) return { success: false, error: 'Payment not found' }
      // Already cancelled — never reverse the balance twice (idempotency guard).
      if (existing.cancelledAt) return { success: true }

      await prisma.$transaction(async (tx: any) => {
        await reversePayment(tx, existing)
        await tx.paymentTransaction.update({ where: { id }, data: { cancelledAt: new Date() } })
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel payment'
      }
    }
  })
}
