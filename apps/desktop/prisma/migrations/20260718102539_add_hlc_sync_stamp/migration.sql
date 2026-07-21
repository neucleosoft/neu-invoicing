-- P1: hlc — the clock-skew-proof sync-ordering stamp (see @neu/shared hlc.ts).
-- One nullable TEXT column on every synced header table; NULL means "row not
-- written since this migration" and the merge comparator falls back to
-- updatedAt for it, so existing data needs no backfill.

ALTER TABLE "Party" ADD COLUMN "hlc" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "hlc" TEXT;
ALTER TABLE "SupplierItem" ADD COLUMN "hlc" TEXT;
ALTER TABLE "Item" ADD COLUMN "hlc" TEXT;
ALTER TABLE "SalesInvoice" ADD COLUMN "hlc" TEXT;
ALTER TABLE "Quotation" ADD COLUMN "hlc" TEXT;
ALTER TABLE "ProformaInvoice" ADD COLUMN "hlc" TEXT;
ALTER TABLE "PurchaseBill" ADD COLUMN "hlc" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "hlc" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN "hlc" TEXT;
ALTER TABLE "DeliveryChallan" ADD COLUMN "hlc" TEXT;
ALTER TABLE "CreditDebitNote" ADD COLUMN "hlc" TEXT;
ALTER TABLE "BankAccount" ADD COLUMN "hlc" TEXT;
ALTER TABLE "BankTransaction" ADD COLUMN "hlc" TEXT;
ALTER TABLE "PreviousInvoice" ADD COLUMN "hlc" TEXT;
