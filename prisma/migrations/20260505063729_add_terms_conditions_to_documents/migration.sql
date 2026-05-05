-- AlterTable
ALTER TABLE "CreditDebitNote" ADD COLUMN "termsConditions" TEXT;

-- AlterTable
ALTER TABLE "DeliveryChallan" ADD COLUMN "termsConditions" TEXT;

-- AlterTable
ALTER TABLE "ProformaInvoice" ADD COLUMN "termsConditions" TEXT;

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN "termsConditions" TEXT;

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN "termsConditions" TEXT;
