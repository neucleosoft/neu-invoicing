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
    signatureBase64?: string
  }
  totalAmount: number
  subtotal?: number
  taxAmount?: number
  discount?: number
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
  // Paise-only amounts read "Fifty Paise Only" — never start with "and".
  if (decimal > 0) r += (r ? ' and ' : '') + twoD(decimal) + ' Paise'
  if (num < 0 && r) r = 'Minus ' + r
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

// ─── Reusable drawing sections ────────────────────────────────────────────────
// (The old LOGO_BASE64 placeholder constant is gone: it was corrupt — pdfmake
// threw on it — and it forced a fake logo onto companies that never uploaded
// one. Logo and signature are both optional now; builders simply omit them.)

/** Add company logo image to the PDF — a no-op when the company has none. */
export function drawLogo(doc: jsPDF, x: number, y: number, width: number, height: number, logoBase64?: string) {
  if (!logoBase64) return
  try {
    doc.addImage(logoBase64, 'PNG', x, y, width, height)
  } catch {
    // If logo image is invalid/corrupt, skip it silently
  }
}

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
