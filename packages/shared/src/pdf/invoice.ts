// Classic GST Tax Invoice pdfmake document-definition builder. Lifted from
// apps/desktop/src/utils/pdfmakeInvoice.ts — the EXACT same layout — minus the
// platform glue (pdfMake import, vfs assignment, createPdf().download/getBuffer).
// Returns a plain pdfmake docDefinition object; each app feeds it to its own
// pdfmake instance (desktop directly, mobile via a WebView).
//
// Handles Tax Invoice, Quotation, and Proforma Invoice — branched on inv.type,
// exactly like desktop (Quotation/Proforma are the same builder with the type set).
//
// Logo: rendered only when inv.company.logoBase64 is present (a base64 data-URI).
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
  getSignatureImage,
} from './helpers'
import type { Content, DocDefinition, InvoiceData, TableCell } from './types'

const GREEN = '#C6E0B4'

export function buildInvoiceFilename(invoice: InvoiceData): string {
  const suffix = invoice.type === 'QUOTATION'
    ? 'quotation'
    : invoice.type === 'PROFORMA_INVOICE'
      ? 'proforma_invoice'
      : 'sales_invoice'
  return `${invoice.invoiceNumber.replace(/\//g, '_')}_${suffix}_${invoice.customer.name.replace(/[^a-z0-9]/gi, '_')}.pdf`
}

export function buildInvoiceDocDefinition(inv: InvoiceData): DocDefinition {
  if (!inv.items) inv.items = []
  const isInter = inv.isInterState !== false
  const taxGroups = getTaxGroups(inv.items, isInter)
  const hsnGroups = getHSNGroups(inv.items, isInter)
  // Only embed the logo when it's a data: URI (the actual image bytes). A stale
  // file path in company.logoPath — e.g. carried over from a desktop DB — would
  // make pdfmake throw, which is the "PDF won't generate until I re-upload the
  // logo" symptom. Anything that isn't a data: URI is treated as "no logo".
  const logoSrc = inv.company?.logoBase64
  const logo = logoSrc && logoSrc.startsWith('data:') ? logoSrc : undefined

  return {
    pageSize: 'A4',
    pageMargins: [17, 13, 17, 13],
    content: [
      buildTitle(inv.type),
      buildCompanySection(inv, logo),
      buildBillShipSection(inv),
      ...buildAdditionalFieldsSection(inv),
      buildItemsSection(inv, isInter, taxGroups),
      buildHSNSection(hsnGroups, isInter),
      buildAmountInWords(inv.totalAmount),
      buildFooter(inv, logo),
    ],
    defaultStyle: { fontSize: 9 },
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
        { text: '', width: '*' },
      ],
      margin: [0, 0, 0, 3],
    }
  }

  return {
    columns: [
      { text: label, bold: true, fontSize: 11, width: 'auto' },
      { width: 6, text: '' },
      {
        table: { body: [[{ text: 'ORIGINAL FOR RECIPIENT', fontSize: 8 }]] },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#000', vLineColor: () => '#000', paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2 },
        width: 'auto',
      },
      { text: '', width: '*' },
    ],
    margin: [0, 0, 0, 3],
  }
}

// ─── Company Section ─────────────────────────────────────────────────────────

function buildCompanySection(inv: InvoiceData, logo: string | undefined): Content {
  const company = inv.company
  const isQuotation = inv.type === 'QUOTATION'
  const isProformaInvoice = inv.type === 'PROFORMA_INVOICE'
  const isQuoteLike = isQuotation || isProformaInvoice
  const secondaryLabel = isQuoteLike ? 'Delivery Time' : 'P.O. No.'
  const secondaryValue = isQuoteLike ? inv.deliveryTime : inv.poNumber
  const secondaryDisplayValue = isQuoteLike && secondaryValue ? formatDate(secondaryValue) : secondaryValue
  const hasSecondaryValue = !!secondaryValue
  const numberLabel = isQuotation ? 'Quotation No.' : isProformaInvoice ? 'Proforma Invoice No.' : 'Invoice No.'
  const dateLabel = isQuotation ? 'Quotation Date' : isProformaInvoice ? 'Proforma Invoice Date' : 'Invoice Date'

  const companyStack: Content[] = [
    { text: (company?.name || 'Company').toUpperCase(), bold: true, fontSize: 16, color: '#2E7D32', margin: [0, 0, 0, 3] },
  ]
  if (company?.address) companyStack.push({ text: company.address.toUpperCase(), fontSize: 10, margin: [0, 0, 0, 1] })
  if (company?.taxId) companyStack.push({ text: [{ text: 'GSTIN: ', bold: true }, company.taxId], fontSize: 10, margin: [0, 0, 0, 1] })
  if (company?.email) companyStack.push({ text: [{ text: 'Email: ', bold: true }, company.email], fontSize: 10 })

  const hasDueDate = !!inv.dueDate
  const dueDateLabel = isQuoteLike ? 'Expiry Date' : 'Due Date'
  const invoiceGridBody: TableCell[][] = [
    [
      { stack: [{ text: numberLabel, bold: true, fontSize: 10 }, { text: inv.invoiceNumber, fontSize: 10, margin: [0, 3, 0, 0] }] },
      { stack: [{ text: dateLabel, bold: true, fontSize: 10 }, { text: formatDate(inv.invoiceDate), fontSize: 10, margin: [0, 3, 0, 0] }] },
    ],
  ]

  if (hasDueDate && hasSecondaryValue) {
    invoiceGridBody.push([
      { stack: [{ text: dueDateLabel, bold: true, fontSize: 10 }, { text: formatDate(inv.dueDate!), fontSize: 10, margin: [0, 3, 0, 0] }] },
      { stack: [{ text: secondaryLabel, bold: true, fontSize: 10 }, { text: secondaryDisplayValue, fontSize: 10, margin: [0, 3, 0, 0] }] },
    ])
  } else if (hasDueDate) {
    invoiceGridBody.push([{ stack: [{ text: dueDateLabel, bold: true, fontSize: 10 }, { text: formatDate(inv.dueDate!), fontSize: 10, margin: [0, 3, 0, 0] }], colSpan: 2 }, {}])
  } else if (hasSecondaryValue) {
    invoiceGridBody.push([{ stack: [{ text: secondaryLabel, bold: true, fontSize: 10 }, { text: secondaryDisplayValue, fontSize: 10, margin: [0, 3, 0, 0] }], colSpan: 2 }, {}])
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
          margin: [-4, -5, -4, -5],
        },
      ]],
    },
    layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#000', vLineColor: () => '#000', paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 5, paddingBottom: () => 5 },
    margin: [0, 0, 0, 0],
  }
}

// ─── Bill To / Ship To ───────────────────────────────────────────────────────

function buildBillShipSection(inv: InvoiceData): Content {
  const customer = inv.customer
  const pan = extractPAN(customer.taxId)
  const shipAddr = customer.shippingAddress || customer.billingAddress

  const billStack: Content[] = [
    { text: 'BILL TO', bold: true, fontSize: 10, margin: [0, 0, 0, 2] },
    { text: customer.name, bold: true, fontSize: 11, margin: [0, 0, 0, 2] },
  ]
  if (customer.billingAddress) {
    billStack.push({ columns: [{ text: 'Address: ', width: 'auto', fontSize: 10, margin: [0, 0, 5, 0] }, { text: customer.billingAddress, width: '*', fontSize: 10 }], margin: [0, 0, 0, 2] })
  }
  if (customer.taxId) {
    const gstParts: Content[] = [{ text: 'GSTIN: ' + customer.taxId, bold: true }]
    if (inv.placeOfSupplyName) gstParts.push({ text: '   Place of Supply: ' + inv.placeOfSupplyName, bold: false })
    billStack.push({ text: gstParts, fontSize: 10, margin: [0, 0, 0, 1] })
  }
  if (customer.phone) billStack.push({ text: [{ text: 'Mobile: ', bold: true }, customer.phone], fontSize: 10, margin: [0, 0, 0, 1] })
  if (pan) billStack.push({ text: [{ text: 'PAN Number: ', bold: true }, pan], fontSize: 10 })

  const shipStack: Content[] = [
    { text: 'SHIP TO', bold: true, fontSize: 10, margin: [0, 0, 0, 2] },
    { text: customer.name, bold: true, fontSize: 11, margin: [0, 0, 0, 2] },
  ]
  if (shipAddr) {
    shipStack.push({ columns: [{ text: 'Address: ', width: 'auto', fontSize: 10, margin: [0, 0, 5, 0] }, { text: shipAddr, width: '*', fontSize: 10 }] })
  }

  return {
    table: { heights: [100], widths: ['50%', '50%'], body: [[{ stack: billStack, margin: [0, 0, 5, 0] }, { stack: shipStack }]] },
    layout: { hLineWidth: (i: number) => i === 0 ? 0 : 0.5, vLineWidth: () => 0.5, hLineColor: () => '#000', vLineColor: () => '#000', paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 4, paddingBottom: () => 4 },
    margin: [0, 0, 0, 0],
  }
}

// ─── Additional Fields (between Bill-To and Items) ───────────────────────────

function buildAdditionalFieldsSection(inv: InvoiceData): Content[] {
  if (inv.type === 'PROFORMA_INVOICE' || inv.type === 'QUOTATION') return []

  const fields: { label: string; value: string }[] = []
  if (inv.ewayBillNo) fields.push({ label: 'E-Way Bill No', value: inv.ewayBillNo })
  if (inv.warrantyPeriod) fields.push({ label: 'Warranty Period', value: inv.warrantyPeriod })
  if (inv.vehicleNumber) fields.push({ label: 'Vehicle Number', value: inv.vehicleNumber })
  if (inv.dispatchedThrough) fields.push({ label: 'Dispatched Through', value: inv.dispatchedThrough })
  if (fields.length === 0) return []

  const rows: TableCell[][] = []
  for (let i = 0; i < fields.length; i += 2) {
    const row: TableCell[] = [{ text: fields[i].label + ':', bold: true, fontSize: 9 }, { text: fields[i].value, fontSize: 9 }]
    if (i + 1 < fields.length) {
      row.push({ text: fields[i + 1].label + ':', bold: true, fontSize: 9 }, { text: fields[i + 1].value, fontSize: 9 })
    } else {
      row.push({ text: '' }, { text: '' })
    }
    rows.push(row)
  }

  return [{
    table: { widths: ['auto', '*', 'auto', '*'], body: rows },
    layout: { hLineWidth: (i: number) => i === 0 ? 0 : 0.5, vLineWidth: (i: number) => (i === 0 || i === 2 || i === 4) ? 0.5 : 0, hLineColor: () => '#000', vLineColor: () => '#000', paddingLeft: () => 4, paddingRight: () => 5, paddingTop: () => 3, paddingBottom: () => 3 },
    margin: [0, 0, 0, 0],
  }]
}

// ─── Items Table + Tax Rows + Total ──────────────────────────────────────────

function buildItemsSection(inv: InvoiceData, isInter: boolean, taxGroups: ReturnType<typeof getTaxGroups>): Content {
  const widths = [32, '*', 50, 50, 50, 55]
  const headers = ['S.NO.', 'ITEMS', 'HSN', 'QTY.', 'RATE', 'AMOUNT']
  const headerRow: TableCell[] = headers.map((h) => ({ text: h, bold: true, fontSize: 9, alignment: 'center', fillColor: GREEN, margin: [0, 2, 0, 2] }))

  const itemRows: TableCell[][] = inv.items.map((it, idx) => {
    const hsn = it.hsnCode || it.item.hsnCode || ''
    const taxable = it.taxableAmount ?? (it.rate * it.quantity)
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
      taxRows.push([{ text: '' }, { text: `IGST @${g.rate}%`, italics: true, fontSize: 9, alignment: 'right' }, { text: '-', alignment: 'right' }, { text: '-', alignment: 'right' }, { text: '-', alignment: 'right' }, { text: fmtRs(g.igst), alignment: 'right', fontSize: 9 }])
    } else {
      taxRows.push([{ text: '' }, { text: `CGST @${g.rate / 2}%`, italics: true, fontSize: 9, alignment: 'right' }, { text: '-', alignment: 'right' }, { text: '-', alignment: 'right' }, { text: '-', alignment: 'right' }, { text: fmtRs(g.cgst), alignment: 'right', fontSize: 9 }])
      taxRows.push([{ text: '' }, { text: `SGST @${g.rate / 2}%`, italics: true, fontSize: 9, alignment: 'right' }, { text: '-', alignment: 'right' }, { text: '-', alignment: 'right' }, { text: '-', alignment: 'right' }, { text: fmtRs(g.sgst), alignment: 'right', fontSize: 9 }])
    }
  })

  // Whole-rupee Round Off (engine rounds authored totals to the rupee). Derived
  // from stored figures; a genuine round-off is always ≤ 50 paise — anything
  // larger means older unrounded data (or a missing discount figure), no line.
  const roundOff = Math.round((inv.totalAmount - ((inv.subtotal ?? 0) + (inv.taxAmount ?? 0) - (inv.discount ?? 0))) * 100) / 100
  if ((inv.subtotal ?? 0) > 0 && Math.abs(roundOff) > 0.004 && Math.abs(roundOff) <= 0.5) {
    taxRows.push([{ text: '' }, { text: 'Round Off', italics: true, fontSize: 9, alignment: 'right' }, { text: '-', alignment: 'right' }, { text: '-', alignment: 'right' }, { text: '-', alignment: 'right' }, { text: (roundOff > 0 ? '+' : '-') + fmtNum(Math.abs(roundOff)), alignment: 'right', fontSize: 9 }])
  }

  const totalQty = inv.items.reduce((s, i) => s + i.quantity, 0)
  const totalRow: TableCell[] = [
    { text: '', fillColor: GREEN },
    { text: 'TOTAL', bold: true, fontSize: 9, alignment: 'right', fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: totalQty.toString(), bold: true, fontSize: 9, alignment: 'right', fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: fmtRs(inv.totalAmount), bold: true, fontSize: 9, alignment: 'right', fillColor: GREEN },
  ]

  const hasAdditionalFields = inv.type === 'PROFORMA_INVOICE' || inv.type === 'QUOTATION'
    ? false
    : !!(inv.ewayBillNo || inv.vehicleNumber || inv.warrantyPeriod || inv.dispatchedThrough)
  const TARGET_ROWS = hasAdditionalFields ? 12 : 14
  const usedRows = itemRows.length + taxRows.length
  const fillerCount = Math.max(0, TARGET_ROWS - usedRows)
  const emptyCell = { text: ' ', fontSize: 6, margin: [0, 3, 0, 3] }
  const fillerRows: TableCell[][] = Array.from({ length: fillerCount }, () => [{ ...emptyCell }, { ...emptyCell }, { ...emptyCell }, { ...emptyCell }, { ...emptyCell }, { ...emptyCell }])

  const body: TableCell[][] = [headerRow, ...itemRows, ...fillerRows, ...taxRows, totalRow]

  return {
    stack: [{
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
    }],
    margin: [0, 0, 0, 0],
  }
}

// ─── HSN / SAC Summary Table ─────────────────────────────────────────────────

function buildHSNSection(hsnGroups: ReturnType<typeof getHSNGroups>, isInter: boolean): Content {
  if (isInter) {
    const headerRow1: TableCell[] = [
      { text: 'HSN/SAC', bold: true, alignment: 'center', fillColor: GREEN, fontSize: 9 },
      { text: 'Taxable Value', bold: true, alignment: 'center', fillColor: GREEN, fontSize: 9 },
      { text: 'IGST', bold: true, alignment: 'center', fillColor: GREEN, colSpan: 2, fontSize: 9 }, {},
      { text: 'Total Tax Amount', bold: true, alignment: 'center', fillColor: GREEN, fontSize: 9 },
    ]
    const headerRow2: TableCell[] = [{ text: '' }, { text: '' }, { text: 'Rate', bold: true, alignment: 'center', fontSize: 8 }, { text: 'Amount', bold: true, alignment: 'center', fontSize: 8 }, { text: '' }]

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
      layout: { hLineWidth: (i: number) => i === 0 ? 0 : 0.5, vLineWidth: () => 0.5, hLineColor: () => '#000', vLineColor: () => '#000', paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2 },
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
  const headerRow2: TableCell[] = [{ text: '' }, { text: '' }, { text: 'Rate', bold: true, alignment: 'center', fontSize: 8 }, { text: 'Amount', bold: true, alignment: 'center', fontSize: 8 }, { text: 'Rate', bold: true, alignment: 'center', fontSize: 8 }, { text: 'Amount', bold: true, alignment: 'center', fontSize: 8 }, { text: '' }]

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
    layout: { hLineWidth: (i: number) => i === 0 ? 0 : 0.5, vLineWidth: () => 0.5, hLineColor: () => '#000', vLineColor: () => '#000', paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2 },
    margin: [0, 0, 0, 0],
  }
}

// ─── Amount in Words ─────────────────────────────────────────────────────────

function buildAmountInWords(totalAmount: number): Content {
  return {
    table: {
      widths: ['*'],
      body: [[{ stack: [{ text: 'Total Amount (in words)', bold: true, fontSize: 9 }, { text: numberToWords(totalAmount), fontSize: 9, margin: [0, 2, 0, 0] }], fillColor: GREEN }]],
    },
    layout: { hLineWidth: (i: number) => i === 0 ? 0 : 0.5, vLineWidth: () => 0.5, hLineColor: () => '#000', vLineColor: () => '#000', paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 3, paddingBottom: () => 3 },
    margin: [0, 0, 0, 0],
  }
}

// ─── Footer: Notes | Bank Details | Terms | Authorised Signatory ─────────────

function buildFooter(inv: InvoiceData, logo: string | undefined): Content {
  const company = inv.company
  const hasNotes = !!(inv.notes && inv.notes.trim())

  const notesStack: Content[] = [
    { text: 'Notes', bold: true, fontSize: 9, margin: [0, 10, 0, 5] },
    { text: inv.notes || '', fontSize: 9, lineHeight: 1.2 },
  ]

  const bankStack: Content[] = [{ text: 'Bank Details', bold: true, fontSize: 9, margin: [0, 10, 0, 5] }]
  if (company?.bankDetails) {
    company.bankDetails.split('\n').forEach((line) => {
      const colonIdx = line.indexOf(':')
      if (colonIdx > -1) {
        bankStack.push({ text: [{ text: line.substring(0, colonIdx + 1), bold: true, fontSize: 9 }, { text: ' ' + line.substring(colonIdx + 1).trim(), fontSize: 9 }], margin: [0, 0, 0, 1] })
      } else {
        bankStack.push({ text: line, fontSize: 9, margin: [0, 0, 0, 1] })
      }
    })
  }

  const effectiveTerms = inv.termsConditions || company?.termsConditions
  const termsStack: Content[] = [{ text: 'Terms and Conditions', bold: true, fontSize: 9, margin: [0, 0, 0, 3] }]
  if (effectiveTerms) termsStack.push({ text: effectiveTerms, fontSize: 8, lineHeight: 1.2 })

  const sigStack: Content[] = [{ text: '', fontSize: 1 }]
  // Uploaded signature wins the signatory box; the logo is only a stand-in
  // when no signature exists. Both are optional — absent both, the box keeps
  // blank space above the text for a pen.
  const signature = getSignatureImage(company)
  if (signature) sigStack.push({ image: signature, width: 90, height: 32, alignment: 'center', margin: [0, 12, 0, 4] })
  else if (logo) sigStack.push({ image: logo, width: 45, height: 45, alignment: 'center', margin: [0, 10, 0, 8] })
  sigStack.push(
    { text: 'Authorised Signatory For', fontSize: 9, alignment: 'center' },
    { text: (company?.name || '').toUpperCase(), bold: true, fontSize: 9, alignment: 'center' },
  )

  const layout = { hLineWidth: (i: number) => i === 0 ? 0 : 0.5, vLineWidth: () => 0.5, hLineColor: () => '#000', vLineColor: () => '#000', paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 5, paddingBottom: () => 5 }

  if (hasNotes) {
    return {
      table: { widths: ['50%', '50%'], body: [[{ stack: notesStack }, { stack: bankStack }], [{ stack: termsStack }, { stack: sigStack }]] },
      layout,
    }
  }

  return {
    table: { widths: ['36%', '34%', '30%'], body: [[{ stack: bankStack }, { stack: termsStack }, { stack: sigStack }]] },
    layout,
  }
}
