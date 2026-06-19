import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import {
  buildSalesDocumentValues,
  derivePaymentStatus,
  generateNextInvoiceNumber,
  normalizeSalesDocumentNumber,
} from './salesDocumentHelpers'

// Marks the single "up-front payment" auto-managed by the invoice form (create + edit),
// so editing the Amount Paid can find and re-sync exactly that row — without touching
// payments the user recorded separately on the Payments screen.
const INLINE_PAYMENT_NOTE = 'Paid with invoice'

export const setupSalesHandlers = () => {
  const prisma = getPrisma()

  // Get all sales invoices
  ipcMain.handle('sales:getAll', async () => {
    try {
      const invoices = await prisma.salesInvoice.findMany({
        where: { type: 'INVOICE' },
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
      return { success: true, data: invoices }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch invoices'
      }
    }
  })

  // Get invoice by ID
  ipcMain.handle('sales:getById', async (_, id: string) => {
    try {
      const invoice = await prisma.salesInvoice.findFirst({
        where: { id, type: 'INVOICE' },
        include: {
          customer: true,
          items: {
            include: {
              item: true
            }
          },
          payments: true
        }
      })
      return { success: true, data: invoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch invoice'
      }
    }
  })

  // Create invoice
  ipcMain.handle('sales:create', async (_, data) => {
    try {
      // Normalize invoice number — pad last numeric segment to 2 digits
      // so NS/SL/26-27/6 and NS/SL/26-27/06 are treated as the same
      data.invoiceNumber = normalizeSalesDocumentNumber(data.invoiceNumber)

      const invoice = await prisma.$transaction(async (tx: any) => {
        // Check for duplicate invoice number
        const existing = await tx.salesInvoice.findUnique({ where: { invoiceNumber: data.invoiceNumber } })
        if (existing) throw new Error(`Invoice number ${data.invoiceNumber} already exists`)

        const values = await buildSalesDocumentValues(tx, data)
        const totalAmount = values.totalAmount
        const amountPaid = data.amountPaid || 0
        const balanceDue = totalAmount - amountPaid

        // Paid-status is DERIVED from the money, never the hand-set dropdown — so the
        // label can't contradict the amount. OVERDUE is the one exception (it's about
        // the due date, not the amount), so we preserve it when chosen.
        const status = data.status === 'OVERDUE'
          ? 'OVERDUE'
          : derivePaymentStatus(totalAmount, amountPaid)

        const created = await tx.salesInvoice.create({
          data: {
            invoiceNumber: data.invoiceNumber,
            invoiceDate: new Date(data.invoiceDate),
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            type: 'INVOICE',
            customerId: data.customerId,
            subtotal: values.subtotal,
            discount: data.discount || 0,
            taxAmount: values.taxAmount,
            totalAmount,
            amountPaid,
            balanceDue,
            status: status as any,
            notes: data.notes,
            termsConditions: data.termsConditions ?? null,
            placeOfSupply: values.placeOfSupply,
            placeOfSupplyName: values.placeOfSupplyName,
            isInterState: values.isInterState,
            reverseCharge: data.reverseCharge || false,
            cgstAmount: values.totalCgst,
            sgstAmount: values.totalSgst,
            igstAmount: values.totalIgst,
            cessAmount: values.totalCess,
            supplyType: values.supplyType,
            ecommerceGstin: data.ecommerceGstin || null,
            poNumber: data.poNumber || null,
            ewayBillNo: data.ewayBillNo || null,
            vehicleNumber: data.vehicleNumber || null,
            warrantyPeriod: data.warrantyPeriod || null,
            dispatchedThrough: data.dispatchedThrough || null,
            items: {
              create: values.processedItems
            }
          },
          include: {
            items: { include: { item: true } },
            customer: true
          }
        })

        // Update customer balance
        await tx.customer.update({
          where: { id: data.customerId},
          data: { currentBalance: { increment: balanceDue } }
        })

        for (const item of data.items) {
          const dbItem = await tx.item.findUnique({ where: { id: item.itemId } })
          if (dbItem && dbItem.trackStock) {
            await tx.item.update({
              where: { id: item.itemId },
              data: { currentStock: { decrement: item.quantity } }
            })

            await tx.stockMovement.create({
              data: {
                itemId: item.itemId,
                movementType: 'SALE',
                quantity: -item.quantity,
                referenceType: 'INVOICE',
                referenceId: created.id
              }
            })
          }
        }

        // Record any up-front payment as a real Payment In row so it shows in the
        // customer's statement/ledger — not just a number stamped on the invoice.
        // currentBalance was already bumped by the NET balanceDue above, so we do
        // NOT re-apply the payment here; this row is the ledger record of that money.
        if (amountPaid > 0) {
          await tx.paymentTransaction.create({
            data: {
              type: 'PAYMENT_IN',
              customerId: data.customerId,
              amount: amountPaid,
              paymentMode: data.paymentMode || 'CASH',
              paymentDate: new Date(data.invoiceDate),
              referenceType: 'INVOICE',
              salesInvoiceId: created.id,
              notes: INLINE_PAYMENT_NOTE,
            },
          })
        }

        return created
      })

      return { success: true, data: invoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create invoice'
      }
    }
  })

  // Update invoice
  ipcMain.handle('sales:update', async (_, id: string, data) => {
    try {
      // Normalize invoice number
      if (data.invoiceNumber) {
        data.invoiceNumber = normalizeSalesDocumentNumber(data.invoiceNumber)
      }

      const invoice = await prisma.$transaction(async (tx: any) => {
        const existingInvoice = await tx.salesInvoice.findUnique({
          where: { id },
          include: { items: true }
        })

        if (!existingInvoice || existingInvoice.type !== 'INVOICE') {
          throw new Error('Invoice not found')
        }

        // Check for duplicate if invoice number changed
        if (data.invoiceNumber && data.invoiceNumber !== existingInvoice.invoiceNumber) {
          const duplicate = await tx.salesInvoice.findUnique({ where: { invoiceNumber: data.invoiceNumber } })
          if (duplicate) throw new Error(`Invoice number ${data.invoiceNumber} already exists`)
        }

        const values = await buildSalesDocumentValues(tx, data)
        const totalAmount = values.totalAmount

        // Amount Paid is editable on the form (driven by the Status), so it's the source
        // of truth here. Reversed invoices are terminal — keep their figures frozen.
        const isReversed = existingInvoice.status === 'REVERSED'
        const amountPaid = isReversed
          ? (existingInvoice.amountPaid || 0)
          : (data.amountPaid ?? existingInvoice.amountPaid ?? 0)
        const balanceDue = totalAmount - amountPaid

        // Status follows the money so it can't contradict it; OVERDUE is preserved when
        // chosen (it's about the due date, not the amount); REVERSED stays terminal.
        const status = isReversed
          ? 'REVERSED'
          : data.status === 'OVERDUE'
          ? 'OVERDUE'
          : derivePaymentStatus(totalAmount, amountPaid)

        // Delete existing items
        await tx.salesInvoiceItem.deleteMany({
          where: { salesInvoiceId: id }
        })

        const updated = await tx.salesInvoice.update({
          where: { id },
          data: {
            invoiceNumber: data.invoiceNumber,
            invoiceDate: new Date(data.invoiceDate),
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            type: 'INVOICE',
            customerId: data.customerId,
            subtotal: values.subtotal,
            discount: data.discount || 0,
            taxAmount: values.taxAmount,
            totalAmount,
            amountPaid,
            balanceDue,
            status: status as any,
            notes: data.notes,
            termsConditions: data.termsConditions ?? null,
            placeOfSupply: values.placeOfSupply,
            placeOfSupplyName: values.placeOfSupplyName,
            isInterState: values.isInterState,
            cgstAmount: values.totalCgst,
            sgstAmount: values.totalSgst,
            igstAmount: values.totalIgst,
            supplyType: values.supplyType,
            poNumber: data.poNumber || null,
            ewayBillNo: data.ewayBillNo || null,
            vehicleNumber: data.vehicleNumber || null,
            warrantyPeriod: data.warrantyPeriod || null,
            dispatchedThrough: data.dispatchedThrough || null,
            items: {
              create: values.processedItems
            }
          },
          include: {
            items: { include: { item: true } },
            customer: true
          }
        })

        // Update customer balance — handle customer change correctly
        if (data.customerId !== existingInvoice.customerId) {
          // Customer changed: reverse the old customer's balance, apply to the new customer
          await tx.customer.update({
            where: { id: existingInvoice.customerId},
            data: { currentBalance: { decrement: existingInvoice.balanceDue } }
          })
          await tx.customer.update({
            where: { id: data.customerId},
            data: { currentBalance: { increment: balanceDue } }
          })
        } else {
          const balanceDiff = balanceDue - existingInvoice.balanceDue
          if (balanceDiff !== 0) {
            await tx.customer.update({
              where: { id: data.customerId},
              data: { currentBalance: { increment: balanceDiff } }
            })
          }
        }

        // Re-sync the invoice's up-front payment row to match the edited Amount Paid, so
        // the customer's statement always agrees with the invoice. We only touch the row
        // tagged as the inline payment — payments recorded on the Payments screen are left
        // alone. currentBalance is handled by balanceDiff above, so this row is purely the
        // ledger record (we do NOT re-apply it).
        if (!isReversed) {
          const inlinePayment = await tx.paymentTransaction.findFirst({
            where: {
              salesInvoiceId: id,
              type: 'PAYMENT_IN',
              notes: INLINE_PAYMENT_NOTE,
              cancelledAt: null,
            },
          })
          if (amountPaid > 0) {
            if (inlinePayment) {
              await tx.paymentTransaction.update({
                where: { id: inlinePayment.id },
                data: {
                  amount: amountPaid,
                  paymentMode: data.paymentMode || inlinePayment.paymentMode,
                  paymentDate: new Date(data.invoiceDate),
                  customerId: data.customerId,
                },
              })
            } else {
              await tx.paymentTransaction.create({
                data: {
                  type: 'PAYMENT_IN',
                  customerId: data.customerId,
                  amount: amountPaid,
                  paymentMode: data.paymentMode || 'CASH',
                  paymentDate: new Date(data.invoiceDate),
                  referenceType: 'INVOICE',
                  salesInvoiceId: id,
                  notes: INLINE_PAYMENT_NOTE,
                },
              })
            }
          } else if (inlinePayment) {
            // Marked Unpaid on edit → void the up-front payment (keep the record; a
            // deleted payment can't sync, so we cancel rather than delete).
            await tx.paymentTransaction.update({
              where: { id: inlinePayment.id },
              data: { cancelledAt: new Date(), cancelReason: 'Invoice marked unpaid' },
            })
          }
        }

        return updated
      })

      return { success: true, data: invoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update invoice'
      }
    }
  })

  // Cancel invoice (Mode B): reverse the customer balance + stock (appending a
  // reversing movement), then stamp cancelledAt. Wrapped in a $transaction so the
  // reversal is atomic — the old delete was NOT, and could FK-crash on a paid invoice
  // after already moving balance/stock. The invoice, its items, and its movements all
  // stay on record. Terminal — there is no restore.
  ipcMain.handle('sales:cancel', async (_, id: string) => {
    try {
      await prisma.$transaction(async (tx: any) => {
        const invoice = await tx.salesInvoice.findUnique({
          where: { id },
          include: {
            items: true
          }
        })

        if (!invoice || invoice.type !== 'INVOICE') {
          throw new Error('Invoice not found')
        }

        // Already cancelled — never reverse the balance/stock twice (idempotency guard).
        if (invoice.cancelledAt) {
          return
        }

        await tx.customer.update({
          where: { id: invoice.customerId },
          data: {
            currentBalance: {
              decrement: invoice.balanceDue
            }
          }
        })

        // Put tracked stock back AND append a "returned" movement per line. We do NOT
        // delete the original movements: cancel preserves the record, and a deleted
        // stockMovement can't sync (the table has no soft-delete column).
        for (const item of invoice.items) {
          const dbItem = await tx.item.findUnique({ where: { id: item.itemId } })
          if (dbItem && dbItem.trackStock) {
            await tx.item.update({
              where: { id: item.itemId },
              data: {
                currentStock: {
                  increment: item.quantity
                }
              }
            })
            await tx.stockMovement.create({
              data: {
                itemId: item.itemId,
                movementType: 'SALE',
                quantity: item.quantity, // positive = goods returned by the cancel
                referenceType: 'INVOICE',
                referenceId: id,
                notes: 'Invoice cancelled — stock returned'
              }
            })
          }
        }

        // CANCEL, not delete: stamp cancelledAt; the invoice, its items, and its
        // stock movements all stay on record.
        await tx.salesInvoice.update({
          where: { id },
          data: { cancelledAt: new Date() }
        })
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel invoice'
      }
    }
  })

  // Reverse a PAID/part-paid invoice by issuing a full-value credit note — the
  // GST-correct way to undo a sale where money or tax has already moved. Unlike
  // sales:cancel (which HIDES an unpaid invoice), this KEEPS the invoice visible and
  // posts an offsetting credit note, so the customer's statement nets correctly and
  // any payment they made is never orphaned — it becomes a credit we owe them
  // (negative balance), to be adjusted against a future bill. The invoice is marked
  // status 'REVERSED' (NOT cancelledAt) so it stays on the ledger beside its note.
  // One $transaction; terminal — there is no restore.
  ipcMain.handle(
    'sales:cancelWithCreditNote',
    async (_, id: string, payload: { noteNumber: string; noteDate?: string; reason?: string }) => {
      try {
        const note = await prisma.$transaction(async (tx: any) => {
          const invoice = await tx.salesInvoice.findUnique({
            where: { id },
            include: { items: true },
          })

          if (!invoice || invoice.type !== 'INVOICE') {
            throw new Error('Invoice not found')
          }
          if (invoice.cancelledAt) {
            throw new Error('This invoice was already cancelled')
          }
          // Already reversed — never post the note / reverse the balance twice.
          if (invoice.status === 'REVERSED') {
            return null
          }

          // A full reversal is an exact mirror of the invoice, so copy its stored
          // line items + GST split into the note rather than recomputing them.
          const noteItems = invoice.items.map((it: any) => ({
            itemId: it.itemId,
            quantity: it.quantity,
            rate: it.rate,
            discount: it.discount || 0,
            taxRate: it.taxRate || 0,
            total: it.total,
            hsnCode: it.hsnCode || '',
            taxableAmount: it.taxableAmount,
            cgstRate: it.cgstRate,
            cgstAmount: it.cgstAmount,
            sgstRate: it.sgstRate,
            sgstAmount: it.sgstAmount,
            igstRate: it.igstRate,
            igstAmount: it.igstAmount,
          }))

          const created = await tx.creditDebitNote.create({
            data: {
              noteNumber: payload.noteNumber,
              noteDate: payload.noteDate ? new Date(payload.noteDate) : new Date(),
              type: 'CREDIT_NOTE',
              customerId: invoice.customerId,
              referenceInvoiceId: invoice.id,
              reason: payload.reason || 'Invoice cancelled',
              subtotal: invoice.subtotal,
              taxAmount: invoice.taxAmount,
              totalAmount: invoice.totalAmount,
              cgstAmount: invoice.cgstAmount,
              sgstAmount: invoice.sgstAmount,
              igstAmount: invoice.igstAmount,
              isInterState: invoice.isInterState,
              status: 'ACTIVE',
              items: { create: noteItems },
            },
            include: {
              items: { include: { item: true } },
              customer: true,
              referenceInvoice: true,
            },
          })

          // Reverse the whole sale on the customer ledger: -totalAmount nets off both
          // what they still owed (balanceDue) AND any cash they paid (amountPaid) — a
          // paid invoice ends at a negative balance = credit we owe them.
          await tx.customer.update({
            where: { id: invoice.customerId },
            data: { currentBalance: { decrement: invoice.totalAmount } },
          })

          // Put tracked stock back, appending a reversing movement (never delete —
          // a deleted stockMovement can't sync). Same pattern as sales:cancel.
          for (const item of invoice.items) {
            const dbItem = await tx.item.findUnique({ where: { id: item.itemId } })
            if (dbItem && dbItem.trackStock) {
              await tx.item.update({
                where: { id: item.itemId },
                data: { currentStock: { increment: item.quantity } },
              })
              await tx.stockMovement.create({
                data: {
                  itemId: item.itemId,
                  movementType: 'SALE',
                  quantity: item.quantity, // positive = goods returned by the reversal
                  referenceType: 'INVOICE',
                  referenceId: id,
                  notes: 'Invoice reversed via credit note — stock returned',
                },
              })
            }
          }

          // Mark REVERSED (not cancelledAt): the invoice STAYS on the statement
          // beside its credit note. balanceDue → 0 so it drops out of receivables.
          await tx.salesInvoice.update({
            where: { id },
            data: { status: 'REVERSED', balanceDue: 0 },
          })

          return created
        })

        return { success: true, data: note }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to reverse invoice',
        }
      }
    }
  )

  // Generate invoice number
  ipcMain.handle('sales:generateInvoiceNumber', async () => {
    try {
      const newInvoiceNumber = await generateNextInvoiceNumber(prisma)
      return { success: true, data: newInvoiceNumber }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate invoice number'
      }
    }
  })

  // Generate PDF
  ipcMain.handle('sales:generatePDF', async (_, _id: string) => {
    try {
      // PDF generation will be implemented with pdfmake
      // For now, return placeholder
      return {
        success: true,
        message: 'PDF generation not yet implemented'
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate PDF'
      }
    }
  })
}
