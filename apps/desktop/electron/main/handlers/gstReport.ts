import { ipcMain, app } from 'electron'
import { toGSTNGstr1 } from '@neu/shared'
import { getPrisma } from '../database'
import ExcelJS from 'exceljs'
import path from 'path'
import { notCancelled, notDeleted } from './softDelete'

// Indian State Codes
export const INDIAN_STATES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
  '99': 'Centre Jurisdiction'
}

interface GSTReportFilters {
  startDate: string
  endDate: string
  period?: 'monthly' | 'quarterly' | 'yearly'
}

interface GSTR1Section {
  sectionName: string
  sectionCode: string
  invoices: any[]
  totalTaxableValue: number
  totalIgst: number
  totalCgst: number
  totalSgst: number
  totalCess: number
  invoiceCount: number
}

// ────────────────────────────────────────────────────────────────────────────
// GSTN-compliant GSTR-1 JSON converter: now the SHARED toGSTNGstr1
// (packages/shared/src/gstr1Gstn.ts) so mobile produces the identical portal
// file. The helpers below remain local for the friendly-JSON and Excel paths.
// ────────────────────────────────────────────────────────────────────────────

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

const stateCodeFromGstin = (g: string | null | undefined) => (g || '').substring(0, 2)

// ────────────────────────────────────────────────────────────────────────────
// Human-friendly GSTR-1 JSON
// Same data as the GSTN file but with full descriptive keys and section
// totals at the bottom of each section (like a spreadsheet's footer row),
// plus a grand-total at the very end. Intended for CA review / archiving,
// NOT for direct GST Portal upload (use exportGSTR1ToGSTNJSON for that).
// ────────────────────────────────────────────────────────────────────────────

function toFriendlyGstr1(data: any, company: any): any {
  // Sum a list of friendly-shape items into a totals object.
  const sumLineItems = (items: any[]) => ({
    totalTaxableValue: round2(items.reduce((s, it) => s + (it.taxableValue || 0), 0)),
    totalIgst: round2(items.reduce((s, it) => s + (it.igstAmount || 0), 0)),
    totalCgst: round2(items.reduce((s, it) => s + (it.cgstAmount || 0), 0)),
    totalSgst: round2(items.reduce((s, it) => s + (it.sgstAmount || 0), 0)),
    totalCess: round2(items.reduce((s, it) => s + (it.cessAmount || 0), 0)),
  })

  // Transform a Prisma invoice's items into the friendly shape.
  const transformItems = (rawItems: any[], isInter: boolean) =>
    (rawItems || []).map((it, idx) => {
      const taxPercentage = it.taxRate || 0
      const taxable = it.taxableAmount ?? (it.quantity * it.rate - (it.discount || 0))
      return {
        serialNumber: idx + 1,
        itemName: it.item?.name || '',
        hsnCode: it.hsnCode || it.item?.hsnCode || '',
        quantity: it.quantity,
        rate: it.rate,
        taxPercentage,
        taxableValue: round2(taxable),
        igstAmount: round2(isInter ? (it.igstAmount ?? (taxable * taxPercentage) / 100) : 0),
        cgstAmount: round2(isInter ? 0 : (it.cgstAmount ?? (taxable * taxPercentage) / 200)),
        sgstAmount: round2(isInter ? 0 : (it.sgstAmount ?? (taxable * taxPercentage) / 200)),
        cessAmount: round2(it.cessAmount || 0),
      }
    })

  // === B2B section ===
  const b2bInvoices = (data.sections?.b2b?.invoices || []).map((inv: any) => {
    const items = transformItems(inv.items || [], !!inv.isInterState)
    return {
      customerGstin: inv.customer?.taxId || '',
      customerName: inv.customer?.name || '',
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: fmtGSTNDate(inv.invoiceDate),
      placeOfSupply: stateCodeFromGstin(inv.customer?.taxId),
      reverseCharge: !!inv.reverseCharge,
      invoiceType: 'Regular',
      isInterState: !!inv.isInterState,
      totalValue: round2(inv.totalAmount),
      items,
      totals: sumLineItems(items),
    }
  })
  const b2bAllItems = b2bInvoices.flatMap((i: any) => i.items)
  const b2bSection = {
    invoices: b2bInvoices,
    totals: {
      invoiceCount: b2bInvoices.length,
      ...sumLineItems(b2bAllItems),
      totalValue: round2(b2bInvoices.reduce((s: number, i: any) => s + i.totalValue, 0)),
    },
  }

  // === B2C Large section ===
  const b2clInvoices = (data.sections?.b2cl?.invoices || []).map((inv: any) => {
    const items = transformItems(inv.items || [], true)
    return {
      customerName: inv.customer?.name || '',
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: fmtGSTNDate(inv.invoiceDate),
      placeOfSupply: inv.placeOfSupply || stateCodeFromGstin(inv.customer?.taxId),
      totalValue: round2(inv.totalAmount),
      items,
      totals: sumLineItems(items),
    }
  })
  const b2clSection = {
    invoices: b2clInvoices,
    totals: {
      invoiceCount: b2clInvoices.length,
      ...sumLineItems(b2clInvoices.flatMap((i: any) => i.items)),
      totalValue: round2(b2clInvoices.reduce((s: number, i: any) => s + i.totalValue, 0)),
    },
  }

  // === B2C Small section ===
  const b2csInvoices = (data.sections?.b2cs?.invoices || []).map((inv: any) => {
    const items = transformItems(inv.items || [], !!inv.isInterState)
    return {
      customerName: inv.customer?.name || '(walk-in / unregistered)',
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: fmtGSTNDate(inv.invoiceDate),
      placeOfSupply: inv.placeOfSupply || stateCodeFromGstin(inv.customer?.taxId),
      isInterState: !!inv.isInterState,
      totalValue: round2(inv.totalAmount),
      items,
      totals: sumLineItems(items),
    }
  })
  const b2csSection = {
    invoices: b2csInvoices,
    totals: {
      invoiceCount: b2csInvoices.length,
      ...sumLineItems(b2csInvoices.flatMap((i: any) => i.items)),
      totalValue: round2(b2csInvoices.reduce((s: number, i: any) => s + i.totalValue, 0)),
    },
  }

  // === HSN Summary ===
  const hsnRows = (data.hsnSummary || []).map((h: any, idx: number) => ({
    serialNumber: idx + 1,
    hsnCode: h.hsnCode || '',
    description: h.description || '',
    unit: h.uqc || 'NOS',
    totalQuantity: round2(h.totalQuantity || 0),
    totalValue: round2(h.totalValue || 0),
    taxableValue: round2(h.taxableValue || 0),
    igstAmount: round2(h.igstAmount || 0),
    cgstAmount: round2(h.cgstAmount || 0),
    sgstAmount: round2(h.sgstAmount || 0),
    cessAmount: round2(h.cessAmount || 0),
  }))
  const hsnSummarySection = {
    rows: hsnRows,
    totals: {
      hsnCodeCount: hsnRows.length,
      totalQuantity: round2(hsnRows.reduce((s: number, r: any) => s + (r.totalQuantity || 0), 0)),
      totalValue: round2(hsnRows.reduce((s: number, r: any) => s + (r.totalValue || 0), 0)),
      totalTaxableValue: round2(hsnRows.reduce((s: number, r: any) => s + (r.taxableValue || 0), 0)),
      totalIgst: round2(hsnRows.reduce((s: number, r: any) => s + (r.igstAmount || 0), 0)),
      totalCgst: round2(hsnRows.reduce((s: number, r: any) => s + (r.cgstAmount || 0), 0)),
      totalSgst: round2(hsnRows.reduce((s: number, r: any) => s + (r.sgstAmount || 0), 0)),
      totalCess: round2(hsnRows.reduce((s: number, r: any) => s + (r.cessAmount || 0), 0)),
    },
  }

  // === Grand total (the document-footer row) ===
  const grandTotal = {
    totalInvoices: data.docSummary?.totalInvoices || 0,
    totalTaxableValue: round2(data.docSummary?.totalTaxableValue || 0),
    totalIgst: round2(data.docSummary?.totalIgst || 0),
    totalCgst: round2(data.docSummary?.totalCgst || 0),
    totalSgst: round2(data.docSummary?.totalSgst || 0),
    totalCess: round2(data.docSummary?.totalCess || 0),
    totalTax: round2(data.docSummary?.totalTax || 0),
    totalValue: round2(data.docSummary?.totalValue || 0),
  }

  return {
    company: {
      gstin: company?.taxId || '',
      name: company?.name || '',
      stateCode: company?.stateCode || stateCodeFromGstin(company?.taxId),
    },
    period: {
      startDate: data.period?.startDate || '',
      endDate: data.period?.endDate || '',
      filingPeriod: periodToFP(data.period?.startDate),
    },
    b2bInvoices: b2bSection,
    b2cLargeInvoices: b2clSection,
    b2cSmallSupplies: b2csSection,
    hsnSummary: hsnSummarySection,
    grandTotal,
  }
}

export const setupGSTReportHandlers = () => {
  const prisma = getPrisma()

  // Get GSTR-1 Report (Sales/Outward Supplies)
  ipcMain.handle('gstReport:getGSTR1', async (_, filters: GSTReportFilters) => {
    try {
      const where: any = {
        type: 'INVOICE',
        ...notDeleted,
        ...notCancelled,
        invoiceDate: {
          gte: new Date(filters.startDate),
          lte: new Date(filters.endDate)
        }
      }

      const invoices = await prisma.salesInvoice.findMany({
        where,
        include: {
          customer: true,
          items: {
            include: {
              item: true
            }
          }
        },
        orderBy: { invoiceDate: 'asc' }
      })

      // Categorize invoices into GSTR-1 sections
      const b2bInvoices: any[] = []
      const b2clInvoices: any[] = []  // B2C Large (> 2.5 lakhs)
      const b2csInvoices: any[] = []  // B2C Small
      const cdnrInvoices: any[] = []  // Credit/Debit Notes Registered
      const cdnurInvoices: any[] = [] // Credit/Debit Notes Unregistered
      const exportInvoices: any[] = []
      const nilExemptInvoices: any[] = []

      for (const invoice of invoices) {
        const hasGstin = invoice.customer?.taxId && invoice.customer.taxId.length === 15
        const isInterState = invoice.isInterState
        const totalValue = invoice.totalAmount

        // Check if it's a credit/debit note (negative total or specific type)
        const isCreditDebitNote = totalValue < 0

        if (isCreditDebitNote) {
          if (hasGstin) {
            cdnrInvoices.push(invoice)
          } else {
            cdnurInvoices.push(invoice)
          }
        } else if (invoice.supplyType === 'EXPORT') {
          exportInvoices.push(invoice)
        } else if (invoice.supplyType === 'NIL_EXEMPT') {
          nilExemptInvoices.push(invoice)
        } else if (hasGstin) {
          // B2B - Registered party with GSTIN
          b2bInvoices.push(invoice)
        } else if (isInterState && totalValue > 250000) {
          // B2C Large - Inter-state and > 2.5 lakhs
          b2clInvoices.push(invoice)
        } else {
          // B2C Small
          b2csInvoices.push(invoice)
        }
      }

      // Calculate section totals
      const calculateSectionTotals = (sectionInvoices: any[]): GSTR1Section => {
        let totalTaxableValue = 0
        let totalIgst = 0
        let totalCgst = 0
        let totalSgst = 0
        let totalCess = 0

        for (const inv of sectionInvoices) {
          totalTaxableValue += inv.subtotal - (inv.discount || 0)
          totalIgst += inv.igstAmount || 0
          totalCgst += inv.cgstAmount || 0
          totalSgst += inv.sgstAmount || 0
          totalCess += inv.cessAmount || 0
        }

        return {
          sectionName: '',
          sectionCode: '',
          invoices: sectionInvoices,
          totalTaxableValue,
          totalIgst,
          totalCgst,
          totalSgst,
          totalCess,
          invoiceCount: sectionInvoices.length
        }
      }

      const sections = {
        b2b: { ...calculateSectionTotals(b2bInvoices), sectionName: 'B2B Invoices', sectionCode: 'B2B' },
        b2cl: { ...calculateSectionTotals(b2clInvoices), sectionName: 'B2C Large', sectionCode: 'B2CL' },
        b2cs: { ...calculateSectionTotals(b2csInvoices), sectionName: 'B2C Small', sectionCode: 'B2CS' },
        cdnr: { ...calculateSectionTotals(cdnrInvoices), sectionName: 'Credit/Debit Notes (Registered)', sectionCode: 'CDNR' },
        cdnur: { ...calculateSectionTotals(cdnurInvoices), sectionName: 'Credit/Debit Notes (Unregistered)', sectionCode: 'CDNUR' },
        exp: { ...calculateSectionTotals(exportInvoices), sectionName: 'Exports', sectionCode: 'EXP' },
        nilExempt: { ...calculateSectionTotals(nilExemptInvoices), sectionName: 'Nil Rated/Exempt', sectionCode: 'NIL' }
      }

      // HSN Summary
      const hsnSummary = await generateHSNSummary(invoices)

      // Document Summary
      const docSummary = {
        totalInvoices: invoices.length,
        totalValue: invoices.reduce((sum, inv) => sum + inv.totalAmount, 0),
        totalTaxableValue: invoices.reduce((sum, inv) => sum + inv.subtotal - (inv.discount || 0), 0),
        totalTax: invoices.reduce((sum, inv) => sum + inv.taxAmount, 0),
        totalIgst: invoices.reduce((sum, inv) => sum + (inv.igstAmount || 0), 0),
        totalCgst: invoices.reduce((sum, inv) => sum + (inv.cgstAmount || 0), 0),
        totalSgst: invoices.reduce((sum, inv) => sum + (inv.sgstAmount || 0), 0),
        totalCess: invoices.reduce((sum, inv) => sum + (inv.cessAmount || 0), 0)
      }

      return {
        success: true,
        data: {
          sections,
          hsnSummary,
          docSummary,
          period: {
            startDate: filters.startDate,
            endDate: filters.endDate
          }
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate GSTR-1 report'
      }
    }
  })

  // Get GSTR-2 Report (Purchases/Inward Supplies)
  ipcMain.handle('gstReport:getGSTR2', async (_, filters: GSTReportFilters) => {
    try {
      const where: any = {
        ...notDeleted,
        ...notCancelled,
        billDate: {
          gte: new Date(filters.startDate),
          lte: new Date(filters.endDate)
        }
      }

      const bills = await prisma.purchaseBill.findMany({
        where,
        include: {
          supplier: true,
          items: {
            include: {
              supplierItem: {
                include: {
                  linkedItem: true
                }
              }
            }
          }
        },
        orderBy: { billDate: 'asc' }
      })

      // Categorize bills
      const b2bPurchases: any[] = []
      const importPurchases: any[] = []
      const rcmPurchases: any[] = []
      const nilExemptPurchases: any[] = []

      for (const bill of bills) {
        const hasGstin = bill.supplier?.taxId && bill.supplier.taxId.length === 15

        if (bill.reverseCharge) {
          rcmPurchases.push(bill)
        } else if (hasGstin) {
          b2bPurchases.push(bill)
        } else {
          nilExemptPurchases.push(bill)
        }
      }

      // Calculate section totals
      const calculatePurchaseTotals = (sectionBills: any[]) => {
        let totalTaxableValue = 0
        let totalIgst = 0
        let totalCgst = 0
        let totalSgst = 0
        let totalCess = 0

        for (const bill of sectionBills) {
          totalTaxableValue += bill.subtotal - (bill.discount || 0)
          totalIgst += bill.igstAmount || 0
          totalCgst += bill.cgstAmount || 0
          totalSgst += bill.sgstAmount || 0
          totalCess += bill.cessAmount || 0
        }

        return {
          bills: sectionBills,
          totalTaxableValue,
          totalIgst,
          totalCgst,
          totalSgst,
          totalCess,
          billCount: sectionBills.length
        }
      }

      const sections = {
        b2b: { ...calculatePurchaseTotals(b2bPurchases), sectionName: 'B2B Purchases', sectionCode: 'B2B' },
        import: { ...calculatePurchaseTotals(importPurchases), sectionName: 'Import of Goods', sectionCode: 'IMP' },
        rcm: { ...calculatePurchaseTotals(rcmPurchases), sectionName: 'RCM Purchases', sectionCode: 'RCM' },
        nilExempt: { ...calculatePurchaseTotals(nilExemptPurchases), sectionName: 'Nil Rated/Exempt', sectionCode: 'NIL' }
      }

      // ITC Summary
      const eligibleITC = {
        igst: bills.filter(b => b.itcEligibility === 'ELIGIBLE').reduce((sum, b) => sum + (b.igstAmount || 0), 0),
        cgst: bills.filter(b => b.itcEligibility === 'ELIGIBLE').reduce((sum, b) => sum + (b.cgstAmount || 0), 0),
        sgst: bills.filter(b => b.itcEligibility === 'ELIGIBLE').reduce((sum, b) => sum + (b.sgstAmount || 0), 0),
        cess: bills.filter(b => b.itcEligibility === 'ELIGIBLE').reduce((sum, b) => sum + (b.cessAmount || 0), 0)
      }

      const ineligibleITC = {
        igst: bills.filter(b => b.itcEligibility === 'INELIGIBLE').reduce((sum, b) => sum + (b.igstAmount || 0), 0),
        cgst: bills.filter(b => b.itcEligibility === 'INELIGIBLE').reduce((sum, b) => sum + (b.cgstAmount || 0), 0),
        sgst: bills.filter(b => b.itcEligibility === 'INELIGIBLE').reduce((sum, b) => sum + (b.sgstAmount || 0), 0),
        cess: bills.filter(b => b.itcEligibility === 'INELIGIBLE').reduce((sum, b) => sum + (b.cessAmount || 0), 0)
      }

      // Document Summary
      const docSummary = {
        totalBills: bills.length,
        totalValue: bills.reduce((sum, b) => sum + b.totalAmount, 0),
        totalTaxableValue: bills.reduce((sum, b) => sum + b.subtotal - (b.discount || 0), 0),
        totalTax: bills.reduce((sum, b) => sum + b.taxAmount, 0),
        totalIgst: bills.reduce((sum, b) => sum + (b.igstAmount || 0), 0),
        totalCgst: bills.reduce((sum, b) => sum + (b.cgstAmount || 0), 0),
        totalSgst: bills.reduce((sum, b) => sum + (b.sgstAmount || 0), 0),
        totalCess: bills.reduce((sum, b) => sum + (b.cessAmount || 0), 0)
      }

      return {
        success: true,
        data: {
          sections,
          eligibleITC,
          ineligibleITC,
          docSummary,
          period: {
            startDate: filters.startDate,
            endDate: filters.endDate
          }
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate GSTR-2 report'
      }
    }
  })

  // Get GSTR-3B Report (Monthly Summary Return)
  ipcMain.handle('gstReport:getGSTR3B', async (_, filters: GSTReportFilters) => {
    try {
      const startDate = new Date(filters.startDate)
      const endDate = new Date(filters.endDate)

      // Get all sales invoices
      const salesInvoices = await prisma.salesInvoice.findMany({
        where: {
          type: 'INVOICE',
          ...notDeleted,
          ...notCancelled,
          invoiceDate: { gte: startDate, lte: endDate }
        },
        include: {
          customer: true,
          items: true
        }
      })

      // Get all purchase bills
      const purchaseBills = await prisma.purchaseBill.findMany({
        where: {
          ...notDeleted,
          ...notCancelled,
          billDate: { gte: startDate, lte: endDate }
        },
        include: {
          supplier: true,
          items: true
        }
      })

      // 3.1 - Outward Supplies (Taxable)
      const outwardTaxable = {
        interState: { taxableValue: 0, igst: 0 },
        intraState: { taxableValue: 0, cgst: 0, sgst: 0 }
      }

      for (const inv of salesInvoices) {
        const taxableValue = inv.subtotal - (inv.discount || 0)
        if (inv.isInterState) {
          outwardTaxable.interState.taxableValue += taxableValue
          outwardTaxable.interState.igst += inv.igstAmount || 0
        } else {
          outwardTaxable.intraState.taxableValue += taxableValue
          outwardTaxable.intraState.cgst += inv.cgstAmount || 0
          outwardTaxable.intraState.sgst += inv.sgstAmount || 0
        }
      }

      // 3.1.1 - Outward supplies to unregistered persons
      const b2cSupplies = salesInvoices.filter(inv => !inv.customer?.taxId || inv.customer.taxId.length !== 15)
      const outwardUnregistered = {
        taxableValue: b2cSupplies.reduce((sum, inv) => sum + inv.subtotal - (inv.discount || 0), 0),
        igst: b2cSupplies.reduce((sum, inv) => sum + (inv.igstAmount || 0), 0),
        cgst: b2cSupplies.reduce((sum, inv) => sum + (inv.cgstAmount || 0), 0),
        sgst: b2cSupplies.reduce((sum, inv) => sum + (inv.sgstAmount || 0), 0)
      }

      // 3.2 - Inward supplies liable to reverse charge
      const rcmPurchases = purchaseBills.filter(b => b.reverseCharge)
      const inwardRCM = {
        taxableValue: rcmPurchases.reduce((sum, b) => sum + b.subtotal - (b.discount || 0), 0),
        igst: rcmPurchases.reduce((sum, b) => sum + (b.igstAmount || 0), 0),
        cgst: rcmPurchases.reduce((sum, b) => sum + (b.cgstAmount || 0), 0),
        sgst: rcmPurchases.reduce((sum, b) => sum + (b.sgstAmount || 0), 0),
        cess: rcmPurchases.reduce((sum, b) => sum + (b.cessAmount || 0), 0)
      }

      // 4 - Eligible ITC
      const eligibleBills = purchaseBills.filter(b => b.itcEligibility === 'ELIGIBLE')
      const eligibleITC = {
        igst: eligibleBills.reduce((sum, b) => sum + (b.igstAmount || 0), 0),
        cgst: eligibleBills.reduce((sum, b) => sum + (b.cgstAmount || 0), 0),
        sgst: eligibleBills.reduce((sum, b) => sum + (b.sgstAmount || 0), 0),
        cess: eligibleBills.reduce((sum, b) => sum + (b.cessAmount || 0), 0)
      }

      // Ineligible ITC
      const ineligibleBills = purchaseBills.filter(b => b.itcEligibility === 'INELIGIBLE')
      const ineligibleITC = {
        igst: ineligibleBills.reduce((sum, b) => sum + (b.igstAmount || 0), 0),
        cgst: ineligibleBills.reduce((sum, b) => sum + (b.cgstAmount || 0), 0),
        sgst: ineligibleBills.reduce((sum, b) => sum + (b.sgstAmount || 0), 0),
        cess: ineligibleBills.reduce((sum, b) => sum + (b.cessAmount || 0), 0)
      }

      // Net ITC Available
      const netITC = {
        igst: eligibleITC.igst - ineligibleITC.igst,
        cgst: eligibleITC.cgst - ineligibleITC.cgst,
        sgst: eligibleITC.sgst - ineligibleITC.sgst,
        cess: eligibleITC.cess - ineligibleITC.cess
      }

      // 5 - Values of Exempt, Nil, Non-GST supplies
      const exemptInvoices = salesInvoices.filter(inv => inv.supplyType === 'NIL_EXEMPT')
      const exemptSupplies = {
        interState: exemptInvoices.filter(inv => inv.isInterState).reduce((sum, inv) => sum + inv.totalAmount, 0),
        intraState: exemptInvoices.filter(inv => !inv.isInterState).reduce((sum, inv) => sum + inv.totalAmount, 0)
      }

      // 6 - Tax Liability and Payment
      const totalOutputTax = {
        igst: salesInvoices.reduce((sum, inv) => sum + (inv.igstAmount || 0), 0) + inwardRCM.igst,
        cgst: salesInvoices.reduce((sum, inv) => sum + (inv.cgstAmount || 0), 0) + inwardRCM.cgst,
        sgst: salesInvoices.reduce((sum, inv) => sum + (inv.sgstAmount || 0), 0) + inwardRCM.sgst,
        cess: salesInvoices.reduce((sum, inv) => sum + (inv.cessAmount || 0), 0) + inwardRCM.cess
      }

      const netTaxPayable = {
        igst: Math.max(0, totalOutputTax.igst - netITC.igst),
        cgst: Math.max(0, totalOutputTax.cgst - netITC.cgst),
        sgst: Math.max(0, totalOutputTax.sgst - netITC.sgst),
        cess: Math.max(0, totalOutputTax.cess - netITC.cess)
      }

      const totalNetPayable = netTaxPayable.igst + netTaxPayable.cgst + netTaxPayable.sgst + netTaxPayable.cess

      return {
        success: true,
        data: {
          // Section 3.1 - Outward supplies
          outwardSupplies: {
            taxable: {
              interState: outwardTaxable.interState,
              intraState: outwardTaxable.intraState,
              total: {
                taxableValue: outwardTaxable.interState.taxableValue + outwardTaxable.intraState.taxableValue,
                igst: outwardTaxable.interState.igst,
                cgst: outwardTaxable.intraState.cgst,
                sgst: outwardTaxable.intraState.sgst
              }
            },
            unregistered: outwardUnregistered
          },
          // Section 3.2 - Inward supplies RCM
          inwardRCM,
          // Section 4 - ITC
          itc: {
            eligible: eligibleITC,
            ineligible: ineligibleITC,
            net: netITC
          },
          // Section 5 - Exempt supplies
          exemptSupplies,
          // Section 6 - Tax liability
          taxLiability: {
            output: totalOutputTax,
            netPayable: netTaxPayable,
            totalPayable: totalNetPayable
          },
          // Summary statistics
          summary: {
            totalSalesInvoices: salesInvoices.length,
            totalPurchaseBills: purchaseBills.length,
            totalSalesValue: salesInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0),
            totalPurchaseValue: purchaseBills.reduce((sum, b) => sum + b.totalAmount, 0)
          },
          period: {
            startDate: filters.startDate,
            endDate: filters.endDate
          }
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate GSTR-3B report'
      }
    }
  })

  // Get GSTR-9 Report (Annual Return)
  ipcMain.handle('gstReport:getGSTR9', async (_, filters: GSTReportFilters) => {
    try {
      const startDate = new Date(filters.startDate)
      const endDate = new Date(filters.endDate)

      // Get all sales invoices for the year
      const salesInvoices = await prisma.salesInvoice.findMany({
        where: {
          type: 'INVOICE',
          ...notDeleted,
          ...notCancelled,
          invoiceDate: { gte: startDate, lte: endDate }
        },
        include: {
          customer: true,
          items: true
        }
      })

      // Get all purchase bills for the year
      const purchaseBills = await prisma.purchaseBill.findMany({
        where: {
          ...notDeleted,
          ...notCancelled,
          billDate: { gte: startDate, lte: endDate }
        },
        include: {
          supplier: true,
          items: true
        }
      })

      // Part II - Outward supplies during the year
      const outwardSupplies = {
        b2b: {
          taxableValue: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          cess: 0
        },
        b2c: {
          taxableValue: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          cess: 0
        },
        exports: {
          taxableValue: 0,
          igst: 0
        },
        exemptNilRated: {
          value: 0
        },
        total: {
          taxableValue: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          cess: 0
        }
      }

      for (const inv of salesInvoices) {
        const hasGstin = inv.customer?.taxId && inv.customer.taxId.length === 15
        const taxableValue = inv.subtotal - (inv.discount || 0)

        if (inv.supplyType === 'EXPORT') {
          outwardSupplies.exports.taxableValue += taxableValue
          outwardSupplies.exports.igst += inv.igstAmount || 0
        } else if (inv.supplyType === 'NIL_EXEMPT') {
          outwardSupplies.exemptNilRated.value += inv.totalAmount
        } else if (hasGstin) {
          outwardSupplies.b2b.taxableValue += taxableValue
          outwardSupplies.b2b.cgst += inv.cgstAmount || 0
          outwardSupplies.b2b.sgst += inv.sgstAmount || 0
          outwardSupplies.b2b.igst += inv.igstAmount || 0
          outwardSupplies.b2b.cess += inv.cessAmount || 0
        } else {
          outwardSupplies.b2c.taxableValue += taxableValue
          outwardSupplies.b2c.cgst += inv.cgstAmount || 0
          outwardSupplies.b2c.sgst += inv.sgstAmount || 0
          outwardSupplies.b2c.igst += inv.igstAmount || 0
          outwardSupplies.b2c.cess += inv.cessAmount || 0
        }

        outwardSupplies.total.taxableValue += taxableValue
        outwardSupplies.total.cgst += inv.cgstAmount || 0
        outwardSupplies.total.sgst += inv.sgstAmount || 0
        outwardSupplies.total.igst += inv.igstAmount || 0
        outwardSupplies.total.cess += inv.cessAmount || 0
      }

      // Part III - Inward supplies during the year
      const inwardSupplies = {
        fromRegistered: {
          taxableValue: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          cess: 0
        },
        fromUnregistered: {
          taxableValue: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          cess: 0
        },
        total: {
          taxableValue: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          cess: 0
        }
      }

      for (const bill of purchaseBills) {
        const hasGstin = bill.supplier?.taxId && bill.supplier.taxId.length === 15
        const taxableValue = bill.subtotal - (bill.discount || 0)

        if (hasGstin) {
          inwardSupplies.fromRegistered.taxableValue += taxableValue
          inwardSupplies.fromRegistered.cgst += bill.cgstAmount || 0
          inwardSupplies.fromRegistered.sgst += bill.sgstAmount || 0
          inwardSupplies.fromRegistered.igst += bill.igstAmount || 0
          inwardSupplies.fromRegistered.cess += bill.cessAmount || 0
        } else {
          inwardSupplies.fromUnregistered.taxableValue += taxableValue
          inwardSupplies.fromUnregistered.cgst += bill.cgstAmount || 0
          inwardSupplies.fromUnregistered.sgst += bill.sgstAmount || 0
          inwardSupplies.fromUnregistered.igst += bill.igstAmount || 0
          inwardSupplies.fromUnregistered.cess += bill.cessAmount || 0
        }

        inwardSupplies.total.taxableValue += taxableValue
        inwardSupplies.total.cgst += bill.cgstAmount || 0
        inwardSupplies.total.sgst += bill.sgstAmount || 0
        inwardSupplies.total.igst += bill.igstAmount || 0
        inwardSupplies.total.cess += bill.cessAmount || 0
      }

      // Part IV - ITC claimed
      const eligibleBills = purchaseBills.filter(b => b.itcEligibility === 'ELIGIBLE')
      const itcClaimed = {
        igst: eligibleBills.reduce((sum, b) => sum + (b.igstAmount || 0), 0),
        cgst: eligibleBills.reduce((sum, b) => sum + (b.cgstAmount || 0), 0),
        sgst: eligibleBills.reduce((sum, b) => sum + (b.sgstAmount || 0), 0),
        cess: eligibleBills.reduce((sum, b) => sum + (b.cessAmount || 0), 0)
      }

      // Part V - Tax paid
      const taxPaid = {
        throughCash: {
          igst: 0,
          cgst: 0,
          sgst: 0,
          cess: 0
        },
        throughITC: {
          igst: itcClaimed.igst,
          cgst: itcClaimed.cgst,
          sgst: itcClaimed.sgst,
          cess: itcClaimed.cess
        }
      }

      // HSN Summary
      const hsnSummary = await generateHSNSummaryForYear(salesInvoices, purchaseBills)

      return {
        success: true,
        data: {
          outwardSupplies,
          inwardSupplies,
          itcClaimed,
          taxPaid,
          hsnSummary,
          documentSummary: {
            totalSalesInvoices: salesInvoices.length,
            totalPurchaseBills: purchaseBills.length,
            totalSalesValue: salesInvoices.reduce((sum, inv) => sum + inv.totalAmount, 0),
            totalPurchaseValue: purchaseBills.reduce((sum, b) => sum + b.totalAmount, 0)
          },
          period: {
            startDate: filters.startDate,
            endDate: filters.endDate,
            financialYear: `${startDate.getFullYear()}-${endDate.getFullYear()}`
          }
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate GSTR-9 report'
      }
    }
  })

  // Get HSN Summary
  ipcMain.handle('gstReport:getHSNSummary', async (_, filters: GSTReportFilters) => {
    try {
      const startDate = new Date(filters.startDate)
      const endDate = new Date(filters.endDate)

      const invoices = await prisma.salesInvoice.findMany({
        where: {
          type: 'INVOICE',
          ...notDeleted,
          ...notCancelled,
          invoiceDate: { gte: startDate, lte: endDate }
        },
        include: {
          items: {
            include: {
              item: true
            }
          }
        }
      })

      const hsnSummary = await generateHSNSummary(invoices)

      return {
        success: true,
        data: hsnSummary
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate HSN summary'
      }
    }
  })

  // Export report to JSON (raw internal shape — useful for debugging /
  // backups, NOT for GST Portal upload). For portal-compatible GSTR-1, use
  // exportGSTR1ToGSTNJSON below.
  ipcMain.handle('gstReport:exportToJSON', async (_, _reportType: string, data: any) => {
    try {
      const jsonData = JSON.stringify(data, null, 2)
      return {
        success: true,
        data: jsonData
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export to JSON'
      }
    }
  })

  // Export GSTR-1 in the GSTN-compliant JSON shape that the GST Portal and
  // GSTN's offline tool accept directly. Reads the company's GSTIN from the
  // Company table — fails loudly if unset, since the schema requires it.
  ipcMain.handle('gstReport:exportGSTR1ToGSTNJSON', async (_, data: any) => {
    try {
      const company = await prisma.company.findFirst()
      const gstin = company?.taxId
      if (!gstin) {
        return {
          success: false,
          error: 'Company GSTIN is not set. Open Settings → Company Profile and add it before exporting.',
        }
      }

      // CDNR/CDNUR routing: real credit/debit notes live in the CreditDebitNote
      // table (Mode B), which the legacy on-screen GSTR-1 (negative-total
      // invoices) never sees. Fetch them for the report period and attach as
      // sections.cdnr/.cdnur `notes` — the shape the shared builder reads.
      const notes = await prisma.creditDebitNote.findMany({
        where: {
          status: 'ACTIVE',
          ...notDeleted,
          ...notCancelled,
          noteDate: {
            gte: new Date(data.period?.startDate),
            lte: new Date(`${data.period?.endDate}T23:59:59.999`),
          },
        },
        include: { customer: true, items: true },
      })
      const isReg = (t?: string | null) => !!t && t.length === 15
      const noteDetail = notes.map((n) => ({
        noteNumber: n.noteNumber,
        noteDate: n.noteDate,
        noteType: n.type,
        totalAmount: n.totalAmount,
        isInterState: n.isInterState,
        customer: { taxId: n.customer?.taxId },
        items: n.items,
      }))
      const withNotes = {
        ...data,
        sections: {
          ...data.sections,
          cdnr: { ...(data.sections?.cdnr ?? {}), notes: noteDetail.filter((n) => isReg(n.customer.taxId)) },
          cdnur: { ...(data.sections?.cdnur ?? {}), notes: noteDetail.filter((n) => !isReg(n.customer.taxId)) },
        },
      }

      const payload = toGSTNGstr1(withNotes, gstin)
      return { success: true, data: JSON.stringify(payload, null, 2) }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export GSTN JSON',
      }
    }
  })

  // Human-friendly GSTR-1 JSON: same data as the GSTN file but with full
  // descriptive keys (`taxPercentage` instead of `rt`) and totals appended at
  // the bottom of every section plus a grand total at the very end. For CA
  // review and archiving — NOT for portal upload.
  ipcMain.handle('gstReport:exportGSTR1ToFriendlyJSON', async (_, data: any) => {
    try {
      const company = await prisma.company.findFirst()
      const payload = toFriendlyGstr1(data, company)
      return { success: true, data: JSON.stringify(payload, null, 2) }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export friendly JSON',
      }
    }
  })

  // Export GSTR-1 to Excel (GST Portal Format)
  ipcMain.handle('gstReport:exportGSTR1ToExcel', async (_, data: any) => {
    try {
      const workbook = new ExcelJS.Workbook()

      // B2B Sheet
      const b2bSheet = workbook.addWorksheet('B2B')
      b2bSheet.columns = [
        { header: 'GSTIN of Recipient', key: 'gstin', width: 20 },
        { header: 'Invoice Number', key: 'invoiceNumber', width: 15 },
        { header: 'Invoice Date', key: 'invoiceDate', width: 12 },
        { header: 'Invoice Value', key: 'invoiceValue', width: 15 },
        { header: 'Place of Supply', key: 'placeOfSupply', width: 20 },
        { header: 'Reverse Charge', key: 'reverseCharge', width: 12 },
        { header: 'Applicable Rate', key: 'rate', width: 12 },
        { header: 'Taxable Value', key: 'taxableValue', width: 15 },
        { header: 'Cess Amount', key: 'cessAmount', width: 12 },
        { header: 'CGST', key: 'cgst', width: 12 },
        { header: 'SGST', key: 'sgst', width: 12 },
        { header: 'IGST', key: 'igst', width: 12 }
      ]

      if (data.sections?.b2b?.invoices) {
        for (const inv of data.sections.b2b.invoices) {
          b2bSheet.addRow({
            gstin: inv.customer?.taxId || '',
            invoiceNumber: inv.invoiceNumber,
            invoiceDate: new Date(inv.invoiceDate).toLocaleDateString('en-GB'),
            invoiceValue: inv.totalAmount,
            placeOfSupply: `${inv.placeOfSupply}-${inv.placeOfSupplyName || INDIAN_STATES[inv.placeOfSupply] || ''}`,
            reverseCharge: inv.reverseCharge ? 'Y' : 'N',
            rate: inv.items?.[0]?.taxRate || 0,
            taxableValue: inv.subtotal - (inv.discount || 0),
            cessAmount: inv.cessAmount || 0,
            cgst: inv.cgstAmount || 0,
            sgst: inv.sgstAmount || 0,
            igst: inv.igstAmount || 0
          })
        }
      }

      // B2CS Sheet
      const b2csSheet = workbook.addWorksheet('B2CS')
      b2csSheet.columns = [
        { header: 'Type', key: 'type', width: 10 },
        { header: 'Place of Supply', key: 'placeOfSupply', width: 20 },
        { header: 'Applicable Rate', key: 'rate', width: 12 },
        { header: 'Taxable Value', key: 'taxableValue', width: 15 },
        { header: 'CGST', key: 'cgst', width: 12 },
        { header: 'SGST', key: 'sgst', width: 12 },
        { header: 'IGST', key: 'igst', width: 12 },
        { header: 'Cess Amount', key: 'cessAmount', width: 12 }
      ]

      if (data.sections?.b2cs?.invoices) {
        // Group by rate and place of supply
        const b2csGrouped: Record<string, any> = {}
        for (const inv of data.sections.b2cs.invoices) {
          const key = `${inv.placeOfSupply}-${inv.items?.[0]?.taxRate || 0}`
          if (!b2csGrouped[key]) {
            b2csGrouped[key] = {
              placeOfSupply: inv.placeOfSupply,
              rate: inv.items?.[0]?.taxRate || 0,
              taxableValue: 0,
              cgst: 0,
              sgst: 0,
              igst: 0,
              cessAmount: 0
            }
          }
          b2csGrouped[key].taxableValue += inv.subtotal - (inv.discount || 0)
          b2csGrouped[key].cgst += inv.cgstAmount || 0
          b2csGrouped[key].sgst += inv.sgstAmount || 0
          b2csGrouped[key].igst += inv.igstAmount || 0
          b2csGrouped[key].cessAmount += inv.cessAmount || 0
        }

        for (const item of Object.values(b2csGrouped)) {
          b2csSheet.addRow({
            type: 'OE',
            placeOfSupply: `${item.placeOfSupply}-${INDIAN_STATES[item.placeOfSupply] || ''}`,
            rate: item.rate,
            taxableValue: item.taxableValue,
            cgst: item.cgst,
            sgst: item.sgst,
            igst: item.igst,
            cessAmount: item.cessAmount
          })
        }
      }

      // HSN Summary Sheet
      const hsnSheet = workbook.addWorksheet('HSN')
      hsnSheet.columns = [
        { header: 'HSN Code', key: 'hsnCode', width: 15 },
        { header: 'Description', key: 'description', width: 30 },
        { header: 'UQC', key: 'uqc', width: 10 },
        { header: 'Total Quantity', key: 'quantity', width: 15 },
        { header: 'Total Value', key: 'totalValue', width: 15 },
        { header: 'Taxable Value', key: 'taxableValue', width: 15 },
        { header: 'IGST', key: 'igst', width: 12 },
        { header: 'CGST', key: 'cgst', width: 12 },
        { header: 'SGST', key: 'sgst', width: 12 }
      ]

      if (data.hsnSummary) {
        for (const hsn of data.hsnSummary) {
          hsnSheet.addRow({
            hsnCode: hsn.hsnCode,
            description: hsn.description,
            uqc: hsn.uqc,
            quantity: hsn.totalQuantity,
            totalValue: hsn.totalValue,
            taxableValue: hsn.taxableValue,
            igst: hsn.igstAmount,
            cgst: hsn.cgstAmount,
            sgst: hsn.sgstAmount
          })
        }
      }

      // Style the headers
      for (const sheet of [b2bSheet, b2csSheet, hsnSheet]) {
        sheet.getRow(1).font = { bold: true }
        sheet.getRow(1).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' }
        }
      }

      // Save the file
      const downloadsPath = app.getPath('downloads')
      const fileName = `GSTR1_${data.period?.startDate}_${data.period?.endDate}.xlsx`
      const filePath = path.join(downloadsPath, fileName)

      await workbook.xlsx.writeFile(filePath)

      return {
        success: true,
        data: filePath
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export to Excel'
      }
    }
  })

  // Export GSTR-3B to Excel
  ipcMain.handle('gstReport:exportGSTR3BToExcel', async (_, data: any) => {
    try {
      const workbook = new ExcelJS.Workbook()
      const sheet = workbook.addWorksheet('GSTR-3B Summary')

      // Title
      sheet.mergeCells('A1:E1')
      sheet.getCell('A1').value = 'GSTR-3B Summary Return'
      sheet.getCell('A1').font = { bold: true, size: 14 }

      // Period
      sheet.mergeCells('A2:E2')
      sheet.getCell('A2').value = `Period: ${data.period?.startDate} to ${data.period?.endDate}`

      // Section 3.1 - Outward Supplies
      let row = 4
      sheet.getCell(`A${row}`).value = '3.1 - Details of Outward Supplies'
      sheet.getCell(`A${row}`).font = { bold: true }

      row++
      sheet.getRow(row).values = ['Nature of Supplies', 'Taxable Value', 'IGST', 'CGST', 'SGST/UTGST']
      sheet.getRow(row).font = { bold: true }

      row++
      sheet.getRow(row).values = [
        'Outward taxable supplies (other than zero rated, nil rated and exempted)',
        data.outwardSupplies?.taxable?.total?.taxableValue || 0,
        data.outwardSupplies?.taxable?.total?.igst || 0,
        data.outwardSupplies?.taxable?.total?.cgst || 0,
        data.outwardSupplies?.taxable?.total?.sgst || 0
      ]

      // Section 4 - ITC
      row += 2
      sheet.getCell(`A${row}`).value = '4 - Eligible ITC'
      sheet.getCell(`A${row}`).font = { bold: true }

      row++
      sheet.getRow(row).values = ['Details', 'IGST', 'CGST', 'SGST/UTGST', 'Cess']
      sheet.getRow(row).font = { bold: true }

      row++
      sheet.getRow(row).values = [
        'ITC Available',
        data.itc?.eligible?.igst || 0,
        data.itc?.eligible?.cgst || 0,
        data.itc?.eligible?.sgst || 0,
        data.itc?.eligible?.cess || 0
      ]

      row++
      sheet.getRow(row).values = [
        'ITC Reversed',
        data.itc?.ineligible?.igst || 0,
        data.itc?.ineligible?.cgst || 0,
        data.itc?.ineligible?.sgst || 0,
        data.itc?.ineligible?.cess || 0
      ]

      row++
      sheet.getRow(row).values = [
        'Net ITC Available',
        data.itc?.net?.igst || 0,
        data.itc?.net?.cgst || 0,
        data.itc?.net?.sgst || 0,
        data.itc?.net?.cess || 0
      ]
      sheet.getRow(row).font = { bold: true }

      // Section 6 - Tax Payable
      row += 2
      sheet.getCell(`A${row}`).value = '6 - Payment of Tax'
      sheet.getCell(`A${row}`).font = { bold: true }

      row++
      sheet.getRow(row).values = ['Description', 'IGST', 'CGST', 'SGST/UTGST', 'Cess']
      sheet.getRow(row).font = { bold: true }

      row++
      sheet.getRow(row).values = [
        'Tax Payable',
        data.taxLiability?.netPayable?.igst || 0,
        data.taxLiability?.netPayable?.cgst || 0,
        data.taxLiability?.netPayable?.sgst || 0,
        data.taxLiability?.netPayable?.cess || 0
      ]
      sheet.getRow(row).font = { bold: true }

      row += 2
      sheet.getCell(`A${row}`).value = `Total Tax Payable: ${data.taxLiability?.totalPayable || 0}`
      sheet.getCell(`A${row}`).font = { bold: true, color: { argb: 'FFFF0000' } }

      // Auto-fit columns
      sheet.columns.forEach(column => {
        column.width = 20
      })

      // Save the file
      const downloadsPath = app.getPath('downloads')
      const fileName = `GSTR3B_${data.period?.startDate}_${data.period?.endDate}.xlsx`
      const filePath = path.join(downloadsPath, fileName)

      await workbook.xlsx.writeFile(filePath)

      return {
        success: true,
        data: filePath
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to export to Excel'
      }
    }
  })

  // Get company GST details
  ipcMain.handle('gstReport:getCompanyGSTDetails', async () => {
    try {
      const company = await prisma.company.findFirst()

      if (!company) {
        return {
          success: false,
          error: 'Company not found'
        }
      }

      return {
        success: true,
        data: {
          gstin: company.taxId,
          legalName: company.name,
          stateCode: company.stateCode,
          stateName: company.stateName
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get company GST details'
      }
    }
  })

  // Get state list
  ipcMain.handle('gstReport:getStateList', async () => {
    return {
      success: true,
      data: INDIAN_STATES
    }
  })
}

// Helper function to generate HSN summary from invoices
async function generateHSNSummary(invoices: any[]) {
  const hsnMap: Record<string, {
    hsnCode: string
    description: string
    uqc: string
    totalQuantity: number
    totalValue: number
    taxableValue: number
    igstAmount: number
    cgstAmount: number
    sgstAmount: number
    cessAmount: number
  }> = {}

  for (const invoice of invoices) {
    for (const item of invoice.items) {
      const hsnCode = item.hsnCode || item.item?.hsnCode || 'NA'
      const key = hsnCode

      if (!hsnMap[key]) {
        hsnMap[key] = {
          hsnCode,
          description: item.item?.name || '',
          uqc: item.item?.unit || 'NOS',
          totalQuantity: 0,
          totalValue: 0,
          taxableValue: 0,
          igstAmount: 0,
          cgstAmount: 0,
          sgstAmount: 0,
          cessAmount: 0
        }
      }

      hsnMap[key].totalQuantity += item.quantity
      hsnMap[key].totalValue += item.total
      hsnMap[key].taxableValue += item.taxableAmount || (item.quantity * item.rate - (item.discount || 0))
      hsnMap[key].igstAmount += item.igstAmount || 0
      hsnMap[key].cgstAmount += item.cgstAmount || 0
      hsnMap[key].sgstAmount += item.sgstAmount || 0
      hsnMap[key].cessAmount += item.cessAmount || 0
    }
  }

  return Object.values(hsnMap)
}

// Helper function to generate HSN summary for annual return
async function generateHSNSummaryForYear(salesInvoices: any[], purchaseBills: any[]) {
  const outwardHSN = await generateHSNSummary(salesInvoices)

  // Generate inward HSN summary
  const inwardHSNMap: Record<string, {
    hsnCode: string
    description: string
    uqc: string
    totalQuantity: number
    totalValue: number
    taxableValue: number
    igstAmount: number
    cgstAmount: number
    sgstAmount: number
    cessAmount: number
  }> = {}

  for (const bill of purchaseBills) {
    for (const item of bill.items) {
      const hsnCode = item.hsnCode || item.supplierItem?.hsnCode || item.supplierItem?.linkedItem?.hsnCode || 'NA'
      const key = hsnCode

      if (!inwardHSNMap[key]) {
        inwardHSNMap[key] = {
          hsnCode,
          description: item.supplierItem?.name || item.supplierItem?.linkedItem?.name || '',
          uqc: item.supplierItem?.unit || item.supplierItem?.linkedItem?.unit || 'NOS',
          totalQuantity: 0,
          totalValue: 0,
          taxableValue: 0,
          igstAmount: 0,
          cgstAmount: 0,
          sgstAmount: 0,
          cessAmount: 0
        }
      }

      inwardHSNMap[key].totalQuantity += item.quantity
      inwardHSNMap[key].totalValue += item.total
      inwardHSNMap[key].taxableValue += item.taxableAmount || (item.quantity * item.rate - (item.discount || 0))
      inwardHSNMap[key].igstAmount += item.igstAmount || 0
      inwardHSNMap[key].cgstAmount += item.cgstAmount || 0
      inwardHSNMap[key].sgstAmount += item.sgstAmount || 0
      inwardHSNMap[key].cessAmount += item.cessAmount || 0
    }
  }

  return {
    outward: outwardHSN,
    inward: Object.values(inwardHSNMap)
  }
}
