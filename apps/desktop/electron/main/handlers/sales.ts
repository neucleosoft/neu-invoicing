import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import {
  buildSalesDocumentValues,
  generateNextInvoiceNumber,
  normalizeSalesDocumentNumber,
} from './salesDocumentHelpers'

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
        const balanceDue = totalAmount - (data.amountPaid || 0)

        const status = data.status || 'DRAFT'

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
            amountPaid: data.amountPaid || 0,
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
        const balanceDue = totalAmount - (existingInvoice.amountPaid || 0)

        const status = data.status || existingInvoice.status

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
