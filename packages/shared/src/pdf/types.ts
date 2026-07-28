// PDF document data shapes, lifted verbatim from apps/desktop/src/utils/pdfHelpers.ts.
// These are the plain-data inputs the pdfmake document-definition builders consume.
// Platform-agnostic: no DOM, no Node, no pdfmake — just the fields a builder reads.

export interface PDFDocumentData {
  customer: {
    name: string
    email?: string
    phone?: string
    billingAddress?: string
    shippingAddress?: string
    taxId?: string
    stateCode?: string
    stateName?: string
  }
  items: Array<{
    item: {
      name: string
      unit?: string
      hsnCode?: string
      skuHsn?: string
    }
    quantity: number
    rate: number
    taxRate: number
    discount: number
    total: number
    hsnCode?: string
    taxableAmount?: number
    cgstRate?: number
    cgstAmount?: number
    sgstRate?: number
    sgstAmount?: number
    igstRate?: number
    igstAmount?: number
  }>
  company?: {
    name: string
    address?: string
    phone?: string
    email?: string
    taxId?: string
    bankDetails?: string
    currency?: string
    termsConditions?: string
    stateCode?: string
    stateName?: string
    logoPath?: string
    logoBase64?: string
    signaturePath?: string
    // Signature image as a data-URI, drawn in the Authorised Signatory box.
    // Mobile passes signaturePath through (it stores data-URIs); desktop's
    // loadCompanyForPDF inlines a file path into this field.
    signatureBase64?: string
  }
  totalAmount: number
  subtotal?: number
  taxAmount?: number
  discount?: number
  notes?: string
  termsConditions?: string
  isInterState?: boolean
  placeOfSupply?: string
  placeOfSupplyName?: string
}

export interface InvoiceData extends PDFDocumentData {
  invoiceNumber: string
  invoiceDate: string
  dueDate?: string
  type: string
  status: string
  subtotal: number
  discount: number
  taxAmount: number
  amountPaid: number
  balanceDue: number
  placeOfSupply?: string
  placeOfSupplyName?: string
  isInterState?: boolean
  reverseCharge?: boolean
  cgstAmount?: number
  sgstAmount?: number
  igstAmount?: number
  cessAmount?: number
  poNumber?: string
  ewayBillNo?: string
  vehicleNumber?: string
  warrantyPeriod?: string
  dispatchedThrough?: string
  deliveryTime?: string
  // Which visual template to render ('classic' when absent). Rides inside the
  // data so the mobile WebView bridge — which passes a single plain-JSON
  // argument — can select the template too.
  template?: string
}

// pdfmake ships no type definitions; its content/cell nodes are plain objects.
export type Content = any
export type TableCell = any
export type DocDefinition = any
