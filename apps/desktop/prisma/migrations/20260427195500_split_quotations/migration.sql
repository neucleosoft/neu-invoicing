-- CreateTable
CREATE TABLE "Quotation" (
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
    CONSTRAINT "Quotation_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuotationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "quotationId" TEXT NOT NULL,
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
    CONSTRAINT "QuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuotationItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Migrate existing quotation records out of SalesInvoice
INSERT INTO "Quotation" (
    "id", "invoiceNumber", "invoiceDate", "dueDate", "partyId", "subtotal", "discount", "taxAmount",
    "totalAmount", "status", "notes", "placeOfSupply", "placeOfSupplyName", "isInterState",
    "reverseCharge", "cgstAmount", "sgstAmount", "igstAmount", "cessAmount", "supplyType",
    "ecommerceGstin", "createdAt", "updatedAt", "deliveryTime"
)
SELECT
    "id", "invoiceNumber", "invoiceDate", "dueDate", "partyId", "subtotal", "discount", "taxAmount",
    "totalAmount", "status", "notes", "placeOfSupply", "placeOfSupplyName", "isInterState",
    "reverseCharge", "cgstAmount", "sgstAmount", "igstAmount", "cessAmount", "supplyType",
    "ecommerceGstin", "createdAt", "updatedAt", NULL
FROM "SalesInvoice"
WHERE "type" = 'QUOTATION';

INSERT INTO "QuotationItem" (
    "id", "quotationId", "itemId", "quantity", "rate", "discount", "taxRate", "total", "hsnCode",
    "taxableAmount", "cgstRate", "cgstAmount", "sgstRate", "sgstAmount", "igstRate", "igstAmount",
    "cessRate", "cessAmount", "createdAt"
)
SELECT
    sii."id", sii."salesInvoiceId", sii."itemId", sii."quantity", sii."rate", sii."discount", sii."taxRate",
    sii."total", sii."hsnCode", sii."taxableAmount", sii."cgstRate", sii."cgstAmount", sii."sgstRate",
    sii."sgstAmount", sii."igstRate", sii."igstAmount", sii."cessRate", sii."cessAmount", sii."createdAt"
FROM "SalesInvoiceItem" sii
INNER JOIN "SalesInvoice" si ON si."id" = sii."salesInvoiceId"
WHERE si."type" = 'QUOTATION';

DELETE FROM "SalesInvoiceItem"
WHERE "salesInvoiceId" IN (
    SELECT "id" FROM "SalesInvoice" WHERE "type" = 'QUOTATION'
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
    "convertedFromQuotationId" TEXT,
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
    CONSTRAINT "SalesInvoice_convertedFromQuotationId_fkey" FOREIGN KEY ("convertedFromQuotationId") REFERENCES "Quotation" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SalesInvoice_convertedFromProformaId_fkey" FOREIGN KEY ("convertedFromProformaId") REFERENCES "ProformaInvoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SalesInvoice" (
    "id", "invoiceNumber", "invoiceDate", "type", "partyId", "subtotal", "discount", "taxAmount",
    "totalAmount", "amountPaid", "balanceDue", "status", "convertedFromQuotationId",
    "convertedFromProformaId", "notes", "placeOfSupply", "placeOfSupplyName", "isInterState",
    "reverseCharge", "cgstAmount", "sgstAmount", "igstAmount", "cessAmount", "supplyType",
    "ecommerceGstin", "createdAt", "updatedAt", "dueDate", "poNumber", "ewayBillNo",
    "vehicleNumber", "warrantyPeriod", "dispatchedThrough"
)
SELECT
    "id", "invoiceNumber", "invoiceDate", "type", "partyId", "subtotal", "discount", "taxAmount",
    "totalAmount", "amountPaid", "balanceDue", "status", "convertedFromQuoteId",
    "convertedFromProformaId", "notes", "placeOfSupply", "placeOfSupplyName", "isInterState",
    "reverseCharge", "cgstAmount", "sgstAmount", "igstAmount", "cessAmount", "supplyType",
    "ecommerceGstin", "createdAt", "updatedAt", "dueDate", "poNumber", "ewayBillNo",
    "vehicleNumber", "warrantyPeriod", "dispatchedThrough"
FROM "SalesInvoice"
WHERE "type" <> 'QUOTATION';
DROP TABLE "SalesInvoice";
ALTER TABLE "new_SalesInvoice" RENAME TO "SalesInvoice";
CREATE UNIQUE INDEX "SalesInvoice_invoiceNumber_key" ON "SalesInvoice"("invoiceNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_invoiceNumber_key" ON "Quotation"("invoiceNumber");
