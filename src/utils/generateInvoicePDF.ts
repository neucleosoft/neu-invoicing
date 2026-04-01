import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

// ─── Data interface (accepts all GST fields from Prisma) ───────────────────────

interface InvoiceData {
  invoiceNumber: string
  invoiceDate: string
  type: string
  status: string
  subtotal: number
  discount: number
  taxAmount: number
  totalAmount: number
  amountPaid: number
  balanceDue: number
  notes?: string
  // GST fields
  placeOfSupply?: string
  placeOfSupplyName?: string
  isInterState?: boolean
  reverseCharge?: boolean
  cgstAmount?: number
  sgstAmount?: number
  igstAmount?: number
  cessAmount?: number
  party: {
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
  }
}

// ─── Template types ────────────────────────────────────────────────────────────

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

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Format number with Indian grouping: 1,23,456 (no decimals if .00) */
function fmtNum(amount: number): string {
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

/** Format with Rs. prefix */
function fmtRs(amount: number): string {
  return 'Rs. ' + fmtNum(amount)
}

/** Format with PDF-safe currency symbol */
function fmtAmt(amount: number, invoice: InvoiceData): string {
  const cur = invoice.company?.currency || 'INR'
  if (cur === 'INR') return 'Rs.' + fmtNum(amount)
  const map: Record<string, string> = { USD: '$', GBP: 'GBP ', EUR: 'EUR ', AUD: 'A$', CAD: 'C$' }
  return (map[cur] || 'Rs.') + fmtNum(amount)
}

/** DD/MM/YYYY date format */
function formatDate(dateInput: string | Date): string {
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) return String(dateInput)
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`
}

/** Extract PAN from GSTIN (characters 2–11) */
function extractPAN(gstin?: string): string {
  if (!gstin || gstin.length < 12) return ''
  return gstin.substring(2, 12)
}

/** Convert number to Indian words */
function numberToWords(num: number): string {
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

/** Group items by tax rate for tax row display */
interface TaxGroup { rate: number; taxable: number; igst: number; cgst: number; sgst: number }
function getTaxGroups(invoice: InvoiceData): TaxGroup[] {
  const isInter = invoice.isInterState !== false
  const map: Record<number, TaxGroup> = {}
  for (const it of invoice.items) {
    const rate = it.taxRate || 0
    if (rate === 0) continue
    if (!map[rate]) map[rate] = { rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 }
    const taxable = it.taxableAmount ?? (it.rate * it.quantity)
    map[rate].taxable += taxable
    if (isInter) {
      map[rate].igst += it.igstAmount ?? (taxable * rate / 100)
    } else {
      map[rate].cgst += it.cgstAmount ?? (taxable * rate / 200)
      map[rate].sgst += it.sgstAmount ?? (taxable * rate / 200)
    }
  }
  return Object.values(map)
}

/** Group items by HSN code for HSN summary table */
interface HSNGroup { hsn: string; taxable: number; rate: number; igst: number; cgst: number; sgst: number; totalTax: number }
function getHSNGroups(invoice: InvoiceData): HSNGroup[] {
  const isInter = invoice.isInterState !== false
  const map: Record<string, HSNGroup> = {}
  for (const it of invoice.items) {
    const hsn = it.hsnCode || it.item.hsnCode || ''
    if (!hsn) continue
    const taxable = it.taxableAmount ?? (it.rate * it.quantity)
    const rate = it.taxRate || 0
    if (!map[hsn]) map[hsn] = { hsn, taxable: 0, rate, igst: 0, cgst: 0, sgst: 0, totalTax: 0 }
    map[hsn].taxable += taxable
    const ig = isInter ? (it.igstAmount ?? (taxable * rate / 100)) : 0
    const cg = !isInter ? (it.cgstAmount ?? (taxable * rate / 200)) : 0
    const sg = !isInter ? (it.sgstAmount ?? (taxable * rate / 200)) : 0
    map[hsn].igst += ig
    map[hsn].cgst += cg
    map[hsn].sgst += sg
    map[hsn].totalTax += ig + cg + sg
  }
  return Object.values(map)
}

/** Company logo as embedded PNG base64 */
const LOGO_BASE64 = 'data:image/png;base64,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'

/** Add company logo image to the PDF */
function drawLogo(doc: jsPDF, x: number, y: number, width: number, height: number) {
  try {
    doc.addImage(LOGO_BASE64, 'PNG', x, y, width, height)
  } catch {
    // If logo image is invalid/corrupt, skip it silently
  }
}

// ─── Classic GST Tax Invoice Template ──────────────────────────────────────────

function generateClassicTemplate(doc: jsPDF, invoice: InvoiceData) {
  const ML = 6, RE = 204, CW = 198, ROW_H = 7

  // Pre-calculate layout
  const BORDER_TOP = 13, COMPANY_BOTTOM = 47, BILLSHIP_BOTTOM = 87
  const ITEMS_HDR_H = 8
  const ITEMS_HDR_BOTTOM = BILLSHIP_BOTTOM + ITEMS_HDR_H // 95

  const isInter = invoice.isInterState !== false
  const taxGroups = getTaxGroups(invoice)
  const hsnGroups = getHSNGroups(invoice)
  const taxRowCount = isInter ? Math.max(taxGroups.length, 1) : Math.max(taxGroups.length * 2, 1)

  // Bottom section heights
  const FOOTER_H = 36, WORDS_H = 12
  const HSN_HDR_H = 14 // 2-row header
  const hsnDataRows = Math.max(hsnGroups.length, 1)
  const HSN_H = HSN_HDR_H + hsnDataRows * ROW_H + ROW_H // header + data + total
  const TOTAL_ROW_H = 8

  const BORDER_BOTTOM = 290
  const FOOTER_TOP = BORDER_BOTTOM - FOOTER_H
  const WORDS_TOP = FOOTER_TOP - WORDS_H
  const HSN_TOP = WORDS_TOP - HSN_H
  const TOTAL_TOP = HSN_TOP - TOTAL_ROW_H
  const TAX_TOP = TOTAL_TOP - taxRowCount * ROW_H

  // Items area
  const ITEMS_AREA_H = TAX_TOP - ITEMS_HDR_BOTTOM
  const maxItemRows = Math.floor(ITEMS_AREA_H / ROW_H)

  // Column positions for items table: S.NO | ITEMS | HSN | QTY | RATE | AMOUNT
  const IC = [ML, ML + 14, ML + 82, ML + 106, ML + 134, ML + 164, RE]

  doc.setDrawColor(0, 0, 0)
  doc.setTextColor(33, 33, 33)
  doc.setLineWidth(0.3)

  // ══════════════════════════════════════════════════════════════════════════════
  // TITLE LINE
  // ══════════════════════════════════════════════════════════════════════════════
  const titleLabel = invoice.type === 'QUOTATION' ? 'QUOTATION' : 'TAX INVOICE'
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text(titleLabel, ML, 9)

  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  const badgeText = 'ORIGINAL FOR RECIPIENT'
  doc.setFontSize(10)
  const titleW = doc.getTextWidth(titleLabel)
  doc.setFontSize(7)
  const bx = ML + titleW + 8
  const badgeW = doc.getTextWidth(badgeText) + 6
  doc.rect(bx, 4, badgeW, 7)
  doc.text(badgeText, bx + 3, 9)

  // ══════════════════════════════════════════════════════════════════════════════
  // OUTER BORDER
  // ══════════════════════════════════════════════════════════════════════════════
  doc.setLineWidth(0.4)
  doc.rect(ML, BORDER_TOP, CW, BORDER_BOTTOM - BORDER_TOP)
  doc.setLineWidth(0.3)

  // ══════════════════════════════════════════════════════════════════════════════
  // COMPANY SECTION (BORDER_TOP → COMPANY_BOTTOM)
  // ══════════════════════════════════════════════════════════════════════════════
  doc.line(ML, COMPANY_BOTTOM, RE, COMPANY_BOTTOM)

  // Vertical divider for invoice no/date
  const INV_X = 142
  doc.line(INV_X, BORDER_TOP, INV_X, COMPANY_BOTTOM)

  // Invoice No / Date sub-grid
  const INV_MID = (INV_X + RE) / 2
  doc.line(INV_MID, BORDER_TOP, INV_MID, COMPANY_BOTTOM)
  const INV_LABEL_BOTTOM = BORDER_TOP + 8
  doc.line(INV_X, INV_LABEL_BOTTOM, RE, INV_LABEL_BOTTOM)

  // Invoice labels
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('Invoice No.', INV_X + 3, BORDER_TOP + 5.5)
  doc.text('Invoice Date', INV_MID + 3, BORDER_TOP + 5.5)

  // Invoice values
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(invoice.invoiceNumber, INV_X + 3, INV_LABEL_BOTTOM + 7)
  doc.text(formatDate(invoice.invoiceDate), INV_MID + 3, INV_LABEL_BOTTOM + 7)

  // Company logo
  const LOGO_SIZE = 14
  drawLogo(doc, ML + 2, BORDER_TOP + 2, LOGO_SIZE, LOGO_SIZE)

  // Company info (offset right of logo)
  const compTextX = ML + LOGO_SIZE + 5
  const compMaxW = INV_X - compTextX - 2
  let cy = BORDER_TOP + 8
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  const compName = (invoice.company?.name || 'Company').toUpperCase()
  doc.text(doc.splitTextToSize(compName, compMaxW)[0], compTextX, cy)
  cy += 5

  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  if (invoice.company?.address) {
    const lines = doc.splitTextToSize(invoice.company.address.toUpperCase(), compMaxW)
    doc.text(lines, compTextX, cy)
    cy += lines.length * 3.2
  }
  if (invoice.company?.taxId) {
    doc.setFont('helvetica', 'bold')
    doc.text('GSTIN: ', compTextX, cy)
    doc.setFont('helvetica', 'normal')
    doc.text(invoice.company.taxId, compTextX + doc.getTextWidth('GSTIN: '), cy)
    cy += 3.5
  }
  if (invoice.company?.email) {
    doc.setFont('helvetica', 'bold')
    doc.text('Email: ', compTextX, cy)
    doc.setFont('helvetica', 'normal')
    doc.text(invoice.company.email, compTextX + doc.getTextWidth('Email: '), cy)
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // BILL TO / SHIP TO (COMPANY_BOTTOM → BILLSHIP_BOTTOM)
  // ══════════════════════════════════════════════════════════════════════════════
  doc.line(ML, BILLSHIP_BOTTOM, RE, BILLSHIP_BOTTOM)

  const MID = ML + CW / 2
  doc.line(MID, COMPANY_BOTTOM, MID, BILLSHIP_BOTTOM)

  // ── BILL TO ──
  let by = COMPANY_BOTTOM + 5
  const billMaxW = MID - ML - 6
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('BILL TO', ML + 3, by)
  by += 4.5
  doc.setFontSize(9)
  doc.text(doc.splitTextToSize(invoice.party.name, billMaxW)[0], ML + 3, by)
  by += 5

  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  if (invoice.party.billingAddress) {
    const lbl = 'Address: '
    doc.text(lbl, ML + 3, by)
    const lblW = doc.getTextWidth(lbl)
    const lines = doc.splitTextToSize(invoice.party.billingAddress, billMaxW - lblW)
    lines.forEach((line: string, i: number) => {
      doc.text(line, ML + 3 + lblW, by + i * 3.2)
    })
    by += lines.length * 3.2 + 1
  }
  if (invoice.party.taxId) {
    doc.setFont('helvetica', 'bold')
    doc.text('GSTIN: ' + invoice.party.taxId, ML + 3, by)
    doc.setFont('helvetica', 'normal')
    if (invoice.placeOfSupplyName) {
      const gW = doc.getTextWidth('GSTIN: ' + invoice.party.taxId) + 5
      if (gW + doc.getTextWidth('Place of Supply:  ' + invoice.placeOfSupplyName) < billMaxW) {
        doc.text('Place of Supply:  ' + invoice.placeOfSupplyName, ML + 3 + gW, by)
      } else {
        by += 3.5
        doc.text('Place of Supply:  ' + invoice.placeOfSupplyName, ML + 3, by)
      }
    }
    by += 3.5
  }
  const pan = extractPAN(invoice.party.taxId)
  if (pan) {
    doc.setFont('helvetica', 'bold')
    doc.text('PAN Number: ' + pan, ML + 3, by)
    doc.setFont('helvetica', 'normal')
  }

  // ── SHIP TO ──
  let sy = COMPANY_BOTTOM + 5
  const shipMaxW = RE - MID - 6
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('SHIP TO', MID + 3, sy)
  sy += 4.5
  doc.setFontSize(9)
  doc.text(doc.splitTextToSize(invoice.party.name, shipMaxW)[0], MID + 3, sy)
  sy += 5

  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  const shipAddr = invoice.party.shippingAddress || invoice.party.billingAddress
  if (shipAddr) {
    const lbl = 'Address: '
    doc.text(lbl, MID + 3, sy)
    const lblW = doc.getTextWidth(lbl)
    const lines = doc.splitTextToSize(shipAddr, shipMaxW - lblW)
    lines.forEach((line: string, i: number) => {
      doc.text(line, MID + 3 + lblW, sy + i * 3.2)
    })
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ITEMS TABLE HEADER
  // ══════════════════════════════════════════════════════════════════════════════
  doc.setFillColor(45, 45, 45)
  doc.rect(ML, BILLSHIP_BOTTOM, CW, ITEMS_HDR_H, 'F')
  doc.line(ML, ITEMS_HDR_BOTTOM, RE, ITEMS_HDR_BOTTOM)

  const hdrs = ['S.NO.', 'ITEMS', 'HSN', 'QTY.', 'RATE', 'AMOUNT']
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(255, 255, 255)
  hdrs.forEach((h, i) => {
    doc.text(h, (IC[i] + IC[i + 1]) / 2, BILLSHIP_BOTTOM + 5.5, { align: 'center' })
  })
  doc.setTextColor(33, 33, 33)

  // ══════════════════════════════════════════════════════════════════════════════
  // ITEMS TABLE – vertical column lines (from header top to total bottom)
  // ══════════════════════════════════════════════════════════════════════════════
  const tableBottom = TOTAL_TOP + TOTAL_ROW_H
  for (let i = 1; i < IC.length - 1; i++) {
    doc.line(IC[i], BILLSHIP_BOTTOM, IC[i], tableBottom)
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // ITEM ROWS
  // ══════════════════════════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)

  const displayItems = invoice.items.slice(0, maxItemRows)
  for (let row = 0; row < displayItems.length; row++) {
    const it = displayItems[row]
    const ry = ITEMS_HDR_BOTTOM + row * ROW_H
    const ty = ry + 5 // text y (vertically centered)

    // Only draw horizontal line for rows with actual items
    doc.line(ML, ry + ROW_H, RE, ry + ROW_H)

    // S.NO
    doc.text((row + 1).toString(), (IC[0] + IC[1]) / 2, ty, { align: 'center' })
    // ITEMS
    doc.text(doc.splitTextToSize(it.item.name, IC[2] - IC[1] - 4)[0], IC[1] + 2, ty)
    // HSN
    const hsn = it.hsnCode || it.item.hsnCode || ''
    doc.text(hsn, (IC[2] + IC[3]) / 2, ty, { align: 'center' })
    // QTY
    doc.text(`${it.quantity} ${it.item.unit || 'PCS'}`, (IC[3] + IC[4]) / 2, ty, { align: 'center' })
    // RATE
    doc.text(fmtNum(it.rate), IC[5] - 2, ty, { align: 'right' })
    // AMOUNT (taxable = rate * qty, before tax)
    const taxable = it.taxableAmount ?? (it.rate * it.quantity)
    doc.text(fmtNum(taxable), RE - 3, ty, { align: 'right' })
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // TAX ROWS
  // ══════════════════════════════════════════════════════════════════════════════
  let ty = TAX_TOP
  doc.setFontSize(7.5)

  if (taxGroups.length === 0) {
    // No tax – draw empty row
    doc.line(ML, ty + ROW_H, RE, ty + ROW_H)
    ty += ROW_H
  } else {
    taxGroups.forEach(g => {
      if (isInter) {
        doc.setFont('helvetica', 'italic')
        doc.text(`IGST @${g.rate}%`, IC[1] + 2, ty + 5)
        doc.text('-', (IC[2] + IC[3]) / 2, ty + 5, { align: 'center' })
        doc.text('-', (IC[3] + IC[4]) / 2, ty + 5, { align: 'center' })
        doc.text('-', (IC[4] + IC[5]) / 2, ty + 5, { align: 'center' })
        doc.setFont('helvetica', 'normal')
        doc.text(fmtRs(g.igst), RE - 3, ty + 5, { align: 'right' })
        doc.line(ML, ty + ROW_H, RE, ty + ROW_H)
        ty += ROW_H
      } else {
        // CGST row
        doc.setFont('helvetica', 'italic')
        doc.text(`CGST @${g.rate / 2}%`, IC[1] + 2, ty + 5)
        doc.text('-', (IC[2] + IC[3]) / 2, ty + 5, { align: 'center' })
        doc.text('-', (IC[3] + IC[4]) / 2, ty + 5, { align: 'center' })
        doc.text('-', (IC[4] + IC[5]) / 2, ty + 5, { align: 'center' })
        doc.setFont('helvetica', 'normal')
        doc.text(fmtRs(g.cgst), RE - 3, ty + 5, { align: 'right' })
        doc.line(ML, ty + ROW_H, RE, ty + ROW_H)
        ty += ROW_H
        // SGST row
        doc.setFont('helvetica', 'italic')
        doc.text(`SGST @${g.rate / 2}%`, IC[1] + 2, ty + 5)
        doc.text('-', (IC[2] + IC[3]) / 2, ty + 5, { align: 'center' })
        doc.text('-', (IC[3] + IC[4]) / 2, ty + 5, { align: 'center' })
        doc.text('-', (IC[4] + IC[5]) / 2, ty + 5, { align: 'center' })
        doc.setFont('helvetica', 'normal')
        doc.text(fmtRs(g.sgst), RE - 3, ty + 5, { align: 'right' })
        doc.line(ML, ty + ROW_H, RE, ty + ROW_H)
        ty += ROW_H
      }
    })
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // TOTAL ROW
  // ══════════════════════════════════════════════════════════════════════════════
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.line(ML, TOTAL_TOP + TOTAL_ROW_H, RE, TOTAL_TOP + TOTAL_ROW_H)
  doc.text('TOTAL', (IC[1] + IC[2]) / 2, TOTAL_TOP + 5.5, { align: 'center' })
  const totalQty = invoice.items.reduce((s, i) => s + i.quantity, 0)
  doc.text(totalQty.toString(), (IC[3] + IC[4]) / 2, TOTAL_TOP + 5.5, { align: 'center' })
  doc.text(fmtRs(invoice.totalAmount), RE - 3, TOTAL_TOP + 5.5, { align: 'right' })

  // ══════════════════════════════════════════════════════════════════════════════
  // HSN / SAC SUMMARY TABLE
  // ══════════════════════════════════════════════════════════════════════════════
  doc.line(ML, HSN_TOP, RE, HSN_TOP) // top line (redundant with total bottom but ensures clarity)

  // HSN column positions
  let HC: number[]
  if (isInter) {
    // HSN(35) | TaxableValue(45) | IGSTRate(20) | IGSTAmt(40) | TotalTax(58)
    HC = [ML, ML + 35, ML + 80, ML + 100, ML + 140, RE]
  } else {
    // HSN(25) | TaxableVal(35) | CGSTRate(15) | CGSTAmt(25) | SGSTRate(15) | SGSTAmt(25) | TotalTax(58)
    HC = [ML, ML + 25, ML + 60, ML + 75, ML + 100, ML + 115, ML + 140, RE]
  }

  // HSN vertical lines
  const hsnBottom = HSN_TOP + HSN_H
  for (let i = 1; i < HC.length - 1; i++) {
    doc.line(HC[i], HSN_TOP, HC[i], hsnBottom)
  }

  // HSN header row 1
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'bold')
  const hsnHdr1Y = HSN_TOP + 5
  doc.text('HSN/SAC', (HC[0] + HC[1]) / 2, hsnHdr1Y, { align: 'center' })
  doc.text('Taxable Value', (HC[1] + HC[2]) / 2, hsnHdr1Y, { align: 'center' })

  if (isInter) {
    // "IGST" spanning 2 columns
    doc.text('IGST', (HC[2] + HC[4]) / 2, hsnHdr1Y, { align: 'center' })
    doc.text('Total Tax Amount', (HC[4] + HC[5]) / 2, hsnHdr1Y, { align: 'center' })
  } else {
    doc.text('CGST', (HC[2] + HC[4]) / 2, hsnHdr1Y, { align: 'center' })
    doc.text('SGST', (HC[4] + HC[6]) / 2, hsnHdr1Y, { align: 'center' })
    doc.text('Total Tax Amount', (HC[6] + HC[7]) / 2, hsnHdr1Y, { align: 'center' })
  }

  // HSN header divider line
  const hsnSubHdrY = HSN_TOP + ROW_H
  doc.line(ML, hsnSubHdrY, RE, hsnSubHdrY)

  // HSN sub-header row 2 (Rate | Amount under IGST/CGST/SGST)
  const hsnHdr2Y = hsnSubHdrY + 5
  doc.setFontSize(7)
  if (isInter) {
    doc.text('Rate', (HC[2] + HC[3]) / 2, hsnHdr2Y, { align: 'center' })
    doc.text('Amount', (HC[3] + HC[4]) / 2, hsnHdr2Y, { align: 'center' })
  } else {
    doc.text('Rate', (HC[2] + HC[3]) / 2, hsnHdr2Y, { align: 'center' })
    doc.text('Amount', (HC[3] + HC[4]) / 2, hsnHdr2Y, { align: 'center' })
    doc.text('Rate', (HC[4] + HC[5]) / 2, hsnHdr2Y, { align: 'center' })
    doc.text('Amount', (HC[5] + HC[6]) / 2, hsnHdr2Y, { align: 'center' })
  }

  const hsnDataStart = HSN_TOP + HSN_HDR_H
  doc.line(ML, hsnDataStart, RE, hsnDataStart)

  // HSN data rows
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  let totalTaxable = 0, totalIgstH = 0, totalCgstH = 0, totalSgstH = 0, totalTaxH = 0

  hsnGroups.forEach((g, idx) => {
    const ry = hsnDataStart + idx * ROW_H
    doc.line(ML, ry + ROW_H, RE, ry + ROW_H)
    const dty = ry + 5
    doc.text(g.hsn, (HC[0] + HC[1]) / 2, dty, { align: 'center' })
    doc.text(fmtNum(g.taxable), HC[2] - 3, dty, { align: 'right' })
    if (isInter) {
      doc.text(g.rate + '%', (HC[2] + HC[3]) / 2, dty, { align: 'center' })
      doc.text(fmtNum(g.igst), HC[4] - 3, dty, { align: 'right' })
      doc.text(fmtRs(g.totalTax), RE - 3, dty, { align: 'right' })
    } else {
      doc.text((g.rate / 2) + '%', (HC[2] + HC[3]) / 2, dty, { align: 'center' })
      doc.text(fmtNum(g.cgst), HC[4] - 3, dty, { align: 'right' })
      doc.text((g.rate / 2) + '%', (HC[4] + HC[5]) / 2, dty, { align: 'center' })
      doc.text(fmtNum(g.sgst), HC[6] - 3, dty, { align: 'right' })
      doc.text(fmtRs(g.totalTax), RE - 3, dty, { align: 'right' })
    }
    totalTaxable += g.taxable
    totalIgstH += g.igst
    totalCgstH += g.cgst
    totalSgstH += g.sgst
    totalTaxH += g.totalTax
  })

  // HSN Total row
  const hsnTotalY = hsnDataStart + hsnDataRows * ROW_H
  doc.line(ML, hsnTotalY + ROW_H, RE, hsnTotalY + ROW_H)
  doc.setFont('helvetica', 'bold')
  const hty = hsnTotalY + 5
  doc.text('Total', (HC[0] + HC[1]) / 2, hty, { align: 'center' })
  doc.text(fmtNum(totalTaxable), HC[2] - 3, hty, { align: 'right' })
  if (isInter) {
    doc.text(fmtNum(totalIgstH), HC[4] - 3, hty, { align: 'right' })
    doc.text(fmtRs(totalTaxH), RE - 3, hty, { align: 'right' })
  } else {
    doc.text(fmtNum(totalCgstH), HC[4] - 3, hty, { align: 'right' })
    doc.text(fmtNum(totalSgstH), HC[6] - 3, hty, { align: 'right' })
    doc.text(fmtRs(totalTaxH), RE - 3, hty, { align: 'right' })
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // AMOUNT IN WORDS
  // ══════════════════════════════════════════════════════════════════════════════
  doc.line(ML, WORDS_TOP, RE, WORDS_TOP)
  doc.line(ML, FOOTER_TOP, RE, FOOTER_TOP)

  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'bold')
  doc.text('Total Amount (in words)', ML + 3, WORDS_TOP + 5)
  doc.setFont('helvetica', 'normal')
  const words = numberToWords(invoice.totalAmount)
  const wordLines = doc.splitTextToSize(words, CW - 6)
  doc.text(wordLines, ML + 3, WORDS_TOP + 10)

  // ══════════════════════════════════════════════════════════════════════════════
  // FOOTER: Bank Details | Terms & Conditions | Authorised Signatory
  // ══════════════════════════════════════════════════════════════════════════════
  const footCol1 = ML
  const footCol2 = ML + 66
  const footCol3 = ML + 132

  doc.line(footCol2, FOOTER_TOP, footCol2, BORDER_BOTTOM)
  doc.line(footCol3, FOOTER_TOP, footCol3, BORDER_BOTTOM)

  // Bank Details
  let fy = FOOTER_TOP + 5
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('Bank Details', footCol1 + 3, fy)
  fy += 4.5
  doc.setFontSize(7)
  doc.setFont('helvetica', 'normal')
  if (invoice.company?.bankDetails) {
    const bankLines = doc.splitTextToSize(invoice.company.bankDetails, 58)
    doc.text(bankLines, footCol1 + 3, fy)
  }

  // Terms and Conditions
  fy = FOOTER_TOP + 5
  doc.setFontSize(8)
  doc.setFont('helvetica', 'bold')
  doc.text('Terms and Conditions', footCol2 + 3, fy)
  fy += 4.5
  doc.setFontSize(6.5)
  doc.setFont('helvetica', 'normal')
  if (invoice.company?.termsConditions) {
    const termLines = doc.splitTextToSize(invoice.company.termsConditions, 62)
    doc.text(termLines.slice(0, 10), footCol2 + 3, fy)
  }

  // Authorised Signatory with logo stamp
  const sigCenterX = (footCol3 + RE) / 2
  drawLogo(doc, sigCenterX - 6, FOOTER_TOP + 5, 12, 12)
  doc.setFontSize(7.5)
  doc.setFont('helvetica', 'normal')
  doc.text('Authorised Signatory For', sigCenterX, BORDER_BOTTOM - 10, { align: 'center' })
  doc.setFont('helvetica', 'bold')
  doc.text((invoice.company?.name || '').toUpperCase(), sigCenterX, BORDER_BOTTOM - 5.5, { align: 'center' })
}

// ─── Non-classic templates (simplified, with fixed currency) ───────────────────

function generateModernTemplate(doc: jsPDF, invoice: InvoiceData) {
  const purple: [number, number, number] = [124, 58, 237]
  const dark: [number, number, number] = [30, 30, 46]
  const cardBg: [number, number, number] = [248, 249, 252]
  const ML = 15, RE = 195

  doc.setFillColor(...purple)
  doc.rect(0, 0, 210, 55, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(22)
  doc.setFont('helvetica', 'bold')
  doc.text(doc.splitTextToSize(invoice.company?.name || 'Company', 115)[0], ML + 5, 22)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  let hy = 30
  if (invoice.company?.address) { doc.text(doc.splitTextToSize(invoice.company.address, 110)[0], ML + 5, hy); hy += 5 }
  if (invoice.company?.phone) { doc.text(invoice.company.phone, ML + 5, hy); hy += 5 }
  if (invoice.company?.email) { doc.text(invoice.company.email, ML + 5, hy); hy += 5 }
  if (invoice.company?.taxId) doc.text('GSTIN: ' + invoice.company.taxId, ML + 5, hy)

  doc.setFillColor(255, 255, 255)
  doc.roundedRect(148, 12, 50, 30, 3, 3, 'F')
  doc.setTextColor(...purple)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text(invoice.type === 'QUOTATION' ? 'QUOTATION' : 'INVOICE', 173, 24, { align: 'center' })
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.text(invoice.invoiceNumber, 173, 32, { align: 'center' })
  doc.setFontSize(7)
  doc.text(formatDate(invoice.invoiceDate), 173, 38, { align: 'center' })

  let yPos = 65
  const halfW = 82
  doc.setFillColor(...cardBg)
  doc.roundedRect(ML, yPos, halfW, 36, 2, 2, 'F')
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...purple)
  doc.text('INVOICE DETAILS', ML + 6, yPos + 8)
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(...dark)
  doc.text('Date: ' + formatDate(invoice.invoiceDate), ML + 6, yPos + 16)
  doc.text('Status: ' + invoice.status, ML + 6, yPos + 23)
  if (invoice.company?.taxId) doc.text('GSTIN: ' + invoice.company.taxId, ML + 6, yPos + 30)

  const rx = ML + halfW + 8
  doc.setFillColor(...cardBg)
  doc.roundedRect(rx, yPos, halfW, 36, 2, 2, 'F')
  doc.setFontSize(7)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...purple)
  doc.text('BILL TO', rx + 6, yPos + 8)
  doc.setFontSize(9)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...dark)
  doc.text(doc.splitTextToSize(invoice.party.name, halfW - 12)[0], rx + 6, yPos + 16)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  let ccy = yPos + 22
  if (invoice.party.phone) { doc.text(invoice.party.phone, rx + 6, ccy); ccy += 4 }
  if (invoice.party.email) doc.text(invoice.party.email, rx + 6, ccy)

  yPos += 48
  const tData = invoice.items.map((it, i) => [(i + 1).toString(), it.item.name, it.quantity.toString(), fmtAmt(it.rate, invoice), fmtAmt(it.total, invoice)])
  autoTable(doc, {
    startY: yPos, head: [['#', 'Description', 'Qty', 'Rate', 'Amount']], body: tData,
    margin: { left: ML, right: 15 }, theme: 'plain',
    headStyles: { fillColor: purple, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, cellPadding: 4 },
    bodyStyles: { fontSize: 8, cellPadding: 4, textColor: dark },
    alternateRowStyles: { fillColor: cardBg },
    columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 2: { cellWidth: 16, halign: 'center' }, 3: { cellWidth: 28, halign: 'right' }, 4: { cellWidth: 32, halign: 'right' } },
  })
  yPos = (doc as any).lastAutoTable.finalY + 12

  doc.setFillColor(...purple)
  const boxH = 42 + (invoice.discount > 0 ? 8 : 0) + (invoice.amountPaid > 0 ? 8 : 0)
  doc.roundedRect(115, yPos, RE - 115, boxH, 3, 3, 'F')
  let ssy = yPos + 8
  doc.setTextColor(220, 220, 255); doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  doc.text('Subtotal:', 120, ssy); doc.setTextColor(255, 255, 255); doc.text(fmtAmt(invoice.subtotal, invoice), RE - 5, ssy, { align: 'right' }); ssy += 8
  if (invoice.discount > 0) { doc.setTextColor(220, 220, 255); doc.text('Discount:', 120, ssy); doc.setTextColor(255, 255, 255); doc.text('- ' + fmtAmt(invoice.discount, invoice), RE - 5, ssy, { align: 'right' }); ssy += 8 }
  doc.setTextColor(220, 220, 255); doc.text('Tax:', 120, ssy); doc.setTextColor(255, 255, 255); doc.text(fmtAmt(invoice.taxAmount, invoice), RE - 5, ssy, { align: 'right' }); ssy += 4
  doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.3); doc.line(120, ssy, RE - 5, ssy); ssy += 7
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text('TOTAL:', 120, ssy); doc.text(fmtAmt(invoice.totalAmount, invoice), RE - 5, ssy, { align: 'right' }); ssy += 10
  if (invoice.amountPaid > 0) { doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(220, 220, 255); doc.text('Paid:', 120, ssy); doc.setTextColor(255, 255, 255); doc.text('- ' + fmtAmt(invoice.amountPaid, invoice), RE - 5, ssy, { align: 'right' }) }

  const pH = doc.internal.pageSize.height
  doc.setFillColor(139, 92, 246); doc.rect(0, pH - 16, 210, 16, 'F')
  doc.setTextColor(255, 255, 255); doc.setFontSize(8); doc.setFont('helvetica', 'bold')
  doc.text('Thank you for your business!', 105, pH - 6, { align: 'center' })
}

function generateMinimalTemplate(doc: jsPDF, invoice: InvoiceData) {
  const black: [number, number, number] = [33, 33, 33]
  const gray: [number, number, number] = [130, 130, 130]
  const ML = 15, RE = 195

  let y = 25
  doc.setTextColor(...black); doc.setFontSize(28); doc.setFont('helvetica', 'bold')
  doc.text(invoice.type === 'QUOTATION' ? 'Quotation' : 'Invoice', ML, y)
  doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray)
  doc.text(invoice.invoiceNumber, RE, y - 8, { align: 'right' })
  doc.text(formatDate(invoice.invoiceDate), RE, y - 1, { align: 'right' })
  y += 18
  doc.setDrawColor(220, 220, 220); doc.setLineWidth(0.5); doc.line(ML, y, RE, y)
  y += 14
  doc.setTextColor(...gray); doc.setFontSize(7); doc.setFont('helvetica', 'bold')
  doc.text('FROM', ML, y); doc.text('TO', 115, y); y += 6
  doc.setTextColor(...black); doc.setFontSize(10); doc.setFont('helvetica', 'bold')
  doc.text(doc.splitTextToSize(invoice.company?.name || 'Company', 85)[0], ML, y)
  doc.text(doc.splitTextToSize(invoice.party.name, 75)[0], 115, y); y += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  let fy = y, ty2 = y
  if (invoice.company?.address) { doc.text(doc.splitTextToSize(invoice.company.address, 85)[0], ML, fy); fy += 4 }
  if (invoice.company?.phone) { doc.text(invoice.company.phone, ML, fy); fy += 4 }
  if (invoice.company?.email) { doc.text(invoice.company.email, ML, fy); fy += 4 }
  if (invoice.party.billingAddress) { doc.text(doc.splitTextToSize(invoice.party.billingAddress, 75)[0], 115, ty2); ty2 += 4 }
  if (invoice.party.phone) { doc.text(invoice.party.phone, 115, ty2); ty2 += 4 }
  if (invoice.party.email) doc.text(invoice.party.email, 115, ty2)
  y = Math.max(fy, ty2) + 12

  const tData = invoice.items.map((it, i) => [(i + 1).toString(), it.item.name, it.quantity.toString(), fmtAmt(it.rate, invoice), fmtAmt(it.total, invoice)])
  autoTable(doc, {
    startY: y, head: [['#', 'Description', 'Qty', 'Rate', 'Amount']], body: tData,
    margin: { left: ML, right: 15 }, theme: 'plain',
    headStyles: { fillColor: [255, 255, 255], textColor: gray, fontStyle: 'bold', fontSize: 7, cellPadding: { top: 4, bottom: 4, left: 3, right: 3 } },
    bodyStyles: { fontSize: 9, cellPadding: 5, textColor: black },
    columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 2: { cellWidth: 18, halign: 'center' }, 3: { cellWidth: 30, halign: 'right' }, 4: { cellWidth: 32, halign: 'right' } },
  })
  y = (doc as any).lastAutoTable.finalY + 16
  const valX = RE, lblX = 140
  doc.setFontSize(9); doc.setFont('helvetica', 'normal')
  doc.setTextColor(...gray); doc.text('Subtotal', lblX, y); doc.setTextColor(...black); doc.text(fmtAmt(invoice.subtotal, invoice), valX, y, { align: 'right' }); y += 7
  if (invoice.discount > 0) { doc.setTextColor(...gray); doc.text('Discount', lblX, y); doc.setTextColor(...black); doc.text('- ' + fmtAmt(invoice.discount, invoice), valX, y, { align: 'right' }); y += 7 }
  doc.setTextColor(...gray); doc.text('Tax', lblX, y); doc.setTextColor(...black); doc.text(fmtAmt(invoice.taxAmount, invoice), valX, y, { align: 'right' }); y += 5
  doc.setDrawColor(220, 220, 220); doc.line(lblX, y, valX, y); y += 7
  doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text('Total', lblX, y); doc.text(fmtAmt(invoice.totalAmount, invoice), valX, y, { align: 'right' })
}

function generateElegantTemplate(doc: jsPDF, invoice: InvoiceData) {
  const gold: [number, number, number] = [180, 145, 50]
  const navy: [number, number, number] = [26, 42, 58]
  const ML = 15, RE = 195

  doc.setDrawColor(...gold); doc.setLineWidth(1.5); doc.rect(10, 10, 190, 45)
  doc.setLineWidth(0.3); doc.rect(12, 12, 186, 41)
  doc.setTextColor(...navy); doc.setFontSize(20); doc.setFont('helvetica', 'bold')
  doc.text(doc.splitTextToSize(invoice.company?.name || 'Company', 150)[0], 105, 28, { align: 'center' })
  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  const cLine = [invoice.company?.address, invoice.company?.phone, invoice.company?.email].filter(Boolean).join(' . ')
  if (cLine) doc.text(doc.splitTextToSize(cLine, 170)[0], 105, 36, { align: 'center' })
  if (invoice.company?.taxId) doc.text('GSTIN: ' + invoice.company.taxId, 105, 42, { align: 'center' })
  doc.setFillColor(...gold)
  const lb = invoice.type === 'QUOTATION' ? 'QUOTATION' : 'TAX INVOICE'
  const lbW = doc.getTextWidth(lb) + 20
  doc.rect((210 - lbW) / 2, 48, lbW, 8, 'F')
  doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont('helvetica', 'bold')
  doc.text(lb, 105, 54, { align: 'center' })

  let y = 70
  doc.setDrawColor(...gold); doc.setLineWidth(0.5); doc.line(ML, y, 55, y); doc.line(155, y, RE, y); y += 12
  doc.setTextColor(...navy); doc.setFontSize(9)
  doc.setFont('helvetica', 'bold'); doc.text('Invoice No:', ML, y); doc.setFont('helvetica', 'normal'); doc.text(invoice.invoiceNumber, ML + 25, y)
  doc.setFont('helvetica', 'bold'); doc.text('Date:', ML, y + 7); doc.setFont('helvetica', 'normal'); doc.text(formatDate(invoice.invoiceDate), ML + 25, y + 7)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text('BILL TO', 120, y - 3)
  doc.setFontSize(10); doc.text(doc.splitTextToSize(invoice.party.name, 70)[0], 120, y + 4)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  if (invoice.party.phone) doc.text(invoice.party.phone, 120, y + 10)
  y += 28

  const tData = invoice.items.map((it, i) => [(i + 1).toString(), it.item.name, it.quantity.toString(), fmtAmt(it.rate, invoice), fmtAmt(it.total, invoice)])
  autoTable(doc, {
    startY: y, head: [['#', 'Description', 'Quantity', 'Rate', 'Amount']], body: tData,
    margin: { left: ML, right: 15 }, theme: 'grid',
    headStyles: { fillColor: navy, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8, cellPadding: 4 },
    bodyStyles: { fontSize: 8, cellPadding: 4, textColor: navy },
    columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 20, halign: 'center' }, 3: { cellWidth: 28, halign: 'right' }, 4: { cellWidth: 32, halign: 'right' } },
  })
  y = (doc as any).lastAutoTable.finalY + 12

  doc.setDrawColor(...gold); doc.setLineWidth(1); doc.rect(120, y, 75, 35)
  doc.setTextColor(...navy); doc.setFontSize(9)
  doc.text('Subtotal:', 125, y + 10); doc.text(fmtAmt(invoice.subtotal, invoice), 190, y + 10, { align: 'right' })
  doc.text('Tax:', 125, y + 18); doc.text(fmtAmt(invoice.taxAmount, invoice), 190, y + 18, { align: 'right' })
  doc.setFillColor(...gold); doc.rect(120, y + 23, 75, 12, 'F')
  doc.setTextColor(255, 255, 255); doc.setFontSize(11); doc.setFont('helvetica', 'bold')
  doc.text('TOTAL:', 125, y + 31); doc.text(fmtAmt(invoice.totalAmount, invoice), 190, y + 31, { align: 'right' })

  const pH = doc.internal.pageSize.height
  doc.setDrawColor(...gold); doc.setLineWidth(0.5); doc.line(ML, pH - 22, RE, pH - 22)
  doc.setTextColor(139, 115, 36); doc.setFontSize(9); doc.setFont('helvetica', 'italic')
  doc.text('Thank you for your valued business', 105, pH - 14, { align: 'center' })
}

function generateBoldTemplate(doc: jsPDF, invoice: InvoiceData) {
  const black: [number, number, number] = [17, 17, 17]
  const accent: [number, number, number] = [0, 184, 212]
  const white: [number, number, number] = [255, 255, 255]
  const offW: [number, number, number] = [245, 245, 247]
  const ML = 15, RE = 195

  doc.setFillColor(...black); doc.rect(0, 0, 210, 62, 'F')
  doc.setFillColor(...accent); doc.rect(0, 58, 210, 4, 'F')
  doc.setTextColor(...white); doc.setFontSize(30); doc.setFont('helvetica', 'bold')
  doc.text(invoice.type === 'QUOTATION' ? 'QUOTE' : 'INVOICE', ML + 5, 28)
  doc.setFontSize(10); doc.setFont('helvetica', 'normal')
  doc.text('# ' + invoice.invoiceNumber, ML + 5, 38)
  doc.text(formatDate(invoice.invoiceDate), ML + 5, 47)
  doc.setFontSize(12); doc.setFont('helvetica', 'bold')
  doc.text(doc.splitTextToSize(invoice.company?.name || 'Company', 80)[0], RE - 5, 20, { align: 'right' })
  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  let hhy = 28
  if (invoice.company?.address) { doc.text(doc.splitTextToSize(invoice.company.address, 80)[0], RE - 5, hhy, { align: 'right' }); hhy += 5 }
  if (invoice.company?.phone) { doc.text(invoice.company.phone, RE - 5, hhy, { align: 'right' }); hhy += 5 }
  if (invoice.company?.email) doc.text(invoice.company.email, RE - 5, hhy, { align: 'right' })

  let y = 74
  doc.setFillColor(...offW); doc.rect(ML, y, 180, 28, 'F')
  doc.setFontSize(7); doc.setTextColor(...accent); doc.setFont('helvetica', 'bold'); doc.text('BILL TO', ML + 6, y + 7)
  doc.setTextColor(...black); doc.setFontSize(11); doc.text(doc.splitTextToSize(invoice.party.name, 80)[0], ML + 6, y + 15)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  if (invoice.party.phone) doc.text(invoice.party.phone, ML + 6, y + 22)
  y += 38

  const tData = invoice.items.map((it, i) => [(i + 1).toString(), it.item.name, it.quantity.toString(), fmtAmt(it.rate, invoice), fmtAmt(it.total, invoice)])
  autoTable(doc, {
    startY: y, head: [['#', 'ITEM', 'QTY', 'RATE', 'TOTAL']], body: tData,
    margin: { left: ML, right: 15 }, theme: 'plain',
    headStyles: { fillColor: black, textColor: white, fontStyle: 'bold', fontSize: 8, cellPadding: 4 },
    bodyStyles: { fontSize: 8, cellPadding: 4, textColor: black },
    alternateRowStyles: { fillColor: offW },
    columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 2: { cellWidth: 16, halign: 'center' }, 3: { cellWidth: 28, halign: 'right' }, 4: { cellWidth: 32, halign: 'right' } },
  })
  y = (doc as any).lastAutoTable.finalY + 12

  const sX = 115, sW = RE - sX
  const mH = 30 + (invoice.discount > 0 ? 8 : 0) + (invoice.amountPaid > 0 ? 8 : 0)
  doc.setFillColor(...black); doc.roundedRect(sX, y, sW, mH, 2, 2, 'F')
  let ssy = y + 8
  doc.setTextColor(180, 180, 180); doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  doc.text('Subtotal', sX + 5, ssy); doc.setTextColor(...white); doc.text(fmtAmt(invoice.subtotal, invoice), RE - 5, ssy, { align: 'right' }); ssy += 8
  if (invoice.discount > 0) { doc.setTextColor(180, 180, 180); doc.text('Discount', sX + 5, ssy); doc.setTextColor(...white); doc.text('- ' + fmtAmt(invoice.discount, invoice), RE - 5, ssy, { align: 'right' }); ssy += 8 }
  doc.setTextColor(180, 180, 180); doc.text('Tax', sX + 5, ssy); doc.setTextColor(...white); doc.text(fmtAmt(invoice.taxAmount, invoice), RE - 5, ssy, { align: 'right' })

  doc.setFillColor(...accent); doc.roundedRect(sX, y + mH, sW, 16, 2, 2, 'F')
  doc.setTextColor(...black); doc.setFontSize(12); doc.setFont('helvetica', 'bold')
  doc.text('TOTAL', sX + 5, y + mH + 11); doc.text(fmtAmt(invoice.totalAmount, invoice), RE - 5, y + mH + 11, { align: 'right' })
}

// ─── Main exports ──────────────────────────────────────────────────────────────

export function generateInvoicePDF(invoice: InvoiceData, template: InvoiceTemplate = 'classic') {
  if (!invoice.items) invoice.items = []
  const doc = new jsPDF()

  switch (template) {
    case 'modern': generateModernTemplate(doc, invoice); break
    case 'minimal': generateMinimalTemplate(doc, invoice); break
    case 'elegant': generateElegantTemplate(doc, invoice); break
    case 'bold': generateBoldTemplate(doc, invoice); break
    case 'classic': default: generateClassicTemplate(doc, invoice)
  }

  return doc
}

export function downloadInvoicePDF(invoice: InvoiceData, template: InvoiceTemplate = 'classic') {
  const doc = generateInvoicePDF(invoice, template)
  const filename = `${invoice.invoiceNumber}_${invoice.party.name.replace(/[^a-z0-9]/gi, '_')}.pdf`
  doc.save(filename)
}

export function previewInvoicePDF(invoice: InvoiceData, template: InvoiceTemplate = 'classic') {
  const doc = generateInvoicePDF(invoice, template)
  const pdfBlob = doc.output('blob')
  const pdfUrl = URL.createObjectURL(pdfBlob)
  window.open(pdfUrl, '_blank')
}
