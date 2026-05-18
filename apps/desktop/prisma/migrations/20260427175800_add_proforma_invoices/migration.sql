-- CreateTable
CREATE TABLE "ProformaInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATETIME,
    "partyId" TEXT NOT NULL,
    "subtotal" REAL NOT NULL DEFAULT 0,
    "discount" REAL NOT NULL DEFAULT 0,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "placeOfSupply" TEXT,
    "placeOfSupplyName" TEXT,
    "isInterState" BOOLEAN NOT NULL DEFAULT false,
    "reverseCharge" BOOLEAN NOT NULL DEFAULT false,
    "cgstAmount" REAL NOT NULL DEFAULT 0,
    "sgstAmount" REAL NOT NULL DEFAULT 0,
    "igstAmount" REAL NOT NULL DEFAULT 0,
    "cessAmount" REAL NOT NULL DEFAULT 0,
    "supplyType" TEXT NOT NULL DEFAULT 'B2B',
    "ecommerceGstin" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deliveryTime" DATETIME,
    CONSTRAINT "ProformaInvoice_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProformaInvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "proformaInvoiceId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "rate" REAL NOT NULL,
    "discount" REAL NOT NULL DEFAULT 0,
    "taxRate" REAL NOT NULL DEFAULT 0,
    "total" REAL NOT NULL,
    "hsnCode" TEXT,
    "taxableAmount" REAL NOT NULL DEFAULT 0,
    "cgstRate" REAL NOT NULL DEFAULT 0,
    "cgstAmount" REAL NOT NULL DEFAULT 0,
    "sgstRate" REAL NOT NULL DEFAULT 0,
    "sgstAmount" REAL NOT NULL DEFAULT 0,
    "igstRate" REAL NOT NULL DEFAULT 0,
    "igstAmount" REAL NOT NULL DEFAULT 0,
    "cessRate" REAL NOT NULL DEFAULT 0,
    "cessAmount" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProformaInvoiceItem_proformaInvoiceId_fkey" FOREIGN KEY ("proformaInvoiceId") REFERENCES "ProformaInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProformaInvoiceItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SalesInvoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL DEFAULT 'INVOICE',
    "partyId" TEXT NOT NULL,
    "subtotal" REAL NOT NULL DEFAULT 0,
    "discount" REAL NOT NULL DEFAULT 0,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "amountPaid" REAL NOT NULL DEFAULT 0,
    "balanceDue" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "convertedFromQuoteId" TEXT,
    "convertedFromProformaId" TEXT,
    "notes" TEXT,
    "placeOfSupply" TEXT,
    "placeOfSupplyName" TEXT,
    "isInterState" BOOLEAN NOT NULL DEFAULT false,
    "reverseCharge" BOOLEAN NOT NULL DEFAULT false,
    "cgstAmount" REAL NOT NULL DEFAULT 0,
    "sgstAmount" REAL NOT NULL DEFAULT 0,
    "igstAmount" REAL NOT NULL DEFAULT 0,
    "cessAmount" REAL NOT NULL DEFAULT 0,
    "supplyType" TEXT NOT NULL DEFAULT 'B2B',
    "ecommerceGstin" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "dueDate" DATETIME,
    "poNumber" TEXT,
    "ewayBillNo" TEXT,
    "vehicleNumber" TEXT,
    "warrantyPeriod" TEXT,
    "dispatchedThrough" TEXT,
    CONSTRAINT "SalesInvoice_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SalesInvoice_convertedFromQuoteId_fkey" FOREIGN KEY ("convertedFromQuoteId") REFERENCES "SalesInvoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SalesInvoice_convertedFromProformaId_fkey" FOREIGN KEY ("convertedFromProformaId") REFERENCES "ProformaInvoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SalesInvoice" ("amountPaid", "balanceDue", "cessAmount", "cgstAmount", "convertedFromQuoteId", "createdAt", "discount", "dispatchedThrough", "dueDate", "ecommerceGstin", "ewayBillNo", "id", "igstAmount", "invoiceDate", "invoiceNumber", "isInterState", "notes", "partyId", "placeOfSupply", "placeOfSupplyName", "poNumber", "reverseCharge", "sgstAmount", "status", "subtotal", "supplyType", "taxAmount", "totalAmount", "type", "updatedAt", "vehicleNumber", "warrantyPeriod") SELECT "amountPaid", "balanceDue", "cessAmount", "cgstAmount", "convertedFromQuoteId", "createdAt", "discount", "dispatchedThrough", "dueDate", "ecommerceGstin", "ewayBillNo", "id", "igstAmount", "invoiceDate", "invoiceNumber", "isInterState", "notes", "partyId", "placeOfSupply", "placeOfSupplyName", "poNumber", "reverseCharge", "sgstAmount", "status", "subtotal", "supplyType", "taxAmount", "totalAmount", "type", "updatedAt", "vehicleNumber", "warrantyPeriod" FROM "SalesInvoice";
DROP TABLE "SalesInvoice";
ALTER TABLE "new_SalesInvoice" RENAME TO "SalesInvoice";
CREATE UNIQUE INDEX "SalesInvoice_invoiceNumber_key" ON "SalesInvoice"("invoiceNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ProformaInvoice_invoiceNumber_key" ON "ProformaInvoice"("invoiceNumber");

