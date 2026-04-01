/**
 * Regenerate ALL sales invoice PDFs from the database
 * with the new GST format including bank details & terms and conditions.
 *
 * Usage:  node scripts/regenerate-pdfs.mjs
 */

import { PrismaClient } from '@prisma/client'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(process.env.APPDATA || '', 'neu-invoicing', 'neuinvoicing.db')
const OUTPUT_DIR = path.join(__dirname, '..', 'invoices database')

if (!fs.existsSync(DB_PATH)) {
  console.error('Database not found at:', DB_PATH)
  process.exit(1)
}

const prisma = new PrismaClient({
  datasources: { db: { url: `file:${DB_PATH}` } }
})

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtNum(amount) {
  const abs = Math.abs(amount)
  const integer = Math.floor(abs)
  const decimal = Math.round((abs - integer) * 100)
  const intStr = integer.toString()
  let result
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

function fmtRs(amount) { return 'Rs. ' + fmtNum(amount) }

function formatDate(dateInput) {
  const d = new Date(dateInput)
  if (isNaN(d.getTime())) return String(dateInput)
  return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`
}

function extractPAN(gstin) {
  if (!gstin || gstin.length < 12) return ''
  return gstin.substring(2, 12)
}

function numberToWords(num) {
  if (num === 0) return 'Zero Rupees Only'
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
  function twoD(n) { if (n === 0) return ''; if (n < 20) return ones[n]; return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '') }
  function threeD(n) { if (n === 0) return ''; if (n >= 100) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + twoD(n % 100) : ''); return twoD(n) }
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

function getTaxGroups(invoice) {
  const isInter = invoice.isInterState !== false
  const map = {}
  for (const it of invoice.items) {
    const rate = it.taxRate || 0
    if (rate === 0) continue
    if (!map[rate]) map[rate] = { rate, taxable: 0, igst: 0, cgst: 0, sgst: 0 }
    const taxable = it.taxableAmount ?? (it.rate * it.quantity)
    map[rate].taxable += taxable
    if (isInter) { map[rate].igst += it.igstAmount ?? (taxable * rate / 100) }
    else { map[rate].cgst += it.cgstAmount ?? (taxable * rate / 200); map[rate].sgst += it.sgstAmount ?? (taxable * rate / 200) }
  }
  return Object.values(map)
}

function getHSNGroups(invoice) {
  const isInter = invoice.isInterState !== false
  const map = {}
  for (const it of invoice.items) {
    const hsn = it.hsnCode || it.item?.hsnCode || ''
    if (!hsn) continue
    const taxable = it.taxableAmount ?? (it.rate * it.quantity)
    const rate = it.taxRate || 0
    if (!map[hsn]) map[hsn] = { hsn, taxable: 0, rate, igst: 0, cgst: 0, sgst: 0, totalTax: 0 }
    map[hsn].taxable += taxable
    const ig = isInter ? (it.igstAmount ?? (taxable * rate / 100)) : 0
    const cg = !isInter ? (it.cgstAmount ?? (taxable * rate / 200)) : 0
    const sg = !isInter ? (it.sgstAmount ?? (taxable * rate / 200)) : 0
    map[hsn].igst += ig; map[hsn].cgst += cg; map[hsn].sgst += sg; map[hsn].totalTax += ig + cg + sg
  }
  return Object.values(map)
}

/** Company logo as embedded PNG base64 */
const LOGO_BASE64 = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'COMPANY LOGO.png')).toString('base64')

function drawLogo(doc, x, y, width, height) {
  doc.addImage(LOGO_BASE64, 'PNG', x, y, width, height)
}

// ─── PDF Generation (mirrors generateClassicTemplate from the app) ─────────────

function generateInvoicePDF(invoice) {
  const doc = new jsPDF()
  const ML = 6, RE = 204, CW = 198, ROW_H = 7

  const BORDER_TOP = 13, COMPANY_BOTTOM = 47, BILLSHIP_BOTTOM = 87
  const ITEMS_HDR_H = 8
  const ITEMS_HDR_BOTTOM = BILLSHIP_BOTTOM + ITEMS_HDR_H

  const isInter = invoice.isInterState !== false
  const taxGroups = getTaxGroups(invoice)
  const hsnGroups = getHSNGroups(invoice)
  const taxRowCount = isInter ? Math.max(taxGroups.length, 1) : Math.max(taxGroups.length * 2, 1)

  const FOOTER_H = 36, WORDS_H = 12
  const HSN_HDR_H = 14
  const hsnDataRows = Math.max(hsnGroups.length, 1)
  const HSN_H = HSN_HDR_H + hsnDataRows * ROW_H + ROW_H
  const TOTAL_ROW_H = 8

  const BORDER_BOTTOM = 290
  const FOOTER_TOP = BORDER_BOTTOM - FOOTER_H
  const WORDS_TOP = FOOTER_TOP - WORDS_H
  const HSN_TOP = WORDS_TOP - HSN_H
  const TOTAL_TOP = HSN_TOP - TOTAL_ROW_H
  const TAX_TOP = TOTAL_TOP - taxRowCount * ROW_H

  const ITEMS_AREA_H = TAX_TOP - ITEMS_HDR_BOTTOM
  const maxItemRows = Math.floor(ITEMS_AREA_H / ROW_H)

  const IC = [ML, ML + 14, ML + 82, ML + 106, ML + 134, ML + 164, RE]

  doc.setDrawColor(0, 0, 0)
  doc.setTextColor(33, 33, 33)
  doc.setLineWidth(0.3)

  // TITLE
  const titleLabel = invoice.type === 'QUOTATION' ? 'QUOTATION' : 'TAX INVOICE'
  doc.setFontSize(10); doc.setFont('helvetica', 'bold')
  doc.text(titleLabel, ML, 9)
  doc.setFontSize(7); doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const titleW = doc.getTextWidth(titleLabel)
  doc.setFontSize(7)
  const badgeText = 'ORIGINAL FOR RECIPIENT'
  const bx = ML + titleW + 8
  const badgeW = doc.getTextWidth(badgeText) + 6
  doc.rect(bx, 4, badgeW, 7)
  doc.text(badgeText, bx + 3, 9)

  // OUTER BORDER
  doc.setLineWidth(0.4); doc.rect(ML, BORDER_TOP, CW, BORDER_BOTTOM - BORDER_TOP); doc.setLineWidth(0.3)

  // COMPANY SECTION
  doc.line(ML, COMPANY_BOTTOM, RE, COMPANY_BOTTOM)
  const INV_X = 142
  doc.line(INV_X, BORDER_TOP, INV_X, COMPANY_BOTTOM)
  const INV_MID = (INV_X + RE) / 2
  doc.line(INV_MID, BORDER_TOP, INV_MID, COMPANY_BOTTOM)
  const INV_LABEL_BOTTOM = BORDER_TOP + 8
  doc.line(INV_X, INV_LABEL_BOTTOM, RE, INV_LABEL_BOTTOM)

  doc.setFontSize(8); doc.setFont('helvetica', 'bold')
  doc.text('Invoice No.', INV_X + 3, BORDER_TOP + 5.5)
  doc.text('Invoice Date', INV_MID + 3, BORDER_TOP + 5.5)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  doc.text(invoice.invoiceNumber, INV_X + 3, INV_LABEL_BOTTOM + 7)
  doc.text(formatDate(invoice.invoiceDate), INV_MID + 3, INV_LABEL_BOTTOM + 7)

  // Company logo
  const LOGO_SIZE = 14
  drawLogo(doc, ML + 2, BORDER_TOP + 2, LOGO_SIZE, LOGO_SIZE)

  const compTextX = ML + LOGO_SIZE + 5
  const compMaxW = INV_X - compTextX - 2
  let cy = BORDER_TOP + 8
  doc.setFontSize(13); doc.setFont('helvetica', 'bold')
  const compName = (invoice.company?.name || 'Company').toUpperCase()
  doc.text(doc.splitTextToSize(compName, compMaxW)[0], compTextX, cy); cy += 5
  doc.setFontSize(7); doc.setFont('helvetica', 'normal')
  if (invoice.company?.address) { const l = doc.splitTextToSize(invoice.company.address.toUpperCase(), compMaxW); doc.text(l, compTextX, cy); cy += l.length * 3.2 }
  if (invoice.company?.taxId) { doc.setFont('helvetica', 'bold'); doc.text('GSTIN: ', compTextX, cy); doc.setFont('helvetica', 'normal'); doc.text(invoice.company.taxId, compTextX + doc.getTextWidth('GSTIN: '), cy); cy += 3.5 }
  if (invoice.company?.email) { doc.setFont('helvetica', 'bold'); doc.text('Email: ', compTextX, cy); doc.setFont('helvetica', 'normal'); doc.text(invoice.company.email, compTextX + doc.getTextWidth('Email: '), cy) }

  // BILL TO / SHIP TO
  doc.line(ML, BILLSHIP_BOTTOM, RE, BILLSHIP_BOTTOM)
  const MID = ML + CW / 2
  doc.line(MID, COMPANY_BOTTOM, MID, BILLSHIP_BOTTOM)

  let by = COMPANY_BOTTOM + 5
  const billMaxW = MID - ML - 6
  doc.setFontSize(8); doc.setFont('helvetica', 'bold')
  doc.text('BILL TO', ML + 3, by); by += 4.5
  doc.setFontSize(9)
  doc.text(doc.splitTextToSize(invoice.party.name, billMaxW)[0], ML + 3, by); by += 5
  doc.setFontSize(7); doc.setFont('helvetica', 'normal')
  if (invoice.party.billingAddress) {
    const lbl = 'Address: '; doc.text(lbl, ML + 3, by)
    const lblW = doc.getTextWidth(lbl)
    const lines = doc.splitTextToSize(invoice.party.billingAddress, billMaxW - lblW)
    lines.forEach((line, i) => { doc.text(line, ML + 3 + lblW, by + i * 3.2) })
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
      } else { by += 3.5; doc.text('Place of Supply:  ' + invoice.placeOfSupplyName, ML + 3, by) }
    }
    by += 3.5
  }
  const pan = extractPAN(invoice.party.taxId)
  if (pan) { doc.setFont('helvetica', 'bold'); doc.text('PAN Number: ' + pan, ML + 3, by); doc.setFont('helvetica', 'normal') }

  let sy = COMPANY_BOTTOM + 5
  const shipMaxW = RE - MID - 6
  doc.setFontSize(8); doc.setFont('helvetica', 'bold')
  doc.text('SHIP TO', MID + 3, sy); sy += 4.5
  doc.setFontSize(9)
  doc.text(doc.splitTextToSize(invoice.party.name, shipMaxW)[0], MID + 3, sy); sy += 5
  doc.setFontSize(7); doc.setFont('helvetica', 'normal')
  const shipAddr = invoice.party.shippingAddress || invoice.party.billingAddress
  if (shipAddr) {
    const lbl = 'Address: '; doc.text(lbl, MID + 3, sy)
    const lblW = doc.getTextWidth(lbl)
    const lines = doc.splitTextToSize(shipAddr, shipMaxW - lblW)
    lines.forEach((line, i) => { doc.text(line, MID + 3 + lblW, sy + i * 3.2) })
  }

  // ITEMS TABLE HEADER
  doc.setFillColor(230, 230, 230)
  doc.rect(ML, BILLSHIP_BOTTOM, CW, ITEMS_HDR_H, 'F')
  doc.line(ML, ITEMS_HDR_BOTTOM, RE, ITEMS_HDR_BOTTOM)

  const hdrs = ['S.NO.', 'ITEMS', 'HSN', 'QTY.', 'RATE', 'AMOUNT']
  doc.setFontSize(8); doc.setFont('helvetica', 'bold')
  hdrs.forEach((h, i) => { doc.text(h, (IC[i] + IC[i + 1]) / 2, BILLSHIP_BOTTOM + 5.5, { align: 'center' }) })

  // Vertical column lines
  const tableBottom = TOTAL_TOP + TOTAL_ROW_H
  for (let i = 1; i < IC.length - 1; i++) { doc.line(IC[i], BILLSHIP_BOTTOM, IC[i], tableBottom) }

  // ITEM ROWS
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  const displayItems = invoice.items.slice(0, maxItemRows)
  for (let row = 0; row < maxItemRows; row++) {
    const ry = ITEMS_HDR_BOTTOM + row * ROW_H
    doc.line(ML, ry + ROW_H, RE, ry + ROW_H)
    if (row < displayItems.length) {
      const it = displayItems[row]
      const tty = ry + 5
      doc.text((row + 1).toString(), (IC[0] + IC[1]) / 2, tty, { align: 'center' })
      doc.text(doc.splitTextToSize(it.item.name, IC[2] - IC[1] - 4)[0], IC[1] + 2, tty)
      const hsn = it.hsnCode || it.item.hsnCode || ''
      doc.text(hsn, (IC[2] + IC[3]) / 2, tty, { align: 'center' })
      doc.text(`${it.quantity} ${it.item.unit || 'PCS'}`, (IC[3] + IC[4]) / 2, tty, { align: 'center' })
      doc.text(fmtNum(it.rate), IC[5] - 2, tty, { align: 'right' })
      const taxable = it.taxableAmount ?? (it.rate * it.quantity)
      doc.text(fmtNum(taxable), RE - 3, tty, { align: 'right' })
    }
  }

  // TAX ROWS
  let tty = TAX_TOP
  doc.setFontSize(7.5)
  if (taxGroups.length === 0) {
    doc.line(ML, tty + ROW_H, RE, tty + ROW_H); tty += ROW_H
  } else {
    taxGroups.forEach(g => {
      if (isInter) {
        doc.setFont('helvetica', 'italic')
        doc.text(`IGST @${g.rate}%`, IC[1] + 2, tty + 5)
        doc.text('-', (IC[2] + IC[3]) / 2, tty + 5, { align: 'center' })
        doc.text('-', (IC[3] + IC[4]) / 2, tty + 5, { align: 'center' })
        doc.text('-', (IC[4] + IC[5]) / 2, tty + 5, { align: 'center' })
        doc.setFont('helvetica', 'normal')
        doc.text(fmtRs(g.igst), RE - 3, tty + 5, { align: 'right' })
        doc.line(ML, tty + ROW_H, RE, tty + ROW_H); tty += ROW_H
      } else {
        doc.setFont('helvetica', 'italic')
        doc.text(`CGST @${g.rate / 2}%`, IC[1] + 2, tty + 5)
        doc.text('-', (IC[2] + IC[3]) / 2, tty + 5, { align: 'center' }); doc.text('-', (IC[3] + IC[4]) / 2, tty + 5, { align: 'center' }); doc.text('-', (IC[4] + IC[5]) / 2, tty + 5, { align: 'center' })
        doc.setFont('helvetica', 'normal'); doc.text(fmtRs(g.cgst), RE - 3, tty + 5, { align: 'right' })
        doc.line(ML, tty + ROW_H, RE, tty + ROW_H); tty += ROW_H
        doc.setFont('helvetica', 'italic')
        doc.text(`SGST @${g.rate / 2}%`, IC[1] + 2, tty + 5)
        doc.text('-', (IC[2] + IC[3]) / 2, tty + 5, { align: 'center' }); doc.text('-', (IC[3] + IC[4]) / 2, tty + 5, { align: 'center' }); doc.text('-', (IC[4] + IC[5]) / 2, tty + 5, { align: 'center' })
        doc.setFont('helvetica', 'normal'); doc.text(fmtRs(g.sgst), RE - 3, tty + 5, { align: 'right' })
        doc.line(ML, tty + ROW_H, RE, tty + ROW_H); tty += ROW_H
      }
    })
  }

  // TOTAL ROW
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
  doc.line(ML, TOTAL_TOP + TOTAL_ROW_H, RE, TOTAL_TOP + TOTAL_ROW_H)
  doc.text('TOTAL', (IC[1] + IC[2]) / 2, TOTAL_TOP + 5.5, { align: 'center' })
  const totalQty = invoice.items.reduce((s, i) => s + i.quantity, 0)
  doc.text(totalQty.toString(), (IC[3] + IC[4]) / 2, TOTAL_TOP + 5.5, { align: 'center' })
  doc.text(fmtRs(invoice.totalAmount), RE - 3, TOTAL_TOP + 5.5, { align: 'right' })

  // HSN SUMMARY
  doc.line(ML, HSN_TOP, RE, HSN_TOP)
  let HC
  if (isInter) { HC = [ML, ML + 35, ML + 80, ML + 100, ML + 140, RE] }
  else { HC = [ML, ML + 25, ML + 60, ML + 75, ML + 100, ML + 115, ML + 140, RE] }

  const hsnBottom = HSN_TOP + HSN_H
  for (let i = 1; i < HC.length - 1; i++) { doc.line(HC[i], HSN_TOP, HC[i], hsnBottom) }

  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold')
  const hsnHdr1Y = HSN_TOP + 5
  doc.text('HSN/SAC', (HC[0] + HC[1]) / 2, hsnHdr1Y, { align: 'center' })
  doc.text('Taxable Value', (HC[1] + HC[2]) / 2, hsnHdr1Y, { align: 'center' })
  if (isInter) {
    doc.text('IGST', (HC[2] + HC[4]) / 2, hsnHdr1Y, { align: 'center' })
    doc.text('Total Tax Amount', (HC[4] + HC[5]) / 2, hsnHdr1Y, { align: 'center' })
  } else {
    doc.text('CGST', (HC[2] + HC[4]) / 2, hsnHdr1Y, { align: 'center' })
    doc.text('SGST', (HC[4] + HC[6]) / 2, hsnHdr1Y, { align: 'center' })
    doc.text('Total Tax Amount', (HC[6] + HC[7]) / 2, hsnHdr1Y, { align: 'center' })
  }

  const hsnSubHdrY = HSN_TOP + ROW_H
  doc.line(ML, hsnSubHdrY, RE, hsnSubHdrY)
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
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5)
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
    totalTaxable += g.taxable; totalIgstH += g.igst; totalCgstH += g.cgst; totalSgstH += g.sgst; totalTaxH += g.totalTax
  })

  // HSN Total row
  const hsnTotalY = hsnDataStart + hsnDataRows * ROW_H
  doc.line(ML, hsnTotalY + ROW_H, RE, hsnTotalY + ROW_H)
  doc.setFont('helvetica', 'bold')
  const hty2 = hsnTotalY + 5
  doc.text('Total', (HC[0] + HC[1]) / 2, hty2, { align: 'center' })
  doc.text(fmtNum(totalTaxable), HC[2] - 3, hty2, { align: 'right' })
  if (isInter) {
    doc.text(fmtNum(totalIgstH), HC[4] - 3, hty2, { align: 'right' })
    doc.text(fmtRs(totalTaxH), RE - 3, hty2, { align: 'right' })
  } else {
    doc.text(fmtNum(totalCgstH), HC[4] - 3, hty2, { align: 'right' })
    doc.text(fmtNum(totalSgstH), HC[6] - 3, hty2, { align: 'right' })
    doc.text(fmtRs(totalTaxH), RE - 3, hty2, { align: 'right' })
  }

  // AMOUNT IN WORDS
  doc.line(ML, WORDS_TOP, RE, WORDS_TOP)
  doc.line(ML, FOOTER_TOP, RE, FOOTER_TOP)
  doc.setFontSize(7.5); doc.setFont('helvetica', 'bold')
  doc.text('Total Amount (in words)', ML + 3, WORDS_TOP + 5)
  doc.setFont('helvetica', 'normal')
  const words = numberToWords(invoice.totalAmount)
  const wordLines = doc.splitTextToSize(words, CW - 6)
  doc.text(wordLines, ML + 3, WORDS_TOP + 10)

  // FOOTER
  const footCol1 = ML, footCol2 = ML + 66, footCol3 = ML + 132
  doc.line(footCol2, FOOTER_TOP, footCol2, BORDER_BOTTOM)
  doc.line(footCol3, FOOTER_TOP, footCol3, BORDER_BOTTOM)

  let ffy = FOOTER_TOP + 5
  doc.setFontSize(8); doc.setFont('helvetica', 'bold')
  doc.text('Bank Details', footCol1 + 3, ffy); ffy += 4.5
  doc.setFontSize(7); doc.setFont('helvetica', 'normal')
  if (invoice.company?.bankDetails) {
    const bankLines = doc.splitTextToSize(invoice.company.bankDetails, 58)
    doc.text(bankLines, footCol1 + 3, ffy)
  }

  ffy = FOOTER_TOP + 5
  doc.setFontSize(8); doc.setFont('helvetica', 'bold')
  doc.text('Terms and Conditions', footCol2 + 3, ffy); ffy += 4.5
  doc.setFontSize(6.5); doc.setFont('helvetica', 'normal')
  if (invoice.company?.termsConditions) {
    const termLines = doc.splitTextToSize(invoice.company.termsConditions, 62)
    doc.text(termLines.slice(0, 10), footCol2 + 3, ffy)
  }

  const sigCenterX = (footCol3 + RE) / 2
  drawLogo(doc, sigCenterX - 6, FOOTER_TOP + 5, 12, 12)
  doc.setFontSize(7.5); doc.setFont('helvetica', 'normal')
  doc.text('Authorised Signatory For', sigCenterX, BORDER_BOTTOM - 10, { align: 'center' })
  doc.setFont('helvetica', 'bold')
  doc.text((invoice.company?.name || '').toUpperCase(), sigCenterX, BORDER_BOTTOM - 5.5, { align: 'center' })

  return doc
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await prisma.$connect()
  console.log('Connected to database:', DB_PATH)

  // Get company details
  const company = await prisma.company.findFirst()
  if (!company) {
    console.error('No company found in database')
    process.exit(1)
  }
  console.log(`Company: ${company.name}`)
  console.log(`Bank Details: ${company.bankDetails ? 'Yes' : 'No'}`)
  console.log(`Terms & Conditions: ${company.termsConditions ? 'Yes' : 'No'}`)

  // Get all sales invoices
  const invoices = await prisma.salesInvoice.findMany({
    include: {
      party: true,
      items: { include: { item: true } }
    },
    orderBy: { invoiceNumber: 'asc' }
  })

  console.log(`\nFound ${invoices.length} invoices to regenerate\n`)

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  let success = 0, failed = 0

  for (const inv of invoices) {
    try {
      // Build invoice data with company info
      const invoiceData = {
        ...inv,
        invoiceDate: inv.invoiceDate.toISOString(),
        party: inv.party,
        items: inv.items,
        company
      }

      const doc = generateInvoicePDF(invoiceData)

      // Generate filename matching the existing pattern
      const partyName = inv.party.name.replace(/[^a-z0-9]/gi, '_')
      const filename = `${partyName}_Sales_Invoice_${inv.invoiceNumber.replace(/\//g, '_')}.pdf`
      const filepath = path.join(OUTPUT_DIR, filename)

      // Save PDF as buffer
      const pdfBuffer = Buffer.from(doc.output('arraybuffer'))
      fs.writeFileSync(filepath, pdfBuffer)

      success++
      process.stdout.write(`\r  Generated: ${success}/${invoices.length} - ${inv.invoiceNumber}`)
    } catch (err) {
      failed++
      console.error(`\n  FAILED: ${inv.invoiceNumber} - ${err.message}`)
    }
  }

  console.log(`\n\nDone! ${success} generated, ${failed} failed`)
  console.log(`Output: ${OUTPUT_DIR}`)

  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
