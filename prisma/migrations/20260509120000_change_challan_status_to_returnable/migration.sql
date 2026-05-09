-- Repurpose DeliveryChallan.status from a lifecycle field (PENDING/DELIVERED/CONVERTED)
-- to a classification field (RETURNABLE/NON_RETURNABLE/CONVERTED).
--
-- Existing rows with PENDING or DELIVERED were dispatches for sale (no expectation
-- of goods coming back) — reclassify them as NON_RETURNABLE. CONVERTED stays as is.

UPDATE "DeliveryChallan" SET "status" = 'NON_RETURNABLE'
  WHERE "status" IN ('PENDING', 'DELIVERED');

-- Change the column default from 'PENDING' to 'NON_RETURNABLE'.
-- SQLite doesn't support ALTER COLUMN DEFAULT directly — recreate the table.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_DeliveryChallan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "challanNumber" TEXT NOT NULL,
    "challanDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "partyId" TEXT NOT NULL,
    "subtotal" REAL NOT NULL DEFAULT 0,
    "taxAmount" REAL NOT NULL DEFAULT 0,
    "totalAmount" REAL NOT NULL DEFAULT 0,
    "transportMode" TEXT,
    "vehicleNumber" TEXT,
    "notes" TEXT,
    "termsConditions" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NON_RETURNABLE',
    "convertedToInvoiceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "poNumber" TEXT,
    "ewayBillNo" TEXT,
    "warrantyPeriod" TEXT,
    "dispatchedThrough" TEXT,
    CONSTRAINT "DeliveryChallan_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "new_DeliveryChallan" (
    "id", "challanNumber", "challanDate", "partyId",
    "subtotal", "taxAmount", "totalAmount",
    "transportMode", "vehicleNumber", "notes", "termsConditions",
    "status", "convertedToInvoiceId",
    "createdAt", "updatedAt",
    "poNumber", "ewayBillNo", "warrantyPeriod", "dispatchedThrough"
)
SELECT
    "id", "challanNumber", "challanDate", "partyId",
    "subtotal", "taxAmount", "totalAmount",
    "transportMode", "vehicleNumber", "notes", "termsConditions",
    "status", "convertedToInvoiceId",
    "createdAt", "updatedAt",
    "poNumber", "ewayBillNo", "warrantyPeriod", "dispatchedThrough"
FROM "DeliveryChallan";

DROP TABLE "DeliveryChallan";
ALTER TABLE "new_DeliveryChallan" RENAME TO "DeliveryChallan";
CREATE UNIQUE INDEX "DeliveryChallan_challanNumber_key" ON "DeliveryChallan"("challanNumber");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
