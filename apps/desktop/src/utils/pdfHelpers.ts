import { jsPDF } from 'jspdf'

// ─── Data interfaces ──────────────────────────────────────────────────────────

export interface PDFDocumentData {
  customer: {
    name: string
    email?: string
    phone?: string
    billingAddress?: string
    shippingAddress?: string
    taxId?: string
    stateCode?: string
    stateName?: string
  }
  items: Array<{
    item: {
      name: string
      unit?: string
      hsnCode?: string
      skuHsn?: string
    }
    quantity: number
    rate: number
    taxRate: number
    discount: number
    total: number
    hsnCode?: string
    taxableAmount?: number
    cgstRate?: number
    cgstAmount?: number
    sgstRate?: number
    sgstAmount?: number
    igstRate?: number
    igstAmount?: number
  }>
  company?: {
    name: string
    address?: string
    phone?: string
    email?: string
    taxId?: string
    bankDetails?: string
    currency?: string
    termsConditions?: string
    stateCode?: string
    stateName?: string
    logoPath?: string
    logoBase64?: string
    signaturePath?: string
  }
  totalAmount: number
  subtotal?: number
  taxAmount?: number
  notes?: string
  termsConditions?: string
  isInterState?: boolean
  placeOfSupply?: string
  placeOfSupplyName?: string
}

export interface ChallanData extends PDFDocumentData {
  challanNumber: string
  challanDate: string
  status: 'RETURNABLE' | 'NON_RETURNABLE' | 'CONVERTED'
  transportMode?: string
  vehicleNumber?: string
  // Additional fields (all optional)
  poNumber?: string
  ewayBillNo?: string
  warrantyPeriod?: string
  dispatchedThrough?: string
}

export interface InvoiceData extends PDFDocumentData {
  invoiceNumber: string
  invoiceDate: string
  dueDate?: string
  type: string
  status: string
  subtotal: number
  discount: number
  taxAmount: number
  amountPaid: number
  balanceDue: number
  // GST fields
  placeOfSupply?: string
  placeOfSupplyName?: string
  isInterState?: boolean
  reverseCharge?: boolean
  cgstAmount?: number
  sgstAmount?: number
  igstAmount?: number
  cessAmount?: number
  // Additional fields
  poNumber?: string
  ewayBillNo?: string
  vehicleNumber?: string
  warrantyPeriod?: string
  dispatchedThrough?: string
  deliveryTime?: string
}

// ─── Template types ───────────────────────────────────────────────────────────

export type InvoiceTemplate = 'classic' | 'modern' | 'minimal' | 'elegant' | 'bold'

export const TEMPLATE_INFO: Record<InvoiceTemplate, { name: string; description: string; preview: string }> = {
  classic: {
    name: 'GST Tax Invoice',
    description: 'Standard Indian GST tax invoice format',
    preview: '🔵'
  },
  modern: {
    name: 'Modern Gradient',
    description: 'Stylish gradient design',
    preview: '🟣'
  },
  minimal: {
    name: 'Minimal Clean',
    description: 'Simple and elegant with lots of whitespace',
    preview: '⚪'
  },
  elegant: {
    name: 'Elegant Gold',
    description: 'Sophisticated design with gold accents',
    preview: '🟡'
  },
  bold: {
    name: 'Bold & Modern',
    description: 'Dark theme with bold typography',
    preview: '⚫'
  }
}

// ─── Tax / HSN interfaces ─────────────────────────────────────────────────────

export interface TaxGroup {
  rate: number
  taxable: number
  igst: number
  cgst: number
  sgst: number
}

export interface HSNGroup {
  hsn: string
  taxable: number
  rate: number
  igst: number
  cgst: number
  sgst: number
  totalTax: number
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

/** Format number with Indian grouping: 1,23,456 (no decimals if .00) */
export function fmtNum(amount: number): string {
  const abs = Math.abs(amount)
  const integer = Math.floor(abs)
  const decimal = Math.round((abs - integer) * 100)
  const intStr = integer.toString()
  let result: string
  if (intStr.length <= 3) {
    result = intStr
  } else {
    const last3 = intStr.slice(-3)
    const remaining = intStr.slice(0, -3)
    result = remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3
  }
  if (decimal > 0) result += '.' + decimal.toString().padStart(2, '0')
  return amount < 0 ? '-' + result : result
}

/** Format with ₹ prefix */
export function fmtRs(amount: number): string {
  return '₹ ' + fmtNum(amount)
}

/** Format with PDF-safe currency symbol */
export function fmtAmt(amount: number, currency?: string): string {
  const cur = currency || 'INR'
  if (cur === 'INR') return 'Rs.' + fmtNum(amount)
  const map: Record<string, string> = { USD: '$', GBP: 'GBP ', EUR: 'EUR ', AUD: 'A$', CAD: 'C$' }
  return (map[cur] || 'Rs.') + fmtNum(amount)
}

/** DD/MM/YYYY date format */
export function formatDate(dateInput: string | Date): string {
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) return String(dateInput)
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`
}

/** Extract PAN from GSTIN (characters 2-11) */
export function extractPAN(gstin?: string): string {
  if (!gstin || gstin.length < 12) return ''
  return gstin.substring(2, 12)
}

/** Convert number to Indian words */
export function numberToWords(num: number): string {
  if (num === 0) return 'Zero Rupees Only'
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  function twoD(n: number): string { if (n === 0) return ''; if (n < 20) return ones[n]; return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '') }
  function threeD(n: number): string { if (n === 0) return ''; if (n >= 100) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + twoD(n % 100) : ''); return twoD(n) }
  const integer = Math.floor(Math.abs(num))
  const decimal = Math.round((Math.abs(num) - integer) * 100)
  let r = '', rem = integer
  if (rem >= 10000000) { r += threeD(Math.floor(rem / 10000000)) + ' Crore '; rem %= 10000000 }
  if (rem >= 100000) { r += twoD(Math.floor(rem / 100000)) + ' Lakh '; rem %= 100000 }
  if (rem >= 1000) { r += twoD(Math.floor(rem / 1000)) + ' Thousand '; rem %= 1000 }
  if (rem > 0) r += threeD(rem)
  r = r.trim()
  if (r) r += ' Rupees'
  if (decimal > 0) r += ' and ' + twoD(decimal) + ' Paise'
  return (r || 'Zero Rupees') + ' Only'
}

// ─── Tax / HSN grouping ───────────────────────────────────────────────────────

/** Group items by tax rate for tax row display */
export function getTaxGroups(items: PDFDocumentData['items'], isInterState: boolean): TaxGroup[] {
  const map: Record<number, TaxGroup> = {}
  for (const it of items) {
    const rate = it.taxRate || 0
    if (rate === 0) continue
    if (!map[rate]) map[rate] = { rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 }
    const taxable = it.taxableAmount ?? (it.rate * it.quantity)
    map[rate].taxable += taxable
    if (isInterState) {
      map[rate].igst += it.igstAmount ?? (taxable * rate / 100)
    } else {
      map[rate].cgst += it.cgstAmount ?? (taxable * rate / 200)
      map[rate].sgst += it.sgstAmount ?? (taxable * rate / 200)
    }
  }
  return Object.values(map)
}

/** Group items by HSN code for HSN summary table */
export function getHSNGroups(items: PDFDocumentData['items'], isInterState: boolean): HSNGroup[] {
  const map: Record<string, HSNGroup> = {}
  for (const it of items) {
    const hsn = it.hsnCode || it.item.hsnCode || it.item.skuHsn || '-'
    const taxable = it.taxableAmount ?? (it.rate * it.quantity)
    const rate = it.taxRate || 0
    if (!map[hsn]) map[hsn] = { hsn, taxable: 0, rate, igst: 0, cgst: 0, sgst: 0, totalTax: 0 }
    map[hsn].taxable += taxable
    const ig = isInterState ? (it.igstAmount ?? (taxable * rate / 100)) : 0
    const cg = !isInterState ? (it.cgstAmount ?? (taxable * rate / 200)) : 0
    const sg = !isInterState ? (it.sgstAmount ?? (taxable * rate / 200)) : 0
    map[hsn].igst += ig
    map[hsn].cgst += cg
    map[hsn].sgst += sg
    map[hsn].totalTax += ig + cg + sg
  }
  return Object.values(map)
}

// ─── Logo constant ────────────────────────────────────────────────────────────

/** Company logo as embedded PNG base64 */
export const LOGO_BASE64 = 'data:image/png;base64,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'

/** Add company logo image to the PDF */
export function drawLogo(doc: jsPDF, x: number, y: number, width: number, height: number, logoBase64?: string) {
  try {
    const logo = logoBase64 || LOGO_BASE64
    doc.addImage(logo, 'PNG', x, y, width, height)
  } catch {
    // If logo image is invalid/corrupt, skip it silently
  }
}

// ─── Reusable drawing sections ────────────────────────────────────────────────

/** Draw the outer page border rectangle */
export function drawPageBorder(doc: jsPDF, ML: number, BORDER_TOP: number, CW: number, BORDER_BOTTOM: number) {
  doc.setLineWidth(0.6)
  doc.rect(ML, BORDER_TOP, CW, BORDER_BOTTOM - BORDER_TOP)
  doc.setLineWidth(0.4)
}

/** Draw the document number / date grid in the top-right of the company section */
export function drawDocumentNumberGrid(
  doc: jsPDF,
  label1: string, value1: string,
  label2: string, value2: string,
  INV_X: number, BORDER_TOP: number, COMPANY_BOTTOM: number, RE: number
) {
  // Vertical divider for number/date
  doc.line(INV_X, BORDER_TOP, INV_X, COMPANY_BOTTOM)

  // Number / Date sub-grid
  const INV_MID = (INV_X + RE) / 2
  doc.line(INV_MID, BORDER_TOP, INV_MID, COMPANY_BOTTOM)
  const INV_LABEL_BOTTOM = BORDER_TOP + 8
  doc.line(INV_X, INV_LABEL_BOTTOM, RE, INV_LABEL_BOTTOM)

  // Labels
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text(label1, INV_X + 3, BORDER_TOP + 5.5)
  doc.text(label2, INV_MID + 3, BORDER_TOP + 5.5)

  // Values
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(value1, INV_X + 3, INV_LABEL_BOTTOM + 7)
  doc.text(value2, INV_MID + 3, INV_LABEL_BOTTOM + 7)
}

/** Draw the company logo + name/address/GSTIN/email section */
export function drawCompanySection(
  doc: jsPDF,
  company: PDFDocumentData['company'],
  logoBase64: string | undefined,
  compTextX: number,
  LOGO_SIZE: number,
  ML: number, BORDER_TOP: number, INV_X: number, COMPANY_BOTTOM: number
) {
  // Horizontal line at company bottom
  doc.line(ML, COMPANY_BOTTOM, ML + (INV_X - ML) + (doc.internal.pageSize.width - INV_X), COMPANY_BOTTOM)

  // Company logo (use company's logo if available, otherwise fallback)
  drawLogo(doc, ML + 2, BORDER_TOP + 2, LOGO_SIZE, LOGO_SIZE, logoBase64)

  // Company info (offset right of logo)
  const compMaxW = INV_X - compTextX - 2
  let cy = BORDER_TOP + 9
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  const compName = (company?.name || 'Company').toUpperCase()
  doc.text(doc.splitTextToSize(compName, compMaxW)[0], compTextX, cy)
  cy += 6.5

  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  if (company?.address) {
    const lines = doc.splitTextToSize(company.address.toUpperCase(), compMaxW)
    doc.text(lines, compTextX, cy)
    cy += lines.length * 3.5
  }
  if (company?.taxId) {
    doc.setFont('helvetica', 'bold')
    doc.text('GSTIN: ', compTextX, cy)
    doc.setFont('helvetica', 'normal')
    doc.text(company.taxId, compTextX + doc.getTextWidth('GSTIN: '), cy)
    cy += 4
  }
  if (company?.email) {
    doc.setFont('helvetica', 'bold')
    doc.text('Email: ', compTextX, cy)
    doc.setFont('helvetica', 'normal')
    doc.text(company.email, compTextX + doc.getTextWidth('Email: '), cy)
  }
}

/** Draw Bill To / Ship To section */
export function drawBillToShipTo(
  doc: jsPDF,
  customer: PDFDocumentData['customer'],
  placeOfSupplyName: string | undefined,
  COMPANY_BOTTOM: number, BILLSHIP_BOTTOM: number,
  ML: number, RE: number
) {
  const CW = RE - ML
  doc.line(ML, BILLSHIP_BOTTOM, RE, BILLSHIP_BOTTOM)

  const MID = ML + CW / 2
  doc.line(MID, COMPANY_BOTTOM, MID, BILLSHIP_BOTTOM)

  // -- BILL TO --
  let by = COMPANY_BOTTOM + 5.5
  const billMaxW = MID - ML - 6
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.text('BILL TO', ML + 3, by)
  by += 5
  doc.setFontSize(10)
  doc.text(doc.splitTextToSize(customer.name, billMaxW)[0], ML + 3, by)
  by += 5.5

  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  if (customer.billingAddress) {
    const lbl = 'Address: '
    doc.text(lbl, ML + 3, by)
    const lblW = doc.getTextWidth(lbl)
    const lines = doc.splitTextToSize(customer.billingAddress, billMaxW - lblW)
    lines.forEach((line: string, i: number) => {
      doc.text(line, ML + 3 + lblW, by + i * 3.5)
    })
    by += lines.length * 3.5 + 1.5
  }
  if (customer.taxId) {
    doc.setFont('helvetica', 'bold')
    doc.text('GSTIN: ' + customer.taxId, ML + 3, by)
    doc.setFont('helvetica', 'normal')
    if (placeOfSupplyName) {
      const gW = doc.getTextWidth('GSTIN: ' + customer.taxId) + 5
      if (gW + doc.getTextWidth('Place of Supply:  ' + placeOfSupplyName) < billMaxW) {
        doc.text('Place of Supply:  ' + placeOfSupplyName, ML + 3 + gW, by)
      } else {
        by += 4
        doc.text('Place of Supply:  ' + placeOfSupplyName, ML + 3, by)
      }
    }
    by += 4
  }
  if (customer.phone) {
    doc.setFont('helvetica', 'bold')
    doc.text('Mobile: ', ML + 3, by)
    doc.setFont('helvetica', 'normal')
    doc.text(customer.phone, ML + 3 + doc.getTextWidth('Mobile: '), by)
    by += 4
  }
  const pan = extractPAN(customer.taxId)
  if (pan) {
    doc.setFont('helvetica', 'bold')
    doc.text('PAN Number: ' + pan, ML + 3, by)
    doc.setFont('helvetica', 'normal')
  }

  // -- SHIP TO --
  let sy = COMPANY_BOTTOM + 5.5
  const shipMaxW = RE - MID - 6
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.text('SHIP TO', MID + 3, sy)
  sy += 5
  doc.setFontSize(10)
  doc.text(doc.splitTextToSize(customer.name, shipMaxW)[0], MID + 3, sy)
  sy += 5.5

  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  const shipAddr = customer.shippingAddress || customer.billingAddress
  if (shipAddr) {
    const lbl = 'Address: '
    doc.text(lbl, MID + 3, sy)
    const lblW = doc.getTextWidth(lbl)
    const lines = doc.splitTextToSize(shipAddr, shipMaxW - lblW)
    lines.forEach((line: string, i: number) => {
      doc.text(line, MID + 3 + lblW, sy + i * 3.5)
    })
  }
}

/** Draw the dark header row for the items table */
export function drawItemsTableHeader(
  doc: jsPDF,
  BILLSHIP_BOTTOM: number, ITEMS_HDR_H: number,
  ML: number, _RE: number, CW: number,
  IC: number[]
) {
  doc.setFillColor(198, 224, 180)
  doc.rect(ML, BILLSHIP_BOTTOM, CW, ITEMS_HDR_H, 'F')

  const hdrs = ['S.NO.', 'ITEMS', 'HSN', 'QTY.', 'RATE', 'AMOUNT']
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(0, 0, 0)
  hdrs.forEach((h, i) => {
    doc.text(h, (IC[i] + IC[i + 1]) / 2, BILLSHIP_BOTTOM + 5.5, { align: 'center' })
  })
}

/** Draw item data rows */
export function drawItemRows(
  doc: jsPDF,
  items: PDFDocumentData['items'],
  ITEMS_HDR_BOTTOM: number, ROW_H: number,
  IC: number[], RE: number,
  maxItemRows: number,
  _currency?: string
) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)

  const LINE_H = 3.5 // height per wrapped text line
  const ITEM_GAP = 7 // fixed gap between items
  const maxY = ITEMS_HDR_BOTTOM + maxItemRows * ROW_H // bottom of items area

  let currentY = ITEMS_HDR_BOTTOM

  for (let row = 0; row < items.length; row++) {
    const it = items[row]

    // Split name into lines that fit the column
    const nameLines = doc.splitTextToSize(it.item.name, IC[2] - IC[1] - 4)
    const nameHeight = nameLines.length * LINE_H
    const rowHeight = Math.max(ITEM_GAP, nameHeight + 3)

    // Stop if this item won't fit
    if (currentY + rowHeight > maxY) break

    const ty = currentY + 5 // text baseline

    // S.NO
    doc.text((row + 1).toString(), (IC[0] + IC[1]) / 2, ty, { align: 'center' })
    // ITEMS — draw all wrapped lines
    for (let l = 0; l < nameLines.length; l++) {
      doc.text(nameLines[l], IC[1] + 2, ty + l * LINE_H)
    }
    // HSN
    const hsn = it.hsnCode || it.item.hsnCode || it.item.skuHsn || ''
    doc.text(hsn, (IC[2] + IC[3]) / 2, ty, { align: 'center' })
    // QTY
    doc.text(`${it.quantity} ${it.item.unit || 'PCS'}`, (IC[3] + IC[4]) / 2, ty, { align: 'center' })
    // RATE
    doc.text(fmtNum(it.rate), IC[5] - 2, ty, { align: 'right' })
    // AMOUNT (taxable = rate * qty, before tax)
    const taxable = it.taxableAmount ?? (it.rate * it.quantity)
    doc.text(fmtNum(taxable), RE - 3, ty, { align: 'right' })

    currentY += rowHeight
  }
}

/** Draw the TOTAL row */
export function drawTotalRow(
  doc: jsPDF,
  totalQty: number, totalAmount: number,
  TOTAL_TOP: number, TOTAL_ROW_H: number,
  IC: number[], RE: number,
  _currency?: string
) {
  doc.setFillColor(198, 224, 180)
  doc.rect(IC[0], TOTAL_TOP, RE - IC[0], TOTAL_ROW_H, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('TOTAL', (IC[1] + IC[2]) / 2, TOTAL_TOP + 5.5, { align: 'center' })
  doc.text(totalQty.toString(), (IC[3] + IC[4]) / 2, TOTAL_TOP + 5.5, { align: 'center' })
  doc.text(fmtRs(totalAmount), RE - 3, TOTAL_TOP + 5.5, { align: 'right' })
}

/** Draw the "Amount in Words" section */
export function drawAmountInWords(
  doc: jsPDF,
  amount: number,
  WORDS_TOP: number, FOOTER_TOP: number,
  ML: number, CW: number
) {
  doc.setFillColor(198, 224, 180)
  doc.setDrawColor(0, 0, 0)
  doc.rect(ML, WORDS_TOP, CW, FOOTER_TOP - WORDS_TOP, 'FD')

  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'bold')
  doc.text('Total Amount (in words)', ML + 3, WORDS_TOP + 5)
  doc.setFont('helvetica', 'normal')
  const words = numberToWords(amount)
  const wordLines = doc.splitTextToSize(words, CW - 6)
  doc.text(wordLines, ML + 3, WORDS_TOP + 10)
}

/** Draw the footer: Bank Details | Terms & Conditions | Authorised Signatory */
export function drawFooter(
  doc: jsPDF,
  company: PDFDocumentData['company'],
  logoBase64: string | undefined,
  FOOTER_TOP: number, BORDER_BOTTOM: number,
  ML: number, RE: number
) {
  const CW = RE - ML
  const footCol1 = ML
  const footCol2 = ML + 72        // bank gets more room
  const footCol3 = ML + CW - 66   // signatory stays same width

  doc.line(footCol2, FOOTER_TOP, footCol2, BORDER_BOTTOM)
  doc.line(footCol3, FOOTER_TOP, footCol3, BORDER_BOTTOM)

  // Bank Details
  let fy = FOOTER_TOP + 5.5
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.text('Bank Details', footCol1 + 3, fy)
  fy += 5.5
  doc.setFontSize(7.5)
  if (company?.bankDetails) {
    // Draw each line with label bold and value normal
    const bankLines = company.bankDetails.split('\n')
    bankLines.forEach((line: string) => {
      const colonIdx = line.indexOf(':')
      if (colonIdx > -1) {
        const label = line.substring(0, colonIdx + 1)
        const value = line.substring(colonIdx + 1).trim()
        doc.setFont('helvetica', 'bold')
        doc.text(label, footCol1 + 3, fy)
        const labelW = doc.getTextWidth(label)
        doc.setFont('helvetica', 'normal')
        doc.text(value, footCol1 + 3 + labelW + 2, fy)
      } else {
        doc.setFont('helvetica', 'normal')
        doc.text(line, footCol1 + 3, fy)
      }
      fy += 3.8
    })
  }

  // Terms and Conditions
  fy = FOOTER_TOP + 5.5
  doc.setFontSize(8.5)
  doc.setFont('helvetica', 'bold')
  doc.text('Terms and Conditions', footCol2 + 3, fy)
  fy += 5.5
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  if (company?.termsConditions) {
    const colWidth = footCol3 - footCol2 - 6
    const termLines = doc.splitTextToSize(company.termsConditions, colWidth)
    doc.text(termLines.slice(0, 12), footCol2 + 3, fy)
  }

  // Authorised Signatory with logo stamp
  const sigCenterX = (footCol3 + RE) / 2
  drawLogo(doc, sigCenterX - 6, FOOTER_TOP + 5, 12, 12, logoBase64)
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  doc.text('Authorised Signatory For', sigCenterX, BORDER_BOTTOM - 10, { align: 'center' })
  doc.setFont('helvetica', 'bold')
  doc.text((company?.name || '').toUpperCase(), sigCenterX, BORDER_BOTTOM - 5.5, { align: 'center' })
}
