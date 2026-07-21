// GSTN GSTR-1 portal-file builder checks (packages/shared/src/gstr1Gstn.ts):
// section shapes, note routing (cdnr / cdnur / netted-into-b2cs), and the
// rate-wise item grouping both apps rely on for the upload file.

import { toGSTNGstr1 } from '../src/gstr1Gstn'

let failures = 0
let passes = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) { passes++; console.log(`  ok  ${name}`) }
  else { failures++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`) }
}
const approx = (a: number, b: number) => Math.abs(a - b) < 1e-6

const GSTIN_MH = '27ABCDE1234F1Z5'
const GSTIN_DL = '07XYZDE9876K1Z2'
const COMPANY_GSTIN = '27COMPY9999A1Z9'

const item = (over: Record<string, unknown> = {}) => ({
  quantity: 2,
  rate: 100,
  discount: 0,
  taxRate: 18,
  taxableAmount: 200,
  igstAmount: 0,
  cgstAmount: 18,
  sgstAmount: 18,
  cessAmount: 0,
  ...over,
})

const data = {
  period: { startDate: '2026-07-01', endDate: '2026-07-31' },
  docSummary: { totalInvoices: 2, totalValue: 1236 },
  hsnSummary: [],
  sections: {
    b2b: {
      invoices: [
        {
          invoiceNumber: 'NS/SL/26-27/01',
          invoiceDate: '2026-07-05',
          totalAmount: 236,
          isInterState: false,
          reverseCharge: false,
          customer: { taxId: GSTIN_MH },
          items: [item()],
        },
        {
          invoiceNumber: 'NS/SL/26-27/02',
          invoiceDate: '2026-07-06',
          totalAmount: 236,
          isInterState: false,
          reverseCharge: false,
          customer: { taxId: GSTIN_MH },
          items: [item()],
        },
      ],
    },
    b2cl: { invoices: [] },
    b2cs: {
      invoices: [
        {
          invoiceNumber: 'NS/SL/26-27/03',
          invoiceDate: '2026-07-07',
          totalAmount: 236,
          isInterState: false,
          placeOfSupply: '27',
          customer: {},
          items: [item()],
        },
      ],
    },
    cdnr: {
      notes: [
        {
          noteNumber: 'CN-2026-001',
          noteDate: '2026-07-10',
          noteType: 'CREDIT_NOTE',
          totalAmount: 118,
          isInterState: false,
          customer: { taxId: GSTIN_DL },
          items: [item({ quantity: 1, taxableAmount: 100, cgstAmount: 9, sgstAmount: 9 })],
        },
        {
          noteNumber: 'DN-2026-001',
          noteDate: '2026-07-11',
          noteType: 'DEBIT_NOTE',
          totalAmount: 59,
          isInterState: false,
          customer: { taxId: GSTIN_DL },
          items: [item({ quantity: 0.5, taxableAmount: 50, cgstAmount: 4.5, sgstAmount: 4.5 })],
        },
      ],
    },
    cdnur: {
      notes: [
        // Small intra-state unregistered credit note → NETTED into b2cs.
        {
          noteNumber: 'CN-2026-002',
          noteDate: '2026-07-12',
          noteType: 'CREDIT_NOTE',
          totalAmount: 59,
          isInterState: false,
          placeOfSupply: '27',
          customer: {},
          items: [item({ quantity: 0.5, taxableAmount: 50, cgstAmount: 4.5, sgstAmount: 4.5 })],
        },
        // Big inter-state unregistered note → its own cdnur entry, typ B2CL.
        {
          noteNumber: 'CN-2026-003',
          noteDate: '2026-07-13',
          noteType: 'CREDIT_NOTE',
          totalAmount: 300000,
          isInterState: true,
          placeOfSupply: '07',
          customer: {},
          items: [item({ quantity: 1000, taxableAmount: 254237, igstAmount: 45763, cgstAmount: 0, sgstAmount: 0 })],
        },
      ],
    },
  },
}

const out = toGSTNGstr1(data, COMPANY_GSTIN)

console.log('\n1. envelope')
check('gstin + fp (MMYYYY from startDate)', out.gstin === COMPANY_GSTIN && out.fp === '072026')
check('cur_gt from docSummary', out.cur_gt === 1236)

console.log('\n2. b2b grouping')
check('one ctin group holding both invoices', out.b2b.length === 1 && out.b2b[0].ctin === GSTIN_MH && out.b2b[0].inv.length === 2)
check('GSTN date format DD-MM-YYYY', out.b2b[0].inv[0].idt === '05-07-2026')
check('rate-grouped itms with split', approx(out.b2b[0].inv[0].itms[0].itm_det.txval, 200) && approx(out.b2b[0].inv[0].itms[0].itm_det.camt, 18))

console.log('\n3. cdnr')
check('cdnr grouped by customer GSTIN', out.cdnr.length === 1 && out.cdnr[0].ctin === GSTIN_DL && out.cdnr[0].nt.length === 2)
check('credit → ntty C, debit → ntty D', out.cdnr[0].nt[0].ntty === 'C' && out.cdnr[0].nt[1].ntty === 'D')
check('note keeps its own number/date/value', out.cdnr[0].nt[0].nt_num === 'CN-2026-001' && out.cdnr[0].nt[0].nt_dt === '10-07-2026' && out.cdnr[0].nt[0].val === 118)
check('note itms rate-grouped', approx(out.cdnr[0].nt[0].itms[0].itm_det.txval, 100))

console.log('\n4. cdnur routing')
check('only the qualifying (inter-state > 2.5L) note appears', out.cdnur.length === 1 && out.cdnur[0].nt_num === 'CN-2026-003' && out.cdnur[0].typ === 'B2CL')
check('qualifying note carries IGST itms', approx(out.cdnur[0].itms[0].itm_det.iamt, 45763))

console.log('\n5. b2cs netting')
{
  const row = out.b2cs.find((r: any) => r.sply_ty === 'INTRA' && r.rt === 18 && r.pos === '27')
  check('small unregistered credit note netted: 200 − 50 taxable', row && approx(row.txval, 150), row ? `txval=${row.txval}` : 'row missing')
  check('tax netted too: 18 − 4.5 CGST', row && approx(row.camt, 13.5))
}

console.log('\n6. empty sections omitted')
{
  const empty = toGSTNGstr1(
    { period: { startDate: '2026-07-01' }, docSummary: {}, hsnSummary: [], sections: {} },
    COMPANY_GSTIN,
  )
  check('no b2b/b2cl/b2cs/cdnr/cdnur/hsn keys when empty', !('b2b' in empty) && !('b2cl' in empty) && !('b2cs' in empty) && !('cdnr' in empty) && !('cdnur' in empty) && !('hsn' in empty))
  check('doc_issue always present', !!empty.doc_issue)
}

console.log(`\n=== ${passes} passed, ${failures} failed ===`)
process.exit(failures > 0 ? 1 : 0)
