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
} from './pdfHelpers'
import type { ChallanData } from './pdfHelpers'

// Register pdfmake fonts
;(pdfMake as any).vfs = (pdfFonts as any).pdfMake?.vfs || pdfFonts

// ─── Colors ──────────────────────────────────────────────────────────────────
const GREEN = '#C6E0B4'

// ─── Main export ─────────────────────────────────────────────────────────────

export function buildChallanFilename(challan: ChallanData) {
  return `${challan.challanNumber.replace(/\//g, '_')}_delivery_challan_${challan.customer.name.replace(/[^a-z0-9]/gi, '_')}.pdf`
}

export function downloadChallanPDF(challan: ChallanData) {
  if (!challan.items) challan.items = []
  const dd = buildDocDefinition(challan)
  pdfMake.createPdf(dd).download(buildChallanFilename(challan))
}

export function getChallanPDFBytes(challan: ChallanData): Promise<Uint8Array> {
  if (!challan.items) challan.items = []
  const dd = buildDocDefinition(challan)
  return new Promise((resolve, reject) => {
    try {
      pdfMake.createPdf(dd).getBuffer((buffer: any) => {
        resolve(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer))
      })
    } catch (err) {
      reject(err)
    }
  })
}

// ─── Document definition ─────────────────────────────────────────────────────

function buildDocDefinition(ch: ChallanData): any {
  const isInter = ch.isInterState !== false
  const taxGroups = getTaxGroups(ch.items, isInter)
  const hsnGroups = getHSNGroups(ch.items, isInter)
  // Logo & signature are OPTIONAL - only valid data: URIs embed (the old
  // LOGO_BASE64 placeholder was corrupt and crashed pdfmake for logo-less companies).
  const logoSrc = ch.company?.logoBase64
  const logo = logoSrc && logoSrc.startsWith('data:') ? logoSrc : undefined
  const sigSrc = ch.company?.signatureBase64
  const signature = sigSrc && sigSrc.startsWith('data:') ? sigSrc : undefined

  return {
    pageSize: 'A4',
    pageMargins: [17, 13, 17, 13],

    content: [
      buildTitle(),
      buildCompanySection(ch, logo),
      buildBillShipSection(ch),
      ...buildAdditionalDetailsSection(ch),
      buildItemsSection(ch, isInter, taxGroups),
      buildHSNSection(hsnGroups, isInter),
      buildAmountInWords(ch.totalAmount),
      buildFooter(ch, logo, signature),
    ],

    defaultStyle: {
      fontSize: 9,
    },
  }
}

// ─── Title ───────────────────────────────────────────────────────────────────

function buildTitle(): Content {
  return {
    columns: [
      { text: 'DELIVERY CHALLAN', bold: true, fontSize: 11, width: 'auto' },
      { text: '', width: '*' }
    ],
    margin: [0, 0, 0, 3]
  }
}

// ─── Company Section ─────────────────────────────────────────────────────────

function buildCompanySection(ch: ChallanData, logo: string | undefined): Content {
  const company = ch.company

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

  // Challan No. + Challan Date on the first row; the returnable / non-returnable
  // type sits on the second row in the right-hand slot — the exact position an
  // invoice prints its P.O. No.
  const statusLabel =
    ch.status === 'NON_RETURNABLE'
      ? 'Non-Returnable'
      : ch.status === 'CONVERTED'
        ? 'Converted'
        : 'Returnable'
  const gridBody: TableCell[][] = [
    [
      { stack: [
        { text: 'Challan No.', bold: true, fontSize: 10 },
        { text: ch.challanNumber, fontSize: 10, margin: [0, 3, 0, 0] as [number, number, number, number] },
      ] },
      { stack: [
        { text: 'Challan Date', bold: true, fontSize: 10 },
        { text: formatDate(ch.challanDate), fontSize: 10, margin: [0, 3, 0, 0] as [number, number, number, number] },
      ] },
    ],
    [
      { text: '' },
      { stack: [
        { text: 'Type', bold: true, fontSize: 10 },
        { text: statusLabel, fontSize: 10, margin: [0, 3, 0, 0] as [number, number, number, number] },
      ] },
    ],
  ]

  return {
    table: {
      heights: [105],
      widths: ['60%', '40%'],
      body: [
        [
          // Left: logo + company info
          {
            columns: [
              ...(logo ? [{ image: logo, width: 60, height: 60, margin: [0, 0, 8, 0] }] : [{ text: '', width: 0 }]),
              { stack: companyStack, width: '*' },
            ]
          },
          // Right: challan number grid (single row)
          {
            table: {
              heights: [35, 35],
              widths: ['*', '*'],
              body: gridBody,
            },
            layout: {
              hLineWidth: (i: number) => (i === 1 ? 0.5 : 0),
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

function buildBillShipSection(ch: ChallanData): Content {
  const customer = ch.customer
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
    if (ch.placeOfSupplyName) {
      gstParts.push({ text: '   Place of Supply: ' + ch.placeOfSupplyName, bold: false })
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

// ─── Additional Details (between Bill-To and Items) ──────────────────────────

/** Returns an array — empty if no fields filled, or [section] if any exists.
 * Shows transport info + documents + commercial terms in 2-column pair rows. */
function buildAdditionalDetailsSection(ch: ChallanData): Content[] {
  const fields: { label: string; value: string }[] = []
  // Order: movement → documents → commercial terms
  if (ch.transportMode) fields.push({ label: 'Transport Mode', value: ch.transportMode })
  if (ch.vehicleNumber) fields.push({ label: 'Vehicle Number', value: ch.vehicleNumber })
  if (ch.poNumber) fields.push({ label: 'P.O. Number', value: ch.poNumber })
  if (ch.ewayBillNo) fields.push({ label: 'e-Way Bill No', value: ch.ewayBillNo })
  if (ch.dispatchedThrough) fields.push({ label: 'Dispatched Through', value: ch.dispatchedThrough })
  if (ch.warrantyPeriod) fields.push({ label: 'Warranty Period', value: ch.warrantyPeriod })

  if (fields.length === 0) return []

  // Arrange in 2-column pairs (same shape as invoice's additional-fields block)
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
      vLineWidth: (i: number) => (i === 0 || i === 4) ? 0.5 : 0,
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

// ─── Items Table + Tax Rows + Total ──────────────────────────────────────────

function buildItemsSection(ch: ChallanData, isInter: boolean, taxGroups: ReturnType<typeof getTaxGroups>): Content {
  // Column widths: S.NO | ITEMS | HSN | QTY | RATE | AMOUNT
  const widths = [32, '*', 50, 50, 50, 55]

  // Header row
  const headers = ['S.NO.', 'ITEMS', 'HSN', 'QTY.', 'RATE', 'AMOUNT']
  const headerRow: TableCell[] = headers.map(h => ({
    text: h, bold: true, fontSize: 9, alignment: 'center' as const,
    fillColor: GREEN, margin: [0, 2, 0, 2] as [number, number, number, number],
  }))

  // Item rows
  const itemRows: TableCell[][] = ch.items.map((it, idx) => {
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

  // Whole-rupee Round Off (mirrors the shared builders - sub-50-paise deltas only).
  const roundOff = Math.round((ch.totalAmount - ((ch.subtotal ?? 0) + (ch.taxAmount ?? 0) - (ch.discount ?? 0))) * 100) / 100
  if ((ch.subtotal ?? 0) > 0 && Math.abs(roundOff) > 0.004 && Math.abs(roundOff) <= 0.5) {
    taxRows.push([{ text: '' }, { text: 'Round Off', italics: true, fontSize: 9, alignment: 'right' as const }, { text: '-', alignment: 'right' as const }, { text: '-', alignment: 'right' as const }, { text: '-', alignment: 'right' as const }, { text: (roundOff > 0 ? '+' : '-') + fmtNum(Math.abs(roundOff)), alignment: 'right' as const, fontSize: 9 }])
  }

  // Total row
  const totalQty = ch.items.reduce((s, i) => s + i.quantity, 0)
  const totalRow: TableCell[] = [
    { text: '', fillColor: GREEN },
    { text: 'TOTAL', bold: true, fontSize: 9, alignment: 'right' as const, fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: totalQty.toString(), bold: true, fontSize: 9, alignment: 'right' as const, fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: fmtRs(ch.totalAmount), bold: true, fontSize: 9, alignment: 'right' as const, fillColor: GREEN },
  ]

  // Filler rows — stretch the items table to fill the page.
  // Shrink when additional details exist (they take space above items).
  const hasAdditionalDetails = !!(
    ch.transportMode || ch.vehicleNumber ||
    ch.poNumber || ch.ewayBillNo ||
    ch.warrantyPeriod || ch.dispatchedThrough
  )
  const TARGET_ROWS = hasAdditionalDetails ? 12 : 14
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

  return {
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
  }
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

// ─── Footer: Bank Details | Terms & Conditions | Authorised Signatory ────────

function buildFooter(ch: ChallanData, logo: string | undefined, signature: string | undefined): Content {
  const company = ch.company

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

  // Terms and Conditions — per-challan override, fall back to company default
  const effectiveTerms = ch.termsConditions || company?.termsConditions
  const termsStack: Content[] = [
    { text: 'Terms and Conditions', bold: true, fontSize: 9, margin: [0, 0, 0, 3] as [number, number, number, number] },
  ]
  if (effectiveTerms) {
    termsStack.push({ text: effectiveTerms, fontSize: 8, lineHeight: 1.2 })
  }

  // Authorised Signatory
  const sigStack: Content[] = [
    { text: '', fontSize: 1 },
    ...(signature
      ? [{ image: signature, width: 90, height: 32, alignment: 'center' as const, margin: [0, 12, 0, 4] as [number, number, number, number] }]
      : logo
        ? [{ image: logo, width: 45, height: 45, alignment: 'center' as const, margin: [0, 10, 0, 8] as [number, number, number, number] }]
        : []),
    { text: 'Authorised Signatory For', fontSize: 9, alignment: 'center' as const },
    { text: (company?.name || '').toUpperCase(), bold: true, fontSize: 9, alignment: 'center' as const },
  ]

  return {
    table: {
      widths: ['36%', '34%', '30%'],
      body: [
        [
          { stack: bankStack },
          { stack: termsStack },
          { stack: sigStack },
        ]
      ]
    },
    layout: {
      hLineWidth: (i: number, _node: any) => i === 0 ? 0 : 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#000',
      vLineColor: () => '#000',
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 5,
      paddingBottom: () => 5,
    },
  }
}
