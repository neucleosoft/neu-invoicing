// Purchase Order pdfmake document-definition builder. Lifted from
// apps/desktop/src/utils/pdfmakePurchaseOrder.ts — the EXACT same layout — minus the
// platform glue (pdfMake import, vfs assignment, createPdf().download/getBuffer).
// Returns a plain pdfmake docDefinition object; each app feeds it to its own
// pdfmake instance (desktop directly, mobile via a WebView).
//
// Logo: rendered only when po.company.logoBase64 is present (a base64 data-URI).
// Desktop fell back to a bundled placeholder logo; we omit that — a missing logo
// just collapses the column, which also dodges pdfmake's "corrupt image throws".

import {
  extractPAN,
  fmtNum,
  fmtRs,
  formatDate,
  getHSNGroups,
  getTaxGroups,
  numberToWords,
} from './helpers'
import type { Content, DocDefinition, PDFDocumentData, TableCell } from './types'

const GREEN = '#C6E0B4'

export interface PurchaseOrderData {
  orderNumber: string
  orderDate: string | Date
  expectedDate?: string | Date | null
  notes?: string
  termsConditions?: string
  totalAmount: number
  subtotal?: number
  taxAmount?: number
  // Per-PO addresses (override company defaults). Either or both can be blank,
  // in which case the PDF falls back to company.address for billing and a "—" for shipping.
  billingAddress?: string | null
  shippingAddress?: string | null
  // Free-text reference to the supplier's quotation (if any)
  vendorQuotationRef?: string | null
  // Boilerplate text from Settings (po_special_instructions, po_general_terms).
  // If absent, the corresponding sections aren't rendered.
  specialInstructions?: string
  generalTerms?: string
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
  company?: PDFDocumentData['company']
  isInterState?: boolean
}

export function buildPurchaseOrderFilename(po: PurchaseOrderData) {
  const safeNum = (po.orderNumber || 'order').replace(/\//g, '_')
  const safeName = (po.supplier?.name || 'supplier').replace(/[^a-z0-9]/gi, '_')
  return `${safeNum}_purchase_order_${safeName}.pdf`
}

function deriveIsInterState(po: PurchaseOrderData): boolean {
  if (typeof po.isInterState === 'boolean') return po.isInterState
  const supplierState = po.supplier?.taxId?.substring(0, 2)
  const companyState =
    po.company?.stateCode || po.company?.taxId?.substring(0, 2)
  if (!supplierState || !companyState) return false
  return supplierState !== companyState
}

export function buildPurchaseOrderDocDefinition(po: PurchaseOrderData): DocDefinition {
  if (!po.items) po.items = []
  const isInter = deriveIsInterState(po)
  const itemsForGroups = po.items.map((it) => ({
    ...it,
    discount: it.discount ?? 0,
  }))
  const taxGroups = getTaxGroups(itemsForGroups as any, isInter)
  const hsnGroups = getHSNGroups(itemsForGroups as any, isInter)
  // Only embed the logo when it's a data: URI (the actual image bytes). A stale
  // file path in company.logoPath — e.g. carried over from a desktop DB — would
  // make pdfmake throw, which is the "PDF won't generate until I re-upload the
  // logo" symptom. Anything that isn't a data: URI is treated as "no logo".
  const logoSrc = po.company?.logoBase64
  const logo = logoSrc && logoSrc.startsWith('data:') ? logoSrc : undefined

  // Sections are conditionally added so a PO without (e.g.) a shipping address
  // doesn't render an empty box. Order: header → items → totals → quote ref →
  // long-form text (instructions then general terms, flowing) → footer (signatures)
  // at the very end. Pdfmake handles wrapping to additional pages automatically.
  const content: Content[] = [
    buildTitle(),
    buildCompanySection(po, logo),
    buildBuyerSupplierSection(po),
  ]
  if (po.billingAddress || po.shippingAddress) {
    content.push(buildAddressSplit(po))
  }
  content.push(
    buildItemsSection(po, isInter, taxGroups),
    buildHSNSection(hsnGroups, isInter),
    buildAmountInWords(po.totalAmount),
  )
  if (po.vendorQuotationRef) {
    content.push(buildVendorQuotationRef(po))
  }
  if (po.specialInstructions && po.specialInstructions.trim()) {
    content.push(buildSpecialInstructions(po))
  }
  if (po.generalTerms && po.generalTerms.trim()) {
    content.push(buildGeneralTerms(po))
  }
  content.push(buildFooter(po, logo))

  return {
    pageSize: 'A4',
    pageMargins: [17, 13, 17, 13],
    content,
    defaultStyle: { fontSize: 9 },
  }
}

// ─── New PO-specific sections (Phase 5) ──────────────────────────────────────

// Side-by-side billing / shipping addresses captured per-PO. Falls back to the
// company default for billing, and shows a dash for shipping if not provided.
function buildAddressSplit(po: PurchaseOrderData): Content {
  const billing = po.billingAddress?.trim() || po.company?.address || '—'
  const shipping = po.shippingAddress?.trim() || '—'
  return {
    table: {
      widths: ['50%', '50%'],
      body: [
        [
          { text: 'BILLING ADDRESS', bold: true, fontSize: 9, fillColor: GREEN },
          { text: 'SHIPPING ADDRESS', bold: true, fontSize: 9, fillColor: GREEN },
        ],
        [
          { text: billing, fontSize: 9 },
          { text: shipping, fontSize: 9 },
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
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 4, 0, 0],
  }
}

// One-liner showing the supplier's earlier quotation reference (e.g. "QUOT-2026-042").
// Standard B2B practice: PO references the prior quote so supplier can match against it.
function buildVendorQuotationRef(po: PurchaseOrderData): Content {
  return {
    text: [
      { text: 'Vendor Quotation No. & Date: ', bold: true, fontSize: 9 },
      { text: po.vendorQuotationRef || '', fontSize: 9 },
    ],
    margin: [0, 4, 0, 0],
  }
}

// Numbered Special Instructions block — long-form text from Settings (default
// is the standard 10-clause Indian PO boilerplate). Rendered as a single text
// block, preserving the user's line breaks.
function buildSpecialInstructions(po: PurchaseOrderData): Content {
  return {
    table: {
      widths: ['*'],
      body: [
        [{ text: 'Special Instructions:', bold: true, fontSize: 9, fillColor: GREEN }],
        [{ text: po.specialInstructions || '', fontSize: 8.5, lineHeight: 1.25 }],
      ],
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#000',
      vLineColor: () => '#000',
      paddingLeft: () => 4,
      paddingRight: () => 4,
      paddingTop: () => 3,
      paddingBottom: () => 3,
    },
    margin: [0, 6, 0, 0],
  }
}

// General T&C (legal boilerplate — TDS/TCS, jurisdiction, arbitration). Renders
// inline right after Special Instructions; pdfmake wraps to a new page on its own
// if the content overflows.
function buildGeneralTerms(po: PurchaseOrderData): Content {
  return {
    stack: [
      { text: 'General Terms & Conditions', bold: true, fontSize: 12, margin: [0, 12, 0, 6] },
      { text: po.generalTerms || '', fontSize: 8.5, lineHeight: 1.3 },
    ],
  } as Content
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

function buildCompanySection(po: PurchaseOrderData, logo: string | undefined): Content {
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
        { text: po.orderNumber, fontSize: 10, margin: [0, 3, 0, 0] },
      ] },
      { stack: [
        { text: 'Order Date', bold: true, fontSize: 10 },
        { text: formatDate(po.orderDate), fontSize: 10, margin: [0, 3, 0, 0] },
      ] },
    ],
  ]
  if (hasExpected) {
    gridBody.push([
      { stack: [
        { text: 'Expected Date', bold: true, fontSize: 10 },
        { text: formatDate(po.expectedDate as string | Date), fontSize: 10, margin: [0, 3, 0, 0] },
      ], colSpan: 2 },
      {},
    ])
  }

  const companyColumns: Content[] = []
  if (logo) companyColumns.push({ image: logo, width: 60, height: 60, margin: [0, 0, 8, 0] })
  companyColumns.push({ stack: companyStack, width: '*' })

  return {
    table: {
      heights: [105],
      widths: ['60%', '40%'],
      body: [
        [
          {
            columns: companyColumns,
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
            margin: [-4, -5, -4, -5],
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

function buildBuyerSupplierSection(po: PurchaseOrderData): Content {
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
      { text: 'Address: ', width: 'auto', fontSize: 10, margin: [0, 0, 5, 0] },
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
      { text: 'Address: ', width: 'auto', fontSize: 10, margin: [0, 0, 5, 0] },
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

function buildItemsSection(po: PurchaseOrderData, isInter: boolean, taxGroups: ReturnType<typeof getTaxGroups>): Content {
  const widths = [32, '*', 50, 50, 50, 55]
  const headers = ['S.NO.', 'ITEMS', 'HSN', 'QTY.', 'RATE', 'AMOUNT']
  const headerRow: TableCell[] = headers.map((h) => ({
    text: h, bold: true, fontSize: 9, alignment: 'center',
    fillColor: GREEN, margin: [0, 2, 0, 2],
  }))

  const itemRows: TableCell[][] = po.items.map((it, idx) => {
    const hsn = it.hsnCode || it.item.hsnCode || it.item.skuHsn || ''
    const taxable = it.taxableAmount ?? (it.rate * it.quantity - (it.discount ?? 0))
    return [
      { text: (idx + 1).toString(), alignment: 'center', fontSize: 9 },
      { text: it.item.name, fontSize: 9 },
      { text: hsn, alignment: 'center', fontSize: 9 },
      { text: `${it.quantity} ${it.item.unit || 'PCS'}`, alignment: 'center', fontSize: 9 },
      { text: fmtNum(it.rate), alignment: 'right', fontSize: 9 },
      { text: fmtNum(taxable), alignment: 'right', fontSize: 9 },
    ]
  })

  const taxRows: TableCell[][] = []
  taxGroups.forEach((g) => {
    if (isInter) {
      taxRows.push([
        { text: '' },
        { text: `IGST @${g.rate}%`, italics: true, fontSize: 9, alignment: 'right' },
        { text: '-', alignment: 'right' },
        { text: '-', alignment: 'right' },
        { text: '-', alignment: 'right' },
        { text: fmtRs(g.igst), alignment: 'right', fontSize: 9 },
      ])
    } else {
      taxRows.push([
        { text: '' },
        { text: `CGST @${g.rate / 2}%`, italics: true, fontSize: 9, alignment: 'right' },
        { text: '-', alignment: 'right' },
        { text: '-', alignment: 'right' },
        { text: '-', alignment: 'right' },
        { text: fmtRs(g.cgst), alignment: 'right', fontSize: 9 },
      ])
      taxRows.push([
        { text: '' },
        { text: `SGST @${g.rate / 2}%`, italics: true, fontSize: 9, alignment: 'right' },
        { text: '-', alignment: 'right' },
        { text: '-', alignment: 'right' },
        { text: '-', alignment: 'right' },
        { text: fmtRs(g.sgst), alignment: 'right', fontSize: 9 },
      ])
    }
  })

  const totalQty = po.items.reduce((s, i) => s + i.quantity, 0)
  const totalRow: TableCell[] = [
    { text: '', fillColor: GREEN },
    { text: 'TOTAL', bold: true, fontSize: 9, alignment: 'right', fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: totalQty.toString(), bold: true, fontSize: 9, alignment: 'right', fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: fmtRs(po.totalAmount), bold: true, fontSize: 9, alignment: 'right', fillColor: GREEN },
  ]

  const TARGET_ROWS = 14
  const usedRows = itemRows.length + taxRows.length
  const fillerCount = Math.max(0, TARGET_ROWS - usedRows)
  const emptyCell = { text: ' ', fontSize: 6, margin: [0, 3, 0, 3] }
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
    margin: [0, 0, 0, 0],
  }
}

function buildHSNSection(hsnGroups: ReturnType<typeof getHSNGroups>, isInter: boolean): Content {
  if (isInter) {
    const headerRow1: TableCell[] = [
      { text: 'HSN/SAC', bold: true, alignment: 'center', fillColor: GREEN, fontSize: 9 },
      { text: 'Taxable Value', bold: true, alignment: 'center', fillColor: GREEN, fontSize: 9 },
      { text: 'IGST', bold: true, alignment: 'center', fillColor: GREEN, colSpan: 2, fontSize: 9 }, {},
      { text: 'Total Tax Amount', bold: true, alignment: 'center', fillColor: GREEN, fontSize: 9 },
    ]
    const headerRow2: TableCell[] = [
      { text: '' }, { text: '' },
      { text: 'Rate', bold: true, alignment: 'center', fontSize: 8 },
      { text: 'Amount', bold: true, alignment: 'center', fontSize: 8 },
      { text: '' },
    ]
    let totalTaxable = 0, totalIgst = 0, totalTax = 0
    const dataRows: TableCell[][] = hsnGroups.map((g) => {
      totalTaxable += g.taxable; totalIgst += g.igst; totalTax += g.totalTax
      return [
        { text: g.hsn, alignment: 'center', fontSize: 9 },
        { text: fmtNum(g.taxable), alignment: 'right', fontSize: 9 },
        { text: g.rate + '%', alignment: 'center', fontSize: 9 },
        { text: fmtNum(g.igst), alignment: 'right', fontSize: 9 },
        { text: fmtRs(g.totalTax), alignment: 'right', fontSize: 9 },
      ]
    })
    const totalRow: TableCell[] = [
      { text: 'Total', bold: true, alignment: 'center', fontSize: 9 },
      { text: fmtNum(totalTaxable), bold: true, alignment: 'right', fontSize: 9 },
      { text: '' },
      { text: fmtNum(totalIgst), bold: true, alignment: 'right', fontSize: 9 },
      { text: fmtRs(totalTax), bold: true, alignment: 'right', fontSize: 9 },
    ]
    return {
      table: { headerRows: 2, widths: [60, 70, 35, 60, '*'], body: [headerRow1, headerRow2, ...dataRows, totalRow] },
      layout: {
        hLineWidth: (i: number) => i === 0 ? 0 : 0.5,
        vLineWidth: () => 0.5,
        hLineColor: () => '#000', vLineColor: () => '#000',
        paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2,
      },
      margin: [0, 0, 0, 0],
    }
  }
  const headerRow1: TableCell[] = [
    { text: 'HSN/SAC', bold: true, alignment: 'center', fillColor: GREEN, fontSize: 9 },
    { text: 'Taxable Value', bold: true, alignment: 'center', fillColor: GREEN, fontSize: 9 },
    { text: 'CGST', bold: true, alignment: 'center', fillColor: GREEN, colSpan: 2, fontSize: 9 }, {},
    { text: 'SGST', bold: true, alignment: 'center', fillColor: GREEN, colSpan: 2, fontSize: 9 }, {},
    { text: 'Total Tax Amount', bold: true, alignment: 'center', fillColor: GREEN, fontSize: 9 },
  ]
  const headerRow2: TableCell[] = [
    { text: '' }, { text: '' },
    { text: 'Rate', bold: true, alignment: 'center', fontSize: 8 },
    { text: 'Amount', bold: true, alignment: 'center', fontSize: 8 },
    { text: 'Rate', bold: true, alignment: 'center', fontSize: 8 },
    { text: 'Amount', bold: true, alignment: 'center', fontSize: 8 },
    { text: '' },
  ]
  let totalTaxable = 0, totalCgst = 0, totalSgst = 0, totalTax = 0
  const dataRows: TableCell[][] = hsnGroups.map((g) => {
    totalTaxable += g.taxable; totalCgst += g.cgst; totalSgst += g.sgst; totalTax += g.totalTax
    return [
      { text: g.hsn, alignment: 'center', fontSize: 9 },
      { text: fmtNum(g.taxable), alignment: 'right', fontSize: 9 },
      { text: (g.rate / 2) + '%', alignment: 'center', fontSize: 9 },
      { text: fmtNum(g.cgst), alignment: 'right', fontSize: 9 },
      { text: (g.rate / 2) + '%', alignment: 'center', fontSize: 9 },
      { text: fmtNum(g.sgst), alignment: 'right', fontSize: 9 },
      { text: fmtRs(g.totalTax), alignment: 'right', fontSize: 9 },
    ]
  })
  const totalRow: TableCell[] = [
    { text: 'Total', bold: true, alignment: 'center', fontSize: 9 },
    { text: fmtNum(totalTaxable), bold: true, alignment: 'right', fontSize: 9 },
    { text: '' },
    { text: fmtNum(totalCgst), bold: true, alignment: 'right', fontSize: 9 },
    { text: '' },
    { text: fmtNum(totalSgst), bold: true, alignment: 'right', fontSize: 9 },
    { text: fmtRs(totalTax), bold: true, alignment: 'right', fontSize: 9 },
  ]
  return {
    table: { headerRows: 2, widths: [45, 55, 25, 45, 25, 45, '*'], body: [headerRow1, headerRow2, ...dataRows, totalRow] },
    layout: {
      hLineWidth: (i: number) => i === 0 ? 0 : 0.5,
      vLineWidth: () => 0.5,
      hLineColor: () => '#000', vLineColor: () => '#000',
      paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2,
    },
    margin: [0, 0, 0, 0],
  }
}

function buildAmountInWords(totalAmount: number): Content {
  return {
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          { text: 'Total Amount (in words)', bold: true, fontSize: 9 },
          { text: numberToWords(totalAmount), fontSize: 9, margin: [0, 2, 0, 0] },
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
    margin: [0, 0, 0, 0],
  }
}

function buildFooter(po: PurchaseOrderData, logo: string | undefined): Content {
  const company = po.company
  const hasNotes = !!(po.notes && po.notes.trim())

  const notesStack: Content[] = [
    { text: 'Notes', bold: true, fontSize: 9, margin: [0, 10, 0, 5] },
    { text: po.notes || '', fontSize: 9, lineHeight: 1.2 },
  ]

  const bankStack: Content[] = [
    { text: 'Bank Details', bold: true, fontSize: 9, margin: [0, 10, 0, 5] },
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
          margin: [0, 0, 0, 1],
        })
      } else {
        bankStack.push({ text: line, fontSize: 9, margin: [0, 0, 0, 1] })
      }
    })
  }

  // Per-PO and company-level T&C used to live here, but Phase 5 introduced the
  // long-form Special Instructions and General Terms blocks (sourced from Settings)
  // which already cover this content. Keeping a third T&C box would just duplicate.
  const sigStack: Content[] = [
    { text: '', fontSize: 1 },
  ]
  if (logo) sigStack.push({ image: logo, width: 45, height: 45, alignment: 'center', margin: [0, 10, 0, 8] })
  sigStack.push(
    { text: 'Authorised Signatory For', fontSize: 9, alignment: 'center' },
    { text: (company?.name || '').toUpperCase(), bold: true, fontSize: 9, alignment: 'center' },
  )

  const layout = {
    // Footer used to omit its top line because it sat directly under the bordered
    // Amount-in-Words box and shared borders. After Phase 5 reorder it sits below
    // the (borderless) General Terms text block, so the top line must be drawn
    // for it to read as a complete table.
    hLineWidth: () => 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => '#000', vLineColor: () => '#000',
    paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 5, paddingBottom: () => 5,
  }

  // Top margin separates the footer table from the General Terms text above.
  // Before Phase 5, footer sat under a bordered Amount-in-Words box and shared
  // its border, so margin: 0 was correct. After reorder it follows borderless
  // text and needs visible breathing room.
  const outerMargin = [0, 12, 0, 0]

  if (hasNotes) {
    return {
      table: {
        widths: ['50%', '50%'],
        body: [
          [{ stack: notesStack }, { stack: bankStack }],
          // Signature spans both bottom columns now that Terms is gone — keeps
          // the authorised-signature block centered visually.
          [{ stack: sigStack, colSpan: 2 }, {}],
        ],
      },
      layout,
      margin: outerMargin,
    }
  }

  return {
    table: {
      widths: ['50%', '50%'],
      body: [[{ stack: bankStack }, { stack: sigStack }]],
    },
    layout,
    margin: outerMargin,
  }
}
