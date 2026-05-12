// Extracts invoice fields from a stored PreviousInvoice PDF blob.
// PreviousInvoice only stores top-level metadata (number/date/party/total) and
// the PDF blob — so to render a Sales-equivalent Excel/CSV we re-parse the PDF
// at download time. Uses pdfjs-dist (already in deps for PDF→image rendering).
//
// Mirrors the parser in scripts/convert-old-to-new-style.mjs, adapted for the
// new-style template the PDFs are now in (both originals and converted).

export interface ParsedItem {
  name: string
  hsn: string
  qty: number
  unit: string
  rate: number
  amount: number
  taxRate: number
}

export interface ParsedInvoice {
  invoiceNumber: string
  invoiceDate: string // DD/MM/YYYY
  partyName: string
  partyGstin: string
  partyPan: string
  placeOfSupply: string
  items: ParsedItem[]
  isInterState: boolean
  taxRate: number
  taxAmount: number
  totalAmount: number
}

// Lazy-import pdfjs so this util doesn't bloat the initial bundle.
async function extractText(bytes: Uint8Array): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist')
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString()

  // pdfjs detaches input on transfer; pass a copy.
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes) }).promise
  const pageTexts: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    // Reconstruct lines by Y-coordinate: items at the same y are one line.
    // pdfjs's transform[5] is the Y of the baseline.
    const byY = new Map<number, { x: number; str: string }[]>()
    for (const item of content.items as Array<{ str: string; transform: number[] }>) {
      const y = Math.round(item.transform[5])
      const x = item.transform[4]
      const bucket = byY.get(y) ?? []
      bucket.push({ x, str: item.str })
      byY.set(y, bucket)
    }
    const ys = [...byY.keys()].sort((a, b) => b - a) // top-down
    const lines = ys.map(y => byY.get(y)!.sort((a, b) => a.x - b.x).map(c => c.str).join(' '))
    pageTexts.push(lines.join('\n'))
  }
  return pageTexts.join('\n')
}

function parseNumber(s: string | undefined | null): number {
  if (s == null) return 0
  const n = parseFloat(String(s).replace(/[₹\s,]/g, '').replace(/Rs\.?/i, ''))
  return Number.isNaN(n) ? 0 : n
}

function extractPAN(gstin: string): string {
  if (!gstin || gstin.length < 12) return ''
  return gstin.substring(2, 12)
}

export async function parsePreviousInvoicePdf(bytes: Uint8Array): Promise<ParsedInvoice> {
  const text = await extractText(bytes)
  const rawLines = text.split('\n').map(l => l.trim())
  const lines = rawLines.filter(Boolean)

  let invoiceNumber = ''
  let invoiceDate = ''
  let partyName = ''
  let partyGstin = ''
  let placeOfSupply = ''

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

  // pdfjs reconstructs by Y-coordinate, so BILL TO and SHIP TO collapse onto
  // one line ("BILL TO  SHIP TO"), and the party-name row likewise contains
  // both copies of the name. Match anywhere on the line and pick the GSTIN
  // that isn't the seller's so we always land on the customer's.
  const SELLER_GSTIN = '07ASNPG3910E1Z0'
  const billIdx = lines.findIndex(l => /\bBILL TO\b/i.test(l))
  if (billIdx >= 0 && lines[billIdx + 1]) {
    // The next line is "<party>  <party>" (left and right halves), or just
    // "<party>" on a single-column PDF — take the de-duplicated first half.
    const partyLine = lines[billIdx + 1].trim()
    // Try to split into halves by collapsing 2+ spaces; the first half is the
    // bill-to name. If splitting fails, fall back to the whole line.
    const half = partyLine.split(/\s{2,}/)[0] || partyLine
    partyName = half.trim()
    for (let i = billIdx + 1; i < Math.min(lines.length, billIdx + 14); i++) {
      const l = lines[i]
      const gMatches = [...l.matchAll(/GSTIN:\s*([0-9A-Z]+)/gi)]
      for (const m of gMatches) {
        if (m[1] !== SELLER_GSTIN) { partyGstin = m[1]; break }
      }
      const pm = l.match(/Place of Supply:\s*([A-Za-z &().-]+)/i)
      if (pm) placeOfSupply = pm[1].trim()
      if (partyGstin && placeOfSupply) break
    }
  }

  const hdrIdx = lines.findIndex(l => /^S\.NO\.\s+ITEMS/i.test(l))
  const items: ParsedItem[] = []
  let taxStart = -1
  if (hdrIdx >= 0) {
    for (let i = hdrIdx + 1; i < lines.length; i++) {
      const l = lines[i]
      if (/^(IGST|CGST|SGST)\s*@/i.test(l) || /^TOTAL\b/i.test(l)) {
        taxStart = i
        break
      }
      const tokens = l.split(/\s+/)
      if (tokens.length < 6) continue
      const amount = parseNumber(tokens[tokens.length - 1])
      const rate = parseNumber(tokens[tokens.length - 2])
      const unit = tokens[tokens.length - 3]
      const qty = parseNumber(tokens[tokens.length - 4])
      const hsn = tokens[tokens.length - 5]
      const startIdx = /^\d+$/.test(tokens[0]) ? 1 : 0
      const name = tokens.slice(startIdx, tokens.length - 5).join(' ').trim()
      if (name && (amount > 0 || rate > 0 || qty > 0)) {
        items.push({ name, hsn, qty, unit, rate, amount, taxRate: 0 })
      }
    }
  }

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
        taxRate = parseFloat(cg[1]) * 2
      }
    }
  }
  items.forEach(it => { it.taxRate = taxRate })

  let totalAmount = 0
  for (let i = 0; i < lines.length; i++) {
    if (!/^TOTAL\b/i.test(lines[i])) continue
    const candidate = lines[i] + ' ' + (lines[i + 1] || '') + ' ' + (lines[i + 2] || '')
    const ms = candidate.match(/(Rs\.?|₹)\s*([\d,]+(?:\.\d+)?)/gi)
    if (ms && ms.length) {
      totalAmount = parseNumber(ms[ms.length - 1].replace(/(Rs\.?|₹)/i, ''))
      break
    }
  }

  return {
    invoiceNumber,
    invoiceDate,
    partyName,
    partyGstin,
    partyPan: extractPAN(partyGstin),
    placeOfSupply,
    items,
    isInterState,
    taxRate,
    taxAmount,
    totalAmount,
  }
}
