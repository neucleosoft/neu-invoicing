-- AlterTable
ALTER TABLE "DeliveryChallan" ADD COLUMN "dispatchedThrough" TEXT;
ALTER TABLE "DeliveryChallan" ADD COLUMN "ewayBillNo" TEXT;
ALTER TABLE "DeliveryChallan" ADD COLUMN "poNumber" TEXT;
ALTER TABLE "DeliveryChallan" ADD COLUMN "warrantyPeriod" TEXT;

-- AlterTable
ALTER TABLE "DeliveryChallanItem" ADD COLUMN "hsnCode" TEXT;
