// GSTN-compliant GSTR-1 JSON converter — lifted verbatim from desktop's
// handlers/gstReport.ts (2026-07-14) so BOTH apps produce byte-identical
// portal files. Reference: GSTN GSTR-1 JSON Schema v3 (offline tool / portal
// upload format).
//
// Input shape (what desktop's getGSTR1 returns and mobile's portal adapter
// assembles): { sections: { b2b|b2cl|b2cs: { invoices: [...] } }, hsnSummary,
// docSummary, period }. Each invoice carries invoiceNumber/invoiceDate/
// totalAmount/isInterState/placeOfSupply/reverseCharge, customer.taxId, and
// items[] with taxRate/quantity/rate/discount/taxableAmount + the four split
// amounts.

const round2 = (n: number) => Math.round((n || 0) * 100) / 100

// GSTN expects DD-MM-YYYY date strings (NOT ISO YYYY-MM-DD)
const fmtGSTNDate = (d: any): string => {
  const dt = new Date(d)
  const dd = String(dt.getDate()).padStart(2, '0')
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const yyyy = dt.getFullYear()
  return `${dd}-${mm}-${yyyy}`
}

// Filing period in MMYYYY format derived from the report's startDate (YYYY-MM-DD).
// e.g. "2026-04-01" → "042026"
const periodToFP = (startDateStr: string | undefined): string => {
  if (!startDateStr || startDateStr.length < 10) return ''
  return startDateStr.substring(5, 7) + startDateStr.substring(0, 4)
}

// Group an invoice's line items by tax rate, returning the GSTN itms[] array.
// Each tax rate becomes one entry with summed taxable value + tax amounts.
const groupItemsByRateForGSTN = (items: any[], isInter: boolean) => {
  const buckets: Record<number, { txval: number; iamt: number; camt: number; samt: number; csamt: number }> = {}
  for (const it of items || []) {
    const rt = it.taxRate || 0
    if (!buckets[rt]) buckets[rt] = { txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 }
    const taxable = it.taxableAmount ?? (it.quantity * it.rate - (it.discount || 0))
    buckets[rt].txval += taxable
    if (isInter) {
      buckets[rt].iamt += it.igstAmount ?? (taxable * rt) / 100
    } else {
      buckets[rt].camt += it.cgstAmount ?? (taxable * rt) / 200
      buckets[rt].samt += it.sgstAmount ?? (taxable * rt) / 200
    }
    buckets[rt].csamt += it.cessAmount || 0
  }
  return Object.entries(buckets).map(([rate, v], idx) => ({
    num: idx + 1,
    itm_det: {
      rt: parseFloat(rate),
      txval: round2(v.txval),
      iamt: round2(v.iamt),
      camt: round2(v.camt),
      samt: round2(v.samt),
      csamt: round2(v.csamt),
    },
  }))
}

const stateCodeFromGstin = (g: string | null | undefined) => (g || '').substring(0, 2)

export function toGSTNGstr1(data: any, companyGstin: string): any {
  // === B2B: invoices grouped by customer GSTIN (ctin) ===
  const b2bByCtin: Record<string, any[]> = {}
  for (const inv of data.sections?.b2b?.invoices || []) {
    const ctin = inv.customer?.taxId
    if (!ctin) continue
    if (!b2bByCtin[ctin]) b2bByCtin[ctin] = []
    b2bByCtin[ctin].push({
      inum: inv.invoiceNumber,
      idt: fmtGSTNDate(inv.invoiceDate),
      val: round2(inv.totalAmount),
      pos: stateCodeFromGstin(inv.customer?.taxId),
      rchrg: inv.reverseCharge ? 'Y' : 'N',
      inv_typ: 'R', // R=Regular. SEZ/Deemed Export not tracked in our schema yet.
      itms: groupItemsByRateForGSTN(inv.items || [], !!inv.isInterState),
    })
  }
  const b2b = Object.entries(b2bByCtin).map(([ctin, inv]) => ({ ctin, inv }))

  // === B2CL: invoices grouped by place-of-supply (pos) ===
  const b2clByPos: Record<string, any[]> = {}
  for (const inv of data.sections?.b2cl?.invoices || []) {
    const pos = inv.placeOfSupply || stateCodeFromGstin(inv.customer?.taxId) || ''
    if (!pos) continue
    if (!b2clByPos[pos]) b2clByPos[pos] = []
    b2clByPos[pos].push({
      inum: inv.invoiceNumber,
      idt: fmtGSTNDate(inv.invoiceDate),
      val: round2(inv.totalAmount),
      itms: groupItemsByRateForGSTN(inv.items || [], true), // B2CL is always inter-state
    })
  }
  const b2cl = Object.entries(b2clByPos).map(([pos, inv]) => ({ pos, inv }))

  // === B2CS: aggregated rows by (sply_ty × rt × pos × typ) ===
  const b2csBuckets: Record<string, any> = {}
  for (const inv of data.sections?.b2cs?.invoices || []) {
    const pos = inv.placeOfSupply || stateCodeFromGstin(inv.customer?.taxId) || stateCodeFromGstin(companyGstin)
    const isInter = !!inv.isInterState
    const sply_ty = isInter ? 'INTER' : 'INTRA'
    for (const it of inv.items || []) {
      const rt = it.taxRate || 0
      const key = `${sply_ty}|${rt}|${pos}|OE`
      if (!b2csBuckets[key]) {
        b2csBuckets[key] = { sply_ty, rt, typ: 'OE', pos, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 }
      }
      const taxable = it.taxableAmount ?? (it.quantity * it.rate - (it.discount || 0))
      b2csBuckets[key].txval += taxable
      if (isInter) {
        b2csBuckets[key].iamt += it.igstAmount ?? (taxable * rt) / 100
      } else {
        b2csBuckets[key].camt += it.cgstAmount ?? (taxable * rt) / 200
        b2csBuckets[key].samt += it.sgstAmount ?? (taxable * rt) / 200
      }
      b2csBuckets[key].csamt += it.cessAmount || 0
    }
  }
  const b2cs = Object.values(b2csBuckets).map((v: any) => ({
    sply_ty: v.sply_ty,
    rt: v.rt,
    typ: v.typ,
    pos: v.pos,
    txval: round2(v.txval),
    iamt: round2(v.iamt),
    camt: round2(v.camt),
    samt: round2(v.samt),
    csamt: round2(v.csamt),
  }))

  // === HSN summary ===
  const hsnData = (data.hsnSummary || []).map((h: any, idx: number) => ({
    num: idx + 1,
    hsn_sc: h.hsnCode || '',
    desc: h.description || '',
    uqc: h.uqc || 'NOS',
    qty: round2(h.totalQuantity || 0),
    val: round2(h.totalValue || 0),
    txval: round2(h.taxableValue || 0),
    iamt: round2(h.igstAmount || 0),
    camt: round2(h.cgstAmount || 0),
    samt: round2(h.sgstAmount || 0),
    csamt: round2(h.cessAmount || 0),
  }))

  // === Document issue summary (doc_num: 1 = Invoices for outward supply) ===
  const totalIssued = data.docSummary?.totalInvoices || 0
  const docIssue = {
    doc_det: [
      {
        doc_num: 1,
        docs: [
          {
            num: 1,
            from: data.sections?.b2b?.invoices?.[0]?.invoiceNumber || '',
            to:
              data.sections?.b2b?.invoices?.[data.sections?.b2b?.invoices?.length - 1]?.invoiceNumber ||
              '',
            totnum: totalIssued,
            cancel: 0,
            net_issue: totalIssued,
          },
        ],
      },
    ],
  }

  const out: any = {
    gstin: companyGstin || '',
    fp: periodToFP(data.period?.startDate),
    gt: 0, // Gross turnover preceding FY — not tracked; user fills on portal if needed.
    cur_gt: round2(data.docSummary?.totalValue || 0),
  }
  if (b2b.length > 0) out.b2b = b2b
  if (b2cl.length > 0) out.b2cl = b2cl
  if (b2cs.length > 0) out.b2cs = b2cs
  if (hsnData.length > 0) out.hsn = { data: hsnData }
  out.doc_issue = docIssue
  // cdnr / cdnur / exp / nil omitted for v1 — add when those sections actually
  // have data in your books (most small businesses won't have any in a given month).
  return out
}
