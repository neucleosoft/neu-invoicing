import { contextBridge, ipcRenderer } from "electron";

// Expose protected methods that allow the renderer process to use ipcRenderer
contextBridge.exposeInMainWorld("electronAPI", {
  // Authentication
  auth: {
    signInWithGoogle: () => ipcRenderer.invoke("auth:signInWithGoogle"),
    signOut: () => ipcRenderer.invoke("auth:signOut"),
    getAuthStatus: () => ipcRenderer.invoke("auth:getAuthStatus"),
    onAuthInvalidated: (callback: () => void) => {
      const handler = () => callback();
      ipcRenderer.on("auth:invalidated", handler);
      return () => ipcRenderer.removeListener("auth:invalidated", handler);
    },
  },

  // Sync
  sync: {
    syncNow: () => ipcRenderer.invoke("sync:syncNow"),
    getSyncStatus: () => ipcRenderer.invoke("sync:getSyncStatus"),
    onSyncStatusChange: (callback: (status: any) => void) => {
      ipcRenderer.on("sync:statusChanged", (_, status) => callback(status));
    },
  },

  // Company
  company: {
    get: () => ipcRenderer.invoke("company:get"),
    create: (data: any) => ipcRenderer.invoke("company:create", data),
    update: (id: string, data: any) =>
      ipcRenderer.invoke("company:update", id, data),
    uploadLogo: (filePath: string) =>
      ipcRenderer.invoke("company:uploadLogo", filePath),
    selectImage: () => ipcRenderer.invoke("company:selectImage"),
  },

  // Customers
  customer: {
    getAll: () => ipcRenderer.invoke("customer:getAll"),
    getById: (id: string) => ipcRenderer.invoke("customer:getById", id),
    create: (data: any) => ipcRenderer.invoke("customer:create", data),
    update: (id: string, data: any) =>
      ipcRenderer.invoke("customer:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("customer:delete", id),
    getLedger: (id: string) => ipcRenderer.invoke("customer:getLedger", id),
    getStatement: (args: { customerId: string; fromDate: string; toDate: string }) =>
      ipcRenderer.invoke("customer:getStatement", args),
  },

  // Suppliers
  supplier: {
    getAll: () => ipcRenderer.invoke("supplier:getAll"),
    getById: (id: string) => ipcRenderer.invoke("supplier:getById", id),
    create: (data: any) => ipcRenderer.invoke("supplier:create", data),
    update: (id: string, data: any) =>
      ipcRenderer.invoke("supplier:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("supplier:delete", id),
  },

  // Supplier items
  supplierItem: {
    getAll: (supplierId?: string) => ipcRenderer.invoke("supplierItem:getAll", supplierId),
    getById: (id: string) => ipcRenderer.invoke("supplierItem:getById", id),
    create: (data: any) => ipcRenderer.invoke("supplierItem:create", data),
    update: (id: string, data: any) =>
      ipcRenderer.invoke("supplierItem:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("supplierItem:delete", id),
  },

  // Items
  item: {
    getAll: () => ipcRenderer.invoke("item:getAll"),
    getById: (id: string) => ipcRenderer.invoke("item:getById", id),
    create: (data: any) => ipcRenderer.invoke("item:create", data),
    update: (id: string, data: any) =>
      ipcRenderer.invoke("item:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("item:delete", id),
    getLowStock: () => ipcRenderer.invoke("item:getLowStock"),
  },

  // Sales
  sales: {
    getAll: () => ipcRenderer.invoke("sales:getAll"),
    getById: (id: string) => ipcRenderer.invoke("sales:getById", id),
    create: (data: any) => ipcRenderer.invoke("sales:create", data),
    update: (id: string, data: any) =>
      ipcRenderer.invoke("sales:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("sales:delete", id),
    generateInvoiceNumber: () =>
      ipcRenderer.invoke("sales:generateInvoiceNumber"),
    generatePDF: (id: string) => ipcRenderer.invoke("sales:generatePDF", id),
  },

  // Quotations
  quotation: {
    getAll: () => ipcRenderer.invoke("quotation:getAll"),
    getById: (id: string) => ipcRenderer.invoke("quotation:getById", id),
    create: (data: any) => ipcRenderer.invoke("quotation:create", data),
    update: (id: string, data: any) =>
      ipcRenderer.invoke("quotation:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("quotation:delete", id),
    convertToInvoice: (id: string) =>
      ipcRenderer.invoke("quotation:convertToInvoice", id),
    generateQuotationNumber: () =>
      ipcRenderer.invoke("quotation:generateQuotationNumber"),
  },

  // Proforma Invoices
  proformaInvoice: {
    getAll: () => ipcRenderer.invoke("proformaInvoice:getAll"),
    getById: (id: string) => ipcRenderer.invoke("proformaInvoice:getById", id),
    create: (data: any) => ipcRenderer.invoke("proformaInvoice:create", data),
    update: (id: string, data: any) =>
      ipcRenderer.invoke("proformaInvoice:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("proformaInvoice:delete", id),
    convertToInvoice: (id: string) =>
      ipcRenderer.invoke("proformaInvoice:convertToInvoice", id),
    generateNumber: () =>
      ipcRenderer.invoke("proformaInvoice:generateNumber"),
  },

  // Purchase
  purchase: {
    getAll: () => ipcRenderer.invoke("purchase:getAll"),
    getById: (id: string) => ipcRenderer.invoke("purchase:getById", id),
    create: (data: any) => ipcRenderer.invoke("purchase:create", data),
    update: (id: string, data: any) =>
      ipcRenderer.invoke("purchase:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("purchase:delete", id),
    generateBillNumber: () => ipcRenderer.invoke("purchase:generateBillNumber"),
    extractFromImage: (args: { fileBytes: Uint8Array; mimeType: string }) =>
      ipcRenderer.invoke("purchase:extractFromImage", args),
  },

  // Payments
  payment: {
    recordPaymentIn: (data: any) =>
      ipcRenderer.invoke("payment:recordPaymentIn", data),
    recordPaymentOut: (data: any) =>
      ipcRenderer.invoke("payment:recordPaymentOut", data),
    getAll: (type?: string) => ipcRenderer.invoke("payment:getAll", type),
  },

  // Dashboard
  dashboard: {
    getMetrics: () => ipcRenderer.invoke("dashboard:getMetrics"),
    getRecentInvoices: (limit: number) =>
      ipcRenderer.invoke("dashboard:getRecentInvoices", limit),
    getSalesChartData: (days: number) =>
      ipcRenderer.invoke("dashboard:getSalesChartData", days),
    getLatestTransactions: (limit: number) =>
      ipcRenderer.invoke("dashboard:getLatestTransactions", limit),
  },

  // Reports
  report: {
    getSalesReport: (filters: any) =>
      ipcRenderer.invoke("report:getSalesReport", filters),
    getStockSummary: () => ipcRenderer.invoke("report:getStockSummary"),
    getReceivables: () => ipcRenderer.invoke("report:getReceivables"),
    getPayables: () => ipcRenderer.invoke("report:getPayables"),
    getTaxReport: (filters: any) =>
      ipcRenderer.invoke("report:getTaxReport", filters),
  },

  // GST Reports
  gstReport: {
    getGSTR1: (filters: any) =>
      ipcRenderer.invoke("gstReport:getGSTR1", filters),
    getGSTR2: (filters: any) =>
      ipcRenderer.invoke("gstReport:getGSTR2", filters),
    getGSTR3B: (filters: any) =>
      ipcRenderer.invoke("gstReport:getGSTR3B", filters),
    getGSTR9: (filters: any) =>
      ipcRenderer.invoke("gstReport:getGSTR9", filters),
    getHSNSummary: (filters: any) =>
      ipcRenderer.invoke("gstReport:getHSNSummary", filters),
    exportToJSON: (reportType: string, data: any) =>
      ipcRenderer.invoke("gstReport:exportToJSON", reportType, data),
    exportGSTR1ToExcel: (data: any) =>
      ipcRenderer.invoke("gstReport:exportGSTR1ToExcel", data),
    exportGSTR3BToExcel: (data: any) =>
      ipcRenderer.invoke("gstReport:exportGSTR3BToExcel", data),
    getCompanyGSTDetails: () =>
      ipcRenderer.invoke("gstReport:getCompanyGSTDetails"),
    getStateList: () => ipcRenderer.invoke("gstReport:getStateList"),
  },

  // Settings
  settings: {
    get: (key: string) => ipcRenderer.invoke("settings:get", key),
    set: (key: string, value: string) =>
      ipcRenderer.invoke("settings:set", key, value),
    getAll: () => ipcRenderer.invoke("settings:getAll"),
  },

  // Delivery Challans
  challan: {
    getAll: () => ipcRenderer.invoke("challan:getAll"),
    getById: (id: string) => ipcRenderer.invoke("challan:getById", id),
    create: (data: any) => ipcRenderer.invoke("challan:create", data),
    update: (id: string, data: any) =>
      ipcRenderer.invoke("challan:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("challan:delete", id),
    convertToInvoice: (id: string) =>
      ipcRenderer.invoke("challan:convertToInvoice", id),
    generateChallanNumber: () =>
      ipcRenderer.invoke("challan:generateChallanNumber"),
  },

  // Credit/Debit Notes
  creditNote: {
    getAll: (type?: string) => ipcRenderer.invoke("creditNote:getAll", type),
    getById: (id: string) => ipcRenderer.invoke("creditNote:getById", id),
    create: (data: any) => ipcRenderer.invoke("creditNote:create", data),
    update: (id: string, data: any) =>
      ipcRenderer.invoke("creditNote:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("creditNote:delete", id),
    generateNoteNumber: (type: string) =>
      ipcRenderer.invoke("creditNote:generateNoteNumber", type),
  },

  // Cash & Bank
  cashBank: {
    getAll: () => ipcRenderer.invoke("cashBank:getAll"),
    getById: (id: string) => ipcRenderer.invoke("cashBank:getById", id),
    create: (data: any) => ipcRenderer.invoke("cashBank:create", data),
    update: (id: string, data: any) =>
      ipcRenderer.invoke("cashBank:update", id, data),
    delete: (id: string) => ipcRenderer.invoke("cashBank:delete", id),
    getTotalBalance: () => ipcRenderer.invoke("cashBank:getTotalBalance"),
    adjustBalance: (id: string, amount: number, notes?: string) =>
      ipcRenderer.invoke("cashBank:adjustBalance", id, amount, notes),
  },

  // GST Lookup
  gst: {
    validate: (gstin: string) => ipcRenderer.invoke("gst:validate", gstin),
    lookup: (gstin: string, forceRefresh?: boolean) =>
      ipcRenderer.invoke("gst:lookup", gstin, forceRefresh),
    getCached: (gstin: string) => ipcRenderer.invoke("gst:getCached", gstin),
    clearExpiredCache: () => ipcRenderer.invoke("gst:clearExpiredCache"),
    getStateList: () => ipcRenderer.invoke("gst:getStateList"),
  },

  // Share (WhatsApp / Email)
  share: {
    sharePdf: (args: {
      pdfBytes: Uint8Array;
      filename: string;
      target: "whatsapp" | "email";
      subject?: string;
      phone?: string;
      email?: string;
    }) => ipcRenderer.invoke("share:sharePdf", args),
  },
});
