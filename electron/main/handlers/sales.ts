import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { triggerSyncAfterChange } from '../sync'
import {
  normalizeInvoiceNumber,
  getFiscalYear,
  determineSupplyType,
  computeTaxableAmount,
  calculateItemGst,
  calculateInvoiceTotals
} from './salesLogic'

// Generate next invoice number in format NS/SL/26-27/01
const generateNextInvoiceNumber = async (prisma: any): Promise<string> => {
  const fy = getFiscalYear()
  const prefix = `NS/SL/${fy}/`

  // Find the last invoice in this fiscal year
  const lastInvoice = await prisma.salesInvoice.findFirst({
    where: {
      type: 'INVOICE',
      invoiceNumber: { startsWith: prefix }
    },
    orderBy: { invoiceNumber: 'desc' }
  })

  let nextNum = 1
  if (lastInvoice) {
    const lastPart = lastInvoice.invoiceNumber.split('/').pop()
    const parsed = parseInt(lastPart || '0')
    if (!isNaN(parsed)) nextNum = parsed + 1
  }

  return `${prefix}${String(nextNum).padStart(2, '0')}`
}

export const setupSalesHandlers = () => {
  const prisma = getPrisma()

  // Get all sales invoices
  ipcMain.handle('sales:getAll', async (_, type?: string) => {
    try {
      const where = type ? { type: type as any } : {}
      const invoices = await prisma.salesInvoice.findMany({
        where,
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
      const invoice = await prisma.salesInvoice.findUnique({
        where: { id },
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
      data.invoiceNumber = normalizeInvoiceNumber(data.invoiceNumber)

      const invoice = await prisma.$transaction(async (tx: any) => {
        // Check for duplicate invoice number
        const existing = await tx.salesInvoice.findUnique({ where: { invoiceNumber: data.invoiceNumber } })
        if (existing) throw new Error(`Invoice number ${data.invoiceNumber} already exists`)

        // Get party and company details for GST calculation
        const party = await tx.party.findUnique({ where: { id: data.partyId } })
        const company = await tx.company.findFirst()

        if (!party) throw new Error('Party not found')

        // Determine place of supply
        const placeOfSupply = data.placeOfSupply || party.stateCode || company?.stateCode || ''
        const placeOfSupplyName = data.placeOfSupplyName || party.stateName || company?.stateName || ''

        const totalCess = 0

        const companyStateCode = company?.stateCode || ''
        const isInterState = companyStateCode !== placeOfSupply && placeOfSupply !== ''

        // Calculate taxable subtotal and GST totals across all lines
        const { subtotal, taxAmount, totalCgst, totalSgst, totalIgst } = calculateInvoiceTotals(
          data.items,
          { isInterState, discount: data.discount || 0 }
        )

        // Process items and calculate GST components per line
        const processedItems: any[] = []
        for (const item of data.items) {
          const itemTaxableAmount = computeTaxableAmount(item.quantity, item.rate, item.discount || 0)

          const dbItem = await tx.item.findUnique({ where: { id: item.itemId } })

          const gstComponents = calculateItemGst(itemTaxableAmount, item.taxRate || 0, isInterState)
          const itemTax = gstComponents.cgstAmount + gstComponents.sgstAmount + gstComponents.igstAmount

          processedItems.push({
            itemId: item.itemId,
            quantity: item.quantity,
            rate: item.rate,
            discount: item.discount || 0,
            taxRate: item.taxRate || 0,
            total: itemTaxableAmount + itemTax,
            hsnCode: item.hsnCode || dbItem?.hsnCode || dbItem?.skuHsn || '',
            taxableAmount: itemTaxableAmount,
            cgstRate: gstComponents.cgstRate,
            cgstAmount: gstComponents.cgstAmount,
            sgstRate: gstComponents.sgstRate,
            sgstAmount: gstComponents.sgstAmount,
            igstRate: gstComponents.igstRate,
            igstAmount: gstComponents.igstAmount,
            cessRate: item.cessRate || 0,
            cessAmount: item.cessAmount || 0
          })
        }

        const totalAmount = subtotal + taxAmount - (data.discount || 0)
        const balanceDue = totalAmount - (data.amountPaid || 0)

        const supplyType = determineSupplyType(party, totalAmount, isInterState)

        const status = data.status || 'DRAFT'

        const created = await tx.salesInvoice.create({
          data: {
            invoiceNumber: data.invoiceNumber,
            invoiceDate: new Date(data.invoiceDate),
            type: data.type,
            partyId: data.partyId,
            subtotal,
            discount: data.discount || 0,
            taxAmount,
            totalAmount,
            amountPaid: data.amountPaid || 0,
            balanceDue,
            status: status as any,
            notes: data.notes,
            placeOfSupply,
            placeOfSupplyName,
            isInterState,
            reverseCharge: data.reverseCharge || false,
            cgstAmount: totalCgst,
            sgstAmount: totalSgst,
            igstAmount: totalIgst,
            cessAmount: totalCess,
            supplyType,
            ecommerceGstin: data.ecommerceGstin || null,
            poNumber: data.poNumber || null,
            ewayBillNo: data.ewayBillNo || null,
            vehicleNumber: data.vehicleNumber || null,
            warrantyPeriod: data.warrantyPeriod || null,
            dispatchedThrough: data.dispatchedThrough || null,
            items: {
              create: processedItems
            }
          },
          include: {
            items: { include: { item: true } },
            party: true
          }
        })

        // Update party balance
        await tx.party.update({
          where: { id: data.partyId },
          data: { currentBalance: { increment: balanceDue } }
        })

        // Update stock if invoice (not quotation)
        if (data.type === 'INVOICE') {
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
        }

        return created
      })

      await triggerSyncAfterChange()
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
        data.invoiceNumber = normalizeInvoiceNumber(data.invoiceNumber)
      }

      const invoice = await prisma.$transaction(async (tx: any) => {
        const existingInvoice = await tx.salesInvoice.findUnique({
          where: { id },
          include: { items: true }
        })

        if (!existingInvoice) {
          throw new Error('Invoice not found')
        }

        // Check for duplicate if invoice number changed
        if (data.invoiceNumber && data.invoiceNumber !== existingInvoice.invoiceNumber) {
          const duplicate = await tx.salesInvoice.findUnique({ where: { invoiceNumber: data.invoiceNumber } })
          if (duplicate) throw new Error(`Invoice number ${data.invoiceNumber} already exists`)
        }

        // Get party and company for GST recalculation
        const party = await tx.party.findUnique({ where: { id: data.partyId } })
        const company = await tx.company.findFirst()
        const companyStateCode = company?.stateCode || ''
        const placeOfSupply = data.placeOfSupply || party?.stateCode || companyStateCode
        const placeOfSupplyName = data.placeOfSupplyName || party?.stateName || company?.stateName || ''
        const isInterState = companyStateCode !== placeOfSupply && placeOfSupply !== ''

        // Calculate new taxable subtotal and GST totals across all lines
        const { subtotal, taxAmount, totalCgst, totalSgst, totalIgst } = calculateInvoiceTotals(
          data.items,
          { isInterState, discount: data.discount || 0 }
        )

        const processedItems: any[] = []
        for (const item of data.items) {
          const itemTaxableAmount = computeTaxableAmount(item.quantity, item.rate, item.discount || 0)

          const dbItem = await tx.item.findUnique({ where: { id: item.itemId } })

          const gstComponents = calculateItemGst(itemTaxableAmount, item.taxRate || 0, isInterState)
          const itemTax = gstComponents.cgstAmount + gstComponents.sgstAmount + gstComponents.igstAmount

          processedItems.push({
            itemId: item.itemId,
            quantity: item.quantity,
            rate: item.rate,
            discount: item.discount || 0,
            taxRate: item.taxRate || 0,
            total: itemTaxableAmount + itemTax,
            hsnCode: item.hsnCode || dbItem?.hsnCode || dbItem?.skuHsn || '',
            taxableAmount: itemTaxableAmount,
            cgstRate: gstComponents.cgstRate,
            cgstAmount: gstComponents.cgstAmount,
            sgstRate: gstComponents.sgstRate,
            sgstAmount: gstComponents.sgstAmount,
            igstRate: gstComponents.igstRate,
            igstAmount: gstComponents.igstAmount,
            cessRate: item.cessRate || 0,
            cessAmount: item.cessAmount || 0
          })
        }

        const totalAmount = subtotal + taxAmount - (data.discount || 0)
        const balanceDue = totalAmount - (existingInvoice.amountPaid || 0)

        const status = data.status || existingInvoice.status

        const supplyType = determineSupplyType(party, totalAmount, isInterState)

        // Delete existing items
        await tx.salesInvoiceItem.deleteMany({
          where: { salesInvoiceId: id }
        })

        const updated = await tx.salesInvoice.update({
          where: { id },
          data: {
            invoiceNumber: data.invoiceNumber,
            invoiceDate: new Date(data.invoiceDate),
            type: data.type,
            partyId: data.partyId,
            subtotal,
            discount: data.discount || 0,
            taxAmount,
            totalAmount,
            balanceDue,
            status: status as any,
            notes: data.notes,
            placeOfSupply,
            placeOfSupplyName,
            isInterState,
            cgstAmount: totalCgst,
            sgstAmount: totalSgst,
            igstAmount: totalIgst,
            supplyType,
            poNumber: data.poNumber || null,
            ewayBillNo: data.ewayBillNo || null,
            vehicleNumber: data.vehicleNumber || null,
            warrantyPeriod: data.warrantyPeriod || null,
            dispatchedThrough: data.dispatchedThrough || null,
            items: {
              create: processedItems
            }
          },
          include: {
            items: { include: { item: true } },
            party: true
          }
        })

        // Update party balance — handle party change correctly
        if (data.partyId !== existingInvoice.partyId) {
          // Party changed: reverse old party's balance, apply to new party
          await tx.party.update({
            where: { id: existingInvoice.partyId },
            data: { currentBalance: { decrement: existingInvoice.balanceDue } }
          })
          await tx.party.update({
            where: { id: data.partyId },
            data: { currentBalance: { increment: balanceDue } }
          })
        } else {
          const balanceDiff = balanceDue - existingInvoice.balanceDue
          if (balanceDiff !== 0) {
            await tx.party.update({
              where: { id: data.partyId },
              data: { currentBalance: { increment: balanceDiff } }
            })
          }
        }

        return updated
      })

      await triggerSyncAfterChange()
      return { success: true, data: invoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update invoice'
      }
    }
  })

  // Delete invoice
  ipcMain.handle('sales:delete', async (_, id: string) => {
    try {
      // Get the invoice with items before deleting
      const invoice = await prisma.salesInvoice.findUnique({
        where: { id },
        include: {
          items: true
        }
      })

      if (!invoice) {
        throw new Error('Invoice not found')
      }

      // If it's an invoice (not quotation), reverse party balance and stock
      if (invoice.type === 'INVOICE') {
        // Reverse party balance
        await prisma.party.update({
          where: { id: invoice.partyId },
          data: {
            currentBalance: {
              decrement: invoice.balanceDue
            }
          }
        })

        // Reverse stock for each item
        for (const item of invoice.items) {
          const dbItem = await prisma.item.findUnique({ where: { id: item.itemId } })
          if (dbItem && dbItem.trackStock) {
            await prisma.item.update({
              where: { id: item.itemId },
              data: {
                currentStock: {
                  increment: item.quantity
                }
              }
            })
          }
        }

        // Delete stock movements for this invoice
        await prisma.stockMovement.deleteMany({
          where: {
            referenceType: 'INVOICE',
            referenceId: id
          }
        })
      }

      // Delete the invoice (items will cascade delete)
      await prisma.salesInvoice.delete({
        where: { id }
      })

      await triggerSyncAfterChange()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete invoice'
      }
    }
  })

  // Convert quotation to invoice
  ipcMain.handle('sales:convertQuoteToInvoice', async (_, quoteId: string) => {
    try {
      const quote = await prisma.salesInvoice.findUnique({
        where: { id: quoteId },
        include: {
          items: true
        }
      })

      if (!quote || quote.type !== 'QUOTATION') {
        throw new Error('Invalid quotation')
      }

      // Generate new invoice number
      const newInvoiceNumber = await generateNextInvoiceNumber(prisma)

      // Create invoice from quotation
      const invoice = await prisma.salesInvoice.create({
        data: {
          invoiceNumber: newInvoiceNumber,
          invoiceDate: new Date(),
          type: 'INVOICE',
          partyId: quote.partyId,
          subtotal: quote.subtotal,
          discount: quote.discount,
          taxAmount: quote.taxAmount,
          totalAmount: quote.totalAmount,
          amountPaid: 0,
          balanceDue: quote.totalAmount,
          status: 'DRAFT',
          convertedFromQuoteId: quoteId,
          notes: quote.notes,
          items: {
            create: quote.items.map(item => ({
              itemId: item.itemId,
              quantity: item.quantity,
              rate: item.rate,
              discount: item.discount,
              taxRate: item.taxRate,
              total: item.total
            }))
          }
        },
        include: {
          items: {
            include: {
              item: true
            }
          },
          party: true
        }
      })

      // Update party balance (since it's now an invoice)
      await prisma.party.update({
        where: { id: quote.partyId },
        data: {
          currentBalance: {
            increment: quote.totalAmount
          }
        }
      })

      // Update stock for each item
      for (const item of quote.items) {
        const dbItem = await prisma.item.findUnique({ where: { id: item.itemId } })
        if (dbItem && dbItem.trackStock) {
          await prisma.item.update({
            where: { id: item.itemId },
            data: {
              currentStock: {
                decrement: item.quantity
              }
            }
          })

          // Record stock movement
          await prisma.stockMovement.create({
            data: {
              itemId: item.itemId,
              movementType: 'SALE',
              quantity: -item.quantity,
              referenceType: 'INVOICE',
              referenceId: invoice.id
            }
          })
        }
      }

      await triggerSyncAfterChange()
      return { success: true, data: invoice }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to convert quotation'
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
