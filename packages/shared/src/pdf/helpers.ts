// Pure formatting + tax-grouping helpers, lifted from apps/desktop/src/utils/pdfHelpers.ts
// (only the platform-neutral parts — the jsPDF drawing functions are dead code and
// stay out). Shared by every pdfmake document-definition builder.

import type { PDFDocumentData } from './types'

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

/** Balance with ₹ — negative shown as "(Advance)" (party in credit) */
export function fmtBalanceRs(n: number): string {
  return n < 0 ? `${fmtRs(Math.abs(n))} (Advance)` : fmtRs(n)
}

/** Balance number — negative shown as "(Advance)" */
export function fmtBalanceNum(n: number): string {
  return n < 0 ? `${fmtNum(Math.abs(n))} (Advance)` : fmtNum(n)
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
