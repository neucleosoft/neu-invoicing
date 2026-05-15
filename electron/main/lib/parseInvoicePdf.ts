// Text-based invoice parser for app-generated PDFs (and any digital PDF whose
// text layer is preserved). Extracts the same fields as the OCR pipeline so
// the renderer can consume both interchangeably. Used as the primary path for
// PreviousInvoice uploads — OCR is the fallback for scanned / image PDFs.
//
// Logic ported from `scripts/import-invoices.js` (proven against 365 real
// NEUCLEO SOFT / Neu Invoicing PDF templates). Keep behaviour in sync if you
// change the JS copy.

import { PDFParse } from 'pdf-parse'

export interface ParsedInvoiceItem {
  name: string
  hsnCode: string | null
  quantity: number
  unit: string | null
  rate: number
  taxRate: number
  total: number
}

// Shape matches the renderer's existing handleFilePick consumer (OCR output
// keys: supplierName / supplierGstin / billNumber / billDate / totalAmount /
// items[{name, hsnCode, quantity, rate, taxRate, total}]) so callers don't
// need to branch on source.
export interface ParsedInvoice {
  supplierName: string | null
  supplierGstin: string | null
  billNumber: string | null
  billDate: string | null // YYYY-MM-DD
  totalAmount: number
  items: ParsedInvoiceItem[]
}

const parseNum = (s: string | undefined): number => {
  if (!s) return 0
  return parseFloat(String(s).replace(/[₹,\s]/g, '')) || 0
}

const round2 = (n: number): number => Math.round(n * 100) / 100

const parseDateDMY = (s: string): Date | null => {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/)
  if (!m) return null
  return new Date(+m[3], +m[2] - 1, +m[1])
}

const toIsoDate = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Strip serial-number references (NEU/YYYY/MM/...) from item descriptions.
const normalizeItemName = (name: string): string => {
  return (
    name
      .replace(/\d+(?:\.\d+)?\s*\([^)]*NEU[^)]*\)/gi, '')
      .replace(
        /\bNEU\/\d{4}\/\d{2}\/[\dA-Z/]+(?:\s*[-–]\s*NEU\/\d{4}\/\d{2}\/[\dA-Z/]+)*/gi,
        '',
      )
      .replace(/\s+/g, ' ')
      .replace(/[-–,\s]+$/, '')
      .trim() || name.trim()
  )
}

// Extract raw text from PDF bytes using pdf-parse v2 PDFParse class. Internally
// uses pdfjs-dist; works in Electron main process with no native deps.
export const extractTextFromPdfBytes = async (bytes: Uint8Array): Promise<string> => {
  // PDFParse transfers the TypedArray to its worker — pass a fresh copy so the
  // caller's bytes remain usable (the upload flow stores the original PDF as
  // fileData).
  const parser = new PDFParse({ data: new Uint8Array(bytes) })
  const result = await parser.getText()
  return result.pages.map((p) => p.text).join('\n')
}

// Internal mutable shape during parsing; converted to ParsedInvoice at the end.
interface MutableInvoice {
  invoiceNumber: string
  invoiceDate: Date | null
  partyName: string
  gstin: string
  items: Array<{
    sno: number
    name: string
    hsnCode: string
    quantity: number
    unit: string
    rate: number
    amount: number
    taxRate: number
  }>
  hsnTaxRates: Record<string, number>
  totalAmount: number
}

export const parseInvoiceText = (text: string): ParsedInvoice => {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)

  const inv: MutableInvoice = {
    invoiceNumber: '',
    invoiceDate: null,
    partyName: '',
    gstin: '',
    items: [],
    hsnTaxRates: {},
    totalAmount: 0,
  }

  // ─── Invoice Number & Date ───
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].includes('Invoice No')) continue
    let numVal = lines[i].replace(/.*Invoice No\.?\s*/, '').replace(/Invoice Date.*/, '').trim()
    if (!numVal && i + 1 < lines.length) {
      const next = lines[i + 1]
      const dm = next.match(/(\d{2}\/\d{2}\/\d{4})/)
      if (dm && dm.index !== undefined) {
        numVal = next.substring(0, dm.index).trim()
        inv.invoiceDate = parseDateDMY(dm[1])
      } else if (!next.includes('Invoice Date')) {
        numVal = next
      }
    }
    inv.invoiceNumber = numVal
    if (!inv.invoiceDate) {
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        const dm = lines[j].match(/(\d{2}\/\d{2}\/\d{4})/)
        if (dm) {
          inv.invoiceDate = parseDateDMY(dm[1])
          break
        }
      }
    }
    break
  }

  // ─── BILL TO section ───
  const billToIdx = lines.findIndex((l) => /^BILL TO:?$/i.test(l))
  const shipToIdx = lines.findIndex((l, i) => i > billToIdx && /^SHIP TO:?$/i.test(l))
  const tableIdx = lines.findIndex((l) => /^S\.?NO\.?\s/i.test(l))
  const billToEnd =
    shipToIdx > billToIdx ? shipToIdx : tableIdx > billToIdx ? tableIdx : billToIdx + 15

  if (billToIdx >= 0 && billToIdx + 1 < lines.length) {
    inv.partyName = lines[billToIdx + 1]
    for (let i = billToIdx + 1; i < billToEnd; i++) {
      if (!inv.gstin) {
        const m = lines[i].match(/GSTIN:\s*(\S+)/i)
        if (m) inv.gstin = m[1].toUpperCase()
      }
    }
  }

  // ─── Line Items (tab-separated columns) ───
  const hasHsnCol = tableIdx >= 0 && /HSN/i.test(lines[tableIdx])
  const hasFreightCol = tableIdx >= 0 && /FREIGHT/i.test(lines[tableIdx])

  if (tableIdx >= 0) {
    let itemsEnd = lines.length
    for (let i = tableIdx + 1; i < lines.length; i++) {
      if (/^(IGST|CGST|SGST)\s*@/i.test(lines[i]) || /^TOTAL[\s\t]/i.test(lines[i])) {
        itemsEnd = i
        break
      }
    }

    let curSno = 0
    let curName = ''

    for (let i = tableIdx + 1; i < itemsEnd; i++) {
      const line = lines[i]
      const cols = line.split('\t').map((c) => c.trim()).filter(Boolean)

      // 1a. Complete item with HSN via clean tab separation (6+ columns).
      //     Also handles 7-col FREIGHT variant: S.NO, NAME, HSN, FREIGHT, QTY, RATE, AMOUNT.
      if (cols.length >= 6 && /^\d+$/.test(cols[0])) {
        let qtyColIdx = 3
        let qtyM = cols[qtyColIdx].match(/^(\d+)\s*([A-Za-z]+)?$/)
        if (!qtyM && hasFreightCol && cols.length >= 7) {
          qtyColIdx = 4
          qtyM = cols[qtyColIdx].match(/^(\d+)\s*([A-Za-z]+)?$/)
        }
        if (qtyM) {
          curSno = 0
          curName = ''
          inv.items.push({
            sno: +cols[0],
            name: normalizeItemName(cols[1]),
            hsnCode: cols[2],
            quantity: +qtyM[1],
            unit: qtyM[2] || 'PCS',
            rate: parseNum(cols[qtyColIdx + 1]),
            amount: parseNum(cols[qtyColIdx + 2]),
            taxRate: 0,
          })
          continue
        }
      }

      // 1b. Complete item WITHOUT HSN via tab separation (5 columns).
      if (cols.length >= 5 && /^\d+$/.test(cols[0]) && !hasHsnCol) {
        const qtyM = cols[2].match(/^(\d+)\s*([A-Za-z]+)?$/)
        if (qtyM) {
          curSno = 0
          curName = ''
          inv.items.push({
            sno: +cols[0],
            name: normalizeItemName(cols[1]),
            hsnCode: '',
            quantity: +qtyM[1],
            unit: qtyM[2] || 'PCS',
            rate: parseNum(cols[3]),
            amount: parseNum(cols[4]),
            taxRate: 0,
          })
          continue
        }
      }

      // 2a. Complete item via space regex WITH HSN (handles merged tab columns).
      {
        const norm = line.replace(/\t/g, '  ')
        const m = norm.match(
          /^(\d+)\s+(.+)\s+(\d{4,8})\s+(\d+)\s+([A-Za-z]+)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s*$/,
        )
        if (m) {
          curSno = 0
          curName = ''
          inv.items.push({
            sno: +m[1],
            name: normalizeItemName(m[2].trim()),
            hsnCode: m[3],
            quantity: +m[4],
            unit: m[5],
            rate: parseNum(m[6]),
            amount: parseNum(m[7]),
            taxRate: 0,
          })
          continue
        }
      }

      // 3a. Data-only row for multi-line items: HSN, QTY UNIT, RATE, AMOUNT.
      if (cols.length >= 4 && /^\d{4,8}$/.test(cols[0]) && curSno > 0) {
        const qtyM = cols[1].match(/^(\d+)\s*([A-Za-z]+)?$/)
        if (qtyM) {
          inv.items.push({
            sno: curSno,
            name: normalizeItemName(curName),
            hsnCode: cols[0],
            quantity: +qtyM[1],
            unit: qtyM[2] || 'PCS',
            rate: parseNum(cols[2]),
            amount: parseNum(cols[3]),
            taxRate: 0,
          })
          curSno = 0
          curName = ''
          continue
        }
      }

      // 3b. Data-only row with merged HSN+QTY (space regex).
      if (curSno > 0 && cols.length >= 2) {
        const norm = line.replace(/\t/g, '  ')
        const dm = norm.match(
          /^(\d{4,8})\s+(\d+)\s+([A-Za-z]+)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s*$/,
        )
        if (dm) {
          inv.items.push({
            sno: curSno,
            name: normalizeItemName(curName),
            hsnCode: dm[1],
            quantity: +dm[2],
            unit: dm[3],
            rate: parseNum(dm[4]),
            amount: parseNum(dm[5]),
            taxRate: 0,
          })
          curSno = 0
          curName = ''
          continue
        }
      }

      // 3c. Data-only row for no-HSN multi-line items.
      if (curSno > 0 && cols.length >= 3) {
        const qtyM = cols[0].match(/^(\d+)\s*([A-Za-z]+)?$/)
        if (qtyM) {
          inv.items.push({
            sno: curSno,
            name: normalizeItemName(curName),
            hsnCode: '',
            quantity: +qtyM[1],
            unit: qtyM[2] || 'PCS',
            rate: parseNum(cols[1]),
            amount: parseNum(cols[2]),
            taxRate: 0,
          })
          curSno = 0
          curName = ''
          continue
        }
      }

      // 2b. Complete item via space regex WITHOUT HSN.
      {
        const norm = line.replace(/\t/g, '  ')
        const m = norm.match(
          /^(\d+)\s+(.+)\s+(\d+)\s+([A-Za-z]+)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s*$/,
        )
        if (m) {
          curSno = 0
          curName = ''
          inv.items.push({
            sno: +m[1],
            name: normalizeItemName(m[2].trim()),
            hsnCode: '',
            quantity: +m[3],
            unit: m[4],
            rate: parseNum(m[5]),
            amount: parseNum(m[6]),
            taxRate: 0,
          })
          continue
        }
      }

      // 4. S.NO + name start (multi-line item, no HSN/QTY yet).
      if (cols.length >= 2 && /^\d+$/.test(cols[0]) && +cols[0] >= 1) {
        curSno = +cols[0]
        curName = cols.slice(1).join(' ')
        continue
      }

      // 5. Continuation line (serial reference, etc.).
      if (curSno > 0 && cols.length > 0) {
        curName += ' ' + cols.join(' ')
      }
    }
  }

  // ─── HSN/SAC Summary Table (authoritative tax rates per HSN) ───
  const noHsnSummary: Array<{ taxableValue: number; taxRate: number }> = []
  const hsnIdx = lines.findIndex((l) => /^HSN\/SAC[\s\t]/i.test(l))
  if (hsnIdx >= 0) {
    const isIGST = /IGST/i.test(lines[hsnIdx])
    for (let i = hsnIdx + 1; i < lines.length; i++) {
      const l = lines[i]
      if (/^Total[\s\t]/i.test(l) && /^\D/.test(l)) break
      if (/^Total Amount/i.test(l)) break
      const rateM = l.match(/(\d+(?:\.\d+)?)%/)
      if (!rateM) continue
      const rate = parseFloat(rateM[1])
      const totalRate = isIGST ? rate : rate * 2
      const hsnM = l.match(/^(\d{4,8})[\s\t]/)
      if (hsnM) {
        inv.hsnTaxRates[hsnM[1]] = totalRate
        continue
      }
      if (/^-[\s\t]/.test(l)) {
        const valM = l.match(/^-[\s\t]+([\d,]+(?:\.\d+)?)/)
        if (valM) {
          noHsnSummary.push({ taxableValue: parseNum(valM[1]), taxRate: totalRate })
        }
      }
    }
  }

  // Map tax rates onto items.
  for (const item of inv.items) {
    if (item.hsnCode) item.taxRate = inv.hsnTaxRates[item.hsnCode] || 0
  }

  // For items without HSN, assign tax rates from noHsnSummary.
  const unratedItems = inv.items.filter((it) => !it.hsnCode && !it.taxRate)
  if (unratedItems.length > 0 && noHsnSummary.length > 0) {
    if (noHsnSummary.length === 1) {
      for (const it of unratedItems) it.taxRate = noHsnSummary[0].taxRate
    } else {
      const usedSummary = new Set<number>()
      for (const it of unratedItems) {
        const idx = noHsnSummary.findIndex(
          (s, i) => !usedSummary.has(i) && Math.abs(s.taxableValue - it.amount) < 1,
        )
        if (idx >= 0) {
          it.taxRate = noHsnSummary[idx].taxRate
          usedSummary.add(idx)
        }
      }
      const stillUnrated = inv.items.filter((it) => !it.hsnCode && !it.taxRate)
      if (stillUnrated.length > 0) {
        const remainingRates = noHsnSummary.filter((_, i) => !usedSummary.has(i))
        if (remainingRates.length > 0) {
          for (const it of stillUnrated) it.taxRate = remainingRates[0].taxRate
        }
      }
    }
  }

  // Final fallback: extract rate from IGST/CGST tax lines.
  if (inv.items.some((it) => !it.taxRate)) {
    for (const line of lines) {
      const igstM = line.match(/^IGST\s*@\s*(\d+(?:\.\d+)?)%/i)
      if (igstM) {
        const rate = parseFloat(igstM[1])
        for (const it of inv.items) if (!it.taxRate) it.taxRate = rate
        break
      }
      const cgstM = line.match(/^CGST\s*@\s*(\d+(?:\.\d+)?)%/i)
      if (cgstM) {
        const rate = parseFloat(cgstM[1]) * 2
        for (const it of inv.items) if (!it.taxRate) it.taxRate = rate
        break
      }
    }
  }

  // ─── Total Amount (from TOTAL row in items table — uppercase only) ───
  const searchStart = tableIdx >= 0 ? tableIdx + 1 : 0
  for (let i = searchStart; i < lines.length; i++) {
    if (/^TOTAL[\s\t]/.test(lines[i])) {
      const m = lines[i].match(/([\d,]+(?:\.\d+)?)\s*$/)
      if (m) {
        inv.totalAmount = parseNum(m[1])
        break
      }
    }
  }

  // Fallback: compute from items + tax.
  if (!inv.totalAmount && inv.items.length > 0) {
    const sub = inv.items.reduce((s, it) => s + it.amount, 0)
    const tax = inv.items.reduce((s, it) => s + (it.amount * (it.taxRate || 0)) / 100, 0)
    inv.totalAmount = round2(sub + tax)
  }

  // Map to OCR-compatible shape.
  return {
    supplierName: inv.partyName || null,
    supplierGstin: inv.gstin || null,
    billNumber: inv.invoiceNumber || null,
    billDate: inv.invoiceDate ? toIsoDate(inv.invoiceDate) : null,
    totalAmount: inv.totalAmount,
    items: inv.items.map((it) => ({
      name: it.name,
      hsnCode: it.hsnCode || null,
      quantity: it.quantity,
      unit: it.unit || null,
      rate: it.rate,
      taxRate: it.taxRate,
      total: it.amount,
    })),
  }
}

// One-shot helper: bytes → parsed invoice. Returns null if parsing produced
// no usable data so the caller can fall back to OCR.
export const extractFromPdfText = async (
  bytes: Uint8Array,
): Promise<ParsedInvoice | null> => {
  const text = await extractTextFromPdfBytes(bytes)
  // Reject empty / nearly-empty text (scanned image PDFs typically extract <50
  // chars of garbage). Threshold is intentionally low so digital PDFs with
  // short content still pass.
  if (text.replace(/\s+/g, '').length < 50) return null
  const parsed = parseInvoiceText(text)
  // Require at least an invoice number OR a party name to consider this a
  // successful text-parse. Otherwise fall back to OCR.
  if (!parsed.billNumber && !parsed.supplierName) return null
  return parsed
}
