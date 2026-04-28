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
      const quotations = await prisma.quotation.findMany({
        include: {
          party: true,
          items: {
            include: {
              item: true,
            },
          },
        },
        orderBy: { invoiceDate: 'desc' },
      })
      return { success: true, data: quotations }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch quotations',
      }
    }
  })

  ipcMain.handle('quotation:getById', async (_, id: string) => {
    try {
      const quotation = await prisma.quotation.findUnique({
        where: { id },
        include: {
          party: true,
          items: {
            include: {
              item: true,
            },
          },
        },
      })
      return { success: true, data: quotation }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch quotation',
      }
    }
  })

  ipcMain.handle('quotation:create', async (_, data) => {
    try {
      data.invoiceNumber = normalizeSalesDocumentNumber(data.invoiceNumber)

      const quotation = await prisma.$transaction(async (tx: any) => {
        const existing = await tx.quotation.findUnique({
          where: { invoiceNumber: data.invoiceNumber },
        })
        if (existing) throw new Error(`Quotation number ${data.invoiceNumber} already exists`)

        const values = await buildSalesDocumentValues(tx, data)
        const status = data.status || 'DRAFT'

        return tx.quotation.create({
          data: {
            invoiceNumber: data.invoiceNumber,
            invoiceDate: new Date(data.invoiceDate),
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            partyId: data.partyId,
            subtotal: values.subtotal,
            discount: data.discount || 0,
            taxAmount: values.taxAmount,
            totalAmount: values.totalAmount,
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
            deliveryTime: data.deliveryTime ? new Date(data.deliveryTime) : null,
            items: {
              create: values.processedItems,
            },
          },
          include: {
            items: { include: { item: true } },
            party: true,
          },
        })
      })

      await triggerSyncAfterChange()
      return { success: true, data: quotation }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create quotation',
      }
    }
  })

  ipcMain.handle('quotation:update', async (_, id: string, data) => {
    try {
      if (data.invoiceNumber) {
        data.invoiceNumber = normalizeSalesDocumentNumber(data.invoiceNumber)
      }

      const quotation = await prisma.$transaction(async (tx: any) => {
        const existingQuotation = await tx.quotation.findUnique({
          where: { id },
        })

        if (!existingQuotation) {
          throw new Error('Quotation not found')
        }

        if (data.invoiceNumber && data.invoiceNumber !== existingQuotation.invoiceNumber) {
          const duplicate = await tx.quotation.findUnique({
            where: { invoiceNumber: data.invoiceNumber },
          })
          if (duplicate) throw new Error(`Quotation number ${data.invoiceNumber} already exists`)
        }

        const values = await buildSalesDocumentValues(tx, data)
        const status = data.status || existingQuotation.status

        await tx.quotationItem.deleteMany({
          where: { quotationId: id },
        })

        return tx.quotation.update({
          where: { id },
          data: {
            invoiceNumber: data.invoiceNumber || existingQuotation.invoiceNumber,
            invoiceDate: new Date(data.invoiceDate),
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            partyId: data.partyId,
            subtotal: values.subtotal,
            discount: data.discount || 0,
            taxAmount: values.taxAmount,
            totalAmount: values.totalAmount,
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
            deliveryTime: data.deliveryTime ? new Date(data.deliveryTime) : null,
            items: {
              create: values.processedItems,
            },
          },
          include: {
            items: { include: { item: true } },
            party: true,
          },
        })
      })

      await triggerSyncAfterChange()
      return { success: true, data: quotation }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update quotation',
      }
    }
  })

  ipcMain.handle('quotation:delete', async (_, id: string) => {
    try {
      const quotation = await prisma.quotation.findUnique({
        where: { id },
      })

      if (!quotation) {
        throw new Error('Quotation not found')
      }

      await prisma.quotation.delete({
        where: { id },
      })

      await triggerSyncAfterChange()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete quotation',
      }
    }
  })

  ipcMain.handle('quotation:convertToInvoice', async (_, quotationId: string) => {
    try {
      const invoice = await convertQuotationToInvoice(prisma, quotationId)
      await triggerSyncAfterChange()
      return { success: true, data: invoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to convert quotation',
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
        error: error instanceof Error ? error.message : 'Failed to generate quotation number',
      }
    }
  })
}
