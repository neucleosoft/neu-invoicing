#!/usr/bin/env node
// Convert old_style/*.pdf → new_style format PDFs.
// Reads each PDF in invoices database/old_style/, extracts structured invoice
// data via pdf-parse, then re-renders it through pdfmake using a layout that
// mirrors src/utils/pdfmakeInvoice.ts (green-tinted headers, ₹, full address).
//
// Usage:
//   node scripts/convert-old-to-new-style.mjs --preview        # 2 sample PDFs to _conversion_preview/
//   node scripts/convert-old-to-new-style.mjs --preview --file=NAME.pdf
//   node scripts/convert-old-to-new-style.mjs --all            # convert all 259 to new_style_from_old/
//   node scripts/convert-old-to-new-style.mjs --all --limit=10 # convert first N

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { PDFParse } = require('pdf-parse')
const PdfPrinter = require('pdfmake')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..')
const OLD_DIR = path.resolve(REPO_ROOT, 'invoices database', 'old_style')
const NEW_DIR = path.resolve(REPO_ROOT, 'invoices database', 'new_style_from_old')
const PREVIEW_DIR = path.resolve(REPO_ROOT, 'invoices database', '_conversion_preview')

const args = process.argv.slice(2)
const MODE_PREVIEW = args.includes('--preview')
const MODE_ALL = args.includes('--all')
const RENUMBER = args.includes('--renumber')
const PLAN_ONLY = args.includes('--plan-only')
const FILE_ARG = (args.find(a => a.startsWith('--file=')) || '').slice('--file='.length)
const LIMIT_ARG = parseInt((args.find(a => a.startsWith('--limit=')) || '').slice('--limit='.length), 10) || 0

if (!MODE_PREVIEW && !MODE_ALL) {
  console.error('Specify --preview or --all')
  process.exit(1)
}

// ─── Seller (new_style values, as agreed) ────────────────────────────────────
const SELLER = {
  name: 'NEUCLEO SOFT',
  address: '98 CHILLA VILLAGE GUHILLA MOHALLA, GUHILLA MOHALLA, MAYUR VIHAR PHASE-1 EAST DELHI, DELHI, Delhi, 110091',
  gstin: '07ASNPG3910E1Z0',
  email: 'sales@neucleosoft.com',
  bank: [
    'Name: Neucleo soft',
    'IFSC Code: KKBK0000203',
    'Account No: 3746217725',
    'Bank: Kotak Mahindra Bank,MAYUR VIHAR',
  ].join('\n'),
  terms: [
    'Freight Terms:',
    '1-Freight charges will be borne by buyer.',
    '2. Warranty does not cover damage due to misuse, improper handling, or modifications by the buyer.',
    '3. A restocking fee may apply for non-defective returns.',
    '4. Estimated delivery dates are provided but not guaranteed.',
  ].join('\n'),
}

// ─── Helpers (mirrored from src/utils/pdfHelpers.ts) ─────────────────────────
const GREEN = '#C6E0B4'

// Use the canonical full-resolution logo from public/ — pdfHelpers.ts's
// LOGO_BASE64 is a tiny embedded thumbnail whose PNG chunks are mis-encoded
// (jsPDF tolerates it; pdfkit doesn't).
const LOGO_PATH = path.resolve(REPO_ROOT, 'public', 'COMPANY LOGO.png')

function fmtNum(amount) {
  const abs = Math.abs(amount)
  const integer = Math.floor(abs)
  const decimal = Math.round((abs - integer) * 100)
  const intStr = integer.toString()
  let result
  if (intStr.length <= 3) result = intStr
  else {
    const last3 = intStr.slice(-3)
    const remaining = intStr.slice(0, -3)
    result = remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3
  }
  if (decimal > 0) result += '.' + decimal.toString().padStart(2, '0')
  return amount < 0 ? '-' + result : result
}
function fmtRs(amount) { return '₹ ' + fmtNum(amount) }
function formatDate(input) {
  const d = new Date(input)
  if (isNaN(d.getTime())) return String(input)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
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
  const twoD = (n) => n === 0 ? '' : (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : ''))
  const threeD = (n) => n === 0 ? '' : (n >= 100 ? ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + twoD(n % 100) : '') : twoD(n))
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

// ─── Parsing ─────────────────────────────────────────────────────────────────

async function extractText(filePath) {
  const buf = fs.readFileSync(filePath)
  const parser = new PDFParse(new Uint8Array(buf))
  await parser.load()
  const r = await parser.getText()
  return r.pages.map(p => p.text).join('\n')
}

function parseNumber(s) {
  if (s == null) return 0
  const n = parseFloat(String(s).replace(/[₹\s,]/g, '').replace(/Rs\.?/i, ''))
  return Number.isNaN(n) ? 0 : n
}

function parseInvoice(text) {
  const rawLines = text.split('\n').map(l => l.trim())
  const lines = rawLines.filter(Boolean)

  let invoiceNumber = ''
  let invoiceDate = null
  let partyName = ''
  let partyAddress = ''
  let partyGstin = ''
  let placeOfSupply = ''

  // Invoice No. / Invoice Date pair: usually "Invoice No. Invoice Date" header line,
  // then "<number> <DD/MM/YYYY>" data line.
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^Invoice No\.?\s+Invoice Date$/i.test(l) && lines[i + 1]) {
      const next = lines[i + 1]
      const dm = next.match(/(\d{2}\/\d{2}\/\d{4})\s*$/)
      if (dm) {
        invoiceDate = dm[1]
        invoiceNumber = next.slice(0, next.length - dm[1].length).trim()
      }
    }
    if (!invoiceNumber) {
      const m = l.match(/Invoice No\.?\s+(\S+)/i)
      if (m && !/Invoice Date/i.test(m[1])) invoiceNumber = m[1]
    }
    if (!invoiceNumber && /^Invoice No\.?$/i.test(l) && lines[i + 1]) {
      invoiceNumber = lines[i + 1].trim()
    }
    if (!invoiceDate) {
      const m = l.match(/Invoice Date\s+(\d{2}\/\d{2}\/\d{4})/i)
      if (m) invoiceDate = m[1]
    }
    if (!invoiceDate && /^Invoice Date$/i.test(l) && lines[i + 1]) {
      const dm = lines[i + 1].match(/(\d{2}\/\d{2}\/\d{4})/)
      if (dm) invoiceDate = dm[1]
    }
  }

  // BILL TO block
  const billIdx = lines.findIndex(l => /^BILL TO$/i.test(l))
  if (billIdx >= 0 && lines[billIdx + 1]) {
    partyName = lines[billIdx + 1].trim()

    // Address: lines after "Address:" until GSTIN/PAN/SHIP TO
    const addrParts = []
    for (let i = billIdx + 2; i < lines.length; i++) {
      const l = lines[i]
      if (/^SHIP TO$/i.test(l) || /^GSTIN:/i.test(l) || /^PAN Number/i.test(l) || /^S\.NO\./i.test(l)) break
      if (/^Address:/i.test(l)) {
        addrParts.push(l.replace(/^Address:\s*/i, ''))
      } else if (addrParts.length) {
        addrParts.push(l)
      }
    }
    partyAddress = addrParts.join(' ').trim()

    // GSTIN + Place of Supply within bill block
    for (let i = billIdx + 1; i < Math.min(lines.length, billIdx + 12); i++) {
      const l = lines[i]
      if (/^SHIP TO$/i.test(l)) break
      const gm = l.match(/GSTIN:\s*([0-9A-Z]+)/i)
      if (gm) partyGstin = gm[1]
      const pm = l.match(/Place of Supply:\s*([A-Za-z &().-]+)/i)
      if (pm) placeOfSupply = pm[1].trim()
    }
  }

  // Items table: lines between S.NO. header and first tax/TOTAL row.
  const hdrIdx = lines.findIndex(l => /^S\.NO\.\s+ITEMS\b/i.test(l))
  const items = []
  let taxStart = -1
  if (hdrIdx >= 0) {
    for (let i = hdrIdx + 1; i < lines.length; i++) {
      const l = lines[i]
      if (/^(IGST|CGST|SGST)\s*@/i.test(l) || /^TOTAL\b/i.test(l)) {
        taxStart = i
        break
      }
      // Item line — tokenize from the right
      const tokens = l.split(/\s+/)
      if (tokens.length < 6) continue
      // Last 5: HSN, QTY, UNIT, RATE, AMOUNT (but unit can be 1+ words; we treat last 1 token before rate as unit)
      // Heuristic: from the end, AMOUNT=last, RATE=2nd last, UNIT=3rd last (alpha), QTY=4th last, HSN=5th last
      const amount = parseNumber(tokens[tokens.length - 1])
      const rate = parseNumber(tokens[tokens.length - 2])
      const unit = tokens[tokens.length - 3]
      const qty = parseNumber(tokens[tokens.length - 4])
      const hsn = tokens[tokens.length - 5]
      // S.NO. is token[0] when numeric
      const startIdx = /^\d+$/.test(tokens[0]) ? 1 : 0
      const name = tokens.slice(startIdx, tokens.length - 5).join(' ').trim()
      if (name && (amount > 0 || rate > 0 || qty > 0)) {
        items.push({ name, hsn, qty, unit, rate, amount })
      }
    }
  }

  // Tax detection: IGST vs CGST+SGST + rate
  let isInterState = true
  let taxRate = 0
  let taxAmount = 0
  if (taxStart >= 0) {
    for (let i = taxStart; i < lines.length; i++) {
      const l = lines[i]
      if (/^TOTAL\b/i.test(l)) break
      const ig = l.match(/^IGST\s*@\s*([\d.]+)%/i)
      if (ig) {
        isInterState = true
        taxRate = parseFloat(ig[1])
        const amt = l.match(/(Rs\.?|₹)\s*([\d,]+(?:\.\d+)?)/i)
        if (amt) taxAmount = parseNumber(amt[2])
      }
      const cg = l.match(/^CGST\s*@\s*([\d.]+)%/i)
      if (cg) {
        isInterState = false
        taxRate = parseFloat(cg[1]) * 2 // store as combined rate (18% = 9% CGST + 9% SGST)
      }
    }
  }

  // TOTAL row → totalAmount (last Rs./₹ amount on or just after the TOTAL line)
  let totalAmount = 0
  for (let i = 0; i < lines.length; i++) {
    if (!/^TOTAL\b/i.test(lines[i])) continue
    const candidate = lines[i] + ' ' + (lines[i + 1] || '') + ' ' + (lines[i + 2] || '')
    const ms = candidate.match(/(Rs\.?|₹)\s*([\d,]+(?:\.\d+)?)/gi)
    if (ms && ms.length) {
      totalAmount = parseNumber(ms[ms.length - 1])
      break
    }
  }

  return {
    invoiceNumber, invoiceDate, partyName, partyAddress, partyGstin, placeOfSupply,
    items, isInterState, taxRate, taxAmount, totalAmount,
  }
}

// ─── pdfmake document builder (mirrors src/utils/pdfmakeInvoice.ts) ──────────

function buildItemForGroups(it, isInter, taxRate) {
  const taxable = it.qty * it.rate
  const tax = taxable * (taxRate / 100)
  return {
    hsn: it.hsn || '',
    taxable,
    rate: taxRate,
    igst: isInter ? tax : 0,
    cgst: !isInter ? tax / 2 : 0,
    sgst: !isInter ? tax / 2 : 0,
    totalTax: tax,
  }
}

function buildDoc(parsed) {
  const isInter = parsed.isInterState
  const taxRate = parsed.taxRate
  const totalQty = parsed.items.reduce((s, i) => s + i.qty, 0)
  const totalTaxable = parsed.items.reduce((s, i) => s + i.qty * i.rate, 0)
  const totalTax = parsed.taxAmount || (totalTaxable * taxRate / 100)
  const computedTotal = parsed.totalAmount || (totalTaxable + totalTax)

  // HSN groups (one per unique HSN)
  const hsnMap = {}
  for (const it of parsed.items) {
    const g = buildItemForGroups(it, isInter, taxRate)
    if (!hsnMap[g.hsn]) hsnMap[g.hsn] = { hsn: g.hsn, taxable: 0, rate: g.rate, igst: 0, cgst: 0, sgst: 0, totalTax: 0 }
    hsnMap[g.hsn].taxable += g.taxable
    hsnMap[g.hsn].igst += g.igst
    hsnMap[g.hsn].cgst += g.cgst
    hsnMap[g.hsn].sgst += g.sgst
    hsnMap[g.hsn].totalTax += g.totalTax
  }
  const hsnGroups = Object.values(hsnMap)
  const pan = extractPAN(parsed.partyGstin)

  // ─── Title ────────────────────────────────────────────────────────────────
  const title = {
    columns: [
      { text: 'TAX INVOICE', bold: true, fontSize: 11, width: 'auto' },
      { width: 6, text: '' },
      {
        table: { body: [[{ text: 'ORIGINAL FOR RECIPIENT', fontSize: 8 }]] },
        layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2 },
        width: 'auto',
      },
      { text: '', width: '*' },
    ],
    margin: [0, 0, 0, 3],
  }

  // ─── Company / Invoice grid ───────────────────────────────────────────────
  const companyStack = [
    { text: SELLER.name.toUpperCase(), bold: true, fontSize: 16, color: '#2E7D32', margin: [0, 0, 0, 3] },
    { text: SELLER.address.toUpperCase(), fontSize: 10, margin: [0, 0, 0, 1] },
    { text: [{ text: 'GSTIN: ', bold: true }, SELLER.gstin], fontSize: 10, margin: [0, 0, 0, 1] },
    { text: [{ text: 'Email: ', bold: true }, SELLER.email], fontSize: 10 },
  ]

  const companySection = {
    table: {
      heights: [105],
      widths: ['60%', '40%'],
      body: [[
        {
          columns: [
            { image: 'neuLogo', width: 60, height: 60, margin: [0, 0, 8, 0] },
            { stack: companyStack, width: '*' },
          ],
        },
        {
          table: {
            heights: [70],
            widths: ['*', '*'],
            body: [[
              { stack: [{ text: 'Invoice No.', bold: true, fontSize: 10 }, { text: parsed.invoiceNumber, fontSize: 10, margin: [0, 3, 0, 0] }] },
              { stack: [{ text: 'Invoice Date', bold: true, fontSize: 10 }, { text: parsed.invoiceDate || '', fontSize: 10, margin: [0, 3, 0, 0] }] },
            ]],
          },
          layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 3, paddingBottom: () => 3 },
          margin: [-4, -5, -4, -5],
        },
      ]],
    },
    layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 5, paddingBottom: () => 5 },
  }

  // ─── Bill / Ship ──────────────────────────────────────────────────────────
  const billStack = [
    { text: 'BILL TO', bold: true, fontSize: 10, margin: [0, 0, 0, 2] },
    { text: parsed.partyName, bold: true, fontSize: 11, margin: [0, 0, 0, 2] },
  ]
  if (parsed.partyAddress) {
    billStack.push({
      columns: [
        { text: 'Address: ', width: 'auto', fontSize: 10, margin: [0, 0, 5, 0] },
        { text: parsed.partyAddress, width: '*', fontSize: 10 },
      ],
      margin: [0, 0, 0, 2],
    })
  }
  if (parsed.partyGstin) {
    const gstParts = [{ text: 'GSTIN: ' + parsed.partyGstin, bold: true }]
    if (parsed.placeOfSupply) gstParts.push({ text: '   Place of Supply: ' + parsed.placeOfSupply, bold: false })
    billStack.push({ text: gstParts, fontSize: 10, margin: [0, 0, 0, 1] })
  }
  if (pan) billStack.push({ text: [{ text: 'PAN Number: ', bold: true }, pan], fontSize: 10 })

  const shipStack = [
    { text: 'SHIP TO', bold: true, fontSize: 10, margin: [0, 0, 0, 2] },
    { text: parsed.partyName, bold: true, fontSize: 11, margin: [0, 0, 0, 2] },
  ]
  if (parsed.partyAddress) {
    shipStack.push({
      columns: [
        { text: 'Address: ', width: 'auto', fontSize: 10, margin: [0, 0, 5, 0] },
        { text: parsed.partyAddress, width: '*', fontSize: 10 },
      ],
    })
  }

  const billShip = {
    table: {
      heights: [100],
      widths: ['50%', '50%'],
      body: [[{ stack: billStack, margin: [0, 0, 5, 0] }, { stack: shipStack }]],
    },
    layout: { hLineWidth: (i) => i === 0 ? 0 : 0.5, vLineWidth: () => 0.5, paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 4, paddingBottom: () => 4 },
  }

  // ─── Items table ──────────────────────────────────────────────────────────
  const headerRow = ['S.NO.', 'ITEMS', 'HSN', 'QTY.', 'RATE', 'AMOUNT'].map(h => ({
    text: h, bold: true, fontSize: 9, alignment: 'center', fillColor: GREEN, margin: [0, 2, 0, 2],
  }))

  const itemRows = parsed.items.map((it, idx) => [
    { text: String(idx + 1), alignment: 'center', fontSize: 9 },
    { text: it.name, fontSize: 9 },
    { text: it.hsn || '', alignment: 'center', fontSize: 9 },
    { text: `${it.qty} ${it.unit || 'PCS'}`, alignment: 'center', fontSize: 9 },
    { text: fmtNum(it.rate), alignment: 'right', fontSize: 9 },
    { text: fmtNum(it.qty * it.rate), alignment: 'right', fontSize: 9 },
  ])

  const taxRows = []
  if (taxRate > 0) {
    if (isInter) {
      taxRows.push([
        { text: '' },
        { text: `IGST @${taxRate}%`, italics: true, fontSize: 9, alignment: 'right' },
        { text: '-', alignment: 'right' }, { text: '-', alignment: 'right' }, { text: '-', alignment: 'right' },
        { text: fmtRs(totalTax), alignment: 'right', fontSize: 9 },
      ])
    } else {
      taxRows.push([
        { text: '' },
        { text: `CGST @${taxRate / 2}%`, italics: true, fontSize: 9, alignment: 'right' },
        { text: '-', alignment: 'right' }, { text: '-', alignment: 'right' }, { text: '-', alignment: 'right' },
        { text: fmtRs(totalTax / 2), alignment: 'right', fontSize: 9 },
      ])
      taxRows.push([
        { text: '' },
        { text: `SGST @${taxRate / 2}%`, italics: true, fontSize: 9, alignment: 'right' },
        { text: '-', alignment: 'right' }, { text: '-', alignment: 'right' }, { text: '-', alignment: 'right' },
        { text: fmtRs(totalTax / 2), alignment: 'right', fontSize: 9 },
      ])
    }
  }

  const totalRow = [
    { text: '', fillColor: GREEN },
    { text: 'TOTAL', bold: true, fontSize: 9, alignment: 'right', fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: String(totalQty), bold: true, fontSize: 9, alignment: 'right', fillColor: GREEN },
    { text: '', fillColor: GREEN },
    { text: fmtRs(computedTotal), bold: true, fontSize: 9, alignment: 'right', fillColor: GREEN },
  ]

  const TARGET_ROWS = 14
  const fillerCount = Math.max(0, TARGET_ROWS - itemRows.length - taxRows.length)
  const emptyCell = { text: ' ', fontSize: 6, margin: [0, 3, 0, 3] }
  const fillers = Array.from({ length: fillerCount }, () => Array.from({ length: 6 }, () => ({ ...emptyCell })))

  const itemsTable = {
    table: { headerRows: 1, widths: [32, '*', 50, 50, 50, 55], body: [headerRow, ...itemRows, ...fillers, ...taxRows, totalRow] },
    layout: {
      hLineWidth: (i, node) => {
        if (i === 0) return 0
        if (i === 1) return 0.5
        if (i === node.table.body.length) return 0.5
        if (i === node.table.body.length - 1) return 0.5
        return 0
      },
      vLineWidth: () => 0.5,
      paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 3, paddingBottom: () => 3,
    },
  }

  // ─── HSN summary ──────────────────────────────────────────────────────────
  let hsnSection
  if (isInter) {
    const hdr1 = [
      { text: 'HSN/SAC', bold: true, alignment: 'center', fillColor: GREEN, fontSize: 9 },
      { text: 'Taxable Value', bold: true, alignment: 'center', fillColor: GREEN, fontSize: 9 },
      { text: 'IGST', bold: true, alignment: 'center', fillColor: GREEN, colSpan: 2, fontSize: 9 }, {},
      { text: 'Total Tax Amount', bold: true, alignment: 'center', fillColor: GREEN, fontSize: 9 },
    ]
    const hdr2 = [
      { text: '' }, { text: '' },
      { text: 'Rate', bold: true, alignment: 'center', fontSize: 8 },
      { text: 'Amount', bold: true, alignment: 'center', fontSize: 8 },
      { text: '' },
    ]
    let tT = 0, tI = 0, tTax = 0
    const dataRows = hsnGroups.map(g => {
      tT += g.taxable; tI += g.igst; tTax += g.totalTax
      return [
        { text: g.hsn, alignment: 'center', fontSize: 9 },
        { text: fmtNum(g.taxable), alignment: 'right', fontSize: 9 },
        { text: g.rate + '%', alignment: 'center', fontSize: 9 },
        { text: fmtNum(g.igst), alignment: 'right', fontSize: 9 },
        { text: fmtRs(g.totalTax), alignment: 'right', fontSize: 9 },
      ]
    })
    const tot = [
      { text: 'Total', bold: true, alignment: 'center', fontSize: 9 },
      { text: fmtNum(tT), bold: true, alignment: 'right', fontSize: 9 },
      { text: '' },
      { text: fmtNum(tI), bold: true, alignment: 'right', fontSize: 9 },
      { text: fmtRs(tTax), bold: true, alignment: 'right', fontSize: 9 },
    ]
    hsnSection = {
      table: { headerRows: 2, widths: [60, 70, 35, 60, '*'], body: [hdr1, hdr2, ...dataRows, tot] },
      layout: { hLineWidth: (i) => i === 0 ? 0 : 0.5, vLineWidth: () => 0.5, paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2 },
    }
  } else {
    const hdr1 = [
      { text: 'HSN/SAC', bold: true, alignment: 'center', fillColor: GREEN, fontSize: 9 },
      { text: 'Taxable Value', bold: true, alignment: 'center', fillColor: GREEN, fontSize: 9 },
      { text: 'CGST', bold: true, alignment: 'center', fillColor: GREEN, colSpan: 2, fontSize: 9 }, {},
      { text: 'SGST', bold: true, alignment: 'center', fillColor: GREEN, colSpan: 2, fontSize: 9 }, {},
      { text: 'Total Tax Amount', bold: true, alignment: 'center', fillColor: GREEN, fontSize: 9 },
    ]
    const hdr2 = [
      { text: '' }, { text: '' },
      { text: 'Rate', bold: true, alignment: 'center', fontSize: 8 },
      { text: 'Amount', bold: true, alignment: 'center', fontSize: 8 },
      { text: 'Rate', bold: true, alignment: 'center', fontSize: 8 },
      { text: 'Amount', bold: true, alignment: 'center', fontSize: 8 },
      { text: '' },
    ]
    let tT = 0, tC = 0, tS = 0, tTax = 0
    const dataRows = hsnGroups.map(g => {
      tT += g.taxable; tC += g.cgst; tS += g.sgst; tTax += g.totalTax
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
    const tot = [
      { text: 'Total', bold: true, alignment: 'center', fontSize: 9 },
      { text: fmtNum(tT), bold: true, alignment: 'right', fontSize: 9 },
      { text: '' },
      { text: fmtNum(tC), bold: true, alignment: 'right', fontSize: 9 },
      { text: '' },
      { text: fmtNum(tS), bold: true, alignment: 'right', fontSize: 9 },
      { text: fmtRs(tTax), bold: true, alignment: 'right', fontSize: 9 },
    ]
    hsnSection = {
      table: { headerRows: 2, widths: [45, 55, 25, 45, 25, 45, '*'], body: [hdr1, hdr2, ...dataRows, tot] },
      layout: { hLineWidth: (i) => i === 0 ? 0 : 0.5, vLineWidth: () => 0.5, paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 2, paddingBottom: () => 2 },
    }
  }

  // ─── Amount in words ─────────────────────────────────────────────────────
  const words = {
    table: { widths: ['*'], body: [[{
      stack: [
        { text: 'Total Amount (in words)', bold: true, fontSize: 9 },
        { text: numberToWords(computedTotal), fontSize: 9, margin: [0, 2, 0, 0] },
      ],
      fillColor: GREEN,
    }]] },
    layout: { hLineWidth: (i) => i === 0 ? 0 : 0.5, vLineWidth: () => 0.5, paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 3, paddingBottom: () => 3 },
  }

  // ─── Footer ──────────────────────────────────────────────────────────────
  const bankStack = [{ text: 'Bank Details', bold: true, fontSize: 9, margin: [0, 10, 0, 5] }]
  for (const line of SELLER.bank.split('\n')) {
    const idx = line.indexOf(':')
    if (idx > -1) {
      bankStack.push({
        text: [
          { text: line.substring(0, idx + 1), bold: true, fontSize: 9 },
          { text: ' ' + line.substring(idx + 1).trim(), fontSize: 9 },
        ],
        margin: [0, 0, 0, 1],
      })
    } else bankStack.push({ text: line, fontSize: 9, margin: [0, 0, 0, 1] })
  }

  const termsStack = [
    { text: 'Terms and Conditions', bold: true, fontSize: 9, margin: [0, 0, 0, 3] },
    { text: SELLER.terms, fontSize: 8, lineHeight: 1.2 },
  ]

  const sigStack = [
    { text: '', fontSize: 1 },
    { image: 'neuLogo', width: 45, height: 45, alignment: 'center', margin: [0, 10, 0, 8] },
    { text: 'Authorised Signatory For', fontSize: 9, alignment: 'center' },
    { text: SELLER.name.toUpperCase(), bold: true, fontSize: 9, alignment: 'center' },
  ]

  const footer = {
    table: { widths: ['36%', '34%', '30%'], body: [[{ stack: bankStack }, { stack: termsStack }, { stack: sigStack }]] },
    layout: { hLineWidth: (i) => i === 0 ? 0 : 0.5, vLineWidth: () => 0.5, paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 5, paddingBottom: () => 5 },
  }

  return {
    pageSize: 'A4',
    pageMargins: [17, 13, 17, 13],
    defaultStyle: { fontSize: 9 },
    images: { neuLogo: LOGO_PATH },
    content: [title, companySection, billShip, itemsTable, hsnSection, words, footer],
  }
}

// ─── pdfmake printer setup (Node side uses Roboto from pdfmake's vfs) ────────

const fonts = {
  Roboto: {
    normal: Buffer.from(require('pdfmake/build/vfs_fonts').pdfMake?.vfs?.['Roboto-Regular.ttf'] || require('pdfmake/build/vfs_fonts')['Roboto-Regular.ttf'] || '', 'base64'),
    bold: Buffer.from(require('pdfmake/build/vfs_fonts').pdfMake?.vfs?.['Roboto-Medium.ttf'] || require('pdfmake/build/vfs_fonts')['Roboto-Medium.ttf'] || '', 'base64'),
    italics: Buffer.from(require('pdfmake/build/vfs_fonts').pdfMake?.vfs?.['Roboto-Italic.ttf'] || require('pdfmake/build/vfs_fonts')['Roboto-Italic.ttf'] || '', 'base64'),
    bolditalics: Buffer.from(require('pdfmake/build/vfs_fonts').pdfMake?.vfs?.['Roboto-MediumItalic.ttf'] || require('pdfmake/build/vfs_fonts')['Roboto-MediumItalic.ttf'] || '', 'base64'),
  },
}
const printer = new PdfPrinter(fonts)

function renderToFile(docDef, outPath) {
  return new Promise((resolve, reject) => {
    try {
      const pdfDoc = printer.createPdfKitDocument(docDef)
      const stream = fs.createWriteStream(outPath)
      pdfDoc.pipe(stream)
      pdfDoc.end()
      stream.on('finish', resolve)
      stream.on('error', reject)
    } catch (err) { reject(err) }
  })
}

// ─── Renumbering plan ────────────────────────────────────────────────────────

// Indian fiscal year: April N → March N+1 → "NN-(NN+1)".
function fyKey(dateStr) {
  const [d, m, y] = dateStr.split('/').map(Number)
  if (m >= 4) return `${y % 100}-${String((y + 1) % 100).padStart(2, '0')}`
  return `${(y - 1) % 100}-${String(y % 100).padStart(2, '0')}`
}

function isAnomalousNumber(num) {
  // Anomalous = not a plain positive integer (e.g. "NEU2025/1", "NS/SL/25-26/112").
  return !/^\d+$/.test(num)
}

function planRenumber(parsedList) {
  // parsedList = [{ file, parsed }]
  const anomalies = []
  const toRenumber = []
  for (const it of parsedList) {
    if (!it.parsed.invoiceNumber || !it.parsed.invoiceDate || isAnomalousNumber(it.parsed.invoiceNumber)) {
      anomalies.push(it)
    } else {
      toRenumber.push(it)
    }
  }
  const byFY = {}
  for (const it of toRenumber) {
    const k = fyKey(it.parsed.invoiceDate)
    byFY[k] = byFY[k] || []
    byFY[k].push(it)
  }
  for (const k of Object.keys(byFY)) {
    byFY[k].sort((a, b) => {
      const [da, ma, ya] = a.parsed.invoiceDate.split('/').map(Number)
      const [db, mb, yb] = b.parsed.invoiceDate.split('/').map(Number)
      return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db)
    })
    byFY[k].forEach((it, idx) => {
      it.newInvoiceNumber = `NS/SL/${k}/${idx + 1}`
      const partyPart = it.file.replace(/_Sales_Invoice_.*\.pdf$/i, '')
      const numPart = it.newInvoiceNumber.replace(/\//g, '_')
      it.newFileName = `${partyPart}_Sales_Invoice_${numPart}.pdf`
    })
  }
  for (const it of anomalies) {
    it.newInvoiceNumber = it.parsed.invoiceNumber || ''
    it.newFileName = it.file
  }
  return { toRenumber, anomalies, byFY }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(OLD_DIR)) { console.error('Missing:', OLD_DIR); process.exit(1) }

  const all = fs.readdirSync(OLD_DIR).filter(f => f.toLowerCase().endsWith('.pdf')).sort()
  let files
  let outDir

  if (MODE_PREVIEW) {
    outDir = PREVIEW_DIR
    if (FILE_ARG) {
      files = all.filter(f => f === FILE_ARG)
      if (!files.length) { console.error('File not found:', FILE_ARG); process.exit(1) }
    } else {
      files = all.slice(0, 2)
    }
  } else {
    outDir = NEW_DIR
    files = LIMIT_ARG > 0 ? all.slice(0, LIMIT_ARG) : all
  }

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  console.log(`Source:    ${OLD_DIR}`)
  console.log(`Output:    ${outDir}`)
  console.log(`Files:     ${files.length}${MODE_PREVIEW ? ' (preview)' : ''}`)
  console.log(`Renumber:  ${RENUMBER}`)
  console.log('')

  // First pass — parse all so we can compute the renumbering map.
  const parsedList = []
  for (const file of files) {
    try {
      const text = await extractText(path.join(OLD_DIR, file))
      const parsed = parseInvoice(text)
      parsedList.push({ file, parsed })
    } catch (err) {
      console.log(`  [ERR-PARSE] ${file} — ${err?.message ?? err}`)
    }
  }

  let plan = null
  if (RENUMBER) {
    plan = planRenumber(parsedList)
    console.log('Renumbering plan:')
    for (const k of Object.keys(plan.byFY).sort()) {
      console.log(`  FY ${k}: ${plan.byFY[k].length} invoices → NS/SL/${k}/1 .. NS/SL/${k}/${plan.byFY[k].length}`)
    }
    console.log(`  Anomalies (kept as-is): ${plan.anomalies.length}`)
    for (const a of plan.anomalies) {
      console.log(`    - ${a.file}  number=${a.newInvoiceNumber || '(missing)'}`)
    }
    console.log('')
    if (PLAN_ONLY) return
    // Empty the output folder before rendering so renamed files don't leave stragglers.
    if (!MODE_PREVIEW) {
      const existing = fs.readdirSync(outDir).filter(f => f.toLowerCase().endsWith('.pdf'))
      for (const f of existing) fs.unlinkSync(path.join(outDir, f))
      console.log(`  Cleared ${existing.length} existing PDFs from ${outDir}`)
      console.log('')
    }
  }

  const planLookup = new Map()
  if (plan) {
    for (const it of [...plan.toRenumber, ...plan.anomalies]) {
      planLookup.set(it.file, { newInvoiceNumber: it.newInvoiceNumber, newFileName: it.newFileName })
    }
  }

  let ok = 0, fail = 0
  for (const { file, parsed } of parsedList) {
    try {
      if (!parsed.partyName || !parsed.items.length) {
        console.log(`  [SKIP] ${file} — parsed party=${!!parsed.partyName} items=${parsed.items.length}`)
        fail++
        continue
      }
      let outName = file
      const renderInvoice = { ...parsed }
      if (plan) {
        const mapping = planLookup.get(file)
        if (mapping) {
          outName = mapping.newFileName
          renderInvoice.invoiceNumber = mapping.newInvoiceNumber
        }
      }
      const outPath = path.join(outDir, outName)
      const docDef = buildDoc(renderInvoice)
      await renderToFile(docDef, outPath)
      console.log(`  [OK]   ${file}  →  ${renderInvoice.invoiceNumber}  ${parsed.partyName}  ₹${parsed.totalAmount}${outName !== file ? `  (file: ${outName})` : ''}`)
      ok++
    } catch (err) {
      console.log(`  [ERR]  ${file} — ${err?.message ?? err}`)
      fail++
    }
  }

  console.log('')
  console.log(`Done. ok=${ok} fail=${fail}`)
}

main().catch(err => { console.error(err); process.exit(1) })
