// Credit Note / Debit Note pdfmake document-definition builder. Lifted from
// apps/desktop/src/utils/pdfmakeCreditNote.ts — the EXACT same layout — minus the
// platform glue (pdfMake import, vfs assignment, createPdf().download/getBuffer).
// Returns a plain pdfmake docDefinition object; each app feeds it to its own
// pdfmake instance (desktop directly, mobile via a WebView).
//
// Handles Credit Note and Debit Note — branched on note.type, exactly like desktop
// (Debit Note is the same builder with the type set).
//
// Logo: rendered only when note.company.logoBase64 is present (a base64 data-URI).
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
import type { Content, DocDefinition, TableCell } from './types'

const GREEN = '#C6E0B4'

export interface CreditNoteData {
  noteNumber: string
  noteDate: string | Date
  type: 'CREDIT_NOTE' | 'DEBIT_NOTE'
  reason?: string
  notes?: string
  termsConditions?: string
  totalAmount: number
  subtotal?: number
  taxAmount?: number
  customer: {
    name: string
    taxId?: string
    phone?: string
    email?: string
    billingAddress?: string
    shippingAddress?: string
  }
  referenceInvoice?: {
    invoiceNumber: string
    invoiceDate?: string | Date
    totalAmount?: number
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

export function buildCreditNoteFilename(note: CreditNoteData) {
  const safeNum = (note.noteNumber || 'note').replace(/\//g, '_')
  const safeName = (note.customer?.name || 'party').replace(/[^a-z0-9]/gi, '_')
  const suffix = note.type === 'DEBIT_NOTE' ? 'debit_note' : 'credit_note'
  return `${safeNum}_${suffix}_${safeName}.pdf`
}

// GSTIN's first two chars are the state code. Intra vs inter-state is derived
// from supplier and company state codes; falls back to intra-state when missing.
function deriveIsInterState(note: CreditNoteData): boolean {
  if (typeof note.isInterState === 'boolean') return note.isInterState
  const partyState = note.customer?.taxId?.substring(0, 2)
  const companyState =
    note.company?.stateCode || note.company?.taxId?.substring(0, 2)
  if (!partyState || !companyState) return false
  return partyState !== companyState
}

export function buildCreditNoteDocDefinition(note: CreditNoteData): DocDefinition {
  if (!note.items) note.items = []
  const isInter = deriveIsInterState(note)
  const itemsForGroups = note.items.map((it) => ({ ...it, discount: it.discount ?? 0 }))
  const taxGroups = getTaxGroups(itemsForGroups as any, isInter)
  const hsnGroups = getHSNGroups(itemsForGroups as any, isInter)
  // Only embed the logo when it's a data: URI (the actual image bytes). A stale
  // file path in company.logoPath — e.g. carried over from a desktop DB — would
  // make pdfmake throw, which is the "PDF won't generate until I re-upload the
  // logo" symptom. Anything that isn't a data: URI is treated as "no logo".
  const logoSrc = note.company?.logoBase64
  const logo = logoSrc && logoSrc.startsWith('data:') ? logoSrc : undefined

  return {
    pageSize: 'A4',
    pageMargins: [17, 13, 17, 13],
    content: [
      buildTitle(note.type),
      buildCompanySection(note, logo),
      buildBillToSection(note),
      buildItemsSection(note, isInter, taxGroups),
      buildHSNSection(hsnGroups, isInter),
      buildAmountInWords(note.totalAmount),
      buildFooter(note, logo),
    ],
    defaultStyle: { fontSize: 9 },
  }
}

function buildTitle(type: 'CREDIT_NOTE' | 'DEBIT_NOTE'): Content {
  const label = type === 'DEBIT_NOTE' ? 'DEBIT NOTE' : 'CREDIT NOTE'
  return {
    columns: [
      { text: label, bold: true, fontSize: 11, width: 'auto' },
      { width: 6, text: '' },
      {
        table: { body: [[{ text: 'ORIGINAL FOR RECIPIENT', fontSize: 8 }]] },
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

function buildCompanySection(note: CreditNoteData, logo: string | undefined): Content {
  const company = note.company
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

  const hasRefInv = !!note.referenceInvoice?.invoiceNumber
  const numberLabel = note.type === 'DEBIT_NOTE' ? 'Debit Note No.' : 'Credit Note No.'
  const dateLabel = note.type === 'DEBIT_NOTE' ? 'Debit Note Date' : 'Credit Note Date'

  const gridBody: TableCell[][] = [
    [
      { stack: [
        { text: numberLabel, bold: true, fontSize: 10 },
        { text: note.noteNumber, fontSize: 10, margin: [0, 3, 0, 0] },
      ] },
      { stack: [
        { text: dateLabel, bold: true, fontSize: 10 },
        { text: formatDate(note.noteDate), fontSize: 10, margin: [0, 3, 0, 0] },
      ] },
    ],
  ]
  if (hasRefInv) {
    gridBody.push([
      { stack: [
        { text: 'Ref. Invoice No.', bold: true, fontSize: 10 },
        { text: note.referenceInvoice!.invoiceNumber, fontSize: 10, margin: [0, 3, 0, 0] },
      ] },
      { stack: [
        { text: 'Ref. Invoice Date', bold: true, fontSize: 10 },
        { text: note.referenceInvoice!.invoiceDate ? formatDate(note.referenceInvoice!.invoiceDate) : '-', fontSize: 10, margin: [0, 3, 0, 0] },
      ] },
    ])
  }

  const companyColumns: Content[] = []
  if (logo) companyColumns.push({ image: logo, width: 60, height: 60, margin: [0, 0, 8, 0] })
  companyColumns.push({ stack: companyStack, width: '*' })

  return {
    table: {
      heights: [105],
      widths: ['60%', '40%'],
      body: [[
        { columns: companyColumns },
        {
          table: {
            heights: hasRefInv ? [35, 35] : [70],
            widths: ['*', '*'],
            body: gridBody,
          },
          layout: {
            hLineWidth: (i: number) => (hasRefInv && i === 1) ? 0.5 : 0,
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
      ]],
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

function buildBillToSection(note: CreditNoteData): Content {
  const party = note.customer
  const pan = extractPAN(party?.taxId)
  const shipAddr = party?.shippingAddress || party?.billingAddress

  const billStack: Content[] = [
    { text: 'BILL TO', bold: true, fontSize: 10, margin: [0, 0, 0, 2] },
    { text: party?.name || '-', bold: true, fontSize: 11, margin: [0, 0, 0, 2] },
  ]
  if (party?.billingAddress) {
    billStack.push({ columns: [
      { text: 'Address: ', width: 'auto', fontSize: 10, margin: [0, 0, 5, 0] },
      { text: party.billingAddress, width: '*', fontSize: 10 },
    ], margin: [0, 0, 0, 2] })
  }
  if (party?.taxId) {
    billStack.push({ text: [{ text: 'GSTIN: ', bold: true }, party.taxId], fontSize: 10, margin: [0, 0, 0, 1] })
  }
  if (party?.phone) {
    billStack.push({ text: [{ text: 'Mobile: ', bold: true }, party.phone], fontSize: 10, margin: [0, 0, 0, 1] })
  }
  if (pan) {
    billStack.push({ text: [{ text: 'PAN Number: ', bold: true }, pan], fontSize: 10 })
  }

  const shipStack: Content[] = [
    { text: 'SHIP TO', bold: true, fontSize: 10, margin: [0, 0, 0, 2] },
    { text: party?.name || '-', bold: true, fontSize: 11, margin: [0, 0, 0, 2] },
  ]
  if (shipAddr) {
    shipStack.push({ columns: [
      { text: 'Address: ', width: 'auto', fontSize: 10, margin: [0, 0, 5, 0] },
      { text: shipAddr, width: '*', fontSize: 10 },
    ] })
  }

  return {
    table: {
      heights: [100],
      widths: ['50%', '50%'],
      body: [[
        { stack: billStack, margin: [0, 0, 5, 0] },
        { stack: shipStack },
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

function buildItemsSection(note: CreditNoteData, isInter: boolean, taxGroups: ReturnType<typeof getTaxGroups>): Content {
  const widths = [32, '*', 50, 50, 50, 55]
  const headers = ['S.NO.', 'ITEMS', 'HSN', 'QTY.', 'RATE', 'AMOUNT']
  const headerRow: TableCell[] = headers.map((h) => ({
    text: h, bold: true, fontSize: 9, alignment: 'center',
    fillColor: GREEN, margin: [0, 2, 0, 2],
  }))

  const itemRows: TableCell[][] = note.items.map((it, idx) => {
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

  const totalQty = note.items.reduce((s, i) => s + i.quantity, 0)
  const totalRow: TableCell[] = [
    { text: '', fillColor: GREEN },
    { text: 'TOTAL', bold: true, fontSize: 9, alignment: 'right', fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: totalQty.toString(), bold: true, fontSize: 9, alignment: 'right', fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: fmtRs(note.totalAmount), bold: true, fontSize: 9, alignment: 'right', fillColor: GREEN },
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

function buildFooter(note: CreditNoteData, logo: string | undefined): Content {
  const company = note.company
  const hasNotes = !!(note.notes && note.notes.trim())
  const hasReason = !!(note.reason && note.reason.trim())

  const reasonAndNotesStack: Content[] = []
  if (hasReason) {
    reasonAndNotesStack.push(
      { text: 'Reason', bold: true, fontSize: 9, margin: [0, 10, 0, 5] },
      { text: note.reason || '', fontSize: 9, lineHeight: 1.2 },
    )
  }
  if (hasNotes) {
    reasonAndNotesStack.push(
      { text: 'Notes', bold: true, fontSize: 9, margin: [0, hasReason ? 6 : 10, 0, 5] },
      { text: note.notes || '', fontSize: 9, lineHeight: 1.2 },
    )
  }

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

  const effectiveTerms = note.termsConditions || company?.termsConditions
  const termsStack: Content[] = [
    { text: 'Terms and Conditions', bold: true, fontSize: 9, margin: [0, 0, 0, 3] },
  ]
  if (effectiveTerms) {
    termsStack.push({ text: effectiveTerms, fontSize: 8, lineHeight: 1.2 })
  }

  const sigStack: Content[] = [{ text: '', fontSize: 1 }]
  if (logo) sigStack.push({ image: logo, width: 45, height: 45, alignment: 'center', margin: [0, 10, 0, 8] })
  sigStack.push(
    { text: 'Authorised Signatory For', fontSize: 9, alignment: 'center' },
    { text: (company?.name || '').toUpperCase(), bold: true, fontSize: 9, alignment: 'center' },
  )

  const layout = {
    hLineWidth: (i: number) => i === 0 ? 0 : 0.5,
    vLineWidth: () => 0.5,
    hLineColor: () => '#000', vLineColor: () => '#000',
    paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 5, paddingBottom: () => 5,
  }

  if (reasonAndNotesStack.length > 0) {
    return {
      table: {
        widths: ['50%', '50%'],
        body: [
          [{ stack: reasonAndNotesStack }, { stack: bankStack }],
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
