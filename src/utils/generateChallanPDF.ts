import { jsPDF } from 'jspdf'
import {
  ChallanData,
  formatDate,
  fmtNum,
  fmtRs,
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

export type { ChallanData } from './pdfHelpers'

// ─── Challan PDF Template (matches classic invoice visual style) ──────────────

function generateChallanTemplate(doc: jsPDF, challan: ChallanData) {
  const ML = 6, RE = 204, CW = 198, ROW_H = 7

  // Pre-calculate layout
  const BORDER_TOP = 13, COMPANY_BOTTOM = 52
  const BILLSHIP_BOTTOM = 95
  const hasTransport = !!(challan.transportMode || challan.vehicleNumber)
  const TRANSPORT_H = hasTransport ? 10 : 0
  const TRANSPORT_BOTTOM = BILLSHIP_BOTTOM + TRANSPORT_H
  const ITEMS_HDR_H = 8
  const ITEMS_HDR_BOTTOM = TRANSPORT_BOTTOM + ITEMS_HDR_H

  // Tax and HSN calculations (same as invoice)
  const isInter = challan.isInterState !== false
  const taxGroups = getTaxGroups(challan.items, isInter)
  const hsnGroups = getHSNGroups(challan.items, isInter)
  const taxRowCount = isInter ? Math.max(taxGroups.length, 1) : Math.max(taxGroups.length * 2, 1)

  // Bottom section heights
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

  // Items area (between header and tax rows)
  const ITEMS_AREA_H = TAX_TOP - ITEMS_HDR_BOTTOM
  const maxItemRows = Math.floor(ITEMS_AREA_H / ROW_H)

  // Column positions for items table: S.NO | ITEMS | HSN | QTY | RATE | AMOUNT
  const IC = [ML, ML + 14, ML + 82, ML + 106, ML + 134, ML + 164, RE]

  doc.setDrawColor(0, 0, 0)
  doc.setTextColor(0, 0, 0)
  doc.setLineWidth(0.4)

  // ════════════════════════════════════════════════════════════════════════════
  // TITLE LINE
  // ════════════════════════════════════════════════════════════════════════════
  doc.setFontSize(10)
  doc.setFont('helvetica', 'bold')
  doc.text('DELIVERY CHALLAN', ML, 9)

  // ════════════════════════════════════════════════════════════════════════════
  // OUTER BORDER
  // ════════════════════════════════════════════════════════════════════════════
  drawPageBorder(doc, ML, BORDER_TOP, CW, BORDER_BOTTOM)

  // ════════════════════════════════════════════════════════════════════════════
  // COMPANY SECTION (BORDER_TOP -> COMPANY_BOTTOM)
  // ════════════════════════════════════════════════════════════════════════════
  const INV_X = 142
  const companyLogo = (challan.company as any)?.logoBase64
  const LOGO_SIZE = 22
  const compTextX = ML + LOGO_SIZE + 5

  drawDocumentNumberGrid(
    doc,
    'Challan No.', challan.challanNumber,
    'Challan Date', formatDate(challan.challanDate),
    INV_X, BORDER_TOP, COMPANY_BOTTOM, RE
  )

  drawCompanySection(
    doc, challan.company, companyLogo,
    compTextX, LOGO_SIZE,
    ML, BORDER_TOP, INV_X, COMPANY_BOTTOM
  )

  // ════════════════════════════════════════════════════════════════════════════
  // BILL TO / SHIP TO (COMPANY_BOTTOM -> BILLSHIP_BOTTOM)
  // ════════════════════════════════════════════════════════════════════════════
  drawBillToShipTo(
    doc, challan.party, undefined,
    COMPANY_BOTTOM, BILLSHIP_BOTTOM,
    ML, RE
  )

  // ════════════════════════════════════════════════════════════════════════════
  // TRANSPORT DETAILS (only if user filled in transport mode or vehicle number)
  // ════════════════════════════════════════════════════════════════════════════
  if (hasTransport) {
    doc.line(ML, TRANSPORT_BOTTOM, RE, TRANSPORT_BOTTOM)
    doc.setFontSize(7.5)
    const tpY = BILLSHIP_BOTTOM + 6.5
    if (challan.transportMode) {
      doc.setFont('helvetica', 'bold')
      doc.text('Transport Mode: ', ML + 3, tpY)
      const lblW = doc.getTextWidth('Transport Mode: ')
      doc.setFont('helvetica', 'normal')
      doc.text(challan.transportMode, ML + 3 + lblW, tpY)
    }
    if (challan.vehicleNumber) {
      const vehX = ML + CW / 2
      doc.setFont('helvetica', 'bold')
      doc.text('Vehicle No: ', vehX + 3, tpY)
      const lblW2 = doc.getTextWidth('Vehicle No: ')
      doc.setFont('helvetica', 'normal')
      doc.text(challan.vehicleNumber, vehX + 3 + lblW2, tpY)
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ITEMS TABLE HEADER
  // ════════════════════════════════════════════════════════════════════════════
  drawItemsTableHeader(doc, TRANSPORT_BOTTOM, ITEMS_HDR_H, ML, RE, CW, IC)

  // ════════════════════════════════════════════════════════════════════════════
  // ITEMS TABLE - vertical column lines (from header top to total bottom)
  // ════════════════════════════════════════════════════════════════════════════
  const tableBottom = TOTAL_TOP + TOTAL_ROW_H
  for (let i = 1; i < IC.length - 1; i++) {
    doc.line(IC[i], TRANSPORT_BOTTOM, IC[i], tableBottom)
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ITEM ROWS
  // ════════════════════════════════════════════════════════════════════════════
  drawItemRows(doc, challan.items, ITEMS_HDR_BOTTOM, ROW_H, IC, RE, maxItemRows, challan.company?.currency)

  // ════════════════════════════════════════════════════════════════════════════
  // TAX ROWS
  // ════════════════════════════════════════════════════════════════════════════
  let ty = TAX_TOP
  doc.setFontSize(7.5)

  if (taxGroups.length === 0) {
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
        doc.setFont('helvetica', 'italic')
        doc.text(`CGST @${g.rate / 2}%`, IC[1] + 2, ty + 5)
        doc.text('-', (IC[2] + IC[3]) / 2, ty + 5, { align: 'center' })
        doc.text('-', (IC[3] + IC[4]) / 2, ty + 5, { align: 'center' })
        doc.text('-', (IC[4] + IC[5]) / 2, ty + 5, { align: 'center' })
        doc.setFont('helvetica', 'normal')
        doc.text(fmtRs(g.cgst), RE - 3, ty + 5, { align: 'right' })
        doc.line(ML, ty + ROW_H, RE, ty + ROW_H)
        ty += ROW_H
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

  // ════════════════════════════════════════════════════════════════════════════
  // TOTAL ROW
  // ════════════════════════════════════════════════════════════════════════════
  const totalQty = challan.items.reduce((s, i) => s + i.quantity, 0)
  drawTotalRow(doc, totalQty, challan.totalAmount, TOTAL_TOP, TOTAL_ROW_H, IC, RE, challan.company?.currency)

  // ════════════════════════════════════════════════════════════════════════════
  // HSN / SAC SUMMARY TABLE
  // ════════════════════════════════════════════════════════════════════════════
  doc.line(ML, HSN_TOP, RE, HSN_TOP)

  let HC: number[]
  if (isInter) {
    HC = [ML, ML + 35, ML + 80, ML + 100, ML + 140, RE]
  } else {
    HC = [ML, ML + 25, ML + 60, ML + 75, ML + 100, ML + 115, ML + 140, RE]
  }

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
    doc.text('IGST', (HC[2] + HC[4]) / 2, hsnHdr1Y, { align: 'center' })
    doc.text('Total Tax Amount', (HC[4] + HC[5]) / 2, hsnHdr1Y, { align: 'center' })
  } else {
    doc.text('CGST', (HC[2] + HC[4]) / 2, hsnHdr1Y, { align: 'center' })
    doc.text('SGST', (HC[4] + HC[6]) / 2, hsnHdr1Y, { align: 'center' })
    doc.text('Total Tax Amount', (HC[6] + HC[7]) / 2, hsnHdr1Y, { align: 'center' })
  }

  const hsnSubHdrY = HSN_TOP + ROW_H
  doc.line(ML, hsnSubHdrY, RE, hsnSubHdrY)

  // HSN sub-header row 2
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

  // ════════════════════════════════════════════════════════════════════════════
  // AMOUNT IN WORDS
  // ════════════════════════════════════════════════════════════════════════════
  drawAmountInWords(doc, challan.totalAmount, WORDS_TOP, FOOTER_TOP, ML, CW)

  // ════════════════════════════════════════════════════════════════════════════
  // FOOTER: Bank Details | Terms & Conditions | Authorised Signatory
  // ════════════════════════════════════════════════════════════════════════════
  drawFooter(doc, challan.company, companyLogo, FOOTER_TOP, BORDER_BOTTOM, ML, RE)
}

// ─── Main exports ─────────────────────────────────────────────────────────────

export function generateChallanPDF(challan: ChallanData) {
  if (!challan.items) challan.items = []
  const doc = new jsPDF()
  generateChallanTemplate(doc, challan)
  return doc
}

export function downloadChallanPDF(challan: ChallanData) {
  const doc = generateChallanPDF(challan)
  const filename = `${challan.challanNumber}_${challan.party.name.replace(/[^a-z0-9]/gi, '_')}.pdf`
  doc.save(filename)
}
