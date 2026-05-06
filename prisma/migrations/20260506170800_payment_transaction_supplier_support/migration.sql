-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_PaymentTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "partyId" TEXT,
    "supplierId" TEXT,
    "amount" REAL NOT NULL,
    "paymentMode" TEXT NOT NULL DEFAULT 'CASH',
    "paymentDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "salesInvoiceId" TEXT,
    "purchaseBillId" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentTransaction_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PaymentTransaction_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PaymentTransaction_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "SalesInvoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PaymentTransaction_purchaseBillId_fkey" FOREIGN KEY ("purchaseBillId") REFERENCES "PurchaseBill" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_PaymentTransaction" (
    "id",
    "type",
    "partyId",
    "supplierId",
    "amount",
    "paymentMode",
    "paymentDate",
    "referenceType",
    "referenceId",
    "salesInvoiceId",
    "purchaseBillId",
    "notes",
    "createdAt"
)
SELECT
    pt."id",
    pt."type",
    CASE
        WHEN pt."type" = 'PAYMENT_IN' THEN pt."partyId"
        ELSE NULL
    END AS "partyId",
    CASE
        WHEN pt."type" = 'PAYMENT_OUT' THEN COALESCE(
            (SELECT pb."supplierId" FROM "PurchaseBill" pb WHERE pb."id" = pt."purchaseBillId"),
            (SELECT s."id" FROM "Supplier" s WHERE s."id" = pt."partyId")
        )
        ELSE NULL
    END AS "supplierId",
    pt."amount",
    pt."paymentMode",
    pt."paymentDate",
    pt."referenceType",
    pt."referenceId",
    pt."salesInvoiceId",
    pt."purchaseBillId",
    pt."notes",
    pt."createdAt"
FROM "PaymentTransaction" pt;

DROP TABLE "PaymentTransaction";
ALTER TABLE "new_PaymentTransaction" RENAME TO "PaymentTransaction";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
