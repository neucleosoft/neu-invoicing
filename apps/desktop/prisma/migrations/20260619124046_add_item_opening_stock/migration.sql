-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Item" (
    "deletedAt" DATETIME,
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "skuHsn" TEXT,
    "hsnCode" TEXT,
    "type" TEXT NOT NULL DEFAULT 'PRODUCT',
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "salePrice" REAL NOT NULL DEFAULT 0,
    "purchasePrice" REAL NOT NULL DEFAULT 0,
    "taxRate" REAL NOT NULL DEFAULT 0,
    "gstType" TEXT NOT NULL DEFAULT 'GST',
    "trackStock" BOOLEAN NOT NULL DEFAULT false,
    "currentStock" REAL NOT NULL DEFAULT 0,
    "openingStock" REAL NOT NULL DEFAULT 0,
    "lowStockWarning" REAL NOT NULL DEFAULT 10,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Item" ("createdAt", "currentStock", "deletedAt", "gstType", "hsnCode", "id", "lowStockWarning", "name", "purchasePrice", "salePrice", "skuHsn", "taxRate", "trackStock", "type", "unit", "updatedAt") SELECT "createdAt", "currentStock", "deletedAt", "gstType", "hsnCode", "id", "lowStockWarning", "name", "purchasePrice", "salePrice", "skuHsn", "taxRate", "trackStock", "type", "unit", "updatedAt" FROM "Item";
DROP TABLE "Item";
ALTER TABLE "new_Item" RENAME TO "Item";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
