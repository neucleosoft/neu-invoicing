-- AlterTable
ALTER TABLE "PreviousInvoice" ADD COLUMN "serialNumber" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "PreviousInvoice_serialNumber_key" ON "PreviousInvoice"("serialNumber");
