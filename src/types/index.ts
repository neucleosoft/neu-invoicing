// Type definitions for the application

export interface Company {
  id: string
  name: string
  address?: string
  phone?: string
  email?: string
  taxId?: string
  logoPath?: string | null
  logoBase64?: string
  signaturePath?: string | null
  fiscalYearStart: number
  currency: string
  invoicePrefix: string
  termsConditions?: string
  bankDetails?: string
  createdAt: string
  updatedAt: string
}

export interface Party {
  id: string
  name: string
  type: 'CUSTOMER' | 'SUPPLIER'
  phone?: string
  email?: string
  billingAddress?: string
  shippingAddress?: string
  taxId?: string
  openingBalance: number
  currentBalance: number
  // GST-specific fields
  stateCode?: string
  stateName?: string
  gstType?: string
  legalName?: string
  tradeName?: string
  gstStatus?: string
  city?: string
  district?: string
  pincode?: string
  fetchedFromGst?: boolean
  lastGstFetch?: string
  createdAt: string
  updatedAt: string
}

// GST Lookup Types
export interface GstValidationResult {
  valid: boolean
  error?: string
  stateCode?: string
  stateName?: string
  panNumber?: string
}

export interface GstLookupData {
  gstin: string
  tradeName?: string
  legalName?: string
  gstStatus?: string
  registrationDate?: string
  businessType?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  district?: string
  state?: string
  stateCode?: string
  pincode?: string
  additionalAddresses?: any[]
}

export interface GstLookupResult {
  success: boolean
  data?: GstLookupData
  error?: string
  errorCode?: 'INVALID_FORMAT' | 'NOT_FOUND' | 'API_ERROR' | 'CANCELLED' | 'RATE_LIMITED'
  warning?: string
  fromCache?: boolean
}

export interface Item {
  id: string
  name: string
  skuHsn?: string
  type: 'PRODUCT' | 'SERVICE'
  unit: string
  salePrice: number
  purchasePrice: number
  taxRate: number
  trackStock: boolean
  currentStock: number
  lowStockWarning: number
  createdAt: string
  updatedAt: string
}

export type SalesDocumentType = 'INVOICE'
export type InvoiceStatus = 'DRAFT' | 'PAID' | 'PARTIAL' | 'OVERDUE'
export type QuotationStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED'
export type ProformaInvoiceStatus = QuotationStatus
export type SalesDocumentStatus = InvoiceStatus | QuotationStatus

export interface SalesInvoice {
  id: string
  invoiceNumber: string
  invoiceDate: string
  dueDate?: string
  type: SalesDocumentType
  partyId: string
  party?: Party
  subtotal: number
  discount: number
  taxAmount: number
  totalAmount: number
  amountPaid: number
  balanceDue: number
  status: InvoiceStatus
  convertedFromQuotationId?: string
  convertedFromProformaId?: string
  notes?: string
  termsConditions?: string
  placeOfSupply?: string
  placeOfSupplyName?: string
  isInterState?: boolean
  reverseCharge?: boolean
  cgstAmount?: number
  sgstAmount?: number
  igstAmount?: number
  cessAmount?: number
  supplyType?: string
  ecommerceGstin?: string
  poNumber?: string
  ewayBillNo?: string
  vehicleNumber?: string
  warrantyPeriod?: string
  dispatchedThrough?: string
  items: SalesInvoiceItem[]
  createdAt: string
  updatedAt: string
}

export interface SalesInvoiceItem {
  id: string
  salesInvoiceId: string
  itemId: string
  item?: Item
  quantity: number
  rate: number
  discount: number
  taxRate: number
  total: number
  hsnCode?: string
  taxableAmount?: number
  cgstRate?: number
  cgstAmount?: number
  sgstRate?: number
  sgstAmount?: number
  igstRate?: number
  igstAmount?: number
  cessRate?: number
  cessAmount?: number
  createdAt: string
}

export interface Quotation {
  id: string
  invoiceNumber: string
  invoiceDate: string
  dueDate?: string
  partyId: string
  party?: Party
  subtotal: number
  discount: number
  taxAmount: number
  totalAmount: number
  status: QuotationStatus
  notes?: string
  placeOfSupply?: string
  placeOfSupplyName?: string
  isInterState?: boolean
  reverseCharge?: boolean
  cgstAmount?: number
  sgstAmount?: number
  igstAmount?: number
  cessAmount?: number
  supplyType?: string
  ecommerceGstin?: string
  deliveryTime?: string
  items: QuotationItem[]
  createdAt: string
  updatedAt: string
}

export interface QuotationItem {
  id: string
  quotationId: string
  itemId: string
  item?: Item
  quantity: number
  rate: number
  discount: number
  taxRate: number
  total: number
  hsnCode?: string
  taxableAmount?: number
  cgstRate?: number
  cgstAmount?: number
  sgstRate?: number
  sgstAmount?: number
  igstRate?: number
  igstAmount?: number
  cessRate?: number
  cessAmount?: number
  createdAt: string
}

export interface ProformaInvoice {
  id: string
  invoiceNumber: string
  invoiceDate: string
  dueDate?: string
  partyId: string
  party?: Party
  subtotal: number
  discount: number
  taxAmount: number
  totalAmount: number
  status: ProformaInvoiceStatus
  notes?: string
  placeOfSupply?: string
  placeOfSupplyName?: string
  isInterState?: boolean
  reverseCharge?: boolean
  cgstAmount?: number
  sgstAmount?: number
  igstAmount?: number
  cessAmount?: number
  supplyType?: string
  ecommerceGstin?: string
  deliveryTime?: string
  items: ProformaInvoiceItem[]
  createdAt: string
  updatedAt: string
}

export interface ProformaInvoiceItem {
  id: string
  proformaInvoiceId: string
  itemId: string
  item?: Item
  quantity: number
  rate: number
  discount: number
  taxRate: number
  total: number
  hsnCode?: string
  taxableAmount?: number
  cgstRate?: number
  cgstAmount?: number
  sgstRate?: number
  sgstAmount?: number
  igstRate?: number
  igstAmount?: number
  cessRate?: number
  cessAmount?: number
  createdAt: string
}

export interface PurchaseBill {
  id: string
  billNumber: string
  billDate: string
  partyId: string
  party?: Party
  subtotal: number
  discount: number
  taxAmount: number
  totalAmount: number
  amountPaid: number
  balanceDue: number
  status: 'DRAFT' | 'PAID' | 'PARTIAL' | 'OVERDUE'
  notes?: string
  items: PurchaseBillItem[]
  createdAt: string
  updatedAt: string
}

export interface PurchaseBillItem {
  id: string
  purchaseBillId: string
  itemId: string
  item?: Item
  quantity: number
  rate: number
  taxRate: number
  total: number
  createdAt: string
}

export interface PaymentTransaction {
  id: string
  type: 'PAYMENT_IN' | 'PAYMENT_OUT'
  partyId: string
  party?: Party
  amount: number
  paymentMode: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'CHEQUE' | 'UPI' | 'OTHER'
  paymentDate: string
  referenceType?: 'INVOICE' | 'BILL' | 'ADVANCE'
  referenceId?: string
  notes?: string
  createdAt: string
}

export interface DashboardMetrics {
  totalReceivables: number
  totalPayables: number
  totalSales: number
  lowStockCount: number
}

export interface SyncStatus {
  status: 'idle' | 'syncing' | 'error'
  lastSync: string | null
  lastError: string | null
}

export interface AuthStatus {
  isAuthenticated: boolean
  user: {
    email?: string
    name?: string
    picture?: string
  } | null
}

// GST Report Types
export interface GSTReportFilters {
  startDate: string
  endDate: string
  period?: 'monthly' | 'quarterly' | 'yearly'
}

export interface GSTR1Section {
  sectionName: string
  sectionCode: string
  invoices: SalesInvoice[]
  totalTaxableValue: number
  totalIgst: number
  totalCgst: number
  totalSgst: number
  totalCess: number
  invoiceCount: number
}

export interface GSTR1Data {
  sections: {
    b2b: GSTR1Section
    b2cl: GSTR1Section
    b2cs: GSTR1Section
    cdnr: GSTR1Section
    cdnur: GSTR1Section
    exp: GSTR1Section
    nilExempt: GSTR1Section
  }
  hsnSummary: HSNSummaryItem[]
  docSummary: {
    totalInvoices: number
    totalValue: number
    totalTaxableValue: number
    totalTax: number
    totalIgst: number
    totalCgst: number
    totalSgst: number
    totalCess: number
  }
  period: {
    startDate: string
    endDate: string
  }
}

export interface GSTR3BData {
  outwardSupplies: {
    taxable: {
      interState: { taxableValue: number; igst: number }
      intraState: { taxableValue: number; cgst: number; sgst: number }
      total: { taxableValue: number; igst: number; cgst: number; sgst: number }
    }
    unregistered: { taxableValue: number; igst: number; cgst: number; sgst: number }
  }
  inwardRCM: {
    taxableValue: number
    igst: number
    cgst: number
    sgst: number
    cess: number
  }
  itc: {
    eligible: { igst: number; cgst: number; sgst: number; cess: number }
    ineligible: { igst: number; cgst: number; sgst: number; cess: number }
    net: { igst: number; cgst: number; sgst: number; cess: number }
  }
  exemptSupplies: {
    interState: number
    intraState: number
  }
  taxLiability: {
    output: { igst: number; cgst: number; sgst: number; cess: number }
    netPayable: { igst: number; cgst: number; sgst: number; cess: number }
    totalPayable: number
  }
  summary: {
    totalSalesInvoices: number
    totalPurchaseBills: number
    totalSalesValue: number
    totalPurchaseValue: number
  }
  period: {
    startDate: string
    endDate: string
  }
}

export interface HSNSummaryItem {
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
}

declare global {
  interface Window {
    electronAPI: {
      auth: {
        signInWithGoogle: () => Promise<any>
        signOut: () => Promise<any>
        getAuthStatus: () => Promise<AuthStatus>
        onAuthInvalidated: (callback: () => void) => () => void
      }
      sync: {
        syncNow: () => Promise<any>
        getSyncStatus: () => Promise<SyncStatus>
        onSyncStatusChange: (callback: (status: SyncStatus) => void) => void
      }
      company: {
        get: () => Promise<{ success: boolean; data?: Company; error?: string }>
        create: (data: Partial<Company>) => Promise<{ success: boolean; data?: Company; error?: string }>
        update: (id: string, data: Partial<Company>) => Promise<{ success: boolean; data?: Company; error?: string }>
        uploadLogo: (filePath: string) => Promise<{ success: boolean; path?: string; error?: string }>
        selectImage: () => Promise<{ success: boolean; path?: string; error?: string }>
      }
      party: {
        getAll: (type?: string) => Promise<{ success: boolean; data?: Party[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: Party; error?: string }>
        create: (data: Partial<Party>) => Promise<{ success: boolean; data?: Party; error?: string }>
        update: (id: string, data: Partial<Party>) => Promise<{ success: boolean; data?: Party; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        getLedger: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
        getStatement: (args: {
          partyId: string
          fromDate: string
          toDate: string
        }) => Promise<{ success: boolean; data?: any; error?: string }>
      }
      item: {
        getAll: () => Promise<{ success: boolean; data?: Item[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: Item; error?: string }>
        create: (data: Partial<Item>) => Promise<{ success: boolean; data?: Item; error?: string }>
        update: (id: string, data: Partial<Item>) => Promise<{ success: boolean; data?: Item; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        getLowStock: () => Promise<{ success: boolean; data?: Item[]; error?: string }>
      }
      sales: {
        getAll: (type?: SalesDocumentType) => Promise<{ success: boolean; data?: SalesInvoice[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: SalesInvoice; error?: string }>
        create: (data: any) => Promise<{ success: boolean; data?: SalesInvoice; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: SalesInvoice; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        generateInvoiceNumber: () => Promise<{ success: boolean; data?: string; error?: string }>
        generatePDF: (id: string) => Promise<{ success: boolean; message?: string; error?: string }>
      }
      quotation: {
        getAll: () => Promise<{ success: boolean; data?: Quotation[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: Quotation; error?: string }>
        create: (data: any) => Promise<{ success: boolean; data?: Quotation; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: Quotation; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        convertToInvoice: (id: string) => Promise<{ success: boolean; data?: SalesInvoice; error?: string }>
        generateQuotationNumber: () => Promise<{ success: boolean; data?: string; error?: string }>
      }
      proformaInvoice: {
        getAll: () => Promise<{ success: boolean; data?: ProformaInvoice[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: ProformaInvoice; error?: string }>
        create: (data: any) => Promise<{ success: boolean; data?: ProformaInvoice; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: ProformaInvoice; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        convertToInvoice: (id: string) => Promise<{ success: boolean; data?: SalesInvoice; error?: string }>
        generateNumber: () => Promise<{ success: boolean; data?: string; error?: string }>
      }
      purchase: {
        getAll: () => Promise<{ success: boolean; data?: PurchaseBill[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: PurchaseBill; error?: string }>
        create: (data: any) => Promise<{ success: boolean; data?: PurchaseBill; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: PurchaseBill; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        generateBillNumber: () => Promise<{ success: boolean; data?: string; error?: string }>
      }
      payment: {
        recordPaymentIn: (data: any) => Promise<{ success: boolean; data?: PaymentTransaction; error?: string }>
        recordPaymentOut: (data: any) => Promise<{ success: boolean; data?: PaymentTransaction; error?: string }>
        getAll: (type?: string) => Promise<{ success: boolean; data?: PaymentTransaction[]; error?: string }>
      }
      challan: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: any; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        convertToInvoice: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
        generateChallanNumber: () => Promise<{ success: boolean; data?: string; error?: string }>
      }
      creditNote: {
        getAll: (type?: string) => Promise<{ success: boolean; data?: any[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: any; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        generateNoteNumber: (type: string) => Promise<{ success: boolean; data?: string; error?: string }>
      }
      cashBank: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: any; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        getTotalBalance: () => Promise<{ success: boolean; data?: { cash: number; bank: number; total: number }; error?: string }>
        adjustBalance: (id: string, amount: number, notes?: string) => Promise<{ success: boolean; data?: any; error?: string }>
      }
      dashboard: {
        getMetrics: () => Promise<{ success: boolean; data?: DashboardMetrics; error?: string }>
        getRecentInvoices: (limit: number) => Promise<{ success: boolean; data?: SalesInvoice[]; error?: string }>
        getSalesChartData: (days: number) => Promise<{ success: boolean; data?: any[]; error?: string }>
        getLatestTransactions: (limit: number) => Promise<{ success: boolean; data?: any[]; error?: string }>
      }
      report: {
        getSalesReport: (filters: any) => Promise<{ success: boolean; data?: any; error?: string }>
        getStockSummary: () => Promise<{ success: boolean; data?: any; error?: string }>
        getReceivables: () => Promise<{ success: boolean; data?: any; error?: string }>
        getPayables: () => Promise<{ success: boolean; data?: any; error?: string }>
        getTaxReport: (filters: any) => Promise<{ success: boolean; data?: any; error?: string }>
      }
      gstReport: {
        getGSTR1: (filters: GSTReportFilters) => Promise<{ success: boolean; data?: GSTR1Data; error?: string }>
        getGSTR2: (filters: GSTReportFilters) => Promise<{ success: boolean; data?: any; error?: string }>
        getGSTR3B: (filters: GSTReportFilters) => Promise<{ success: boolean; data?: GSTR3BData; error?: string }>
        getGSTR9: (filters: GSTReportFilters) => Promise<{ success: boolean; data?: any; error?: string }>
        getHSNSummary: (filters: GSTReportFilters) => Promise<{ success: boolean; data?: HSNSummaryItem[]; error?: string }>
        exportToJSON: (reportType: string, data: any) => Promise<{ success: boolean; data?: string; error?: string }>
        exportGSTR1ToExcel: (data: GSTR1Data) => Promise<{ success: boolean; data?: string; error?: string }>
        exportGSTR3BToExcel: (data: GSTR3BData) => Promise<{ success: boolean; data?: string; error?: string }>
        getCompanyGSTDetails: () => Promise<{ success: boolean; data?: { gstin?: string; legalName?: string; stateCode?: string; stateName?: string }; error?: string }>
        getStateList: () => Promise<{ success: boolean; data?: Record<string, string>; error?: string }>
      }
      settings: {
        get: (key: string) => Promise<{ success: boolean; data?: string | null; error?: string }>
        set: (key: string, value: string) => Promise<{ success: boolean; data?: any; error?: string }>
        getAll: () => Promise<{ success: boolean; data?: Record<string, string>; error?: string }>
      }
      gst: {
        validate: (gstin: string) => Promise<{ success: boolean; data?: GstValidationResult; error?: string }>
        lookup: (gstin: string, forceRefresh?: boolean) => Promise<GstLookupResult>
        getCached: (gstin: string) => Promise<{ success: boolean; data?: any; error?: string }>
        clearExpiredCache: () => Promise<{ success: boolean; data?: { deleted: number }; error?: string }>
        getStateList: () => Promise<{ success: boolean; data?: Record<string, string>; error?: string }>
      }
      share: {
        sharePdf: (args: {
          pdfBytes: Uint8Array
          filename: string
          target: 'whatsapp' | 'email'
          subject?: string
          phone?: string
          email?: string
        }) => Promise<{
          success: boolean
          data?: { savedPath: string; clipboardCopied: boolean; recipientPrefilled: boolean }
          error?: string
        }>
      }
    }
  }
}

export {}
