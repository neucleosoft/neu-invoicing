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
  // `sign` is +1 for invoices and unregistered DEBIT notes, −1 for unregistered
  // CREDIT notes — GSTN's rule is that small (non-B2CL) notes to unregistered
  // customers never get their own section; they NET into B2CS.
  const b2csBuckets: Record<string, any> = {}
  const addToB2cs = (items: any[], isInter: boolean, pos: string, sign: number) => {
    const sply_ty = isInter ? 'INTER' : 'INTRA'
    for (const it of items || []) {
      const rt = it.taxRate || 0
      const key = `${sply_ty}|${rt}|${pos}|OE`
      if (!b2csBuckets[key]) {
        b2csBuckets[key] = { sply_ty, rt, typ: 'OE', pos, txval: 0, iamt: 0, camt: 0, samt: 0, csamt: 0 }
      }
      const taxable = it.taxableAmount ?? (it.quantity * it.rate - (it.discount || 0))
      b2csBuckets[key].txval += sign * taxable
      if (isInter) {
        b2csBuckets[key].iamt += sign * (it.igstAmount ?? (taxable * rt) / 100)
      } else {
        b2csBuckets[key].camt += sign * (it.cgstAmount ?? (taxable * rt) / 200)
        b2csBuckets[key].samt += sign * (it.sgstAmount ?? (taxable * rt) / 200)
      }
      b2csBuckets[key].csamt += sign * (it.cessAmount || 0)
    }
  }
  for (const inv of data.sections?.b2cs?.invoices || []) {
    const pos = inv.placeOfSupply || stateCodeFromGstin(inv.customer?.taxId) || stateCodeFromGstin(companyGstin)
    addToB2cs(inv.items || [], !!inv.isInterState, pos, +1)
  }

  // === CDNR: notes to REGISTERED customers, grouped by GSTIN. GSTN v3
  // "delinked" shape — a note stands alone, no original-invoice reference. ===
  const cdnrByCtin: Record<string, any[]> = {}
  for (const note of data.sections?.cdnr?.notes || []) {
    const ctin = note.customer?.taxId
    if (!ctin) continue
    if (!cdnrByCtin[ctin]) cdnrByCtin[ctin] = []
    cdnrByCtin[ctin].push({
      ntty: note.noteType === 'DEBIT_NOTE' ? 'D' : 'C',
      nt_num: note.noteNumber,
      nt_dt: fmtGSTNDate(note.noteDate),
      pos: stateCodeFromGstin(ctin),
      rchrg: 'N',
      inv_typ: 'R',
      val: round2(note.totalAmount),
      itms: groupItemsByRateForGSTN(note.items || [], !!note.isInterState),
    })
  }
  const cdnr = Object.entries(cdnrByCtin).map(([ctin, nt]) => ({ ctin, nt }))

  // === CDNUR: only inter-state notes to UNREGISTERED customers above ₹2.5L
  // qualify (typ B2CL). Everything smaller was already netted into B2CS above. ===
  const cdnur: any[] = []
  for (const note of data.sections?.cdnur?.notes || []) {
    const pos = note.placeOfSupply || stateCodeFromGstin(companyGstin)
    if (note.isInterState && note.totalAmount > 250000) {
      cdnur.push({
        ntty: note.noteType === 'DEBIT_NOTE' ? 'D' : 'C',
        nt_num: note.noteNumber,
        nt_dt: fmtGSTNDate(note.noteDate),
        val: round2(note.totalAmount),
        pos,
        typ: 'B2CL',
        itms: groupItemsByRateForGSTN(note.items || [], true),
      })
    } else {
      addToB2cs(note.items || [], !!note.isInterState, pos, note.noteType === 'DEBIT_NOTE' ? +1 : -1)
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
  if (cdnr.length > 0) out.cdnr = cdnr
  if (cdnur.length > 0) out.cdnur = cdnur
  if (hsnData.length > 0) out.hsn = { data: hsnData }
  out.doc_issue = docIssue
  // exp / nil still omitted — add when those sections actually carry data
  // (supplyType EXPORT / NIL_EXEMPT are rare for this app's audience).
  return out
}
