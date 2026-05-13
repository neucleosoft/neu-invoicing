-- CreateTable
CREATE TABLE "PreviousInvoiceItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "previousInvoiceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hsnCode" TEXT,
    "quantity" REAL NOT NULL,
    "unit" TEXT,
    "rate" REAL NOT NULL,
    "discount" REAL NOT NULL DEFAULT 0,
    "taxRate" REAL NOT NULL DEFAULT 0,
    "amount" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PreviousInvoiceItem_previousInvoiceId_fkey" FOREIGN KEY ("previousInvoiceId") REFERENCES "PreviousInvoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
