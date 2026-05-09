-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN "billingAddress" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "shippingAddress" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "vendorQuotationRef" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PurchaseOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseOrderId" TEXT NOT NULL,
    "supplierItemId" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "receivedQuantity" REAL NOT NULL DEFAULT 0,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderItem_supplierItemId_fkey" FOREIGN KEY ("supplierItemId") REFERENCES "SupplierItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_PurchaseOrderItem" ("cgstAmount", "cgstRate", "createdAt", "discount", "hsnCode", "id", "igstAmount", "igstRate", "purchaseOrderId", "quantity", "rate", "sgstAmount", "sgstRate", "supplierItemId", "taxRate", "taxableAmount", "total") SELECT "cgstAmount", "cgstRate", "createdAt", "discount", "hsnCode", "id", "igstAmount", "igstRate", "purchaseOrderId", "quantity", "rate", "sgstAmount", "sgstRate", "supplierItemId", "taxRate", "taxableAmount", "total" FROM "PurchaseOrderItem";
DROP TABLE "PurchaseOrderItem";
ALTER TABLE "new_PurchaseOrderItem" RENAME TO "PurchaseOrderItem";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
