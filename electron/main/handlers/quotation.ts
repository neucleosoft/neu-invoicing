import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { triggerSyncAfterChange } from '../sync'
import {
  buildSalesDocumentValues,
  convertQuotationToInvoice,
  generateNextQuotationNumber,
  normalizeSalesDocumentNumber,
} from './salesDocumentHelpers'

export const setupQuotationHandlers = () => {
  const prisma = getPrisma()

  ipcMain.handle('quotation:getAll', async () => {
    try {
      const quotations = await prisma.salesInvoice.findMany({
        where: { type: 'QUOTATION' },
        include: {
          party: true,
          items: {
            include: {
              item: true
            }
          }
        },
        orderBy: { invoiceDate: 'desc' }
      })
      return { success: true, data: quotations }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch quotations'
      }
    }
  })

  ipcMain.handle('quotation:getById', async (_, id: string) => {
    try {
      const quotation = await prisma.salesInvoice.findFirst({
        where: { id, type: 'QUOTATION' },
        include: {
          party: true,
          items: {
            include: {
              item: true
            }
          },
          payments: true
        }
      })
      return { success: true, data: quotation }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch quotation'
      }
    }
  })

  ipcMain.handle('quotation:create', async (_, data) => {
    try {
      data.invoiceNumber = normalizeSalesDocumentNumber(data.invoiceNumber)

      const quotation = await prisma.$transaction(async (tx: any) => {
        const existing = await tx.salesInvoice.findUnique({ where: { invoiceNumber: data.invoiceNumber } })
        if (existing) throw new Error(`Quotation number ${data.invoiceNumber} already exists`)

        const values = await buildSalesDocumentValues(tx, data)
        const status = data.status || 'DRAFT'

        return tx.salesInvoice.create({
          data: {
            invoiceNumber: data.invoiceNumber,
            invoiceDate: new Date(data.invoiceDate),
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            type: 'QUOTATION',
            partyId: data.partyId,
            subtotal: values.subtotal,
            discount: data.discount || 0,
            taxAmount: values.taxAmount,
            totalAmount: values.totalAmount,
            amountPaid: 0,
            balanceDue: 0,
            status: status as any,
            notes: data.notes,
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
            party: true
          }
        })
      })

      await triggerSyncAfterChange()
      return { success: true, data: quotation }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create quotation'
      }
    }
  })

  ipcMain.handle('quotation:update', async (_, id: string, data) => {
    try {
      if (data.invoiceNumber) {
        data.invoiceNumber = normalizeSalesDocumentNumber(data.invoiceNumber)
      }

      const quotation = await prisma.$transaction(async (tx: any) => {
        const existingQuotation = await tx.salesInvoice.findFirst({
          where: { id, type: 'QUOTATION' }
        })

        if (!existingQuotation) {
          throw new Error('Quotation not found')
        }

        if (data.invoiceNumber && data.invoiceNumber !== existingQuotation.invoiceNumber) {
          const duplicate = await tx.salesInvoice.findUnique({ where: { invoiceNumber: data.invoiceNumber } })
          if (duplicate) throw new Error(`Quotation number ${data.invoiceNumber} already exists`)
        }

        const values = await buildSalesDocumentValues(tx, data)
        const status = data.status || existingQuotation.status

        await tx.salesInvoiceItem.deleteMany({
          where: { salesInvoiceId: id }
        })

        return tx.salesInvoice.update({
          where: { id },
          data: {
            invoiceNumber: data.invoiceNumber || existingQuotation.invoiceNumber,
            invoiceDate: new Date(data.invoiceDate),
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            type: 'QUOTATION',
            partyId: data.partyId,
            subtotal: values.subtotal,
            discount: data.discount || 0,
            taxAmount: values.taxAmount,
            totalAmount: values.totalAmount,
            amountPaid: 0,
            balanceDue: 0,
            status: status as any,
            notes: data.notes,
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
            party: true
          }
        })
      })

      await triggerSyncAfterChange()
      return { success: true, data: quotation }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update quotation'
      }
    }
  })

  ipcMain.handle('quotation:delete', async (_, id: string) => {
    try {
      const quotation = await prisma.salesInvoice.findFirst({
        where: { id, type: 'QUOTATION' }
      })

      if (!quotation) {
        throw new Error('Quotation not found')
      }

      await prisma.salesInvoice.delete({
        where: { id }
      })

      await triggerSyncAfterChange()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete quotation'
      }
    }
  })

  ipcMain.handle('quotation:convertToInvoice', async (_, quoteId: string) => {
    try {
      const invoice = await convertQuotationToInvoice(prisma, quoteId)
      await triggerSyncAfterChange()
      return { success: true, data: invoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to convert quotation'
      }
    }
  })

  ipcMain.handle('quotation:generateQuotationNumber', async () => {
    try {
      const quotationNumber = await generateNextQuotationNumber(prisma)
      return { success: true, data: quotationNumber }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate quotation number'
      }
    }
  })
}
