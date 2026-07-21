import { ipcMain } from 'electron'
import { desc, eq } from '@neu/shared'
import { getDb, schema } from '../db'
import { attachCustomerAndItems } from './docLoaders'
import {
  buildSalesDocumentValues,
  convertProformaInvoiceToInvoice,
  generateNextProformaInvoiceNumber,
  normalizeSalesDocumentNumber,
} from './salesDocumentHelpers'

export const setupProformaInvoiceHandlers = () => {
  const db = getDb()

  ipcMain.handle('proformaInvoice:getAll', async () => {
    try {
      const headers = await db.select().from(schema.proformaInvoice).orderBy(desc(schema.proformaInvoice.invoiceDate))
      const proformaInvoices = await attachCustomerAndItems(db, headers, schema.proformaInvoiceItem, 'proformaInvoiceId')
      return { success: true, data: proformaInvoices }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch proforma invoices',
      }
    }
  })

  ipcMain.handle('proformaInvoice:getById', async (_, id: string) => {
    try {
      const [header] = await db.select().from(schema.proformaInvoice).where(eq(schema.proformaInvoice.id, id)).limit(1)
      if (!header) return { success: true, data: null }
      const [proformaInvoice] = await attachCustomerAndItems(db, [header], schema.proformaInvoiceItem, 'proformaInvoiceId')
      return { success: true, data: proformaInvoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch proforma invoice',
      }
    }
  })

  ipcMain.handle('proformaInvoice:create', async (_, data) => {
    try {
      data.invoiceNumber = normalizeSalesDocumentNumber(data.invoiceNumber)

      const created = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: schema.proformaInvoice.id })
          .from(schema.proformaInvoice)
          .where(eq(schema.proformaInvoice.invoiceNumber, data.invoiceNumber))
          .limit(1)
        if (existing) throw new Error(`Proforma invoice number ${data.invoiceNumber} already exists`)

        const values = await buildSalesDocumentValues(tx, data)
        const status = data.status || 'DRAFT'

        const [proformaInvoice] = await tx
          .insert(schema.proformaInvoice)
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
            .insert(schema.proformaInvoiceItem)
            .values(values.processedItems.map((i: any) => ({ ...i, proformaInvoiceId: proformaInvoice.id })))
        }
        return proformaInvoice
      })

      const [proformaInvoice] = await attachCustomerAndItems(db, [created], schema.proformaInvoiceItem, 'proformaInvoiceId')
      return { success: true, data: proformaInvoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create proforma invoice',
      }
    }
  })

  ipcMain.handle('proformaInvoice:update', async (_, id: string, data) => {
    try {
      if (data.invoiceNumber) {
        data.invoiceNumber = normalizeSalesDocumentNumber(data.invoiceNumber)
      }

      const updated = await db.transaction(async (tx) => {
        const [existingProformaInvoice] = await tx.select().from(schema.proformaInvoice).where(eq(schema.proformaInvoice.id, id)).limit(1)
        if (!existingProformaInvoice) {
          throw new Error('Proforma invoice not found')
        }

        if (data.invoiceNumber && data.invoiceNumber !== existingProformaInvoice.invoiceNumber) {
          const [duplicate] = await tx
            .select({ id: schema.proformaInvoice.id })
            .from(schema.proformaInvoice)
            .where(eq(schema.proformaInvoice.invoiceNumber, data.invoiceNumber))
            .limit(1)
          if (duplicate) throw new Error(`Proforma invoice number ${data.invoiceNumber} already exists`)
        }

        const values = await buildSalesDocumentValues(tx, data)
        const status = data.status || existingProformaInvoice.status

        await tx.delete(schema.proformaInvoiceItem).where(eq(schema.proformaInvoiceItem.proformaInvoiceId, id))

        const [proformaInvoice] = await tx
          .update(schema.proformaInvoice)
          .set({
            invoiceNumber: data.invoiceNumber || existingProformaInvoice.invoiceNumber,
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
          .where(eq(schema.proformaInvoice.id, id))
          .returning()

        if (values.processedItems.length) {
          await tx
            .insert(schema.proformaInvoiceItem)
            .values(values.processedItems.map((i: any) => ({ ...i, proformaInvoiceId: id })))
        }
        return proformaInvoice
      })

      const [proformaInvoice] = await attachCustomerAndItems(db, [updated], schema.proformaInvoiceItem, 'proformaInvoiceId')
      return { success: true, data: proformaInvoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update proforma invoice',
      }
    }
  })

  ipcMain.handle('proformaInvoice:delete', async (_, id: string) => {
    try {
      const [proformaInvoice] = await db.select({ id: schema.proformaInvoice.id }).from(schema.proformaInvoice).where(eq(schema.proformaInvoice.id, id)).limit(1)
      if (!proformaInvoice) {
        throw new Error('Proforma invoice not found')
      }

      // Soft-delete: stamp deletedAt (updatedAt + hlc auto-bump). The row and its
      // line items stay put so a restore brings the whole document back intact.
      await db.update(schema.proformaInvoice).set({ deletedAt: new Date() }).where(eq(schema.proformaInvoice.id, id))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete proforma invoice',
      }
    }
  })

  ipcMain.handle('proformaInvoice:restore', async (_, id: string) => {
    try {
      const [proformaInvoice] = await db.select({ id: schema.proformaInvoice.id }).from(schema.proformaInvoice).where(eq(schema.proformaInvoice.id, id)).limit(1)
      if (!proformaInvoice) {
        throw new Error('Proforma invoice not found')
      }

      await db.update(schema.proformaInvoice).set({ deletedAt: null }).where(eq(schema.proformaInvoice.id, id))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restore proforma invoice',
      }
    }
  })

  ipcMain.handle('proformaInvoice:convertToInvoice', async (_, proformaInvoiceId: string) => {
    try {
      const invoice = await convertProformaInvoiceToInvoice(proformaInvoiceId)
      return { success: true, data: invoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to convert proforma invoice',
      }
    }
  })

  ipcMain.handle('proformaInvoice:generateNumber', async () => {
    try {
      const proformaInvoiceNumber = await generateNextProformaInvoiceNumber(db)
      return { success: true, data: proformaInvoiceNumber }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate proforma invoice number',
      }
    }
  })
}
