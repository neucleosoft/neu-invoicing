-- GST split columns for delivery challans (computed since 2026-06 by the
-- shared helper, dropped for lack of columns). Same shape as SalesInvoice.
ALTER TABLE "DeliveryChallan" ADD COLUMN "placeOfSupply" TEXT;
ALTER TABLE "DeliveryChallan" ADD COLUMN "placeOfSupplyName" TEXT;
ALTER TABLE "DeliveryChallan" ADD COLUMN "isInterState" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DeliveryChallan" ADD COLUMN "cgstAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryChallan" ADD COLUMN "sgstAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryChallan" ADD COLUMN "igstAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryChallan" ADD COLUMN "cessAmount" REAL NOT NULL DEFAULT 0;

ALTER TABLE "DeliveryChallanItem" ADD COLUMN "taxableAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryChallanItem" ADD COLUMN "cgstRate" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryChallanItem" ADD COLUMN "cgstAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryChallanItem" ADD COLUMN "sgstRate" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryChallanItem" ADD COLUMN "sgstAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryChallanItem" ADD COLUMN "igstRate" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryChallanItem" ADD COLUMN "igstAmount" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryChallanItem" ADD COLUMN "cessRate" REAL NOT NULL DEFAULT 0;
ALTER TABLE "DeliveryChallanItem" ADD COLUMN "cessAmount" REAL NOT NULL DEFAULT 0;
