import pdfMake from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'
import {
  fmtNum,
  fmtRs,
  numberToWords,
  formatDate,
  extractPAN,
  getTaxGroups,
  getHSNGroups,
  LOGO_BASE64,
} from './pdfHelpers'

type Content = any
type TableCell = any

;(pdfMake as any).vfs = (pdfFonts as any).pdfMake?.vfs || pdfFonts

const GREEN = '#C6E0B4'

export interface PurchaseOrderPDFData {
  orderNumber: string
  orderDate: string | Date
  expectedDate?: string | Date | null
  notes?: string
  termsConditions?: string
  totalAmount: number
  subtotal?: number
  taxAmount?: number
  supplier: {
    name: string
    taxId?: string
    phone?: string
    email?: string
    billingAddress?: string
  }
  items: Array<{
    item: { name: string; unit?: string; hsnCode?: string; skuHsn?: string }
    quantity: number
    rate: number
    taxRate: number
    discount?: number
    total: number
    hsnCode?: string
    taxableAmount?: number
  }>
  company?: any
  isInterState?: boolean
}

export function buildPurchaseOrderFilename(po: PurchaseOrderPDFData) {
  const safeNum = (po.orderNumber || 'order').replace(/\//g, '_')
  const safeName = (po.supplier?.name || 'supplier').replace(/[^a-z0-9]/gi, '_')
  return `${safeNum}_purchase_order_${safeName}.pdf`
}

export function downloadPurchaseOrderPDF(po: PurchaseOrderPDFData) {
  if (!po.items) po.items = []
  pdfMake.createPdf(buildPurchaseOrderDefinition(po)).download(buildPurchaseOrderFilename(po))
}

export function getPurchaseOrderPDFBytes(po: PurchaseOrderPDFData): Promise<Uint8Array> {
  if (!po.items) po.items = []
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(buildPurchaseOrderDefinition(po)).getBuffer((buffer: any) => {
        resolve(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer))
      })
    } catch (err) {
      reject(err)
    }
  })
}

function deriveIsInterState(po: PurchaseOrderPDFData): boolean {
  if (typeof po.isInterState === 'boolean') return po.isInterState
  const supplierState = po.supplier?.taxId?.substring(0, 2)
  const companyState =
    po.company?.stateCode || po.company?.taxId?.substring(0, 2)
  if (!supplierState || !companyState) return false
  return supplierState !== companyState
}

function buildPurchaseOrderDefinition(po: PurchaseOrderPDFData): any {
  const isInter = deriveIsInterState(po)
  const itemsForGroups = po.items.map((it) => ({
    ...it,
    discount: it.discount ?? 0,
  }))
  const taxGroups = getTaxGroups(itemsForGroups as any, isInter)
  const hsnGroups = getHSNGroups(itemsForGroups as any, isInter)
  const logo = po.company?.logoBase64 || LOGO_BASE64

  return {
    pageSize: 'A4',
    pageMargins: [17, 13, 17, 13],
    content: [
      buildTitle(),
      buildCompanySection(po, logo),
      buildBuyerSupplierSection(po),
      buildItemsSection(po, isInter, taxGroups),
      buildHSNSection(hsnGroups, isInter),
      buildAmountInWords(po.totalAmount),
      buildFooter(po, logo),
    ],
    defaultStyle: { fontSize: 9 },
  }
}

function buildTitle(): Content {
  return {
    columns: [
      { text: 'PURCHASE ORDER', bold: true, fontSize: 11, width: 'auto' },
      { width: 6, text: '' },
      {
        table: { body: [[{ text: 'OFFICE COPY', fontSize: 8 }]] },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          hLineColor: () => '#000',
          vLineColor: () => '#000',
          paddingLeft: () => 3,
          paddingRight: () => 3,
          paddingTop: () => 2,
          paddingBottom: () => 2,
        },
        width: 'auto',
      },
      { text: '', width: '*' },
    ],
    margin: [0, 0, 0, 3],
  }
}

function buildCompanySection(po: PurchaseOrderPDFData, logo: string): Content {
  const company = po.company
  const companyStack: Content[] = [
    { text: (company?.name || 'Company').toUpperCase(), bold: true, fontSize: 16, color: '#2E7D32', margin: [0, 0, 0, 3] },
  ]
  if (company?.address) {
    companyStack.push({ text: company.address.toUpperCase(), fontSize: 10, margin: [0, 0, 0, 1] })
  }
  if (company?.taxId) {
    companyStack.push({ text: [{ text: 'GSTIN: ', bold: true }, company.taxId], fontSize: 10, margin: [0, 0, 0, 1] })
  }
  if (company?.email) {
    companyStack.push({ text: [{ text: 'Email: ', bold: true }, company.email], fontSize: 10 })
  }

  const hasExpected = !!po.expectedDate
  const gridBody: TableCell[][] = [
    [
      { stack: [
        { text: 'Order No.', bold: true, fontSize: 10 },
        { text: po.orderNumber, fontSize: 10, margin: [0, 3, 0, 0] as [number, number, number, number] },
      ] },
      { stack: [
        { text: 'Order Date', bold: true, fontSize: 10 },
        { text: formatDate(po.orderDate), fontSize: 10, margin: [0, 3, 0, 0] as [number, number, number, number] },
      ] },
    ],
  ]
  if (hasExpected) {
    gridBody.push([
      { stack: [
        { text: 'Expected Date', bold: true, fontSize: 10 },
        { text: formatDate(po.expectedDate as string | Date), fontSize: 10, margin: [0, 3, 0, 0] as [number, number, number, number] },
      ], colSpan: 2 },
      {},
    ])
  }

  return {
    table: {
      heights: [105],
      widths: ['60%', '40%'],
      body: [
        [
          {
            columns: [
              { image: logo, width: 60, height: 60, margin: [0, 0, 8, 0] },
              { stack: companyStack, width: '*' },
            ],
          },
          {
            table: {
              heights: hasExpected ? [35, 35] : [70],
              widths: ['*', '*'],
              body: gridBody,
            },
            layout: {
              hLineWidth: (i: number) => (hasExpected && i === 1) ? 0.5 : 0,
              vLineWidth: () => 0,
              hLineColor: () => '#000',
              vLineColor: () => '#000',
              paddingLeft: () => 4,
              paddingRight: () => 4,
              paddingTop: () => 3,
              paddingBottom: () => 3,
            },
            margin: [-4, -5, -4, -5] as [number, number, number, number],
          },
        ],
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#000',
      vLineColor: () => '#000',
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 5,
      paddingBottom: () => 5,
    },
    margin: [0, 0, 0, 0],
  }
}

function buildBuyerSupplierSection(po: PurchaseOrderPDFData): Content {
  // PO direction is opposite of a bill: WE (the company) are placing an order
  // WITH the supplier. Buyer = us (left), Supplier = them (right).
  const supplier = po.supplier
  const company = po.company
  const buyerPan = extractPAN(company?.taxId)

  const fromStack: Content[] = [
    { text: 'ORDER FROM (BUYER)', bold: true, fontSize: 10, margin: [0, 0, 0, 2] },
    { text: company?.name || '-', bold: true, fontSize: 11, margin: [0, 0, 0, 2] },
  ]
  if (company?.address) {
    fromStack.push({ columns: [
      { text: 'Address: ', width: 'auto', fontSize: 10, margin: [0, 0, 5, 0] as [number, number, number, number] },
      { text: company.address, width: '*', fontSize: 10 },
    ], margin: [0, 0, 0, 2] })
  }
  if (company?.taxId) {
    fromStack.push({ text: [{ text: 'GSTIN: ', bold: true }, company.taxId], fontSize: 10, margin: [0, 0, 0, 1] })
  }
  if (company?.phone) {
    fromStack.push({ text: [{ text: 'Mobile: ', bold: true }, company.phone], fontSize: 10, margin: [0, 0, 0, 1] })
  }
  if (buyerPan) {
    fromStack.push({ text: [{ text: 'PAN Number: ', bold: true }, buyerPan], fontSize: 10 })
  }

  const toStack: Content[] = [
    { text: 'ORDER TO (SUPPLIER)', bold: true, fontSize: 10, margin: [0, 0, 0, 2] },
    { text: supplier?.name || '-', bold: true, fontSize: 11, margin: [0, 0, 0, 2] },
  ]
  if (supplier?.billingAddress) {
    toStack.push({ columns: [
      { text: 'Address: ', width: 'auto', fontSize: 10, margin: [0, 0, 5, 0] as [number, number, number, number] },
      { text: supplier.billingAddress, width: '*', fontSize: 10 },
    ], margin: [0, 0, 0, 2] })
  }
  if (supplier?.taxId) {
    toStack.push({ text: [{ text: 'GSTIN: ', bold: true }, supplier.taxId], fontSize: 10, margin: [0, 0, 0, 1] })
  }
  if (supplier?.phone) {
    toStack.push({ text: [{ text: 'Mobile: ', bold: true }, supplier.phone], fontSize: 10 })
  }

  return {
    table: {
      heights: [100],
      widths: ['50%', '50%'],
      body: [[
        { stack: fromStack, margin: [0, 0, 5, 0] },
        { stack: toStack },
      ]],
    },
    layout: {
      hLineWidth: (i: number) => i === 0 ? 0 : 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#000',
      vLineColor: () => '#000',
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
    margin: [0, 0, 0, 0],
  }
}

function buildItemsSection(po: PurchaseOrderPDFData, isInter: boolean, taxGroups: ReturnType<typeof getTaxGroups>): Content {
  const widths = [32, '*', 50, 50, 50, 55]
  const headers = ['S.NO.', 'ITEMS', 'HSN', 'QTY.', 'RATE', 'AMOUNT']
  const headerRow: TableCell[] = headers.map((h) => ({
    text: h, bold: true, fontSize: 9, alignment: 'center' as const,
    fillColor: GREEN, margin: [0, 2, 0, 2] as [number, number, number, number],
  }))

  const itemRows: TableCell[][] = po.items.map((it, idx) => {
    const hsn = it.hsnCode || it.item.hsnCode || it.item.skuHsn || ''
    const taxable = it.taxableAmount ?? (it.rate * it.quantity - (it.discount ?? 0))
    return [
      { text: (idx + 1).toString(), alignment: 'center' as const, fontSize: 9 },
      { text: it.item.name, fontSize: 9 },
      { text: hsn, alignment: 'center' as const, fontSize: 9 },
      { text: `${it.quantity} ${it.item.unit || 'PCS'}`, alignment: 'center' as const, fontSize: 9 },
      { text: fmtNum(it.rate), alignment: 'right' as const, fontSize: 9 },
      { text: fmtNum(taxable), alignment: 'right' as const, fontSize: 9 },
    ]
  })

  const taxRows: TableCell[][] = []
  taxGroups.forEach((g) => {
    if (isInter) {
      taxRows.push([
        { text: '' },
        { text: `IGST @${g.rate}%`, italics: true, fontSize: 9, alignment: 'right' as const },
        { text: '-', alignment: 'right' as const },
        { text: '-', alignment: 'right' as const },
        { text: '-', alignment: 'right' as const },
        { text: fmtRs(g.igst), alignment: 'right' as const, fontSize: 9 },
      ])
    } else {
      taxRows.push([
        { text: '' },
        { text: `CGST @${g.rate / 2}%`, italics: true, fontSize: 9, alignment: 'right' as const },
        { text: '-', alignment: 'right' as const },
        { text: '-', alignment: 'right' as const },
        { text: '-', alignment: 'right' as const },
        { text: fmtRs(g.cgst), alignment: 'right' as const, fontSize: 9 },
      ])
      taxRows.push([
        { text: '' },
        { text: `SGST @${g.rate / 2}%`, italics: true, fontSize: 9, alignment: 'right' as const },
        { text: '-', alignment: 'right' as const },
        { text: '-', alignment: 'right' as const },
        { text: '-', alignment: 'right' as const },
        { text: fmtRs(g.sgst), alignment: 'right' as const, fontSize: 9 },
      ])
    }
  })

  const totalQty = po.items.reduce((s, i) => s + i.quantity, 0)
  const totalRow: TableCell[] = [
    { text: '', fillColor: GREEN },
    { text: 'TOTAL', bold: true, fontSize: 9, alignment: 'right' as const, fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: totalQty.toString(), bold: true, fontSize: 9, alignment: 'right' as const, fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: fmtRs(po.totalAmount), bold: true, fontSize: 9, alignment: 'right' as const, fillColor: GREEN },
  ]

  const TARGET_ROWS = 14
  const usedRows = itemRows.length + taxRows.length
  const fillerCount = Math.max(0, TARGET_ROWS - usedRows)
  const emptyCell = { text: ' ', fontSize: 6, margin: [0, 3, 0, 3] as [number, number, number, number] }
  const fillerRows: TableCell[][] = Array.from({ length: fillerCount }, () => [
    { ...emptyCell }, { ...emptyCell }, { ...emptyCell }, { ...emptyCell }, { ...emptyCell }, { ...emptyCell },
  ])

  const body: TableCell[][] = [headerRow, ...itemRows, ...fillerRows, ...taxRows, totalRow]

  return {
    table: { headerRows: 1, widths, body },
    layout: {
      hLineWidth: (i: number, node: any) => {
        if (i === 0) return 0
        if (i === 1) return 0.5
        if (i === node.table.body.length) return 0.5
        if (i === node.table.body.length - 1) return 0.5
        return 0
      },
      vLineWidth: () => 0.5,
      hLineColor: () => '#000',
      vLineColor: () => '#000',
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 0] as [number, number, number, number],
  }
}

function buildHSNSection(hsnGroups: ReturnType<typeof getHSNGroups>, isInter: boolean): Content {
  if (isInter) {
    const headerRow1: TableCell[] = [
      { text: 'HSN/SAC', bold: true, alignment: 'center' as const, fillColor: GREEN, fontSize: 9 },
      { text: 'Taxable Value', bold: true, alignment: 'center' as const, fillColor: GREEN, fontSize: 9 },
      { text: 'IGST', bold: true, alignment: 'center' as const, fillColor: GREEN, colSpan: 2, fontSize: 9 }, {},
      { text: 'Total Tax Amount', bold: true, alignment: 'center' as const, fillColor: GREEN, fontSize: 9 },
    ]
    const headerRow2: TableCell[] = [
      { text: '' }, { text: '' },
      { text: 'Rate', bold: true, alignment: 'center' as const, fontSize: 8 },
      { text: 'Amount', bold: true, alignment: 'center' as const, fontSize: 8 },
      { text: '' },
    ]
    let totalTaxable = 0, totalIgst = 0, totalTax = 0
    const dataRows: TableCell[][] = hsnGroups.map((g) => {
      totalTaxable += g.taxable; totalIgst += g.igst; totalTax += g.totalTax
      return [
        { text: g.hsn, alignment: 'center' as const, fontSize: 9 },
        { text: fmtNum(g.taxable), alignment: 'right' as const, fontSize: 9 },
        { text: g.rate + '%', alignment: 'center' as const, fontSize: 9 },
        { text: fmtNum(g.igst), alignment: 'right' as const, fontSize: 9 },
        { text: fmtRs(g.totalTax), alignment: 'right' as const, fontSize: 9 },
      ]
    })
    const totalRow: TableCell[] = [
      { text: 'Total', bold: true, alignment: 'center' as const, fontSize: 9 },
      { text: fmtNum(totalTaxable), bold: true, alignment: 'right' as const, fontSize: 9 },
      { text: '' },
      { text: fmtNum(totalIgst), bold: true, alignment: 'right' as const, fontSize: 9 },
      { text: fmtRs(totalTax), bold: true, alignment: 'right' as const, fontSize: 9 },
    ]
    return {
      table: { headerRows: 2, widths: [60, 70, 35, 60, '*'], body: [headerRow1, headerRow2, ...dataRows, totalRow] },
      layout: {
        hLineWidth: (i: number) => i === 0 ? 0 : 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => '#000', vLineColor: () => '#000',
        paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2,
      },
      margin: [0, 0, 0, 0] as [number, number, number, number],
    }
  }
  const headerRow1: TableCell[] = [
    { text: 'HSN/SAC', bold: true, alignment: 'center' as const, fillColor: GREEN, fontSize: 9 },
    { text: 'Taxable Value', bold: true, alignment: 'center' as const, fillColor: GREEN, fontSize: 9 },
    { text: 'CGST', bold: true, alignment: 'center' as const, fillColor: GREEN, colSpan: 2, fontSize: 9 }, {},
    { text: 'SGST', bold: true, alignment: 'center' as const, fillColor: GREEN, colSpan: 2, fontSize: 9 }, {},
    { text: 'Total Tax Amount', bold: true, alignment: 'center' as const, fillColor: GREEN, fontSize: 9 },
  ]
  const headerRow2: TableCell[] = [
    { text: '' }, { text: '' },
    { text: 'Rate', bold: true, alignment: 'center' as const, fontSize: 8 },
    { text: 'Amount', bold: true, alignment: 'center' as const, fontSize: 8 },
    { text: 'Rate', bold: true, alignment: 'center' as const, fontSize: 8 },
    { text: 'Amount', bold: true, alignment: 'center' as const, fontSize: 8 },
    { text: '' },
  ]
  let totalTaxable = 0, totalCgst = 0, totalSgst = 0, totalTax = 0
  const dataRows: TableCell[][] = hsnGroups.map((g) => {
    totalTaxable += g.taxable; totalCgst += g.cgst; totalSgst += g.sgst; totalTax += g.totalTax
    return [
      { text: g.hsn, alignment: 'center' as const, fontSize: 9 },
      { text: fmtNum(g.taxable), alignment: 'right' as const, fontSize: 9 },
      { text: (g.rate / 2) + '%', alignment: 'center' as const, fontSize: 9 },
      { text: fmtNum(g.cgst), alignment: 'right' as const, fontSize: 9 },
      { text: (g.rate / 2) + '%', alignment: 'center' as const, fontSize: 9 },
      { text: fmtNum(g.sgst), alignment: 'right' as const, fontSize: 9 },
      { text: fmtRs(g.totalTax), alignment: 'right' as const, fontSize: 9 },
    ]
  })
  const totalRow: TableCell[] = [
    { text: 'Total', bold: true, alignment: 'center' as const, fontSize: 9 },
    { text: fmtNum(totalTaxable), bold: true, alignment: 'right' as const, fontSize: 9 },
    { text: '' },
    { text: fmtNum(totalCgst), bold: true, alignment: 'right' as const, fontSize: 9 },
    { text: '' },
    { text: fmtNum(totalSgst), bold: true, alignment: 'right' as const, fontSize: 9 },
    { text: fmtRs(totalTax), bold: true, alignment: 'right' as const, fontSize: 9 },
  ]
  return {
    table: { headerRows: 2, widths: [45, 55, 25, 45, 25, 45, '*'], body: [headerRow1, headerRow2, ...dataRows, totalRow] },
    layout: {
      hLineWidth: (i: number) => i === 0 ? 0 : 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#000', vLineColor: () => '#000',
      paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2,
    },
    margin: [0, 0, 0, 0] as [number, number, number, number],
  }
}

function buildAmountInWords(totalAmount: number): Content {
  return {
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          { text: 'Total Amount (in words)', bold: true, fontSize: 9 },
          { text: numberToWords(totalAmount), fontSize: 9, margin: [0, 2, 0, 0] as [number, number, number, number] },
        ],
        fillColor: GREEN,
      }]],
    },
    layout: {
      hLineWidth: (i: number) => i === 0 ? 0 : 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#000', vLineColor: () => '#000',
      paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 3, paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 0] as [number, number, number, number],
  }
}

function buildFooter(po: PurchaseOrderPDFData, logo: string): Content {
  const company = po.company
  const hasNotes = !!(po.notes && po.notes.trim())

  const notesStack: Content[] = [
    { text: 'Notes', bold: true, fontSize: 9, margin: [0, 10, 0, 5] as [number, number, number, number] },
    { text: po.notes || '', fontSize: 9, lineHeight: 1.2 },
  ]

  const bankStack: Content[] = [
    { text: 'Bank Details', bold: true, fontSize: 9, margin: [0, 10, 0, 5] as [number, number, number, number] },
  ]
  if (company?.bankDetails) {
    company.bankDetails.split('\n').forEach((line: string) => {
      const colonIdx = line.indexOf(':')
      if (colonIdx > -1) {
        bankStack.push({
          text: [
            { text: line.substring(0, colonIdx + 1), bold: true, fontSize: 9 },
            { text: ' ' + line.substring(colonIdx + 1).trim(), fontSize: 9 },
          ],
          margin: [0, 0, 0, 1] as [number, number, number, number],
        })
      } else {
        bankStack.push({ text: line, fontSize: 9, margin: [0, 0, 0, 1] as [number, number, number, number] })
      }
    })
  }

  const termsStack: Content[] = [
    { text: 'Terms and Conditions', bold: true, fontSize: 9, margin: [0, 0, 0, 3] as [number, number, number, number] },
  ]
  // PO-specific terms override the company default if provided.
  const termsText = (po.termsConditions && po.termsConditions.trim())
    ? po.termsConditions
    : company?.termsConditions
  if (termsText) {
    termsStack.push({ text: termsText, fontSize: 8, lineHeight: 1.2 })
  }

  const sigStack: Content[] = [
    { text: '', fontSize: 1 },
    { image: logo, width: 45, height: 45, alignment: 'center' as const, margin: [0, 10, 0, 8] as [number, number, number, number] },
    { text: 'Authorised Signatory For', fontSize: 9, alignment: 'center' as const },
    { text: (company?.name || '').toUpperCase(), bold: true, fontSize: 9, alignment: 'center' as const },
  ]

  const layout = {
    hLineWidth: (i: number) => i === 0 ? 0 : 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => '#000', vLineColor: () => '#000',
    paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 5, paddingBottom: () => 5,
  }

  if (hasNotes) {
    return {
      table: {
        widths: ['50%', '50%'],
        body: [
          [{ stack: notesStack }, { stack: bankStack }],
          [{ stack: termsStack }, { stack: sigStack }],
        ],
      },
      layout,
    }
  }

  return {
    table: {
      widths: ['36%', '34%', '30%'],
      body: [[{ stack: bankStack }, { stack: termsStack }, { stack: sigStack }]],
    },
    layout,
  }
}
