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

export interface PurchaseBillPDFData {
  billNumber: string
  billDate: string | Date
  supplierInvoiceNumber?: string
  supplierInvoiceDate?: string | Date
  notes?: string
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

export function buildPurchaseBillFilename(bill: PurchaseBillPDFData) {
  const safeNum = (bill.billNumber || 'bill').replace(/\//g, '_')
  const safeName = (bill.supplier?.name || 'supplier').replace(/[^a-z0-9]/gi, '_')
  return `${safeNum}_purchase_bill_${safeName}.pdf`
}

export function downloadPurchaseBillPDF(bill: PurchaseBillPDFData) {
  if (!bill.items) bill.items = []
  pdfMake.createPdf(buildPurchaseBillDefinition(bill)).download(buildPurchaseBillFilename(bill))
}

export function getPurchaseBillPDFBytes(bill: PurchaseBillPDFData): Promise<Uint8Array> {
  if (!bill.items) bill.items = []
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(buildPurchaseBillDefinition(bill)).getBuffer((buffer: any) => {
        resolve(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer))
      })
    } catch (err) {
      reject(err)
    }
  })
}

// GSTIN's first two chars are the state code. Intra vs inter-state is
// derived by comparing supplier and company state codes; if either is
// missing, fall back to intra-state (CGST + SGST split).
function deriveIsInterState(bill: PurchaseBillPDFData): boolean {
  if (typeof bill.isInterState === 'boolean') return bill.isInterState
  const supplierState = bill.supplier?.taxId?.substring(0, 2)
  const companyState =
    bill.company?.stateCode || bill.company?.taxId?.substring(0, 2)
  if (!supplierState || !companyState) return false
  return supplierState !== companyState
}

function buildPurchaseBillDefinition(bill: PurchaseBillPDFData): any {
  const isInter = deriveIsInterState(bill)
  const itemsForGroups = bill.items.map((it) => ({
    ...it,
    discount: it.discount ?? 0,
  }))
  const taxGroups = getTaxGroups(itemsForGroups as any, isInter)
  const hsnGroups = getHSNGroups(itemsForGroups as any, isInter)
  const logo = bill.company?.logoBase64 || LOGO_BASE64

  return {
    pageSize: 'A4',
    pageMargins: [17, 13, 17, 13],
    content: [
      buildTitle(),
      buildCompanySection(bill, logo),
      buildSupplierBuyerSection(bill),
      buildItemsSection(bill, isInter, taxGroups),
      buildHSNSection(hsnGroups, isInter),
      buildAmountInWords(bill.totalAmount),
      buildFooter(bill, logo),
    ],
    defaultStyle: { fontSize: 9 },
  }
}

function buildTitle(): Content {
  return {
    columns: [
      { text: 'PURCHASE BILL', bold: true, fontSize: 11, width: 'auto' },
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

function buildCompanySection(bill: PurchaseBillPDFData, logo: string): Content {
  const company = bill.company
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

  const hasSupplierInv = !!bill.supplierInvoiceNumber
  const gridBody: TableCell[][] = [
    [
      { stack: [
        { text: 'Bill No.', bold: true, fontSize: 10 },
        { text: bill.billNumber, fontSize: 10, margin: [0, 3, 0, 0] as [number, number, number, number] },
      ] },
      { stack: [
        { text: 'Bill Date', bold: true, fontSize: 10 },
        { text: formatDate(bill.billDate), fontSize: 10, margin: [0, 3, 0, 0] as [number, number, number, number] },
      ] },
    ],
  ]
  if (hasSupplierInv) {
    gridBody.push([
      { stack: [
        { text: 'Supplier Inv. No.', bold: true, fontSize: 10 },
        { text: bill.supplierInvoiceNumber!, fontSize: 10, margin: [0, 3, 0, 0] as [number, number, number, number] },
      ] },
      { stack: [
        { text: 'Supplier Inv. Date', bold: true, fontSize: 10 },
        { text: bill.supplierInvoiceDate ? formatDate(bill.supplierInvoiceDate) : '-', fontSize: 10, margin: [0, 3, 0, 0] as [number, number, number, number] },
      ] },
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
              heights: hasSupplierInv ? [35, 35] : [70],
              widths: ['*', '*'],
              body: gridBody,
            },
            layout: {
              hLineWidth: (i: number) => (hasSupplierInv && i === 1) ? 0.5 : 0,
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

function buildSupplierBuyerSection(bill: PurchaseBillPDFData): Content {
  const supplier = bill.supplier
  const company = bill.company
  const supplierPan = extractPAN(supplier?.taxId)

  const fromStack: Content[] = [
    { text: 'BILL FROM (SUPPLIER)', bold: true, fontSize: 10, margin: [0, 0, 0, 2] },
    { text: supplier?.name || '-', bold: true, fontSize: 11, margin: [0, 0, 0, 2] },
  ]
  if (supplier?.billingAddress) {
    fromStack.push({ columns: [
      { text: 'Address: ', width: 'auto', fontSize: 10, margin: [0, 0, 5, 0] as [number, number, number, number] },
      { text: supplier.billingAddress, width: '*', fontSize: 10 },
    ], margin: [0, 0, 0, 2] })
  }
  if (supplier?.taxId) {
    fromStack.push({ text: [{ text: 'GSTIN: ', bold: true }, supplier.taxId], fontSize: 10, margin: [0, 0, 0, 1] })
  }
  if (supplier?.phone) {
    fromStack.push({ text: [{ text: 'Mobile: ', bold: true }, supplier.phone], fontSize: 10, margin: [0, 0, 0, 1] })
  }
  if (supplierPan) {
    fromStack.push({ text: [{ text: 'PAN Number: ', bold: true }, supplierPan], fontSize: 10 })
  }

  const toStack: Content[] = [
    { text: 'BILL TO (BUYER)', bold: true, fontSize: 10, margin: [0, 0, 0, 2] },
    { text: company?.name || '-', bold: true, fontSize: 11, margin: [0, 0, 0, 2] },
  ]
  if (company?.address) {
    toStack.push({ columns: [
      { text: 'Address: ', width: 'auto', fontSize: 10, margin: [0, 0, 5, 0] as [number, number, number, number] },
      { text: company.address, width: '*', fontSize: 10 },
    ], margin: [0, 0, 0, 2] })
  }
  if (company?.taxId) {
    toStack.push({ text: [{ text: 'GSTIN: ', bold: true }, company.taxId], fontSize: 10 })
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

function buildItemsSection(bill: PurchaseBillPDFData, isInter: boolean, taxGroups: ReturnType<typeof getTaxGroups>): Content {
  const widths = [32, '*', 50, 50, 50, 55]
  const headers = ['S.NO.', 'ITEMS', 'HSN', 'QTY.', 'RATE', 'AMOUNT']
  const headerRow: TableCell[] = headers.map((h) => ({
    text: h, bold: true, fontSize: 9, alignment: 'center' as const,
    fillColor: GREEN, margin: [0, 2, 0, 2] as [number, number, number, number],
  }))

  const itemRows: TableCell[][] = bill.items.map((it, idx) => {
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

  const totalQty = bill.items.reduce((s, i) => s + i.quantity, 0)
  const totalRow: TableCell[] = [
    { text: '', fillColor: GREEN },
    { text: 'TOTAL', bold: true, fontSize: 9, alignment: 'right' as const, fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: totalQty.toString(), bold: true, fontSize: 9, alignment: 'right' as const, fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: fmtRs(bill.totalAmount), bold: true, fontSize: 9, alignment: 'right' as const, fillColor: GREEN },
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

function buildFooter(bill: PurchaseBillPDFData, logo: string): Content {
  const company = bill.company
  const hasNotes = !!(bill.notes && bill.notes.trim())

  const notesStack: Content[] = [
    { text: 'Notes', bold: true, fontSize: 9, margin: [0, 10, 0, 5] as [number, number, number, number] },
    { text: bill.notes || '', fontSize: 9, lineHeight: 1.2 },
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
  if (company?.termsConditions) {
    termsStack.push({ text: company.termsConditions, fontSize: 8, lineHeight: 1.2 })
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
