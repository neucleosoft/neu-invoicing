-- AlterTable
ALTER TABLE "BankAccount" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "CreditDebitNote" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "DeliveryChallan" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "Item" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "Party" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "PaymentTransaction" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "PreviousInvoice" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "ProformaInvoice" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "PurchaseBill" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "deletedAt" DATETIME;

-- AlterTable
ALTER TABLE "SupplierItem" ADD COLUMN "deletedAt" DATETIME;
