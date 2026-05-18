/*
  Warnings:

  - You are about to drop the column `convertedBillId` on the `PurchaseOrder` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PurchaseBill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billNumber" TEXT NOT NULL,
    "billDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplierId" TEXT NOT NULL,
    "subtotal" REAL NOT NULL DEFAULT 0,
    "discount" REAL NOT NULL DEFAULT 0,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "amountPaid" REAL NOT NULL DEFAULT 0,
    "balanceDue" REAL NOT NULL DEFAULT 0,
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
    "supplierInvoiceNumber" TEXT,
    "supplierInvoiceDate" DATETIME,
    "itcEligibility" TEXT NOT NULL DEFAULT 'ELIGIBLE',
    "attachmentData" BLOB,
    "attachmentMimeType" TEXT,
    "purchaseOrderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseBill_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseBill_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseBill" ("amountPaid", "attachmentData", "attachmentMimeType", "balanceDue", "billDate", "billNumber", "cessAmount", "cgstAmount", "createdAt", "discount", "id", "igstAmount", "isInterState", "itcEligibility", "notes", "placeOfSupply", "placeOfSupplyName", "reverseCharge", "sgstAmount", "status", "subtotal", "supplierId", "supplierInvoiceDate", "supplierInvoiceNumber", "taxAmount", "totalAmount", "updatedAt") SELECT "amountPaid", "attachmentData", "attachmentMimeType", "balanceDue", "billDate", "billNumber", "cessAmount", "cgstAmount", "createdAt", "discount", "id", "igstAmount", "isInterState", "itcEligibility", "notes", "placeOfSupply", "placeOfSupplyName", "reverseCharge", "sgstAmount", "status", "subtotal", "supplierId", "supplierInvoiceDate", "supplierInvoiceNumber", "taxAmount", "totalAmount", "updatedAt" FROM "PurchaseBill";
DROP TABLE "PurchaseBill";
ALTER TABLE "new_PurchaseBill" RENAME TO "PurchaseBill";
CREATE UNIQUE INDEX "PurchaseBill_billNumber_key" ON "PurchaseBill"("billNumber");
CREATE TABLE "new_PurchaseOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderNumber" TEXT NOT NULL,
    "orderDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" DATETIME,
    "supplierId" TEXT NOT NULL,
    "billingAddress" TEXT,
    "shippingAddress" TEXT,
    "vendorQuotationRef" TEXT,
    "subtotal" REAL NOT NULL DEFAULT 0,
    "discount" REAL NOT NULL DEFAULT 0,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "termsConditions" TEXT,
    "placeOfSupply" TEXT,
    "placeOfSupplyName" TEXT,
    "isInterState" BOOLEAN NOT NULL DEFAULT false,
    "cgstAmount" REAL NOT NULL DEFAULT 0,
    "sgstAmount" REAL NOT NULL DEFAULT 0,
    "igstAmount" REAL NOT NULL DEFAULT 0,
    "cessAmount" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseOrder" ("billingAddress", "cessAmount", "cgstAmount", "createdAt", "discount", "expectedDate", "id", "igstAmount", "isInterState", "notes", "orderDate", "orderNumber", "placeOfSupply", "placeOfSupplyName", "sgstAmount", "shippingAddress", "status", "subtotal", "supplierId", "taxAmount", "termsConditions", "totalAmount", "updatedAt", "vendorQuotationRef") SELECT "billingAddress", "cessAmount", "cgstAmount", "createdAt", "discount", "expectedDate", "id", "igstAmount", "isInterState", "notes", "orderDate", "orderNumber", "placeOfSupply", "placeOfSupplyName", "sgstAmount", "shippingAddress", "status", "subtotal", "supplierId", "taxAmount", "termsConditions", "totalAmount", "updatedAt", "vendorQuotationRef" FROM "PurchaseOrder";
DROP TABLE "PurchaseOrder";
ALTER TABLE "new_PurchaseOrder" RENAME TO "PurchaseOrder";
CREATE UNIQUE INDEX "PurchaseOrder_orderNumber_key" ON "PurchaseOrder"("orderNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
