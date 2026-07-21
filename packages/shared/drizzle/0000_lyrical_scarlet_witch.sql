CREATE TABLE `BankAccount` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`accountNumber` text,
	`bankName` text,
	`ifscCode` text,
	`currentBalance` real DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `Company` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`phone` text,
	`email` text,
	`taxId` text,
	`logoPath` text,
	`signaturePath` text,
	`fiscalYearStart` integer DEFAULT 4 NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`invoicePrefix` text DEFAULT 'INV' NOT NULL,
	`termsConditions` text,
	`bankDetails` text,
	`stateCode` text,
	`stateName` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `CreditDebitNote` (
	`id` text PRIMARY KEY NOT NULL,
	`noteNumber` text NOT NULL,
	`noteDate` integer NOT NULL,
	`type` text NOT NULL,
	`partyId` text NOT NULL,
	`referenceInvoiceId` text,
	`reason` text,
	`subtotal` real DEFAULT 0 NOT NULL,
	`taxAmount` real DEFAULT 0 NOT NULL,
	`totalAmount` real DEFAULT 0 NOT NULL,
	`cgstAmount` real DEFAULT 0 NOT NULL,
	`sgstAmount` real DEFAULT 0 NOT NULL,
	`igstAmount` real DEFAULT 0 NOT NULL,
	`isInterState` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`notes` text,
	`termsConditions` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`referenceInvoiceId`) REFERENCES `SalesInvoice`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `CreditDebitNote_noteNumber_unique` ON `CreditDebitNote` (`noteNumber`);--> statement-breakpoint
CREATE TABLE `CreditDebitNoteItem` (
	`id` text PRIMARY KEY NOT NULL,
	`creditDebitNoteId` text NOT NULL,
	`itemId` text NOT NULL,
	`quantity` real NOT NULL,
	`rate` real NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`taxRate` real DEFAULT 0 NOT NULL,
	`total` real NOT NULL,
	`hsnCode` text,
	`taxableAmount` real DEFAULT 0 NOT NULL,
	`cgstRate` real DEFAULT 0 NOT NULL,
	`cgstAmount` real DEFAULT 0 NOT NULL,
	`sgstRate` real DEFAULT 0 NOT NULL,
	`sgstAmount` real DEFAULT 0 NOT NULL,
	`igstRate` real DEFAULT 0 NOT NULL,
	`igstAmount` real DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`creditDebitNoteId`) REFERENCES `CreditDebitNote`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `Party` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`phone` text,
	`email` text,
	`billingAddress` text,
	`shippingAddress` text,
	`taxId` text,
	`openingBalance` real DEFAULT 0 NOT NULL,
	`currentBalance` real DEFAULT 0 NOT NULL,
	`stateCode` text,
	`stateName` text,
	`gstType` text DEFAULT 'REGULAR' NOT NULL,
	`legalName` text,
	`tradeName` text,
	`gstStatus` text,
	`city` text,
	`district` text,
	`pincode` text,
	`fetchedFromGst` integer DEFAULT false NOT NULL,
	`lastGstFetch` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `DeliveryChallan` (
	`id` text PRIMARY KEY NOT NULL,
	`challanNumber` text NOT NULL,
	`challanDate` integer NOT NULL,
	`partyId` text NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`taxAmount` real DEFAULT 0 NOT NULL,
	`totalAmount` real DEFAULT 0 NOT NULL,
	`transportMode` text,
	`vehicleNumber` text,
	`notes` text,
	`termsConditions` text,
	`status` text DEFAULT 'NON_RETURNABLE' NOT NULL,
	`convertedToInvoiceId` text,
	`poNumber` text,
	`ewayBillNo` text,
	`warrantyPeriod` text,
	`dispatchedThrough` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `DeliveryChallan_challanNumber_unique` ON `DeliveryChallan` (`challanNumber`);--> statement-breakpoint
CREATE TABLE `DeliveryChallanItem` (
	`id` text PRIMARY KEY NOT NULL,
	`deliveryChallanId` text NOT NULL,
	`itemId` text NOT NULL,
	`quantity` real NOT NULL,
	`rate` real NOT NULL,
	`taxRate` real DEFAULT 0 NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`total` real NOT NULL,
	`hsnCode` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`deliveryChallanId`) REFERENCES `DeliveryChallan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `GstCache` (
	`id` text PRIMARY KEY NOT NULL,
	`gstin` text NOT NULL,
	`tradeName` text,
	`legalName` text,
	`gstStatus` text,
	`registrationDate` text,
	`businessType` text,
	`addressLine1` text,
	`addressLine2` text,
	`city` text,
	`district` text,
	`state` text,
	`stateCode` text,
	`pincode` text,
	`additionalAddresses` text,
	`rawResponse` text,
	`fetchedAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `GstCache_gstin_unique` ON `GstCache` (`gstin`);--> statement-breakpoint
CREATE TABLE `Item` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`skuHsn` text,
	`hsnCode` text,
	`type` text DEFAULT 'PRODUCT' NOT NULL,
	`unit` text DEFAULT 'pcs' NOT NULL,
	`salePrice` real DEFAULT 0 NOT NULL,
	`purchasePrice` real DEFAULT 0 NOT NULL,
	`taxRate` real DEFAULT 0 NOT NULL,
	`gstType` text DEFAULT 'GST' NOT NULL,
	`trackStock` integer DEFAULT false NOT NULL,
	`currentStock` real DEFAULT 0 NOT NULL,
	`lowStockWarning` real DEFAULT 10 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `PaymentTransaction` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`partyId` text,
	`supplierId` text,
	`amount` real NOT NULL,
	`paymentMode` text DEFAULT 'CASH' NOT NULL,
	`paymentDate` integer NOT NULL,
	`referenceType` text,
	`referenceId` text,
	`salesInvoiceId` text,
	`purchaseBillId` text,
	`notes` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`salesInvoiceId`) REFERENCES `SalesInvoice`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchaseBillId`) REFERENCES `PurchaseBill`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `PreviousInvoice` (
	`id` text PRIMARY KEY NOT NULL,
	`serialNumber` integer,
	`invoiceNumber` text NOT NULL,
	`invoiceDate` integer NOT NULL,
	`partyName` text NOT NULL,
	`partyGstin` text,
	`totalAmount` real NOT NULL,
	`notes` text,
	`fileData` blob NOT NULL,
	`fileMimeType` text NOT NULL,
	`fileName` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `PreviousInvoice_serialNumber_unique` ON `PreviousInvoice` (`serialNumber`);--> statement-breakpoint
CREATE TABLE `PreviousInvoiceItem` (
	`id` text PRIMARY KEY NOT NULL,
	`previousInvoiceId` text NOT NULL,
	`name` text NOT NULL,
	`hsnCode` text,
	`quantity` real NOT NULL,
	`unit` text,
	`rate` real NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`taxRate` real DEFAULT 0 NOT NULL,
	`amount` real NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`previousInvoiceId`) REFERENCES `PreviousInvoice`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ProformaInvoice` (
	`id` text PRIMARY KEY NOT NULL,
	`invoiceNumber` text NOT NULL,
	`invoiceDate` integer NOT NULL,
	`dueDate` integer,
	`partyId` text NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`taxAmount` real DEFAULT 0 NOT NULL,
	`totalAmount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`notes` text,
	`termsConditions` text,
	`placeOfSupply` text,
	`placeOfSupplyName` text,
	`isInterState` integer DEFAULT false NOT NULL,
	`reverseCharge` integer DEFAULT false NOT NULL,
	`cgstAmount` real DEFAULT 0 NOT NULL,
	`sgstAmount` real DEFAULT 0 NOT NULL,
	`igstAmount` real DEFAULT 0 NOT NULL,
	`cessAmount` real DEFAULT 0 NOT NULL,
	`supplyType` text DEFAULT 'B2B' NOT NULL,
	`ecommerceGstin` text,
	`deliveryTime` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ProformaInvoice_invoiceNumber_unique` ON `ProformaInvoice` (`invoiceNumber`);--> statement-breakpoint
CREATE TABLE `ProformaInvoiceItem` (
	`id` text PRIMARY KEY NOT NULL,
	`proformaInvoiceId` text NOT NULL,
	`itemId` text NOT NULL,
	`quantity` real NOT NULL,
	`rate` real NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`taxRate` real DEFAULT 0 NOT NULL,
	`total` real NOT NULL,
	`hsnCode` text,
	`taxableAmount` real DEFAULT 0 NOT NULL,
	`cgstRate` real DEFAULT 0 NOT NULL,
	`cgstAmount` real DEFAULT 0 NOT NULL,
	`sgstRate` real DEFAULT 0 NOT NULL,
	`sgstAmount` real DEFAULT 0 NOT NULL,
	`igstRate` real DEFAULT 0 NOT NULL,
	`igstAmount` real DEFAULT 0 NOT NULL,
	`cessRate` real DEFAULT 0 NOT NULL,
	`cessAmount` real DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`proformaInvoiceId`) REFERENCES `ProformaInvoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `PurchaseBill` (
	`id` text PRIMARY KEY NOT NULL,
	`billNumber` text NOT NULL,
	`billDate` integer NOT NULL,
	`supplierId` text NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`taxAmount` real DEFAULT 0 NOT NULL,
	`totalAmount` real DEFAULT 0 NOT NULL,
	`amountPaid` real DEFAULT 0 NOT NULL,
	`balanceDue` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`notes` text,
	`placeOfSupply` text,
	`placeOfSupplyName` text,
	`isInterState` integer DEFAULT false NOT NULL,
	`reverseCharge` integer DEFAULT false NOT NULL,
	`cgstAmount` real DEFAULT 0 NOT NULL,
	`sgstAmount` real DEFAULT 0 NOT NULL,
	`igstAmount` real DEFAULT 0 NOT NULL,
	`cessAmount` real DEFAULT 0 NOT NULL,
	`supplierInvoiceNumber` text,
	`supplierInvoiceDate` integer,
	`itcEligibility` text DEFAULT 'ELIGIBLE' NOT NULL,
	`attachmentData` blob,
	`attachmentMimeType` text,
	`purchaseOrderId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `PurchaseBill_billNumber_unique` ON `PurchaseBill` (`billNumber`);--> statement-breakpoint
CREATE TABLE `PurchaseBillItem` (
	`id` text PRIMARY KEY NOT NULL,
	`purchaseBillId` text NOT NULL,
	`supplierItemId` text NOT NULL,
	`quantity` real NOT NULL,
	`rate` real NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`taxRate` real DEFAULT 0 NOT NULL,
	`total` real NOT NULL,
	`hsnCode` text,
	`taxableAmount` real DEFAULT 0 NOT NULL,
	`cgstRate` real DEFAULT 0 NOT NULL,
	`cgstAmount` real DEFAULT 0 NOT NULL,
	`sgstRate` real DEFAULT 0 NOT NULL,
	`sgstAmount` real DEFAULT 0 NOT NULL,
	`igstRate` real DEFAULT 0 NOT NULL,
	`igstAmount` real DEFAULT 0 NOT NULL,
	`cessRate` real DEFAULT 0 NOT NULL,
	`cessAmount` real DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`purchaseBillId`) REFERENCES `PurchaseBill`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplierItemId`) REFERENCES `SupplierItem`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `PurchaseOrder` (
	`id` text PRIMARY KEY NOT NULL,
	`orderNumber` text NOT NULL,
	`orderDate` integer NOT NULL,
	`expectedDate` integer,
	`supplierId` text NOT NULL,
	`billingAddress` text,
	`shippingAddress` text,
	`vendorQuotationRef` text,
	`subtotal` real DEFAULT 0 NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`taxAmount` real DEFAULT 0 NOT NULL,
	`totalAmount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`notes` text,
	`termsConditions` text,
	`placeOfSupply` text,
	`placeOfSupplyName` text,
	`isInterState` integer DEFAULT false NOT NULL,
	`cgstAmount` real DEFAULT 0 NOT NULL,
	`sgstAmount` real DEFAULT 0 NOT NULL,
	`igstAmount` real DEFAULT 0 NOT NULL,
	`cessAmount` real DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `PurchaseOrder_orderNumber_unique` ON `PurchaseOrder` (`orderNumber`);--> statement-breakpoint
CREATE TABLE `PurchaseOrderItem` (
	`id` text PRIMARY KEY NOT NULL,
	`purchaseOrderId` text NOT NULL,
	`supplierItemId` text NOT NULL,
	`quantity` real NOT NULL,
	`receivedQuantity` real DEFAULT 0 NOT NULL,
	`rate` real NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`taxRate` real DEFAULT 0 NOT NULL,
	`total` real NOT NULL,
	`hsnCode` text,
	`taxableAmount` real DEFAULT 0 NOT NULL,
	`cgstRate` real DEFAULT 0 NOT NULL,
	`cgstAmount` real DEFAULT 0 NOT NULL,
	`sgstRate` real DEFAULT 0 NOT NULL,
	`sgstAmount` real DEFAULT 0 NOT NULL,
	`igstRate` real DEFAULT 0 NOT NULL,
	`igstAmount` real DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplierItemId`) REFERENCES `SupplierItem`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `Quotation` (
	`id` text PRIMARY KEY NOT NULL,
	`invoiceNumber` text NOT NULL,
	`invoiceDate` integer NOT NULL,
	`dueDate` integer,
	`partyId` text NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`taxAmount` real DEFAULT 0 NOT NULL,
	`totalAmount` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`notes` text,
	`termsConditions` text,
	`placeOfSupply` text,
	`placeOfSupplyName` text,
	`isInterState` integer DEFAULT false NOT NULL,
	`reverseCharge` integer DEFAULT false NOT NULL,
	`cgstAmount` real DEFAULT 0 NOT NULL,
	`sgstAmount` real DEFAULT 0 NOT NULL,
	`igstAmount` real DEFAULT 0 NOT NULL,
	`cessAmount` real DEFAULT 0 NOT NULL,
	`supplyType` text DEFAULT 'B2B' NOT NULL,
	`ecommerceGstin` text,
	`deliveryTime` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Quotation_invoiceNumber_unique` ON `Quotation` (`invoiceNumber`);--> statement-breakpoint
CREATE TABLE `QuotationItem` (
	`id` text PRIMARY KEY NOT NULL,
	`quotationId` text NOT NULL,
	`itemId` text NOT NULL,
	`quantity` real NOT NULL,
	`rate` real NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`taxRate` real DEFAULT 0 NOT NULL,
	`total` real NOT NULL,
	`hsnCode` text,
	`taxableAmount` real DEFAULT 0 NOT NULL,
	`cgstRate` real DEFAULT 0 NOT NULL,
	`cgstAmount` real DEFAULT 0 NOT NULL,
	`sgstRate` real DEFAULT 0 NOT NULL,
	`sgstAmount` real DEFAULT 0 NOT NULL,
	`igstRate` real DEFAULT 0 NOT NULL,
	`igstAmount` real DEFAULT 0 NOT NULL,
	`cessRate` real DEFAULT 0 NOT NULL,
	`cessAmount` real DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`quotationId`) REFERENCES `Quotation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `SalesInvoice` (
	`id` text PRIMARY KEY NOT NULL,
	`invoiceNumber` text NOT NULL,
	`invoiceDate` integer NOT NULL,
	`dueDate` integer,
	`type` text DEFAULT 'INVOICE' NOT NULL,
	`partyId` text NOT NULL,
	`subtotal` real DEFAULT 0 NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`taxAmount` real DEFAULT 0 NOT NULL,
	`totalAmount` real DEFAULT 0 NOT NULL,
	`amountPaid` real DEFAULT 0 NOT NULL,
	`balanceDue` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`convertedFromQuotationId` text,
	`convertedFromProformaId` text,
	`notes` text,
	`termsConditions` text,
	`placeOfSupply` text,
	`placeOfSupplyName` text,
	`isInterState` integer DEFAULT false NOT NULL,
	`reverseCharge` integer DEFAULT false NOT NULL,
	`cgstAmount` real DEFAULT 0 NOT NULL,
	`sgstAmount` real DEFAULT 0 NOT NULL,
	`igstAmount` real DEFAULT 0 NOT NULL,
	`cessAmount` real DEFAULT 0 NOT NULL,
	`supplyType` text DEFAULT 'B2B' NOT NULL,
	`ecommerceGstin` text,
	`poNumber` text,
	`ewayBillNo` text,
	`vehicleNumber` text,
	`warrantyPeriod` text,
	`dispatchedThrough` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `SalesInvoice_invoiceNumber_unique` ON `SalesInvoice` (`invoiceNumber`);--> statement-breakpoint
CREATE TABLE `SalesInvoiceItem` (
	`id` text PRIMARY KEY NOT NULL,
	`salesInvoiceId` text NOT NULL,
	`itemId` text NOT NULL,
	`quantity` real NOT NULL,
	`rate` real NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`taxRate` real DEFAULT 0 NOT NULL,
	`total` real NOT NULL,
	`hsnCode` text,
	`taxableAmount` real DEFAULT 0 NOT NULL,
	`cgstRate` real DEFAULT 0 NOT NULL,
	`cgstAmount` real DEFAULT 0 NOT NULL,
	`sgstRate` real DEFAULT 0 NOT NULL,
	`sgstAmount` real DEFAULT 0 NOT NULL,
	`igstRate` real DEFAULT 0 NOT NULL,
	`igstAmount` real DEFAULT 0 NOT NULL,
	`cessRate` real DEFAULT 0 NOT NULL,
	`cessAmount` real DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`salesInvoiceId`) REFERENCES `SalesInvoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `Settings` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Settings_key_unique` ON `Settings` (`key`);--> statement-breakpoint
CREATE TABLE `StockMovement` (
	`id` text PRIMARY KEY NOT NULL,
	`itemId` text NOT NULL,
	`movementType` text NOT NULL,
	`quantity` real NOT NULL,
	`referenceType` text,
	`referenceId` text,
	`notes` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `Supplier` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`email` text,
	`billingAddress` text,
	`shippingAddress` text,
	`taxId` text,
	`openingBalance` real DEFAULT 0 NOT NULL,
	`currentBalance` real DEFAULT 0 NOT NULL,
	`stateCode` text,
	`stateName` text,
	`gstType` text DEFAULT 'REGULAR' NOT NULL,
	`legalName` text,
	`tradeName` text,
	`gstStatus` text,
	`city` text,
	`district` text,
	`pincode` text,
	`fetchedFromGst` integer DEFAULT false NOT NULL,
	`lastGstFetch` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `SupplierItem` (
	`id` text PRIMARY KEY NOT NULL,
	`supplierId` text NOT NULL,
	`name` text NOT NULL,
	`hsnCode` text,
	`unit` text DEFAULT 'pcs' NOT NULL,
	`lastPurchasePrice` real DEFAULT 0 NOT NULL,
	`defaultTaxRate` real DEFAULT 0 NOT NULL,
	`linkedItemId` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linkedItemId`) REFERENCES `Item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `SyncMetadata` (
	`id` text PRIMARY KEY NOT NULL,
	`lastSyncTimestamp` integer NOT NULL,
	`deviceId` text NOT NULL,
	`syncStatus` text DEFAULT 'idle' NOT NULL,
	`cloudFileModifiedTime` integer,
	`lastError` text,
	`updatedAt` integer NOT NULL
);
