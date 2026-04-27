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

const generateNextNumber = async (
  prisma: any,
  type: 'INVOICE' | 'QUOTATION',
  seriesCode: 'SL' | 'QT'
): Promise<string> => {
  const fy = getFiscalYear()
  const prefix = `NS/${seriesCode}/${fy}/`

  const lastDocument = await prisma.salesInvoice.findFirst({
    where: {
      type,
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
  generateNextNumber(prisma, 'INVOICE', 'SL')

export const generateNextQuotationNumber = async (prisma: any): Promise<string> =>
  generateNextNumber(prisma, 'QUOTATION', 'QT')

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

export const determineSupplyType = (party: any, totalAmount: number, isInterState: boolean): string => {
  const hasGstin = party?.taxId && party.taxId.length === 15

  if (hasGstin) {
    return 'B2B'
  } else if (isInterState && totalAmount > 250000) {
    return 'B2C_LARGE'
  } else {
    return 'B2C_SMALL'
  }
}

export const buildSalesDocumentValues = async (tx: any, data: any) => {
  const party = await tx.party.findUnique({ where: { id: data.partyId } })
  const company = await tx.company.findFirst()

  if (!party) throw new Error('Party not found')

  const placeOfSupply = data.placeOfSupply || party.stateCode || company?.stateCode || ''
  const placeOfSupplyName = data.placeOfSupplyName || party.stateName || company?.stateName || ''
  const companyStateCode = company?.stateCode || ''
  const isInterState = companyStateCode !== placeOfSupply && placeOfSupply !== ''

  let subtotal = 0
  let taxAmount = 0
  let totalCgst = 0
  let totalSgst = 0
  let totalIgst = 0
  let totalCess = 0

  const processedItems: any[] = []
  for (const item of data.items) {
    const itemTaxableAmount = item.quantity * item.rate - (item.discount || 0)
    subtotal += itemTaxableAmount

    const dbItem = await tx.item.findUnique({ where: { id: item.itemId } })
    const halfRate = (item.taxRate || 0) / 2

    let gstComponents
    if (isInterState) {
      gstComponents = {
        cgstRate: 0, cgstAmount: 0, sgstRate: 0, sgstAmount: 0,
        igstRate: item.taxRate || 0, igstAmount: (itemTaxableAmount * (item.taxRate || 0)) / 100
      }
    } else {
      gstComponents = {
        cgstRate: halfRate, cgstAmount: (itemTaxableAmount * halfRate) / 100,
        sgstRate: halfRate, sgstAmount: (itemTaxableAmount * halfRate) / 100,
        igstRate: 0, igstAmount: 0
      }
    }

    const itemCessAmount = item.cessAmount || 0
    const itemTax = gstComponents.cgstAmount + gstComponents.sgstAmount + gstComponents.igstAmount + itemCessAmount

    taxAmount += itemTax
    totalCgst += gstComponents.cgstAmount
    totalSgst += gstComponents.sgstAmount
    totalIgst += gstComponents.igstAmount
    totalCess += itemCessAmount

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
      cessAmount: itemCessAmount
    })
  }

  const totalAmount = subtotal + taxAmount - (data.discount || 0)
  const supplyType = determineSupplyType(party, totalAmount, isInterState)

  return {
    party,
    placeOfSupply,
    placeOfSupplyName,
    isInterState,
    subtotal,
    taxAmount,
    totalAmount,
    totalCgst,
    totalSgst,
    totalIgst,
    totalCess,
    supplyType,
    processedItems
  }
}

const createInvoiceFromSourceDocument = async (
  tx: any,
  source: any,
  relationData: { convertedFromQuoteId?: string; convertedFromProformaId?: string }
) => {
  const newInvoiceNumber = await generateNextInvoiceNumber(tx)

  const invoice = await tx.salesInvoice.create({
    data: {
      invoiceNumber: newInvoiceNumber,
      invoiceDate: new Date(),
      type: 'INVOICE',
      partyId: source.partyId,
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
      party: true
    }
  })

  await tx.party.update({
    where: { id: source.partyId },
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
    const quote = await tx.salesInvoice.findUnique({
      where: { id: quoteId },
      include: {
        items: true
      }
    })

    if (!quote || quote.type !== 'QUOTATION') {
      throw new Error('Invalid quotation')
    }

    return createInvoiceFromSourceDocument(tx, quote, { convertedFromQuoteId: quoteId })
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
