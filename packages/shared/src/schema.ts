import {
  sqliteTable,
  text,
  integer,
  real,
  blob,
  customType,
} from "drizzle-orm/sqlite-core";
import cuid from "cuid";

const now = () => new Date();

// Stores Date values as Unix-epoch MILLISECOND integers — the format Prisma
// actually writes for SQLite DateTime columns. (An earlier version wrote
// ISO-8601 text while claiming to match Prisma; on desktop-born DBs that put
// two dialects into one column and broke SQL date comparison/sorting.
// runMigrations' repairLegacyTextDates() converts those old text rows.)
//
// dataType stays "text" on purpose: changing the declared type would make
// drizzle-kit emit table-rebuild migrations for every table. The declared
// type only affects column affinity in mobile-born DBs; desktop-born DBs use
// Prisma's DATETIME (numeric affinity) regardless. fromDriver therefore
// tolerates every dialect ever written: integer ms, digit-string ms (a number
// stored into a text-affinity column), and legacy ISO text.
const prismaDate = customType<{ data: Date; driverData: string | number }>({
  dataType() {
    return "text";
  },
  toDriver(value: Date): number {
    return value.getTime();
  },
  fromDriver(value: string | number): Date {
    if (typeof value === "number") return new Date(value);
    if (/^\d+$/.test(value)) return new Date(Number(value));
    return new Date(value);
  },
});

// =============================================================
// Company (singleton)
// =============================================================
export const company = sqliteTable("Company", {
  id: text("id").primaryKey().$defaultFn(cuid),
  name: text("name").notNull(),
  address: text("address").notNull(),
  phone: text("phone"),
  email: text("email"),
  taxId: text("taxId"),
  logoPath: text("logoPath"),
  signaturePath: text("signaturePath"),
  fiscalYearStart: integer("fiscalYearStart").notNull().default(4),
  currency: text("currency").notNull().default("USD"),
  invoicePrefix: text("invoicePrefix").notNull().default("INV"),
  termsConditions: text("termsConditions"),
  bankDetails: text("bankDetails"),
  stateCode: text("stateCode"),
  stateName: text("stateName"),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

// =============================================================
// Customer (sales-side party; mapped to "Party" table for parity with desktop)
// =============================================================
export const customer = sqliteTable("Party", {
  id: text("id").primaryKey().$defaultFn(cuid),
  deletedAt: prismaDate("deletedAt"),
  name: text("name").notNull(),
  type: text("type").notNull(),
  phone: text("phone"),
  email: text("email"),
  billingAddress: text("billingAddress"),
  shippingAddress: text("shippingAddress"),
  taxId: text("taxId"),
  openingBalance: real("openingBalance").notNull().default(0),
  currentBalance: real("currentBalance").notNull().default(0),
  stateCode: text("stateCode"),
  stateName: text("stateName"),
  gstType: text("gstType").notNull().default("REGULAR"),
  legalName: text("legalName"),
  tradeName: text("tradeName"),
  gstStatus: text("gstStatus"),
  city: text("city"),
  district: text("district"),
  pincode: text("pincode"),
  fetchedFromGst: integer("fetchedFromGst", { mode: "boolean" })
    .notNull()
    .default(false),
  lastGstFetch: prismaDate("lastGstFetch"),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

// =============================================================
// Supplier
// =============================================================
export const supplier = sqliteTable("Supplier", {
  id: text("id").primaryKey().$defaultFn(cuid),
  deletedAt: prismaDate("deletedAt"),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  billingAddress: text("billingAddress"),
  shippingAddress: text("shippingAddress"),
  taxId: text("taxId"),
  openingBalance: real("openingBalance").notNull().default(0),
  currentBalance: real("currentBalance").notNull().default(0),
  stateCode: text("stateCode"),
  stateName: text("stateName"),
  gstType: text("gstType").notNull().default("REGULAR"),
  legalName: text("legalName"),
  tradeName: text("tradeName"),
  gstStatus: text("gstStatus"),
  city: text("city"),
  district: text("district"),
  pincode: text("pincode"),
  fetchedFromGst: integer("fetchedFromGst", { mode: "boolean" })
    .notNull()
    .default(false),
  lastGstFetch: prismaDate("lastGstFetch"),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

// =============================================================
// Item (sellable products and services)
// =============================================================
export const item = sqliteTable("Item", {
  id: text("id").primaryKey().$defaultFn(cuid),
  deletedAt: prismaDate("deletedAt"),
  name: text("name").notNull(),
  skuHsn: text("skuHsn"),
  hsnCode: text("hsnCode"),
  type: text("type").notNull().default("PRODUCT"),
  unit: text("unit").notNull().default("pcs"),
  salePrice: real("salePrice").notNull().default(0),
  purchasePrice: real("purchasePrice").notNull().default(0),
  taxRate: real("taxRate").notNull().default(0),
  gstType: text("gstType").notNull().default("GST"),
  trackStock: integer("trackStock", { mode: "boolean" })
    .notNull()
    .default(false),
  currentStock: real("currentStock").notNull().default(0),
  lowStockWarning: real("lowStockWarning").notNull().default(10),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

// =============================================================
// SupplierItem (catalog of items each supplier sells YOU)
// =============================================================
export const supplierItem = sqliteTable("SupplierItem", {
  id: text("id").primaryKey().$defaultFn(cuid),
  deletedAt: prismaDate("deletedAt"),
  supplierId: text("supplierId")
    .notNull()
    .references(() => supplier.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  hsnCode: text("hsnCode"),
  unit: text("unit").notNull().default("pcs"),
  lastPurchasePrice: real("lastPurchasePrice").notNull().default(0),
  defaultTaxRate: real("defaultTaxRate").notNull().default(0),
  linkedItemId: text("linkedItemId").references(() => item.id),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

// =============================================================
// Sales Invoice
// =============================================================
export const salesInvoice = sqliteTable("SalesInvoice", {
  id: text("id").primaryKey().$defaultFn(cuid),
  deletedAt: prismaDate("deletedAt"),
  invoiceNumber: text("invoiceNumber").notNull().unique(),
  invoiceDate: prismaDate("invoiceDate")
    .notNull()
    .$defaultFn(now),
  dueDate: prismaDate("dueDate"),
  type: text("type").notNull().default("INVOICE"),
  customerId: text("partyId")
    .notNull()
    .references(() => customer.id),
  subtotal: real("subtotal").notNull().default(0),
  discount: real("discount").notNull().default(0),
  taxAmount: real("taxAmount").notNull().default(0),
  totalAmount: real("totalAmount").notNull().default(0),
  amountPaid: real("amountPaid").notNull().default(0),
  balanceDue: real("balanceDue").notNull().default(0),
  status: text("status").notNull().default("DRAFT"),
  convertedFromQuotationId: text("convertedFromQuotationId"),
  convertedFromProformaId: text("convertedFromProformaId"),
  notes: text("notes"),
  termsConditions: text("termsConditions"),
  placeOfSupply: text("placeOfSupply"),
  placeOfSupplyName: text("placeOfSupplyName"),
  isInterState: integer("isInterState", { mode: "boolean" })
    .notNull()
    .default(false),
  reverseCharge: integer("reverseCharge", { mode: "boolean" })
    .notNull()
    .default(false),
  cgstAmount: real("cgstAmount").notNull().default(0),
  sgstAmount: real("sgstAmount").notNull().default(0),
  igstAmount: real("igstAmount").notNull().default(0),
  cessAmount: real("cessAmount").notNull().default(0),
  supplyType: text("supplyType").notNull().default("B2B"),
  ecommerceGstin: text("ecommerceGstin"),
  poNumber: text("poNumber"),
  ewayBillNo: text("ewayBillNo"),
  vehicleNumber: text("vehicleNumber"),
  warrantyPeriod: text("warrantyPeriod"),
  dispatchedThrough: text("dispatchedThrough"),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

export const salesInvoiceItem = sqliteTable("SalesInvoiceItem", {
  id: text("id").primaryKey().$defaultFn(cuid),
  salesInvoiceId: text("salesInvoiceId")
    .notNull()
    .references(() => salesInvoice.id, { onDelete: "cascade" }),
  itemId: text("itemId")
    .notNull()
    .references(() => item.id),
  quantity: real("quantity").notNull(),
  rate: real("rate").notNull(),
  discount: real("discount").notNull().default(0),
  taxRate: real("taxRate").notNull().default(0),
  total: real("total").notNull(),
  hsnCode: text("hsnCode"),
  taxableAmount: real("taxableAmount").notNull().default(0),
  cgstRate: real("cgstRate").notNull().default(0),
  cgstAmount: real("cgstAmount").notNull().default(0),
  sgstRate: real("sgstRate").notNull().default(0),
  sgstAmount: real("sgstAmount").notNull().default(0),
  igstRate: real("igstRate").notNull().default(0),
  igstAmount: real("igstAmount").notNull().default(0),
  cessRate: real("cessRate").notNull().default(0),
  cessAmount: real("cessAmount").notNull().default(0),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
});

// =============================================================
// Quotation
// =============================================================
export const quotation = sqliteTable("Quotation", {
  id: text("id").primaryKey().$defaultFn(cuid),
  deletedAt: prismaDate("deletedAt"),
  invoiceNumber: text("invoiceNumber").notNull().unique(),
  invoiceDate: prismaDate("invoiceDate")
    .notNull()
    .$defaultFn(now),
  dueDate: prismaDate("dueDate"),
  customerId: text("partyId")
    .notNull()
    .references(() => customer.id),
  subtotal: real("subtotal").notNull().default(0),
  discount: real("discount").notNull().default(0),
  taxAmount: real("taxAmount").notNull().default(0),
  totalAmount: real("totalAmount").notNull().default(0),
  status: text("status").notNull().default("DRAFT"),
  notes: text("notes"),
  termsConditions: text("termsConditions"),
  placeOfSupply: text("placeOfSupply"),
  placeOfSupplyName: text("placeOfSupplyName"),
  isInterState: integer("isInterState", { mode: "boolean" })
    .notNull()
    .default(false),
  reverseCharge: integer("reverseCharge", { mode: "boolean" })
    .notNull()
    .default(false),
  cgstAmount: real("cgstAmount").notNull().default(0),
  sgstAmount: real("sgstAmount").notNull().default(0),
  igstAmount: real("igstAmount").notNull().default(0),
  cessAmount: real("cessAmount").notNull().default(0),
  supplyType: text("supplyType").notNull().default("B2B"),
  ecommerceGstin: text("ecommerceGstin"),
  deliveryTime: prismaDate("deliveryTime"),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

export const quotationItem = sqliteTable("QuotationItem", {
  id: text("id").primaryKey().$defaultFn(cuid),
  quotationId: text("quotationId")
    .notNull()
    .references(() => quotation.id, { onDelete: "cascade" }),
  itemId: text("itemId")
    .notNull()
    .references(() => item.id),
  quantity: real("quantity").notNull(),
  rate: real("rate").notNull(),
  discount: real("discount").notNull().default(0),
  taxRate: real("taxRate").notNull().default(0),
  total: real("total").notNull(),
  hsnCode: text("hsnCode"),
  taxableAmount: real("taxableAmount").notNull().default(0),
  cgstRate: real("cgstRate").notNull().default(0),
  cgstAmount: real("cgstAmount").notNull().default(0),
  sgstRate: real("sgstRate").notNull().default(0),
  sgstAmount: real("sgstAmount").notNull().default(0),
  igstRate: real("igstRate").notNull().default(0),
  igstAmount: real("igstAmount").notNull().default(0),
  cessRate: real("cessRate").notNull().default(0),
  cessAmount: real("cessAmount").notNull().default(0),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
});

// =============================================================
// Proforma Invoice
// =============================================================
export const proformaInvoice = sqliteTable("ProformaInvoice", {
  id: text("id").primaryKey().$defaultFn(cuid),
  deletedAt: prismaDate("deletedAt"),
  invoiceNumber: text("invoiceNumber").notNull().unique(),
  invoiceDate: prismaDate("invoiceDate")
    .notNull()
    .$defaultFn(now),
  dueDate: prismaDate("dueDate"),
  customerId: text("partyId")
    .notNull()
    .references(() => customer.id),
  subtotal: real("subtotal").notNull().default(0),
  discount: real("discount").notNull().default(0),
  taxAmount: real("taxAmount").notNull().default(0),
  totalAmount: real("totalAmount").notNull().default(0),
  status: text("status").notNull().default("DRAFT"),
  notes: text("notes"),
  termsConditions: text("termsConditions"),
  placeOfSupply: text("placeOfSupply"),
  placeOfSupplyName: text("placeOfSupplyName"),
  isInterState: integer("isInterState", { mode: "boolean" })
    .notNull()
    .default(false),
  reverseCharge: integer("reverseCharge", { mode: "boolean" })
    .notNull()
    .default(false),
  cgstAmount: real("cgstAmount").notNull().default(0),
  sgstAmount: real("sgstAmount").notNull().default(0),
  igstAmount: real("igstAmount").notNull().default(0),
  cessAmount: real("cessAmount").notNull().default(0),
  supplyType: text("supplyType").notNull().default("B2B"),
  ecommerceGstin: text("ecommerceGstin"),
  deliveryTime: prismaDate("deliveryTime"),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

export const proformaInvoiceItem = sqliteTable("ProformaInvoiceItem", {
  id: text("id").primaryKey().$defaultFn(cuid),
  proformaInvoiceId: text("proformaInvoiceId")
    .notNull()
    .references(() => proformaInvoice.id, { onDelete: "cascade" }),
  itemId: text("itemId")
    .notNull()
    .references(() => item.id),
  quantity: real("quantity").notNull(),
  rate: real("rate").notNull(),
  discount: real("discount").notNull().default(0),
  taxRate: real("taxRate").notNull().default(0),
  total: real("total").notNull(),
  hsnCode: text("hsnCode"),
  taxableAmount: real("taxableAmount").notNull().default(0),
  cgstRate: real("cgstRate").notNull().default(0),
  cgstAmount: real("cgstAmount").notNull().default(0),
  sgstRate: real("sgstRate").notNull().default(0),
  sgstAmount: real("sgstAmount").notNull().default(0),
  igstRate: real("igstRate").notNull().default(0),
  igstAmount: real("igstAmount").notNull().default(0),
  cessRate: real("cessRate").notNull().default(0),
  cessAmount: real("cessAmount").notNull().default(0),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
});

// =============================================================
// Purchase Order
// =============================================================
export const purchaseOrder = sqliteTable("PurchaseOrder", {
  id: text("id").primaryKey().$defaultFn(cuid),
  deletedAt: prismaDate("deletedAt"),
  orderNumber: text("orderNumber").notNull().unique(),
  orderDate: prismaDate("orderDate")
    .notNull()
    .$defaultFn(now),
  expectedDate: prismaDate("expectedDate"),
  supplierId: text("supplierId")
    .notNull()
    .references(() => supplier.id),
  billingAddress: text("billingAddress"),
  shippingAddress: text("shippingAddress"),
  vendorQuotationRef: text("vendorQuotationRef"),
  subtotal: real("subtotal").notNull().default(0),
  discount: real("discount").notNull().default(0),
  taxAmount: real("taxAmount").notNull().default(0),
  totalAmount: real("totalAmount").notNull().default(0),
  status: text("status").notNull().default("DRAFT"),
  notes: text("notes"),
  termsConditions: text("termsConditions"),
  placeOfSupply: text("placeOfSupply"),
  placeOfSupplyName: text("placeOfSupplyName"),
  isInterState: integer("isInterState", { mode: "boolean" })
    .notNull()
    .default(false),
  cgstAmount: real("cgstAmount").notNull().default(0),
  sgstAmount: real("sgstAmount").notNull().default(0),
  igstAmount: real("igstAmount").notNull().default(0),
  cessAmount: real("cessAmount").notNull().default(0),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

export const purchaseOrderItem = sqliteTable("PurchaseOrderItem", {
  id: text("id").primaryKey().$defaultFn(cuid),
  purchaseOrderId: text("purchaseOrderId")
    .notNull()
    .references(() => purchaseOrder.id, { onDelete: "cascade" }),
  supplierItemId: text("supplierItemId")
    .notNull()
    .references(() => supplierItem.id),
  quantity: real("quantity").notNull(),
  receivedQuantity: real("receivedQuantity").notNull().default(0),
  rate: real("rate").notNull(),
  discount: real("discount").notNull().default(0),
  taxRate: real("taxRate").notNull().default(0),
  total: real("total").notNull(),
  hsnCode: text("hsnCode"),
  taxableAmount: real("taxableAmount").notNull().default(0),
  cgstRate: real("cgstRate").notNull().default(0),
  cgstAmount: real("cgstAmount").notNull().default(0),
  sgstRate: real("sgstRate").notNull().default(0),
  sgstAmount: real("sgstAmount").notNull().default(0),
  igstRate: real("igstRate").notNull().default(0),
  igstAmount: real("igstAmount").notNull().default(0),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
});

// =============================================================
// Purchase Bill (with attachment BLOB)
// =============================================================
export const purchaseBill = sqliteTable("PurchaseBill", {
  id: text("id").primaryKey().$defaultFn(cuid),
  deletedAt: prismaDate("deletedAt"),
  billNumber: text("billNumber").notNull().unique(),
  billDate: prismaDate("billDate")
    .notNull()
    .$defaultFn(now),
  supplierId: text("supplierId")
    .notNull()
    .references(() => supplier.id),
  subtotal: real("subtotal").notNull().default(0),
  discount: real("discount").notNull().default(0),
  taxAmount: real("taxAmount").notNull().default(0),
  totalAmount: real("totalAmount").notNull().default(0),
  amountPaid: real("amountPaid").notNull().default(0),
  balanceDue: real("balanceDue").notNull().default(0),
  status: text("status").notNull().default("DRAFT"),
  notes: text("notes"),
  placeOfSupply: text("placeOfSupply"),
  placeOfSupplyName: text("placeOfSupplyName"),
  isInterState: integer("isInterState", { mode: "boolean" })
    .notNull()
    .default(false),
  reverseCharge: integer("reverseCharge", { mode: "boolean" })
    .notNull()
    .default(false),
  cgstAmount: real("cgstAmount").notNull().default(0),
  sgstAmount: real("sgstAmount").notNull().default(0),
  igstAmount: real("igstAmount").notNull().default(0),
  cessAmount: real("cessAmount").notNull().default(0),
  supplierInvoiceNumber: text("supplierInvoiceNumber"),
  supplierInvoiceDate: prismaDate("supplierInvoiceDate"),
  itcEligibility: text("itcEligibility").notNull().default("ELIGIBLE"),
  attachmentData: blob("attachmentData", { mode: "buffer" }),
  attachmentMimeType: text("attachmentMimeType"),
  purchaseOrderId: text("purchaseOrderId").references(() => purchaseOrder.id, {
    onDelete: "set null",
  }),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

export const purchaseBillItem = sqliteTable("PurchaseBillItem", {
  id: text("id").primaryKey().$defaultFn(cuid),
  purchaseBillId: text("purchaseBillId")
    .notNull()
    .references(() => purchaseBill.id, { onDelete: "cascade" }),
  supplierItemId: text("supplierItemId")
    .notNull()
    .references(() => supplierItem.id),
  quantity: real("quantity").notNull(),
  rate: real("rate").notNull(),
  discount: real("discount").notNull().default(0),
  taxRate: real("taxRate").notNull().default(0),
  total: real("total").notNull(),
  hsnCode: text("hsnCode"),
  taxableAmount: real("taxableAmount").notNull().default(0),
  cgstRate: real("cgstRate").notNull().default(0),
  cgstAmount: real("cgstAmount").notNull().default(0),
  sgstRate: real("sgstRate").notNull().default(0),
  sgstAmount: real("sgstAmount").notNull().default(0),
  igstRate: real("igstRate").notNull().default(0),
  igstAmount: real("igstAmount").notNull().default(0),
  cessRate: real("cessRate").notNull().default(0),
  cessAmount: real("cessAmount").notNull().default(0),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
});

// =============================================================
// Payment Transaction (covers PAYMENT_IN and PAYMENT_OUT)
// =============================================================
export const paymentTransaction = sqliteTable("PaymentTransaction", {
  id: text("id").primaryKey().$defaultFn(cuid),
  deletedAt: prismaDate("deletedAt"),
  type: text("type").notNull(),
  customerId: text("partyId").references(() => customer.id),
  supplierId: text("supplierId").references(() => supplier.id),
  amount: real("amount").notNull(),
  paymentMode: text("paymentMode").notNull().default("CASH"),
  paymentDate: prismaDate("paymentDate")
    .notNull()
    .$defaultFn(now),
  referenceType: text("referenceType"),
  referenceId: text("referenceId"),
  salesInvoiceId: text("salesInvoiceId").references(() => salesInvoice.id),
  purchaseBillId: text("purchaseBillId").references(() => purchaseBill.id),
  notes: text("notes"),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
});

// =============================================================
// Stock Movement (audit log)
// =============================================================
export const stockMovement = sqliteTable("StockMovement", {
  id: text("id").primaryKey().$defaultFn(cuid),
  itemId: text("itemId")
    .notNull()
    .references(() => item.id),
  movementType: text("movementType").notNull(),
  quantity: real("quantity").notNull(),
  referenceType: text("referenceType"),
  referenceId: text("referenceId"),
  notes: text("notes"),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
});

// =============================================================
// Sync Metadata
// =============================================================
export const syncMetadata = sqliteTable("SyncMetadata", {
  id: text("id").primaryKey().$defaultFn(cuid),
  lastSyncTimestamp: prismaDate("lastSyncTimestamp")
    .notNull()
    .$defaultFn(now),
  deviceId: text("deviceId").notNull(),
  syncStatus: text("syncStatus").notNull().default("idle"),
  cloudFileModifiedTime: prismaDate("cloudFileModifiedTime"),
  lastError: text("lastError"),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

// =============================================================
// Settings (generic key/value)
// =============================================================
export const settings = sqliteTable("Settings", {
  id: text("id").primaryKey().$defaultFn(cuid),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

// =============================================================
// Delivery Challan
// =============================================================
export const deliveryChallan = sqliteTable("DeliveryChallan", {
  id: text("id").primaryKey().$defaultFn(cuid),
  deletedAt: prismaDate("deletedAt"),
  challanNumber: text("challanNumber").notNull().unique(),
  challanDate: prismaDate("challanDate")
    .notNull()
    .$defaultFn(now),
  customerId: text("partyId")
    .notNull()
    .references(() => customer.id),
  subtotal: real("subtotal").notNull().default(0),
  taxAmount: real("taxAmount").notNull().default(0),
  totalAmount: real("totalAmount").notNull().default(0),
  transportMode: text("transportMode"),
  vehicleNumber: text("vehicleNumber"),
  notes: text("notes"),
  termsConditions: text("termsConditions"),
  status: text("status").notNull().default("NON_RETURNABLE"),
  convertedToInvoiceId: text("convertedToInvoiceId"),
  poNumber: text("poNumber"),
  ewayBillNo: text("ewayBillNo"),
  warrantyPeriod: text("warrantyPeriod"),
  dispatchedThrough: text("dispatchedThrough"),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

export const deliveryChallanItem = sqliteTable("DeliveryChallanItem", {
  id: text("id").primaryKey().$defaultFn(cuid),
  deliveryChallanId: text("deliveryChallanId")
    .notNull()
    .references(() => deliveryChallan.id, { onDelete: "cascade" }),
  itemId: text("itemId")
    .notNull()
    .references(() => item.id),
  quantity: real("quantity").notNull(),
  rate: real("rate").notNull(),
  taxRate: real("taxRate").notNull().default(0),
  discount: real("discount").notNull().default(0),
  total: real("total").notNull(),
  hsnCode: text("hsnCode"),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
});

// =============================================================
// Credit / Debit Note
// =============================================================
export const creditDebitNote = sqliteTable("CreditDebitNote", {
  id: text("id").primaryKey().$defaultFn(cuid),
  deletedAt: prismaDate("deletedAt"),
  noteNumber: text("noteNumber").notNull().unique(),
  noteDate: prismaDate("noteDate")
    .notNull()
    .$defaultFn(now),
  type: text("type").notNull(),
  customerId: text("partyId")
    .notNull()
    .references(() => customer.id),
  referenceInvoiceId: text("referenceInvoiceId").references(
    () => salesInvoice.id,
  ),
  reason: text("reason"),
  subtotal: real("subtotal").notNull().default(0),
  taxAmount: real("taxAmount").notNull().default(0),
  totalAmount: real("totalAmount").notNull().default(0),
  cgstAmount: real("cgstAmount").notNull().default(0),
  sgstAmount: real("sgstAmount").notNull().default(0),
  igstAmount: real("igstAmount").notNull().default(0),
  isInterState: integer("isInterState", { mode: "boolean" })
    .notNull()
    .default(false),
  status: text("status").notNull().default("ACTIVE"),
  notes: text("notes"),
  termsConditions: text("termsConditions"),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

export const creditDebitNoteItem = sqliteTable("CreditDebitNoteItem", {
  id: text("id").primaryKey().$defaultFn(cuid),
  creditDebitNoteId: text("creditDebitNoteId")
    .notNull()
    .references(() => creditDebitNote.id, { onDelete: "cascade" }),
  itemId: text("itemId")
    .notNull()
    .references(() => item.id),
  quantity: real("quantity").notNull(),
  rate: real("rate").notNull(),
  discount: real("discount").notNull().default(0),
  taxRate: real("taxRate").notNull().default(0),
  total: real("total").notNull(),
  hsnCode: text("hsnCode"),
  taxableAmount: real("taxableAmount").notNull().default(0),
  cgstRate: real("cgstRate").notNull().default(0),
  cgstAmount: real("cgstAmount").notNull().default(0),
  sgstRate: real("sgstRate").notNull().default(0),
  sgstAmount: real("sgstAmount").notNull().default(0),
  igstRate: real("igstRate").notNull().default(0),
  igstAmount: real("igstAmount").notNull().default(0),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
});

// =============================================================
// Bank Account (cash + bank ledger heads)
// =============================================================
export const bankAccount = sqliteTable("BankAccount", {
  id: text("id").primaryKey().$defaultFn(cuid),
  deletedAt: prismaDate("deletedAt"),
  name: text("name").notNull(),
  type: text("type").notNull(),
  accountNumber: text("accountNumber"),
  bankName: text("bankName"),
  ifscCode: text("ifscCode"),
  currentBalance: real("currentBalance").notNull().default(0),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

// =============================================================
// GST Lookup Cache
// =============================================================
export const gstCache = sqliteTable("GstCache", {
  id: text("id").primaryKey().$defaultFn(cuid),
  gstin: text("gstin").notNull().unique(),
  tradeName: text("tradeName"),
  legalName: text("legalName"),
  gstStatus: text("gstStatus"),
  registrationDate: text("registrationDate"),
  businessType: text("businessType"),
  addressLine1: text("addressLine1"),
  addressLine2: text("addressLine2"),
  city: text("city"),
  district: text("district"),
  state: text("state"),
  stateCode: text("stateCode"),
  pincode: text("pincode"),
  additionalAddresses: text("additionalAddresses"),
  rawResponse: text("rawResponse"),
  fetchedAt: prismaDate("fetchedAt")
    .notNull()
    .$defaultFn(now),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

// =============================================================
// Previous Invoice (legacy archive with raw file BLOB)
// =============================================================
export const previousInvoice = sqliteTable("PreviousInvoice", {
  id: text("id").primaryKey().$defaultFn(cuid),
  deletedAt: prismaDate("deletedAt"),
  serialNumber: integer("serialNumber").unique(),
  invoiceNumber: text("invoiceNumber").notNull(),
  invoiceDate: prismaDate("invoiceDate").notNull(),
  partyName: text("partyName").notNull(),
  partyGstin: text("partyGstin"),
  totalAmount: real("totalAmount").notNull(),
  notes: text("notes"),
  fileData: blob("fileData", { mode: "buffer" }).notNull(),
  fileMimeType: text("fileMimeType").notNull(),
  fileName: text("fileName").notNull(),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
  updatedAt: prismaDate("updatedAt")
    .notNull()
    .$defaultFn(now)
    .$onUpdate(now),
});

export const previousInvoiceItem = sqliteTable("PreviousInvoiceItem", {
  id: text("id").primaryKey().$defaultFn(cuid),
  previousInvoiceId: text("previousInvoiceId")
    .notNull()
    .references(() => previousInvoice.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  hsnCode: text("hsnCode"),
  quantity: real("quantity").notNull(),
  unit: text("unit"),
  rate: real("rate").notNull(),
  discount: real("discount").notNull().default(0),
  taxRate: real("taxRate").notNull().default(0),
  amount: real("amount").notNull(),
  createdAt: prismaDate("createdAt")
    .notNull()
    .$defaultFn(now),
});
