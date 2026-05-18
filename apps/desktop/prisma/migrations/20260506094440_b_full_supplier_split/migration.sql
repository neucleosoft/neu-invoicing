/*
  Warnings:

  - You are about to drop the column `partyId` on the `PurchaseBill` table. All the data in the column will be lost.
  - You are about to drop the column `itemId` on the `PurchaseBillItem` table. All the data in the column will be lost.
  - Added the required column `supplierId` to the `PurchaseBill` table without a default value. This is not possible if the table is not empty.
  - Added the required column `supplierItemId` to the `PurchaseBillItem` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "billingAddress" TEXT,
    "shippingAddress" TEXT,
    "taxId" TEXT,
    "openingBalance" REAL NOT NULL DEFAULT 0,
    "currentBalance" REAL NOT NULL DEFAULT 0,
    "stateCode" TEXT,
    "stateName" TEXT,
    "gstType" TEXT NOT NULL DEFAULT 'REGULAR',
    "legalName" TEXT,
    "tradeName" TEXT,
    "gstStatus" TEXT,
    "city" TEXT,
    "district" TEXT,
    "pincode" TEXT,
    "fetchedFromGst" BOOLEAN NOT NULL DEFAULT false,
    "lastGstFetch" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SupplierItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hsnCode" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "lastPurchasePrice" REAL NOT NULL DEFAULT 0,
    "defaultTaxRate" REAL NOT NULL DEFAULT 0,
    "linkedItemId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierItem_linkedItemId_fkey" FOREIGN KEY ("linkedItemId") REFERENCES "Item" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseBill_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseBill" ("amountPaid", "attachmentData", "attachmentMimeType", "balanceDue", "billDate", "billNumber", "cessAmount", "cgstAmount", "createdAt", "discount", "id", "igstAmount", "isInterState", "itcEligibility", "notes", "placeOfSupply", "placeOfSupplyName", "reverseCharge", "sgstAmount", "status", "subtotal", "supplierInvoiceDate", "supplierInvoiceNumber", "taxAmount", "totalAmount", "updatedAt") SELECT "amountPaid", "attachmentData", "attachmentMimeType", "balanceDue", "billDate", "billNumber", "cessAmount", "cgstAmount", "createdAt", "discount", "id", "igstAmount", "isInterState", "itcEligibility", "notes", "placeOfSupply", "placeOfSupplyName", "reverseCharge", "sgstAmount", "status", "subtotal", "supplierInvoiceDate", "supplierInvoiceNumber", "taxAmount", "totalAmount", "updatedAt" FROM "PurchaseBill";
DROP TABLE "PurchaseBill";
ALTER TABLE "new_PurchaseBill" RENAME TO "PurchaseBill";
CREATE UNIQUE INDEX "PurchaseBill_billNumber_key" ON "PurchaseBill"("billNumber");
CREATE TABLE "new_PurchaseBillItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseBillId" TEXT NOT NULL,
    "supplierItemId" TEXT NOT NULL,
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
    CONSTRAINT "PurchaseBillItem_purchaseBillId_fkey" FOREIGN KEY ("purchaseBillId") REFERENCES "PurchaseBill" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseBillItem_supplierItemId_fkey" FOREIGN KEY ("supplierItemId") REFERENCES "SupplierItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseBillItem" ("cessAmount", "cessRate", "cgstAmount", "cgstRate", "createdAt", "discount", "hsnCode", "id", "igstAmount", "igstRate", "purchaseBillId", "quantity", "rate", "sgstAmount", "sgstRate", "taxRate", "taxableAmount", "total") SELECT "cessAmount", "cessRate", "cgstAmount", "cgstRate", "createdAt", "discount", "hsnCode", "id", "igstAmount", "igstRate", "purchaseBillId", "quantity", "rate", "sgstAmount", "sgstRate", "taxRate", "taxableAmount", "total" FROM "PurchaseBillItem";
DROP TABLE "PurchaseBillItem";
ALTER TABLE "new_PurchaseBillItem" RENAME TO "PurchaseBillItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
