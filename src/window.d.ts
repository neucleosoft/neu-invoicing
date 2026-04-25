import type { SalesDocumentType, SalesInvoice } from './types';

export {};

declare global {
  interface Window {
    electronAPI: {
      auth: {
        signInWithGoogle: () => Promise<any>;
        signOut: () => Promise<any>;
        getAuthStatus: () => Promise<any>;
      };
      sync: {
        syncNow: () => Promise<any>;
        getSyncStatus: () => Promise<any>;
        onSyncStatusChange: (callback: (status: any) => void) => void;
      };
      company: {
        get: () => Promise<any>;
        create: (data: any) => Promise<any>;
        update: (id: string, data: any) => Promise<any>;
        uploadLogo: (filePath: string) => Promise<any>;
        selectImage: () => Promise<any>;
      };
      party: {
        getAll: (type?: string) => Promise<any>;
        getById: (id: string) => Promise<any>;
        create: (data: any) => Promise<any>;
        update: (id: string, data: any) => Promise<any>;
        delete: (id: string) => Promise<any>;
        getLedger: (id: string) => Promise<any>;
      };
      item: {
        getAll: () => Promise<any>;
        getById: (id: string) => Promise<any>;
        create: (data: any) => Promise<any>;
        update: (id: string, data: any) => Promise<any>;
        delete: (id: string) => Promise<any>;
        getLowStock: () => Promise<any>;
      };
      sales: {
        getAll: (type?: SalesDocumentType) => Promise<{ success: boolean; data?: SalesInvoice[]; error?: string }>;
        getById: (id: string) => Promise<{ success: boolean; data?: SalesInvoice; error?: string }>;
        create: (data: any) => Promise<{ success: boolean; data?: SalesInvoice; error?: string }>;
        update: (id: string, data: any) => Promise<{ success: boolean; data?: SalesInvoice; error?: string }>;
        delete: (id: string) => Promise<{ success: boolean; error?: string }>;
        convertQuoteToInvoice: (quoteId: string) => Promise<{ success: boolean; data?: SalesInvoice; error?: string }>;
        generateInvoiceNumber: () => Promise<{ success: boolean; data?: string; error?: string }>;
        generatePDF: (id: string) => Promise<{ success: boolean; message?: string; error?: string }>;
      };
      purchase: {
        getAll: () => Promise<any>;
        getById: (id: string) => Promise<any>;
        create: (data: any) => Promise<any>;
        update: (id: string, data: any) => Promise<any>;
        delete: (id: string) => Promise<any>;
        generateBillNumber: () => Promise<any>;
      };
      payment: {
        recordPaymentIn: (data: any) => Promise<any>;
        recordPaymentOut: (data: any) => Promise<any>;
        getAll: (type?: string) => Promise<any>;
      };
      dashboard: {
        getMetrics: () => Promise<any>;
        getRecentInvoices: (limit: number) => Promise<any>;
        getSalesChartData: (months: number) => Promise<any>;
        getLatestTransactions: (limit: number) => Promise<any>;
      };
      report: {
        getSalesReport: (filters: any) => Promise<any>;
        getStockSummary: () => Promise<any>;
        getReceivables: () => Promise<any>;
        getPayables: () => Promise<any>;
        getTaxReport: (filters: any) => Promise<any>;
      };
      challan: {
        getAll: () => Promise<any>;
        getById: (id: string) => Promise<any>;
        create: (data: any) => Promise<any>;
        update: (id: string, data: any) => Promise<any>;
        delete: (id: string) => Promise<any>;
        convertToInvoice: (id: string) => Promise<any>;
        generateChallanNumber: () => Promise<any>;
      };
      creditNote: {
        getAll: (type?: string) => Promise<any>;
        getById: (id: string) => Promise<any>;
        create: (data: any) => Promise<any>;
        update: (id: string, data: any) => Promise<any>;
        delete: (id: string) => Promise<any>;
        generateNoteNumber: (type: string) => Promise<any>;
      };
      cashBank: {
        getAll: () => Promise<any>;
        getById: (id: string) => Promise<any>;
        create: (data: any) => Promise<any>;
        update: (id: string, data: any) => Promise<any>;
        delete: (id: string) => Promise<any>;
        getTotalBalance: () => Promise<any>;
        adjustBalance: (
          id: string,
          amount: number,
          notes?: string,
        ) => Promise<any>;
      };
      gstReport: {
        getGSTR1: (filters: any) => Promise<any>;
        getGSTR2: (filters: any) => Promise<any>;
        getGSTR3B: (filters: any) => Promise<any>;
        getGSTR9: (filters: any) => Promise<any>;
        getHSNSummary: (filters: any) => Promise<any>;
        exportToJSON: (reportType: string, data: any) => Promise<any>;
        exportGSTR1ToExcel: (data: any) => Promise<any>;
        exportGSTR3BToExcel: (data: any) => Promise<any>;
        getCompanyGSTDetails: () => Promise<any>;
        getStateList: () => Promise<any>;
      };
      settings: {
        get: (key: string) => Promise<any>;
        set: (key: string, value: string) => Promise<any>;
        getAll: () => Promise<any>;
      };
      gst: {
        validate: (gstin: string) => Promise<any>;
        lookup: (gstin: string, forceRefresh?: boolean) => Promise<any>;
        getCached: (gstin: string) => Promise<any>;
        clearExpiredCache: () => Promise<any>;
        getStateList: () => Promise<any>;
      };
    };
  }
}
