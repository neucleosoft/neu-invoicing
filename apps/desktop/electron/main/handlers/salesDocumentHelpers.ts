import { computeGstValues } from '@neu/shared'

// Paid-status is DERIVED from the money, never hand-set: amountPaid vs total.
// Mirrors the shared computePaymentStatus / desktop computeStatus rule so the
// invoice's label can never contradict what was actually paid. OVERDUE is NOT
// produced here — it's a function of the due date, handled separately at the call site.
export const derivePaymentStatus = (total: number, paid: number): 'PAID' | 'PARTIAL' | 'DRAFT' => {
  if (total - paid <= 0) return 'PAID'
  if (paid > 0) return 'PARTIAL'
  return 'DRAFT'
}

export const normalizeSalesDocumentNumber = (num: string): string => {
  const parts = num.trim().split('/')
  const last = parts[parts.length - 1]
  const parsed = parseInt(last)
  if (!isNaN(parsed)) {
    parts[parts.length - 1] = String(parsed).padStart(2, '0')
  }
  return parts.join('/')
}

const getFiscalYear = (): string => {
  const now = new Date()
  const month = now.getMonth() + 1
  const year = now.getFullYear() % 100
  if (month >= 4) {
    return `${String(year).padStart(2, '0')}-${String(year + 1).padStart(2, '0')}`
  } else {
    return `${String(year - 1).padStart(2, '0')}-${String(year).padStart(2, '0')}`
  }
}

const generateNextInvoiceSeriesNumber = async (
  prisma: any,
  seriesCode: 'SL'
): Promise<string> => {
  const fy = getFiscalYear()
  const prefix = `NS/${seriesCode}/${fy}/`

  const lastDocument = await prisma.salesInvoice.findFirst({
    where: {
      type: 'INVOICE',
      invoiceNumber: { startsWith: prefix }
    },
    orderBy: { invoiceNumber: 'desc' }
  })

  let nextNum = 1
  if (lastDocument) {
    const lastPart = lastDocument.invoiceNumber.split('/').pop()
    const parsed = parseInt(lastPart || '0')
    if (!isNaN(parsed)) nextNum = parsed + 1
  }

  return `${prefix}${String(nextNum).padStart(2, '0')}`
}

export const generateNextInvoiceNumber = async (prisma: any): Promise<string> =>
  generateNextInvoiceSeriesNumber(prisma, 'SL')

export const generateNextQuotationNumber = async (prisma: any): Promise<string> => {
  const fy = getFiscalYear()
  const prefix = `NS/QT/${fy}/`

  const lastDocument = await prisma.quotation.findFirst({
    where: {
      invoiceNumber: { startsWith: prefix }
    },
    orderBy: { invoiceNumber: 'desc' }
  })

  let nextNum = 1
  if (lastDocument) {
    const lastPart = lastDocument.invoiceNumber.split('/').pop()
    const parsed = parseInt(lastPart || '0')
    if (!isNaN(parsed)) nextNum = parsed + 1
  }

  return `${prefix}${String(nextNum).padStart(2, '0')}`
}

export const generateNextProformaInvoiceNumber = async (prisma: any): Promise<string> => {
  const fy = getFiscalYear()
  const prefix = `NS/PI/${fy}/`

  const lastDocument = await prisma.proformaInvoice.findFirst({
    where: {
      invoiceNumber: { startsWith: prefix }
    },
    orderBy: { invoiceNumber: 'desc' }
  })

  let nextNum = 1
  if (lastDocument) {
    const lastPart = lastDocument.invoiceNumber.split('/').pop()
    const parsed = parseInt(lastPart || '0')
    if (!isNaN(parsed)) nextNum = parsed + 1
  }

  return `${prefix}${String(nextNum).padStart(2, '0')}`
}

export const determineSupplyType = (customer: any, totalAmount: number, isInterState: boolean): string => {
  const hasGstin = customer?.taxId && customer.taxId.length === 15

  if (hasGstin) {
    return 'B2B'
  } else if (isInterState && totalAmount > 250000) {
    return 'B2C_LARGE'
  } else {
    return 'B2C_SMALL'
  }
}

export const buildSalesDocumentValues = async (tx: any, data: any) => {
  const customer = await tx.customer.findUnique({ where: { id: data.customerId } })
  const company = await tx.company.findFirst()

  if (!customer) throw new Error('Customer not found')

  // Fetch each line's catalog item for the HSN fallback chain (typed HSN →
  // item.hsnCode → item.skuHsn) the shared helper applies.
  const catalogItems: any[] = []
  for (const item of data.items) {
    catalogItems.push(await tx.item.findUnique({ where: { id: item.itemId } }))
  }

  // ONE GST implementation for the whole product: the shared computeGstValues
  // (packages/shared/src/gstCompute.ts) that mobile already uses. This function
  // used to hand-roll the identical math; delegating removes the second copy so
  // the two apps can never drift.
  const gst = computeGstValues({
    company: company ? { stateCode: company.stateCode, stateName: company.stateName } : null,
    party: { taxId: customer.taxId, stateCode: customer.stateCode, stateName: customer.stateName },
    items: data.items.map((item: any, idx: number) => ({
      quantity: item.quantity,
      rate: item.rate,
      discount: item.discount,
      taxRate: item.taxRate,
      cessRate: item.cessRate,
      cessAmount: item.cessAmount,
      hsnCode: item.hsnCode,
      catalogHsnCode: catalogItems[idx]?.hsnCode,
      catalogSkuHsn: catalogItems[idx]?.skuHsn
    })),
    docDiscount: data.discount || 0,
    placeOfSupply: data.placeOfSupply,
    placeOfSupplyName: data.placeOfSupplyName
  })

  const processedItems = data.items.map((item: any, idx: number) => {
    const g = gst.items[idx]
    return {
      itemId: item.itemId,
      quantity: item.quantity,
      rate: item.rate,
      discount: item.discount || 0,
      taxRate: item.taxRate || 0,
      total: g.total,
      hsnCode: g.hsnCode,
      taxableAmount: g.taxableAmount,
      cgstRate: g.cgstRate,
      cgstAmount: g.cgstAmount,
      sgstRate: g.sgstRate,
      sgstAmount: g.sgstAmount,
      igstRate: g.igstRate,
      igstAmount: g.igstAmount,
      cessRate: g.cessRate,
      cessAmount: g.cessAmount
    }
  })

  return {
    customer,
    placeOfSupply: gst.placeOfSupply,
    placeOfSupplyName: gst.placeOfSupplyName,
    isInterState: gst.isInterState,
    subtotal: gst.subtotal,
    taxAmount: gst.taxAmount,
    totalAmount: gst.totalAmount,
    totalCgst: gst.totalCgst,
    totalSgst: gst.totalSgst,
    totalIgst: gst.totalIgst,
    totalCess: gst.totalCess,
    supplyType: gst.supplyType,
    processedItems
  }
}

const createInvoiceFromSourceDocument = async (
  tx: any,
  source: any,
  relationData: { convertedFromQuotationId?: string; convertedFromProformaId?: string }
) => {
  const newInvoiceNumber = await generateNextInvoiceNumber(tx)

  const invoice = await tx.salesInvoice.create({
    data: {
      invoiceNumber: newInvoiceNumber,
      invoiceDate: new Date(),
      type: 'INVOICE',
      customerId: source.customerId,
      subtotal: source.subtotal,
      discount: source.discount,
      taxAmount: source.taxAmount,
      totalAmount: source.totalAmount,
      amountPaid: 0,
      balanceDue: source.totalAmount,
      status: 'DRAFT',
      notes: source.notes,
      placeOfSupply: source.placeOfSupply,
      placeOfSupplyName: source.placeOfSupplyName,
      isInterState: source.isInterState,
      reverseCharge: source.reverseCharge,
      cgstAmount: source.cgstAmount,
      sgstAmount: source.sgstAmount,
      igstAmount: source.igstAmount,
      cessAmount: source.cessAmount,
      supplyType: source.supplyType,
      ecommerceGstin: source.ecommerceGstin,
      poNumber: source.poNumber,
      ewayBillNo: source.ewayBillNo,
      vehicleNumber: source.vehicleNumber,
      warrantyPeriod: source.warrantyPeriod,
      dispatchedThrough: source.dispatchedThrough,
      ...relationData,
      items: {
        create: source.items.map((item: any) => ({
          itemId: item.itemId,
          quantity: item.quantity,
          rate: item.rate,
          discount: item.discount,
          taxRate: item.taxRate,
          total: item.total,
          hsnCode: item.hsnCode,
          taxableAmount: item.taxableAmount,
          cgstRate: item.cgstRate,
          cgstAmount: item.cgstAmount,
          sgstRate: item.sgstRate,
          sgstAmount: item.sgstAmount,
          igstRate: item.igstRate,
          igstAmount: item.igstAmount,
          cessRate: item.cessRate,
          cessAmount: item.cessAmount
        }))
      }
    },
    include: {
      items: {
        include: {
          item: true
        }
      },
      customer: true
    }
  })

  await tx.customer.update({
    where: { id: source.customerId },
    data: {
      currentBalance: {
        increment: source.totalAmount
      }
    }
  })

  for (const item of source.items) {
    const dbItem = await tx.item.findUnique({ where: { id: item.itemId } })
    if (dbItem && dbItem.trackStock) {
      await tx.item.update({
        where: { id: item.itemId },
        data: {
          currentStock: {
            decrement: item.quantity
          }
        }
      })

      await tx.stockMovement.create({
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

  return invoice
}

export const convertQuotationToInvoice = async (prisma: any, quoteId: string) => {
  return prisma.$transaction(async (tx: any) => {
    const quote = await tx.quotation.findUnique({
      where: { id: quoteId },
      include: {
        items: true
      }
    })

    if (!quote) {
      throw new Error('Invalid quotation')
    }

    return createInvoiceFromSourceDocument(tx, quote, { convertedFromQuotationId: quoteId })
  })
}

export const convertProformaInvoiceToInvoice = async (prisma: any, proformaInvoiceId: string) => {
  return prisma.$transaction(async (tx: any) => {
    const proformaInvoice = await tx.proformaInvoice.findUnique({
      where: { id: proformaInvoiceId },
      include: {
        items: true
      }
    })

    if (!proformaInvoice) {
      throw new Error('Invalid proforma invoice')
    }

    return createInvoiceFromSourceDocument(tx, proformaInvoice, { convertedFromProformaId: proformaInvoiceId })
  })
}
