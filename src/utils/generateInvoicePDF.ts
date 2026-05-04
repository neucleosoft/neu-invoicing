import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatInvoiceStatus } from './invoiceStatus'
import { downloadClassicPDF, getClassicPDFBytes, buildClassicPDFFilename } from './pdfmakeInvoice'
import {
  downloadQuotationPDF,
  previewQuotationPDF,
  getQuotationPDFBytes,
  buildQuotationFilename,
} from './pdfmakeQuotation'
import {
  downloadProformaInvoicePDF,
  previewProformaInvoicePDF,
  getProformaInvoicePDFBytes,
  buildProformaInvoiceFilename,
} from './pdfmakeProformaInvoice'
import {
  fmtNum,
  fmtRs,
  fmtAmt,
  formatDate,
  getTaxGroups,
  getHSNGroups,
  drawPageBorder,
  drawDocumentNumberGrid,
  drawCompanySection,
  drawBillToShipTo,
  drawItemsTableHeader,
  drawItemRows,
  drawTotalRow,
  drawAmountInWords,
  drawFooter,
} from './pdfHelpers'
import type { InvoiceData, InvoiceTemplate } from './pdfHelpers'

// Re-export so existing imports in Sales.tsx, Settings.tsx, etc. don't break
export type { InvoiceData, InvoiceTemplate } from './pdfHelpers'
export { TEMPLATE_INFO } from './pdfHelpers'

// ─── Classic GST Tax Invoice Template ─────────────────────────────────────────

function generateClassicTemplate(doc: jsPDF, invoice: InvoiceData) {
  const ML = 6, RE = 204, CW = 198, ROW_H = 7

  // Pre-calculate layout
  const BORDER_TOP = 13, COMPANY_BOTTOM = 52, BILLSHIP_BOTTOM = 95
  const ITEMS_HDR_H = 8
  const ITEMS_HDR_BOTTOM = BILLSHIP_BOTTOM + ITEMS_HDR_H // 95

  const isInter = invoice.isInterState !== false
  const taxGroups = getTaxGroups(invoice.items, isInter)
  const hsnGroups = getHSNGroups(invoice.items, isInter)
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
  doc.setTextColor(0, 0, 0)
  doc.setLineWidth(0.4)

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
  drawPageBorder(doc, ML, BORDER_TOP, CW, BORDER_BOTTOM)

  // ══════════════════════════════════════════════════════════════════════════════
  // COMPANY SECTION (BORDER_TOP → COMPANY_BOTTOM)
  // ══════════════════════════════════════════════════════════════════════════════
  const INV_X = 142
  const companyLogo = (invoice.company as any)?.logoBase64
  const LOGO_SIZE = 22
  const compTextX = ML + LOGO_SIZE + 5

  drawDocumentNumberGrid(
    doc,
    'Invoice No.', invoice.invoiceNumber,
    'Invoice Date', formatDate(invoice.invoiceDate),
    INV_X, BORDER_TOP, COMPANY_BOTTOM, RE
  )

  drawCompanySection(
    doc, invoice.company, companyLogo,
    compTextX, LOGO_SIZE,
    ML, BORDER_TOP, INV_X, COMPANY_BOTTOM
  )

  // ══════════════════════════════════════════════════════════════════════════════
  // BILL TO / SHIP TO (COMPANY_BOTTOM → BILLSHIP_BOTTOM)
  // ══════════════════════════════════════════════════════════════════════════════
  drawBillToShipTo(
    doc, invoice.party, invoice.placeOfSupplyName,
    COMPANY_BOTTOM, BILLSHIP_BOTTOM,
    ML, RE
  )

  // ══════════════════════════════════════════════════════════════════════════════
  // ITEMS TABLE HEADER
  // ══════════════════════════════════════════════════════════════════════════════
  drawItemsTableHeader(doc, BILLSHIP_BOTTOM, ITEMS_HDR_H, ML, RE, CW, IC)

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
  drawItemRows(doc, invoice.items, ITEMS_HDR_BOTTOM, ROW_H, IC, RE, maxItemRows, invoice.company?.currency)

  // ══════════════════════════════════════════════════════════════════════════════
  // TAX ROWS (invoice-specific, kept inline)
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
  const totalQty = invoice.items.reduce((s, i) => s + i.quantity, 0)
  drawTotalRow(doc, totalQty, invoice.totalAmount, TOTAL_TOP, TOTAL_ROW_H, IC, RE, invoice.company?.currency)

  // ══════════════════════════════════════════════════════════════════════════════
  // HSN / SAC SUMMARY TABLE (invoice-specific, kept inline)
  // ══════════════════════════════════════════════════════════════════════════════
  doc.line(ML, HSN_TOP, RE, HSN_TOP) // top line

  // HSN column positions
  let HC: number[]
  if (isInter) {
    // HSN(35) | TaxableValue(45) | IGSTRate(20) | IGSTAmt(40) | TotalTax(58)
    HC = [ML, ML + 35, ML + 80, ML + 100, ML + 140, RE]
  } else {
    // HSN(25) | TaxableVal(35) | CGSTRate(15) | CGSTAmt(25) | SGSTRate(15) | SGSTAmt(25) | TotalTax(58)
    HC = [ML, ML + 25, ML + 60, ML + 75, ML + 100, ML + 115, ML + 140, RE]
  }

  // HSN border lines
  doc.line(ML, HSN_TOP, RE, HSN_TOP)
  const hsnBottom = HSN_TOP + HSN_H
  doc.line(ML, hsnBottom, RE, hsnBottom)
  // HSN vertical lines
  for (let i = 1; i < HC.length - 1; i++) {
    doc.line(HC[i], HSN_TOP, HC[i], hsnBottom)
  }

  // HSN header row 1
  doc.setFillColor(198, 224, 180)
  doc.setDrawColor(0, 0, 0)
  doc.rect(ML, HSN_TOP, CW, ROW_H, 'FD')
  doc.line(ML, HSN_TOP + HSN_HDR_H, RE, HSN_TOP + HSN_HDR_H)
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
  doc.line(ML, hsnTotalY, RE, hsnTotalY)
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
  drawAmountInWords(doc, invoice.totalAmount, WORDS_TOP, FOOTER_TOP, ML, CW)

  // ══════════════════════════════════════════════════════════════════════════════
  // FOOTER: Bank Details | Terms & Conditions | Authorised Signatory
  // ══════════════════════════════════════════════════════════════════════════════
  drawFooter(doc, invoice.company, companyLogo, FOOTER_TOP, BORDER_BOTTOM, ML, RE)

  // ══════════════════════════════════════════════════════════════════════════════
  // REDRAW: Lines on top of green fills (green rect covers lines drawn before it)
  // ══════════════════════════════════════════════════════════════════════════════
  doc.setDrawColor(0, 0, 0)

  // Outer page border (green fills cover left/right edges)
  doc.setLineWidth(0.6)
  doc.rect(ML, BORDER_TOP, CW, BORDER_BOTTOM - BORDER_TOP)
  doc.setLineWidth(0.4)

  // Vertical column lines through items header, items, tax rows, and TOTAL
  for (let ci = 1; ci < IC.length - 1; ci++) {
    doc.line(IC[ci], BILLSHIP_BOTTOM, IC[ci], TOTAL_TOP + TOTAL_ROW_H)
  }

  // HSN vertical column lines
  for (let ci = 1; ci < HC.length - 1; ci++) {
    if (isInter && ci === 3) {
      // Rate/Amount divider starts below IGST header (not through it)
      doc.line(HC[ci], HSN_TOP + ROW_H, HC[ci], HSN_TOP + HSN_H)
    } else if (!isInter && (ci === 3 || ci === 5)) {
      // Same for CGST and SGST Rate/Amount dividers
      doc.line(HC[ci], HSN_TOP + ROW_H, HC[ci], HSN_TOP + HSN_H)
    } else {
      doc.line(HC[ci], HSN_TOP, HC[ci], HSN_TOP + HSN_H)
    }
  }

  // All horizontal lines on green sections
  // Items header
  doc.line(ML, BILLSHIP_BOTTOM, RE, BILLSHIP_BOTTOM)
  doc.line(ML, BILLSHIP_BOTTOM + ITEMS_HDR_H, RE, BILLSHIP_BOTTOM + ITEMS_HDR_H)
  // TOTAL row
  doc.line(ML, TOTAL_TOP, RE, TOTAL_TOP)
  doc.line(ML, TOTAL_TOP + TOTAL_ROW_H, RE, TOTAL_TOP + TOTAL_ROW_H)
  // HSN header
  doc.line(ML, HSN_TOP, RE, HSN_TOP)
  // Sub-header line only under HSN/SAC and Taxable Value, not under IGST (it spans Rate+Amount)
  doc.line(HC[2], HSN_TOP + ROW_H, RE, HSN_TOP + ROW_H)
  // Amount in words
  doc.line(ML, WORDS_TOP, RE, WORDS_TOP)
  doc.line(ML, FOOTER_TOP, RE, FOOTER_TOP)
}

// ─── Non-classic templates (simplified, with fixed currency) ─────────────────

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
  doc.text('Status: ' + formatInvoiceStatus(invoice.status), ML + 6, yPos + 23)
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
  const cur = invoice.company?.currency
  const tData = invoice.items.map((it, i) => [(i + 1).toString(), it.item.name, it.quantity.toString(), fmtAmt(it.rate, cur), fmtAmt(it.total, cur)])
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
  doc.text('Subtotal:', 120, ssy); doc.setTextColor(255, 255, 255); doc.text(fmtAmt(invoice.subtotal, cur), RE - 5, ssy, { align: 'right' }); ssy += 8
  if (invoice.discount > 0) { doc.setTextColor(220, 220, 255); doc.text('Discount:', 120, ssy); doc.setTextColor(255, 255, 255); doc.text('- ' + fmtAmt(invoice.discount, cur), RE - 5, ssy, { align: 'right' }); ssy += 8 }
  doc.setTextColor(220, 220, 255); doc.text('Tax:', 120, ssy); doc.setTextColor(255, 255, 255); doc.text(fmtAmt(invoice.taxAmount, cur), RE - 5, ssy, { align: 'right' }); ssy += 4
  doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.3); doc.line(120, ssy, RE - 5, ssy); ssy += 7
  doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.text('TOTAL:', 120, ssy); doc.text(fmtAmt(invoice.totalAmount, cur), RE - 5, ssy, { align: 'right' }); ssy += 10
  if (invoice.amountPaid > 0) { doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(220, 220, 255); doc.text('Paid:', 120, ssy); doc.setTextColor(255, 255, 255); doc.text('- ' + fmtAmt(invoice.amountPaid, cur), RE - 5, ssy, { align: 'right' }) }

  const pH = doc.internal.pageSize.height
  doc.setFillColor(139, 92, 246); doc.rect(0, pH - 16, 210, 16, 'F')
  doc.setTextColor(255, 255, 255); doc.setFontSize(8); doc.setFont('helvetica', 'bold')
  doc.text('Thank you for your business!', 105, pH - 6, { align: 'center' })
}

function generateMinimalTemplate(doc: jsPDF, invoice: InvoiceData) {
  const black: [number, number, number] = [0, 0, 0]
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

  const cur = invoice.company?.currency
  const tData = invoice.items.map((it, i) => [(i + 1).toString(), it.item.name, it.quantity.toString(), fmtAmt(it.rate, cur), fmtAmt(it.total, cur)])
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
  doc.setTextColor(...gray); doc.text('Subtotal', lblX, y); doc.setTextColor(...black); doc.text(fmtAmt(invoice.subtotal, cur), valX, y, { align: 'right' }); y += 7
  if (invoice.discount > 0) { doc.setTextColor(...gray); doc.text('Discount', lblX, y); doc.setTextColor(...black); doc.text('- ' + fmtAmt(invoice.discount, cur), valX, y, { align: 'right' }); y += 7 }
  doc.setTextColor(...gray); doc.text('Tax', lblX, y); doc.setTextColor(...black); doc.text(fmtAmt(invoice.taxAmount, cur), valX, y, { align: 'right' }); y += 5
  doc.setDrawColor(220, 220, 220); doc.line(lblX, y, valX, y); y += 7
  doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text('Total', lblX, y); doc.text(fmtAmt(invoice.totalAmount, cur), valX, y, { align: 'right' })
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
  const cur = invoice.company?.currency
  doc.setDrawColor(...gold); doc.setLineWidth(0.5); doc.line(ML, y, 55, y); doc.line(155, y, RE, y); y += 12
  doc.setTextColor(...navy); doc.setFontSize(9)
  doc.setFont('helvetica', 'bold'); doc.text('Invoice No:', ML, y); doc.setFont('helvetica', 'normal'); doc.text(invoice.invoiceNumber, ML + 25, y)
  doc.setFont('helvetica', 'bold'); doc.text('Date:', ML, y + 7); doc.setFont('helvetica', 'normal'); doc.text(formatDate(invoice.invoiceDate), ML + 25, y + 7)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.text('BILL TO', 120, y - 3)
  doc.setFontSize(10); doc.text(doc.splitTextToSize(invoice.party.name, 70)[0], 120, y + 4)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  if (invoice.party.phone) doc.text(invoice.party.phone, 120, y + 10)
  y += 28

  const tData = invoice.items.map((it, i) => [(i + 1).toString(), it.item.name, it.quantity.toString(), fmtAmt(it.rate, cur), fmtAmt(it.total, cur)])
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
  doc.text('Subtotal:', 125, y + 10); doc.text(fmtAmt(invoice.subtotal, cur), 190, y + 10, { align: 'right' })
  doc.text('Tax:', 125, y + 18); doc.text(fmtAmt(invoice.taxAmount, cur), 190, y + 18, { align: 'right' })
  doc.setFillColor(...gold); doc.rect(120, y + 23, 75, 12, 'F')
  doc.setTextColor(255, 255, 255); doc.setFontSize(11); doc.setFont('helvetica', 'bold')
  doc.text('TOTAL:', 125, y + 31); doc.text(fmtAmt(invoice.totalAmount, cur), 190, y + 31, { align: 'right' })

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
  const cur = invoice.company?.currency
  doc.setFillColor(...offW); doc.rect(ML, y, 180, 28, 'F')
  doc.setFontSize(7); doc.setTextColor(...accent); doc.setFont('helvetica', 'bold'); doc.text('BILL TO', ML + 6, y + 7)
  doc.setTextColor(...black); doc.setFontSize(11); doc.text(doc.splitTextToSize(invoice.party.name, 80)[0], ML + 6, y + 15)
  doc.setFontSize(8); doc.setFont('helvetica', 'normal')
  if (invoice.party.phone) doc.text(invoice.party.phone, ML + 6, y + 22)
  y += 38

  const tData = invoice.items.map((it, i) => [(i + 1).toString(), it.item.name, it.quantity.toString(), fmtAmt(it.rate, cur), fmtAmt(it.total, cur)])
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
  doc.text('Subtotal', sX + 5, ssy); doc.setTextColor(...white); doc.text(fmtAmt(invoice.subtotal, cur), RE - 5, ssy, { align: 'right' }); ssy += 8
  if (invoice.discount > 0) { doc.setTextColor(180, 180, 180); doc.text('Discount', sX + 5, ssy); doc.setTextColor(...white); doc.text('- ' + fmtAmt(invoice.discount, cur), RE - 5, ssy, { align: 'right' }); ssy += 8 }
  doc.setTextColor(180, 180, 180); doc.text('Tax', sX + 5, ssy); doc.setTextColor(...white); doc.text(fmtAmt(invoice.taxAmount, cur), RE - 5, ssy, { align: 'right' })

  doc.setFillColor(...accent); doc.roundedRect(sX, y + mH, sW, 16, 2, 2, 'F')
  doc.setTextColor(...black); doc.setFontSize(12); doc.setFont('helvetica', 'bold')
  doc.text('TOTAL', sX + 5, y + mH + 11); doc.text(fmtAmt(invoice.totalAmount, cur), RE - 5, y + mH + 11, { align: 'right' })
}

// ─── Main exports ─────────────────────────────────────────────────────────────

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
  if (invoice.type === 'QUOTATION') {
    downloadQuotationPDF(invoice)
    return
  }

  if (invoice.type === 'PROFORMA_INVOICE') {
    downloadProformaInvoicePDF(invoice)
    return
  }

  // Classic uses pdfmake (flow-based layout), others still use jsPDF
  if (template === 'classic') {
    downloadClassicPDF(invoice)
    return
  }
  const doc = generateInvoicePDF(invoice, template)
  const filename = `${invoice.invoiceNumber}_${invoice.party.name.replace(/[^a-z0-9]/gi, '_')}.pdf`
  doc.save(filename)
}

export async function getInvoicePDFBytes(
  invoice: InvoiceData,
  template: InvoiceTemplate = 'classic'
): Promise<{ bytes: Uint8Array; filename: string }> {
  if (!invoice.items) invoice.items = []

  // Quotation/Proforma always use the pdfmake Classic layout regardless of template.
  if (invoice.type === 'QUOTATION') {
    return { bytes: await getQuotationPDFBytes(invoice), filename: buildQuotationFilename(invoice) }
  }
  if (invoice.type === 'PROFORMA_INVOICE') {
    return {
      bytes: await getProformaInvoicePDFBytes(invoice),
      filename: buildProformaInvoiceFilename(invoice),
    }
  }

  // Sales invoice — Classic via pdfmake, others via jsPDF.
  if (template === 'classic') {
    return { bytes: await getClassicPDFBytes(invoice), filename: buildClassicPDFFilename(invoice) }
  }

  const doc = generateInvoicePDF(invoice, template)
  const arrayBuffer = doc.output('arraybuffer') as ArrayBuffer
  const safeParty = invoice.party.name.replace(/[^a-z0-9]/gi, '_')
  const filename = `${invoice.invoiceNumber.replace(/\//g, '_')}_${safeParty}.pdf`
  return { bytes: new Uint8Array(arrayBuffer), filename }
}

export function previewInvoicePDF(invoice: InvoiceData, template: InvoiceTemplate = 'classic') {
  if (invoice.type === 'QUOTATION') {
    previewQuotationPDF(invoice)
    return
  }

  if (invoice.type === 'PROFORMA_INVOICE') {
    previewProformaInvoicePDF(invoice)
    return
  }

  const doc = generateInvoicePDF(invoice, template)
  const pdfBlob = doc.output('blob')
  const pdfUrl = URL.createObjectURL(pdfBlob)
  window.open(pdfUrl, '_blank')
}
