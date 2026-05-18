import pdfMake from 'pdfmake/build/pdfmake'
import pdfFonts from 'pdfmake/build/vfs_fonts'
// pdfmake doesn't ship type definitions — use any for doc definition types
type Content = any
type TableCell = any
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
import type { InvoiceData } from './pdfHelpers'

// Register pdfmake fonts
;(pdfMake as any).vfs = (pdfFonts as any).pdfMake?.vfs || pdfFonts

// ─── Colors ──────────────────────────────────────────────────────────────────
const GREEN = '#C6E0B4'

// ─── Main export ─────────────────────────────────────────────────────────────

export function buildClassicPDFFilename(invoice: InvoiceData) {
  const suffix = invoice.type === 'QUOTATION'
    ? 'quotation'
    : invoice.type === 'PROFORMA_INVOICE'
      ? 'proforma_invoice'
      : 'sales_invoice'
  return `${invoice.invoiceNumber.replace(/\//g, '_')}_${suffix}_${invoice.customer.name.replace(/[^a-z0-9]/gi, '_')}.pdf`
}

export function downloadClassicPDF(invoice: InvoiceData) {
  if (!invoice.items) invoice.items = []
  const dd = buildClassicPDFDefinition(invoice)
  pdfMake.createPdf(dd).download(buildClassicPDFFilename(invoice))
}

export function getClassicPDFBytes(invoice: InvoiceData): Promise<Uint8Array> {
  if (!invoice.items) invoice.items = []
  const dd = buildClassicPDFDefinition(invoice)
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(dd).getBuffer((buffer: any) => {
        // pdfmake returns a Node Buffer in Electron renderer; coerce to Uint8Array
        resolve(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer))
      })
    } catch (err) {
      reject(err)
    }
  })
}

// ─── Document definition ─────────────────────────────────────────────────────

export function buildClassicPDFDefinition(inv: InvoiceData): any {
  const isInter = inv.isInterState !== false
  const taxGroups = getTaxGroups(inv.items, isInter)
  const hsnGroups = getHSNGroups(inv.items, isInter)
  const logo = inv.company?.logoBase64 || LOGO_BASE64

  return {
    pageSize: 'A4',
    pageMargins: [17, 13, 17, 13],

    content: [
      // Title line
      buildTitle(inv.type),
      // Each section draws its own borders — no wrapper
      buildCompanySection(inv, logo),
      buildBillShipSection(inv),
      // Additional fields between bill-to and items (if any exist)
      ...buildAdditionalFieldsSection(inv),
      buildItemsSection(inv, isInter, taxGroups),
      buildHSNSection(hsnGroups, isInter),
      buildAmountInWords(inv.totalAmount),
      buildFooter(inv, logo),
    ],

    defaultStyle: {
      fontSize: 9,
    },
  }
}

// ─── Title ───────────────────────────────────────────────────────────────────

function buildTitle(type: string): Content {
  const label =
    type === 'QUOTATION'
      ? 'QUOTATION'
      : type === 'PROFORMA_INVOICE'
        ? 'PROFORMA INVOICE'
        : 'TAX INVOICE'

  if (type === 'QUOTATION' || type === 'PROFORMA_INVOICE') {
    return {
      columns: [
        { text: label, bold: true, fontSize: 11, width: 'auto' },
        { text: '', width: '*' }
      ],
      margin: [0, 0, 0, 3]
    }
  }

  return {
    columns: [
      { text: label, bold: true, fontSize: 11, width: 'auto' },
      { width: 6, text: '' },
      {
        table: {
          body: [[{ text: 'ORIGINAL FOR RECIPIENT', fontSize: 8 }]]
        },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#000', vLineColor: () => '#000', paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2 },
        width: 'auto'
      },
      { text: '', width: '*' }
    ],
    margin: [0, 0, 0, 3]
  }
}

// ─── Company Section ─────────────────────────────────────────────────────────

function buildCompanySection(inv: InvoiceData, logo: string): Content {
  const company = inv.company
  const isQuotation = inv.type === 'QUOTATION'
  const isProformaInvoice = inv.type === 'PROFORMA_INVOICE'
  const isQuoteLike = isQuotation || isProformaInvoice
  const secondaryLabel = isQuoteLike ? 'Delivery Time' : 'P.O. No.'
  const secondaryValue = isQuoteLike ? inv.deliveryTime : inv.poNumber
  const secondaryDisplayValue = isQuoteLike && secondaryValue ? formatDate(secondaryValue) : secondaryValue
  const hasSecondaryValue = !!secondaryValue
  const numberLabel = isQuotation
    ? 'Quotation No.'
    : isProformaInvoice
      ? 'Proforma Invoice No.'
      : 'Invoice No.'
  const dateLabel = isQuotation
    ? 'Quotation Date'
    : isProformaInvoice
      ? 'Proforma Invoice Date'
      : 'Invoice Date'

  // Build company info lines
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

  // Build the invoice details grid (right side)
  // Rows: Number + Date, then document-specific details if present
  const hasDueDate = !!inv.dueDate
  const dueDateLabel = isQuoteLike ? 'Expiry Date' : 'Due Date'
  const invoiceGridBody: TableCell[][] = [
    [
      { stack: [
        { text: numberLabel, bold: true, fontSize: 10 },
        { text: inv.invoiceNumber, fontSize: 10, margin: [0, 3, 0, 0] as [number, number, number, number] },
      ] },
      { stack: [
        { text: dateLabel, bold: true, fontSize: 10 },
        { text: formatDate(inv.invoiceDate), fontSize: 10, margin: [0, 3, 0, 0] as [number, number, number, number] },
      ] },
    ],
  ]

  if (hasDueDate && hasSecondaryValue) {
    invoiceGridBody.push([
      { stack: [
        { text: dueDateLabel, bold: true, fontSize: 10 },
        { text: formatDate(inv.dueDate!), fontSize: 10, margin: [0, 3, 0, 0] as [number, number, number, number] },
      ] },
      { stack: [
        { text: secondaryLabel, bold: true, fontSize: 10 },
        { text: secondaryDisplayValue, fontSize: 10, margin: [0, 3, 0, 0] as [number, number, number, number] },
      ] },
    ])
  } else if (hasDueDate) {
    invoiceGridBody.push(
      [{ stack: [
        { text: dueDateLabel, bold: true, fontSize: 10 },
        { text: formatDate(inv.dueDate!), fontSize: 10, margin: [0, 3, 0, 0] as [number, number, number, number] },
      ], colSpan: 2 }, {}],
    )
  } else if (hasSecondaryValue) {
    invoiceGridBody.push(
      [{ stack: [
        { text: secondaryLabel, bold: true, fontSize: 10 },
        { text: secondaryDisplayValue, fontSize: 10, margin: [0, 3, 0, 0] as [number, number, number, number] },
      ], colSpan: 2 }, {}],
    )
  }

  return {
    table: {
      heights: [105],
      widths: ['60%', '40%'],
      body: [
        [
          // Left: logo + company info
          {
            columns: [
              { image: logo, width: 60, height: 60, margin: [0, 0, 8, 0] },
              { stack: companyStack, width: '*' },
            ]
          },
          // Right: invoice number grid
          {
            table: {
              heights: (hasSecondaryValue || hasDueDate) ? [35, 35] : [70],
              widths: ['*', '*'],
              body: invoiceGridBody,
            },
            layout: {
              hLineWidth: (i: number) => ((hasSecondaryValue || hasDueDate) && i === 1) ? 0.5 : 0,
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

// ─── Bill To / Ship To ───────────────────────────────────────────────────────

function buildBillShipSection(inv: InvoiceData): Content {
  const customer = inv.customer
  const pan = extractPAN(customer.taxId)
  const shipAddr = customer.shippingAddress || customer.billingAddress

  // Bill To stack
  const billStack: Content[] = [
    { text: 'BILL TO', bold: true, fontSize: 10, margin: [0, 0, 0, 2] },
    { text: customer.name, bold: true, fontSize: 11, margin: [0, 0, 0, 2] },
  ]
  if (customer.billingAddress) {
    billStack.push({ columns: [
      { text: 'Address: ', width: 'auto', fontSize: 10, margin: [0, 0, 5, 0] as [number, number, number, number] },
      { text: customer.billingAddress, width: '*', fontSize: 10 },
    ], margin: [0, 0, 0, 2] })
  }
  if (customer.taxId) {
    const gstParts: any[] = [{ text: 'GSTIN: ' + customer.taxId, bold: true }]
    if (inv.placeOfSupplyName) {
      gstParts.push({ text: '   Place of Supply: ' + inv.placeOfSupplyName, bold: false })
    }
    billStack.push({ text: gstParts, fontSize: 10, margin: [0, 0, 0, 1] })
  }
  if (customer.phone) {
    billStack.push({ text: [{ text: 'Mobile: ', bold: true }, customer.phone], fontSize: 10, margin: [0, 0, 0, 1] })
  }
  if (pan) {
    billStack.push({ text: [{ text: 'PAN Number: ', bold: true }, pan], fontSize: 10 })
  }

  // Ship To stack
  const shipStack: Content[] = [
    { text: 'SHIP TO', bold: true, fontSize: 10, margin: [0, 0, 0, 2] },
    { text: customer.name, bold: true, fontSize: 11, margin: [0, 0, 0, 2] },
  ]
  if (shipAddr) {
    shipStack.push({ columns: [
      { text: 'Address: ', width: 'auto', fontSize: 10, margin: [0, 0, 5, 0] as [number, number, number, number] },
      { text: shipAddr, width: '*', fontSize: 10 },
    ] })
  }

  return {
    table: {
      heights: [100],
      widths: ['50%', '50%'],
      body: [
        [
          { stack: billStack, margin: [0, 0, 5, 0] },
          { stack: shipStack },
        ],
      ],
    },
    layout: {
      hLineWidth: (i: number, _node: any) => i === 0 ? 0 : 0.5,
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

// ─── Items Table + Tax Rows + Total ──────────────────────────────────────────

function buildItemsSection(inv: InvoiceData, isInter: boolean, taxGroups: ReturnType<typeof getTaxGroups>): Content {
  // Column widths: S.NO | ITEMS | HSN | QTY | RATE | AMOUNT
  const widths = [32, '*', 50, 50, 50, 55]

  // Header row
  const headers = ['S.NO.', 'ITEMS', 'HSN', 'QTY.', 'RATE', 'AMOUNT']
  const headerRow: TableCell[] = headers.map(h => ({
    text: h, bold: true, fontSize: 9, alignment: 'center' as const,
    fillColor: GREEN, margin: [0, 2, 0, 2] as [number, number, number, number],
  }))

  // Item rows
  const itemRows: TableCell[][] = inv.items.map((it, idx) => {
    const hsn = it.hsnCode || it.item.hsnCode || ''
    const taxable = it.taxableAmount ?? (it.rate * it.quantity)
    return [
      { text: (idx + 1).toString(), alignment: 'center' as const, fontSize: 9 },
      { text: it.item.name, fontSize: 9 },
      { text: hsn, alignment: 'center' as const, fontSize: 9 },
      { text: `${it.quantity} ${it.item.unit || 'PCS'}`, alignment: 'center' as const, fontSize: 9 },
      { text: fmtNum(it.rate), alignment: 'right' as const, fontSize: 9 },
      { text: fmtNum(taxable), alignment: 'right' as const, fontSize: 9 },
    ]
  })

  // Tax rows
  const taxRows: TableCell[][] = []
  taxGroups.forEach(g => {
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

  // Total row
  const totalQty = inv.items.reduce((s, i) => s + i.quantity, 0)
  const totalRow: TableCell[] = [
    { text: '', fillColor: GREEN },
    { text: 'TOTAL', bold: true, fontSize: 9, alignment: 'right' as const, fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: totalQty.toString(), bold: true, fontSize: 9, alignment: 'right' as const, fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: fmtRs(inv.totalAmount), bold: true, fontSize: 9, alignment: 'right' as const, fillColor: GREEN },
  ]

  // Filler rows — stretch the items table to fill the page.
  // Shrink when additional fields exist (they take space above items).
  const hasAdditionalFields = inv.type === 'PROFORMA_INVOICE' || inv.type === 'QUOTATION'
    ? false
    : !!(inv.ewayBillNo || inv.vehicleNumber || inv.warrantyPeriod || inv.dispatchedThrough)
  const TARGET_ROWS = hasAdditionalFields ? 12 : 14
  const usedRows = itemRows.length + taxRows.length
  const fillerCount = Math.max(0, TARGET_ROWS - usedRows)
  const emptyCell = { text: ' ', fontSize: 6, margin: [0, 3, 0, 3] as [number, number, number, number] }
  const fillerRows: TableCell[][] = Array.from({ length: fillerCount }, () => [
    { ...emptyCell }, { ...emptyCell }, { ...emptyCell }, { ...emptyCell }, { ...emptyCell }, { ...emptyCell }
  ])

  const body: TableCell[][] = [
    headerRow,
    ...itemRows,
    ...fillerRows,
    ...taxRows,
    totalRow,
  ]

  const result: Content[] = [
    {
      table: { headerRows: 1, widths, body },
      layout: {
        hLineWidth: (i: number, node: any) => {
          // Skip top — bill-to section already draws its bottom
          if (i === 0) return 0
          // Below header
          if (i === 1) return 0.5
          // Bottom of table
          if (i === node.table.body.length) return 0.5
          // Above total row
          if (i === node.table.body.length - 1) return 0.5
          // Everything else (items, fillers, tax rows): no horizontal lines
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
    },
  ]

  return { stack: result, margin: [0, 0, 0, 0] }
}

// ─── Additional Fields (between Bill-To and Items) ───────────────────────────

/** Returns an array — empty if no fields, or [section] if fields exist */
function buildAdditionalFieldsSection(inv: InvoiceData): Content[] {
  if (inv.type === 'PROFORMA_INVOICE' || inv.type === 'QUOTATION') {
    return []
  }

  const fields: { label: string; value: string }[] = []
  if (inv.ewayBillNo) fields.push({ label: 'E-Way Bill No', value: inv.ewayBillNo })
  if (inv.warrantyPeriod) fields.push({ label: 'Warranty Period', value: inv.warrantyPeriod })
  if (inv.vehicleNumber) fields.push({ label: 'Vehicle Number', value: inv.vehicleNumber })
  if (inv.dispatchedThrough) fields.push({ label: 'Dispatched Through', value: inv.dispatchedThrough })

  if (fields.length === 0) return []

  // Arrange in 2-column pairs
  const rows: TableCell[][] = []
  for (let i = 0; i < fields.length; i += 2) {
    const row: TableCell[] = [
      { text: fields[i].label + ':', bold: true, fontSize: 9 },
      { text: fields[i].value, fontSize: 9 },
    ]
    if (i + 1 < fields.length) {
      row.push({ text: fields[i + 1].label + ':', bold: true, fontSize: 9 })
      row.push({ text: fields[i + 1].value, fontSize: 9 })
    } else {
      row.push({ text: '' }, { text: '' })
    }
    rows.push(row)
  }

  return [{
    table: {
      widths: ['auto', '*', 'auto', '*'],
      body: rows,
    },
    layout: {
      hLineWidth: (i: number) => i === 0 ? 0 : 0.5,
      vLineWidth: (i: number) => (i === 0 || i === 2 || i === 4) ? 0.5 : 0,
      hLineColor: () => '#000',
      vLineColor: () => '#000',
      paddingLeft: () => 4,
      paddingRight: () => 5,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 0] as [number, number, number, number],
  }]
}

// ─── HSN / SAC Summary Table ─────────────────────────────────────────────────

function buildHSNSection(hsnGroups: ReturnType<typeof getHSNGroups>, isInter: boolean): Content {
  if (isInter) {
    // IGST layout: HSN/SAC | Taxable Value | IGST Rate | IGST Amount | Total Tax Amount
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
    const dataRows: TableCell[][] = hsnGroups.map(g => {
      totalTaxable += g.taxable
      totalIgst += g.igst
      totalTax += g.totalTax
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
      table: {
        headerRows: 2,
        widths: [60, 70, 35, 60, '*'],
        body: [headerRow1, headerRow2, ...dataRows, totalRow],
      },
      layout: {
        hLineWidth: (i: number) => i === 0 ? 0 : 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => '#000',
        vLineColor: () => '#000',
        paddingLeft: () => 3,
        paddingRight: () => 3,
        paddingTop: () => 2,
        paddingBottom: () => 2,
      },
      margin: [0, 0, 0, 0] as [number, number, number, number],
    }
  } else {
    // CGST + SGST layout
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
    const dataRows: TableCell[][] = hsnGroups.map(g => {
      totalTaxable += g.taxable
      totalCgst += g.cgst
      totalSgst += g.sgst
      totalTax += g.totalTax
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
      table: {
        headerRows: 2,
        widths: [45, 55, 25, 45, 25, 45, '*'],
        body: [headerRow1, headerRow2, ...dataRows, totalRow],
      },
      layout: {
        hLineWidth: (i: number) => i === 0 ? 0 : 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => '#000',
        vLineColor: () => '#000',
        paddingLeft: () => 3,
        paddingRight: () => 3,
        paddingTop: () => 2,
        paddingBottom: () => 2,
      },
      margin: [0, 0, 0, 0] as [number, number, number, number],
    }
  }
}

// ─── Amount in Words ─────────────────────────────────────────────────────────

function buildAmountInWords(totalAmount: number): Content {
  const words = numberToWords(totalAmount)
  return {
    table: {
      widths: ['*'],
      body: [[
        {
          stack: [
            { text: 'Total Amount (in words)', bold: true, fontSize: 9 },
            { text: words, fontSize: 9, margin: [0, 2, 0, 0] as [number, number, number, number] },
          ],
          fillColor: GREEN,
        }
      ]],
    },
    layout: {
      hLineWidth: (i: number) => i === 0 ? 0 : 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#000',
      vLineColor: () => '#000',
      paddingLeft: () => 3,
      paddingRight: () => 3,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 0, 0, 0] as [number, number, number, number],
  }
}

// ─── Footer: Notes (if any) | Bank Details, Terms | Authorised Signatory ─────

function buildFooter(inv: InvoiceData, logo: string): Content {
  const company = inv.company
  const hasNotes = !!(inv.notes && inv.notes.trim())

  // Notes (rendered only when present)
  const notesStack: Content[] = [
    { text: 'Notes', bold: true, fontSize: 9, margin: [0, 10, 0, 5] as [number, number, number, number] },
    { text: inv.notes || '', fontSize: 9, lineHeight: 1.2 },
  ]

  // Bank Details
  const bankStack: Content[] = [
    { text: 'Bank Details', bold: true, fontSize: 9, margin: [0, 10, 0, 5] as [number, number, number, number] },
  ]
  if (company?.bankDetails) {
    const lines = company.bankDetails.split('\n')
    lines.forEach(line => {
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

  // Terms and Conditions — per-invoice override, fall back to company default
  const effectiveTerms = inv.termsConditions || company?.termsConditions
  const termsStack: Content[] = [
    { text: 'Terms and Conditions', bold: true, fontSize: 9, margin: [0, 0, 0, 3] as [number, number, number, number] },
  ]
  if (effectiveTerms) {
    termsStack.push({ text: effectiveTerms, fontSize: 8, lineHeight: 1.2 })
  }

  // Authorised Signatory
  const sigStack: Content[] = [
    { text: '', fontSize: 1 },
    { image: logo, width: 45, height: 45, alignment: 'center' as const, margin: [0, 10, 0, 8] as [number, number, number, number] },
    { text: 'Authorised Signatory For', fontSize: 9, alignment: 'center' as const },
    { text: (company?.name || '').toUpperCase(), bold: true, fontSize: 9, alignment: 'center' as const },
  ]

  const layout = {
    hLineWidth: (i: number, _node: any) => i === 0 ? 0 : 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => '#000',
    vLineColor: () => '#000',
    paddingLeft: () => 4,
    paddingRight: () => 4,
    paddingTop: () => 5,
    paddingBottom: () => 5,
  }

  // With notes: 2x2 grid matching the reference layout.
  // Without notes: keep the original 3-column layout untouched.
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
      body: [
        [
          { stack: bankStack },
          { stack: termsStack },
          { stack: sigStack },
        ],
      ],
    },
    layout,
  }
}
