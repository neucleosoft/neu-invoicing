-- AlterTable
ALTER TABLE "CreditDebitNote" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "CreditDebitNote" ADD COLUMN "cancelledAt" DATETIME;

-- AlterTable
ALTER TABLE "DeliveryChallan" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "DeliveryChallan" ADD COLUMN "cancelledAt" DATETIME;

-- AlterTable
ALTER TABLE "PaymentTransaction" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "PaymentTransaction" ADD COLUMN "cancelledAt" DATETIME;

-- AlterTable
ALTER TABLE "PurchaseBill" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "PurchaseBill" ADD COLUMN "cancelledAt" DATETIME;

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "SalesInvoice" ADD COLUMN "cancelledAt" DATETIME;
