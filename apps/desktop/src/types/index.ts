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

interface BaseParty {
  id: string
  name: string
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
  deletedAt?: string | null
}

export interface Customer extends BaseParty {
  type: 'CUSTOMER'
}

export interface Supplier extends BaseParty {
  type: 'SUPPLIER'
}

export type Party = Customer | Supplier

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
  deletedAt?: string | null
}

export interface SupplierItem {
  id: string
  supplierId: string
  supplier?: Supplier
  linkedItemId?: string | null
  linkedItem?: Item | null
  name: string
  supplierSku?: string | null
  description?: string | null
  hsnCode?: string | null
  unit: string
  lastPurchasePrice: number
  defaultTaxRate: number
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export type SalesDocumentType = 'INVOICE'
export type InvoiceStatus = 'DRAFT' | 'PAID' | 'PARTIAL' | 'OVERDUE' | 'REVERSED'
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
  customerId?: string
  customer?: Customer
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
  cancelledAt?: string | null
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
  customerId?: string
  customer?: Customer
  subtotal: number
  discount: number
  taxAmount: number
  totalAmount: number
  status: QuotationStatus
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
  deliveryTime?: string
  items: QuotationItem[]
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
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
  customerId?: string
  customer?: Customer
  subtotal: number
  discount: number
  taxAmount: number
  totalAmount: number
  status: ProformaInvoiceStatus
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
  deliveryTime?: string
  items: ProformaInvoiceItem[]
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
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
  supplierId?: string
  supplier?: Supplier
  subtotal: number
  discount: number
  taxAmount: number
  totalAmount: number
  amountPaid: number
  balanceDue: number
  status: 'DRAFT' | 'PAID' | 'PARTIAL' | 'OVERDUE'
  notes?: string
  // Supplier's own invoice number (what's printed on their bill). Distinct from billNumber,
  // which is OUR internal sequence and is unique-constrained.
  supplierInvoiceNumber?: string | null
  supplierInvoiceDate?: string | null
  attachmentData?: Uint8Array
  attachmentMimeType?: string
  // Optional link to the originating Purchase Order (when this bill was created
  // against a PO). Bills can also be standalone (no PO).
  purchaseOrderId?: string | null
  purchaseOrder?: PurchaseOrder
  items: PurchaseBillItem[]
  createdAt: string
  updatedAt: string
  cancelledAt?: string | null
}

export interface ExtractedBillItem {
  name: string
  hsnCode: string | null
  quantity: number
  rate: number
  taxRate: number
  total: number
}

export interface ExtractedBillData {
  supplierName: string | null
  supplierGstin: string | null
  supplierAddress: string | null
  supplierCity: string | null
  supplierPincode: string | null
  supplierPhone: string | null
  supplierEmail: string | null
  billNumber: string | null
  billDate: string | null
  subtotal: number
  taxAmount: number
  totalAmount: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
  items: ExtractedBillItem[]
}

export interface PurchaseOrder {
  id: string
  orderNumber: string
  orderDate: string
  expectedDate?: string | null
  supplierId: string
  supplier?: Supplier
  billingAddress?: string | null
  shippingAddress?: string | null
  vendorQuotationRef?: string | null
  subtotal: number
  discount: number
  taxAmount: number
  totalAmount: number
  status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CLOSED' | 'CANCELLED'
  notes?: string
  termsConditions?: string
  placeOfSupply?: string
  placeOfSupplyName?: string
  isInterState?: boolean
  cgstAmount?: number
  sgstAmount?: number
  igstAmount?: number
  cessAmount?: number
  items: PurchaseOrderItem[]
  // Bills issued against this PO. Populated when fetched via `getById` / `getAll`.
  // Useful for "X bills against this PO" UI hints.
  bills?: Array<{
    id: string
    billNumber: string
    billDate: string | Date
    totalAmount: number
    status: string
  }>
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export interface PurchaseOrderItem {
  id: string
  purchaseOrderId: string
  supplierItemId: string
  supplierItem?: SupplierItem
  item?: Item
  quantity: number
  receivedQuantity: number
  rate: number
  discount: number
  taxRate: number
  total: number
  hsnCode?: string
  taxableAmount?: number
  createdAt: string
}

export interface PurchaseBillItem {
  id: string
  purchaseBillId: string
  itemId: string
  item?: Item
  supplierItemId?: string
  supplierItem?: SupplierItem
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
  customerId?: string | null
  customer?: Customer | null
  supplierId?: string | null
  supplier?: Supplier | null
  amount: number
  paymentMode: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'CHEQUE' | 'UPI' | 'OTHER'
  paymentDate: string
  referenceType?: 'INVOICE' | 'BILL' | 'ADVANCE'
  referenceId?: string
  notes?: string
  cancelledAt?: string | null
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
  // True when the user chose to skip Google sign-in and use the app offline.
  // Mutually exclusive with `isAuthenticated` (signing in clears the flag).
  offlineMode?: boolean
  // When the current refresh token was issued (ms). Testing-mode tokens die at
  // day 7 — the SessionBanner prompts a renew at day 6.
  signedInAt?: number | null
  // Set when Google REVOKED the session (vs a deliberate sign-out) — drives
  // the red "sign-in expired" banner.
  authInvalidatedAt?: number | null
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
        enterOfflineMode: () => Promise<{ success: boolean; error?: string }>
        exitOfflineMode: () => Promise<{ success: boolean; error?: string }>
        onAuthInvalidated: (callback: () => void) => () => void
      }
      sync: {
        getSyncStatus: () => Promise<SyncStatus>
        checkCloudBackup: () => Promise<{ exists: boolean; modifiedTime?: string; size?: number }>
        syncState: () => Promise<{
          cloudExists: boolean
          localChanged: boolean
          cloudChanged: boolean
          isConflict: boolean
          firstSync: boolean
          cloudModifiedTime?: string
          cloudSize?: number
        }>
        upload: () => Promise<{ success: boolean; error?: string }>
        download: () => Promise<{ success: boolean; error?: string }>
        rowSyncNow: (confirmRemovals?: boolean) => Promise<{
          success: boolean
          error?: string
          needsConfirmation?: boolean
          removalsPending?: number
          pushedPackets?: number
          applied?: number
          skipped?: number
          localRenumbers?: number
          removalsApplied?: number
          recomputeChanges?: number
          photosPushed?: number
          log?: { kind: string; table: string; rowId: string; detail: string }[]
        }>
        getSyncActivityLog: () => Promise<{
          at: number
          kind: string
          table?: string
          rowId?: string
          detail: string
        }[]>
        getRowSyncStatus: () => Promise<{
          lastSyncAt: number | null
          pendingRemovals: number | null
        }>
        fetchBillImage: (billId: string) => Promise<{ success: boolean; error?: string }>
        getLadderInfo: () => Promise<{ name: string; modifiedTime: string | null; size: number | null }[]>
        restoreFromLadder: (slotName: string) => Promise<{ success: boolean; error?: string }>
        getBackupInfo: () => Promise<{
          cloudBackup: { lastSyncTimestamp: string; deviceId: string } | null
          thisDeviceLastUpload: string | null
          backupFrequency: 'off' | 'daily' | 'weekly' | 'monthly'
        }>
        setBackupFrequency: (freq: 'off' | 'daily' | 'weekly' | 'monthly') => Promise<{ success: boolean }>
        onSyncStatusChange: (callback: (status: SyncStatus) => void) => void
      }
      log: {
        openFolder: () => Promise<{ success: boolean }>
        send: (level: string, message: string) => Promise<{ success: boolean }>
      }
      company: {
        get: () => Promise<{ success: boolean; data?: Company; error?: string }>
        create: (data: Partial<Company>) => Promise<{ success: boolean; data?: Company; error?: string }>
        update: (id: string, data: Partial<Company>) => Promise<{ success: boolean; data?: Company; error?: string }>
        uploadLogo: (filePath: string) => Promise<{ success: boolean; path?: string; error?: string }>
        selectImage: () => Promise<{ success: boolean; path?: string; error?: string }>
      }
      customer: {
        getAll: () => Promise<{ success: boolean; data?: Customer[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: Customer; error?: string }>
        create: (data: Partial<Customer>) => Promise<{ success: boolean; data?: Customer; error?: string }>
        update: (id: string, data: Partial<Customer>) => Promise<{ success: boolean; data?: Customer; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        restore: (id: string) => Promise<{ success: boolean; error?: string }>
        getLedger: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
        getStatement: (args: {
          customerId: string
          fromDate: string
          toDate: string
        }) => Promise<{ success: boolean; data?: any; error?: string }>
      }
      supplier: {
        getAll: () => Promise<{ success: boolean; data?: Supplier[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: Supplier; error?: string }>
        create: (data: Partial<Supplier>) => Promise<{ success: boolean; data?: Supplier; error?: string }>
        update: (id: string, data: Partial<Supplier>) => Promise<{ success: boolean; data?: Supplier; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        restore: (id: string) => Promise<{ success: boolean; error?: string }>
      }
      supplierItem: {
        getAll: (supplierId?: string) => Promise<{ success: boolean; data?: SupplierItem[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: SupplierItem; error?: string }>
        create: (data: Partial<SupplierItem>) => Promise<{ success: boolean; data?: SupplierItem; error?: string }>
        update: (id: string, data: Partial<SupplierItem>) => Promise<{ success: boolean; data?: SupplierItem; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        restore: (id: string) => Promise<{ success: boolean; error?: string }>
      }
      item: {
        getAll: () => Promise<{ success: boolean; data?: Item[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: Item; error?: string }>
        create: (data: Partial<Item>) => Promise<{ success: boolean; data?: Item; error?: string }>
        update: (id: string, data: Partial<Item>) => Promise<{ success: boolean; data?: Item; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        restore: (id: string) => Promise<{ success: boolean; error?: string }>
        getLowStock: () => Promise<{ success: boolean; data?: Item[]; error?: string }>
      }
      sales: {
        getAll: () => Promise<{ success: boolean; data?: SalesInvoice[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: SalesInvoice; error?: string }>
        create: (data: any) => Promise<{ success: boolean; data?: SalesInvoice; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: SalesInvoice; error?: string }>
        cancel: (id: string) => Promise<{ success: boolean; error?: string }>
        cancelWithCreditNote: (id: string, payload: { noteNumber: string; noteDate?: string; reason?: string }) => Promise<{ success: boolean; data?: any; error?: string }>
        generateInvoiceNumber: () => Promise<{ success: boolean; data?: string; error?: string }>
        generatePDF: (id: string) => Promise<{ success: boolean; message?: string; error?: string }>
      }
      quotation: {
        getAll: () => Promise<{ success: boolean; data?: Quotation[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: Quotation; error?: string }>
        create: (data: any) => Promise<{ success: boolean; data?: Quotation; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: Quotation; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        restore: (id: string) => Promise<{ success: boolean; error?: string }>
        convertToInvoice: (id: string) => Promise<{ success: boolean; data?: SalesInvoice; error?: string }>
        generateQuotationNumber: () => Promise<{ success: boolean; data?: string; error?: string }>
      }
      proformaInvoice: {
        getAll: () => Promise<{ success: boolean; data?: ProformaInvoice[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: ProformaInvoice; error?: string }>
        create: (data: any) => Promise<{ success: boolean; data?: ProformaInvoice; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: ProformaInvoice; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        restore: (id: string) => Promise<{ success: boolean; error?: string }>
        convertToInvoice: (id: string) => Promise<{ success: boolean; data?: SalesInvoice; error?: string }>
        generateNumber: () => Promise<{ success: boolean; data?: string; error?: string }>
      }
      purchase: {
        getAll: () => Promise<{ success: boolean; data?: PurchaseBill[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: PurchaseBill; error?: string }>
        create: (data: any) => Promise<{ success: boolean; data?: PurchaseBill; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: PurchaseBill; error?: string }>
        cancel: (id: string) => Promise<{ success: boolean; error?: string }>
        generateBillNumber: () => Promise<{ success: boolean; data?: string; error?: string }>
        extractFromImage: (args: { fileBytes: Uint8Array; mimeType: string }) => Promise<{ success: boolean; data?: ExtractedBillData; error?: string }>
      }
      purchaseOrder: {
        getAll: () => Promise<{ success: boolean; data?: PurchaseOrder[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: PurchaseOrder; error?: string }>
        create: (data: any) => Promise<{ success: boolean; data?: PurchaseOrder; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: PurchaseOrder; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        restore: (id: string) => Promise<{ success: boolean; error?: string }>
        generateOrderNumber: () => Promise<{ success: boolean; data?: string; error?: string }>
        markAsReceived: (
          id: string,
          lineUpdates: Array<{ lineId: string; receivedQuantity: number }>,
        ) => Promise<{ success: boolean; data?: PurchaseOrder; error?: string }>
        listOpenForSupplier: (
          supplierId: string,
        ) => Promise<{ success: boolean; data?: PurchaseOrder[]; error?: string }>
      }
      payment: {
        recordPaymentIn: (data: any) => Promise<{ success: boolean; data?: PaymentTransaction; error?: string }>
        recordPaymentOut: (data: any) => Promise<{ success: boolean; data?: PaymentTransaction; error?: string }>
        getAll: (type?: string) => Promise<{ success: boolean; data?: PaymentTransaction[]; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: PaymentTransaction; error?: string }>
        cancel: (id: string) => Promise<{ success: boolean; error?: string }>
      }
      challan: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: any; error?: string }>
        cancel: (id: string) => Promise<{ success: boolean; error?: string }>
        convertToInvoice: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
        generateChallanNumber: () => Promise<{ success: boolean; data?: string; error?: string }>
      }
      creditNote: {
        getAll: (type?: string) => Promise<{ success: boolean; data?: any[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: any; error?: string }>
        cancel: (id: string) => Promise<{ success: boolean; error?: string }>
        generateNoteNumber: (type: string) => Promise<{ success: boolean; data?: string; error?: string }>
      }
      previousInvoice: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
        getFile: (id: string) => Promise<{ success: boolean; data?: { fileData: Uint8Array; fileMimeType: string; fileName: string }; error?: string }>
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: any; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        extractFromPdfText: (args: { fileBytes: Uint8Array }) => Promise<{ success: boolean; data?: any; error?: string }>
      }
      cashBank: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: any; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        restore: (id: string) => Promise<{ success: boolean; error?: string }>
        getTotalBalance: () => Promise<{ success: boolean; data?: { cash: number; bank: number; total: number }; error?: string }>
        adjustBalance: (id: string, amount: number, notes?: string) => Promise<{ success: boolean; data?: any; error?: string }>
      }
      expense: {
        getAll: () => Promise<{ success: boolean; data?: any[]; error?: string }>
        getById: (id: string) => Promise<{ success: boolean; data?: any; error?: string }>
        getReceipt: (
          id: string,
        ) => Promise<{
          success: boolean
          data?: { receiptData: Uint8Array; receiptMimeType: string | null; receiptFileName: string | null }
          error?: string
        }>
        create: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>
        update: (id: string, data: any) => Promise<{ success: boolean; data?: any; error?: string }>
        delete: (id: string) => Promise<{ success: boolean; error?: string }>
        getTotals: (args?: { fromDate?: string; toDate?: string }) => Promise<{
          success: boolean
          data?: {
            byCategory: { category: string; total: number; count: number }[]
            grandTotal: number
            totalCount: number
          }
          error?: string
        }>
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
        exportGSTR1ToGSTNJSON: (data: GSTR1Data) => Promise<{ success: boolean; data?: string; error?: string }>
        exportGSTR1ToFriendlyJSON: (data: GSTR1Data) => Promise<{ success: boolean; data?: string; error?: string }>
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
