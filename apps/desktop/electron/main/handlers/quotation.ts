import { ipcMain } from 'electron'
import { desc, eq } from '@neu/shared'
import { getDb, schema } from '../db'
import { attachCustomerAndItems } from './docLoaders'
import {
  buildSalesDocumentValues,
  convertQuotationToInvoice,
  generateNextQuotationNumber,
  normalizeSalesDocumentNumber,
} from './salesDocumentHelpers'

export const setupQuotationHandlers = () => {
  const db = getDb()

  ipcMain.handle('quotation:getAll', async () => {
    try {
      const headers = await db.select().from(schema.quotation).orderBy(desc(schema.quotation.invoiceDate))
      const quotations = await attachCustomerAndItems(db, headers, schema.quotationItem, 'quotationId')
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
      const [header] = await db.select().from(schema.quotation).where(eq(schema.quotation.id, id)).limit(1)
      if (!header) return { success: true, data: null }
      const [quotation] = await attachCustomerAndItems(db, [header], schema.quotationItem, 'quotationId')
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

      const created = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: schema.quotation.id })
          .from(schema.quotation)
          .where(eq(schema.quotation.invoiceNumber, data.invoiceNumber))
          .limit(1)
        if (existing) throw new Error(`Quotation number ${data.invoiceNumber} already exists`)

        const values = await buildSalesDocumentValues(tx, data)
        const status = data.status || 'DRAFT'

        const [quotation] = await tx
          .insert(schema.quotation)
          .values({
            invoiceNumber: data.invoiceNumber,
            invoiceDate: new Date(data.invoiceDate),
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            customerId: data.customerId,
            subtotal: values.subtotal,
            discount: data.discount || 0,
            taxAmount: values.taxAmount,
            totalAmount: values.totalAmount,
            status,
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
            deliveryTime: data.deliveryTime ? new Date(data.deliveryTime) : null,
          })
          .returning()

        if (values.processedItems.length) {
          await tx
            .insert(schema.quotationItem)
            .values(values.processedItems.map((i: any) => ({ ...i, quotationId: quotation.id })))
        }
        return quotation
      })

      const [quotation] = await attachCustomerAndItems(db, [created], schema.quotationItem, 'quotationId')
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

      const updated = await db.transaction(async (tx) => {
        const [existingQuotation] = await tx.select().from(schema.quotation).where(eq(schema.quotation.id, id)).limit(1)
        if (!existingQuotation) {
          throw new Error('Quotation not found')
        }

        if (data.invoiceNumber && data.invoiceNumber !== existingQuotation.invoiceNumber) {
          const [duplicate] = await tx
            .select({ id: schema.quotation.id })
            .from(schema.quotation)
            .where(eq(schema.quotation.invoiceNumber, data.invoiceNumber))
            .limit(1)
          if (duplicate) throw new Error(`Quotation number ${data.invoiceNumber} already exists`)
        }

        const values = await buildSalesDocumentValues(tx, data)
        const status = data.status || existingQuotation.status

        await tx.delete(schema.quotationItem).where(eq(schema.quotationItem.quotationId, id))

        const [quotation] = await tx
          .update(schema.quotation)
          .set({
            invoiceNumber: data.invoiceNumber || existingQuotation.invoiceNumber,
            invoiceDate: new Date(data.invoiceDate),
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            customerId: data.customerId,
            subtotal: values.subtotal,
            discount: data.discount || 0,
            taxAmount: values.taxAmount,
            totalAmount: values.totalAmount,
            status,
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
            deliveryTime: data.deliveryTime ? new Date(data.deliveryTime) : null,
          })
          .where(eq(schema.quotation.id, id))
          .returning()

        if (values.processedItems.length) {
          await tx
            .insert(schema.quotationItem)
            .values(values.processedItems.map((i: any) => ({ ...i, quotationId: id })))
        }
        return quotation
      })

      const [quotation] = await attachCustomerAndItems(db, [updated], schema.quotationItem, 'quotationId')
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
      const [quotation] = await db.select({ id: schema.quotation.id }).from(schema.quotation).where(eq(schema.quotation.id, id)).limit(1)
      if (!quotation) {
        throw new Error('Quotation not found')
      }

      // Soft-delete: stamp deletedAt (updatedAt + hlc auto-bump). The row and its
      // line items stay put so a restore brings the whole document back intact.
      await db.update(schema.quotation).set({ deletedAt: new Date() }).where(eq(schema.quotation.id, id))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete quotation',
      }
    }
  })

  ipcMain.handle('quotation:restore', async (_, id: string) => {
    try {
      const [quotation] = await db.select({ id: schema.quotation.id }).from(schema.quotation).where(eq(schema.quotation.id, id)).limit(1)
      if (!quotation) {
        throw new Error('Quotation not found')
      }

      await db.update(schema.quotation).set({ deletedAt: null }).where(eq(schema.quotation.id, id))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restore quotation',
      }
    }
  })

  ipcMain.handle('quotation:convertToInvoice', async (_, quotationId: string) => {
    try {
      const invoice = await convertQuotationToInvoice(quotationId)
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
      const quotationNumber = await generateNextQuotationNumber(db)
      return { success: true, data: quotationNumber }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate quotation number',
      }
    }
  })
}
