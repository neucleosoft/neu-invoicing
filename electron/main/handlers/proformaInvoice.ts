import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { triggerSyncAfterChange } from '../sync'
import {
  buildSalesDocumentValues,
  convertProformaInvoiceToInvoice,
  generateNextProformaInvoiceNumber,
  normalizeSalesDocumentNumber,
} from './salesDocumentHelpers'

export const setupProformaInvoiceHandlers = () => {
  const prisma = getPrisma()

  ipcMain.handle('proformaInvoice:getAll', async () => {
    try {
      const proformaInvoices = await prisma.proformaInvoice.findMany({
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
      return { success: true, data: proformaInvoices }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch proforma invoices'
      }
    }
  })

  ipcMain.handle('proformaInvoice:getById', async (_, id: string) => {
    try {
      const proformaInvoice = await prisma.proformaInvoice.findUnique({
        where: { id },
        include: {
          party: true,
          items: {
            include: {
              item: true
            }
          }
        }
      })
      return { success: true, data: proformaInvoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch proforma invoice'
      }
    }
  })

  ipcMain.handle('proformaInvoice:create', async (_, data) => {
    try {
      data.invoiceNumber = normalizeSalesDocumentNumber(data.invoiceNumber)

      const proformaInvoice = await prisma.$transaction(async (tx: any) => {
        const existing = await tx.proformaInvoice.findUnique({ where: { invoiceNumber: data.invoiceNumber } })
        if (existing) throw new Error(`Proforma invoice number ${data.invoiceNumber} already exists`)

        const values = await buildSalesDocumentValues(tx, data)
        const status = data.status || 'DRAFT'

        return tx.proformaInvoice.create({
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
      return { success: true, data: proformaInvoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create proforma invoice'
      }
    }
  })

  ipcMain.handle('proformaInvoice:update', async (_, id: string, data) => {
    try {
      if (data.invoiceNumber) {
        data.invoiceNumber = normalizeSalesDocumentNumber(data.invoiceNumber)
      }

      const proformaInvoice = await prisma.$transaction(async (tx: any) => {
        const existingProformaInvoice = await tx.proformaInvoice.findUnique({
          where: { id }
        })

        if (!existingProformaInvoice) {
          throw new Error('Proforma invoice not found')
        }

        if (data.invoiceNumber && data.invoiceNumber !== existingProformaInvoice.invoiceNumber) {
          const duplicate = await tx.proformaInvoice.findUnique({ where: { invoiceNumber: data.invoiceNumber } })
          if (duplicate) throw new Error(`Proforma invoice number ${data.invoiceNumber} already exists`)
        }

        const values = await buildSalesDocumentValues(tx, data)
        const status = data.status || existingProformaInvoice.status

        await tx.proformaInvoiceItem.deleteMany({
          where: { proformaInvoiceId: id }
        })

        return tx.proformaInvoice.update({
          where: { id },
          data: {
            invoiceNumber: data.invoiceNumber || existingProformaInvoice.invoiceNumber,
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
      return { success: true, data: proformaInvoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update proforma invoice'
      }
    }
  })

  ipcMain.handle('proformaInvoice:delete', async (_, id: string) => {
    try {
      const proformaInvoice = await prisma.proformaInvoice.findUnique({
        where: { id }
      })

      if (!proformaInvoice) {
        throw new Error('Proforma invoice not found')
      }

      await prisma.proformaInvoice.delete({
        where: { id }
      })

      await triggerSyncAfterChange()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete proforma invoice'
      }
    }
  })

  ipcMain.handle('proformaInvoice:convertToInvoice', async (_, id: string) => {
    try {
      const invoice = await convertProformaInvoiceToInvoice(prisma, id)
      await triggerSyncAfterChange()
      return { success: true, data: invoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to convert proforma invoice'
      }
    }
  })

  ipcMain.handle('proformaInvoice:generateNumber', async () => {
    try {
      const proformaInvoiceNumber = await generateNextProformaInvoiceNumber(prisma)
      return { success: true, data: proformaInvoiceNumber }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate proforma invoice number'
      }
    }
  })
}
