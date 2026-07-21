PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_BankAccount` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`accountNumber` text,
	`bankName` text,
	`ifscCode` text,
	`currentBalance` real DEFAULT 0 NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_BankAccount`("id", "name", "type", "accountNumber", "bankName", "ifscCode", "currentBalance", "createdAt", "updatedAt") SELECT "id", "name", "type", "accountNumber", "bankName", "ifscCode", "currentBalance", "createdAt", "updatedAt" FROM `BankAccount`;--> statement-breakpoint
DROP TABLE `BankAccount`;--> statement-breakpoint
ALTER TABLE `__new_BankAccount` RENAME TO `BankAccount`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_Company` (
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
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_Company`("id", "name", "address", "phone", "email", "taxId", "logoPath", "signaturePath", "fiscalYearStart", "currency", "invoicePrefix", "termsConditions", "bankDetails", "stateCode", "stateName", "createdAt", "updatedAt") SELECT "id", "name", "address", "phone", "email", "taxId", "logoPath", "signaturePath", "fiscalYearStart", "currency", "invoicePrefix", "termsConditions", "bankDetails", "stateCode", "stateName", "createdAt", "updatedAt" FROM `Company`;--> statement-breakpoint
DROP TABLE `Company`;--> statement-breakpoint
ALTER TABLE `__new_Company` RENAME TO `Company`;--> statement-breakpoint
CREATE TABLE `__new_CreditDebitNote` (
	`id` text PRIMARY KEY NOT NULL,
	`noteNumber` text NOT NULL,
	`noteDate` text NOT NULL,
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
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`referenceInvoiceId`) REFERENCES `SalesInvoice`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_CreditDebitNote`("id", "noteNumber", "noteDate", "type", "partyId", "referenceInvoiceId", "reason", "subtotal", "taxAmount", "totalAmount", "cgstAmount", "sgstAmount", "igstAmount", "isInterState", "status", "notes", "termsConditions", "createdAt", "updatedAt") SELECT "id", "noteNumber", "noteDate", "type", "partyId", "referenceInvoiceId", "reason", "subtotal", "taxAmount", "totalAmount", "cgstAmount", "sgstAmount", "igstAmount", "isInterState", "status", "notes", "termsConditions", "createdAt", "updatedAt" FROM `CreditDebitNote`;--> statement-breakpoint
DROP TABLE `CreditDebitNote`;--> statement-breakpoint
ALTER TABLE `__new_CreditDebitNote` RENAME TO `CreditDebitNote`;--> statement-breakpoint
CREATE UNIQUE INDEX `CreditDebitNote_noteNumber_unique` ON `CreditDebitNote` (`noteNumber`);--> statement-breakpoint
CREATE TABLE `__new_CreditDebitNoteItem` (
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
	`createdAt` text NOT NULL,
	FOREIGN KEY (`creditDebitNoteId`) REFERENCES `CreditDebitNote`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_CreditDebitNoteItem`("id", "creditDebitNoteId", "itemId", "quantity", "rate", "discount", "taxRate", "total", "hsnCode", "taxableAmount", "cgstRate", "cgstAmount", "sgstRate", "sgstAmount", "igstRate", "igstAmount", "createdAt") SELECT "id", "creditDebitNoteId", "itemId", "quantity", "rate", "discount", "taxRate", "total", "hsnCode", "taxableAmount", "cgstRate", "cgstAmount", "sgstRate", "sgstAmount", "igstRate", "igstAmount", "createdAt" FROM `CreditDebitNoteItem`;--> statement-breakpoint
DROP TABLE `CreditDebitNoteItem`;--> statement-breakpoint
ALTER TABLE `__new_CreditDebitNoteItem` RENAME TO `CreditDebitNoteItem`;--> statement-breakpoint
CREATE TABLE `__new_Party` (
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
	`lastGstFetch` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_Party`("id", "name", "type", "phone", "email", "billingAddress", "shippingAddress", "taxId", "openingBalance", "currentBalance", "stateCode", "stateName", "gstType", "legalName", "tradeName", "gstStatus", "city", "district", "pincode", "fetchedFromGst", "lastGstFetch", "createdAt", "updatedAt") SELECT "id", "name", "type", "phone", "email", "billingAddress", "shippingAddress", "taxId", "openingBalance", "currentBalance", "stateCode", "stateName", "gstType", "legalName", "tradeName", "gstStatus", "city", "district", "pincode", "fetchedFromGst", "lastGstFetch", "createdAt", "updatedAt" FROM `Party`;--> statement-breakpoint
DROP TABLE `Party`;--> statement-breakpoint
ALTER TABLE `__new_Party` RENAME TO `Party`;--> statement-breakpoint
CREATE TABLE `__new_DeliveryChallan` (
	`id` text PRIMARY KEY NOT NULL,
	`challanNumber` text NOT NULL,
	`challanDate` text NOT NULL,
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
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_DeliveryChallan`("id", "challanNumber", "challanDate", "partyId", "subtotal", "taxAmount", "totalAmount", "transportMode", "vehicleNumber", "notes", "termsConditions", "status", "convertedToInvoiceId", "poNumber", "ewayBillNo", "warrantyPeriod", "dispatchedThrough", "createdAt", "updatedAt") SELECT "id", "challanNumber", "challanDate", "partyId", "subtotal", "taxAmount", "totalAmount", "transportMode", "vehicleNumber", "notes", "termsConditions", "status", "convertedToInvoiceId", "poNumber", "ewayBillNo", "warrantyPeriod", "dispatchedThrough", "createdAt", "updatedAt" FROM `DeliveryChallan`;--> statement-breakpoint
DROP TABLE `DeliveryChallan`;--> statement-breakpoint
ALTER TABLE `__new_DeliveryChallan` RENAME TO `DeliveryChallan`;--> statement-breakpoint
CREATE UNIQUE INDEX `DeliveryChallan_challanNumber_unique` ON `DeliveryChallan` (`challanNumber`);--> statement-breakpoint
CREATE TABLE `__new_DeliveryChallanItem` (
	`id` text PRIMARY KEY NOT NULL,
	`deliveryChallanId` text NOT NULL,
	`itemId` text NOT NULL,
	`quantity` real NOT NULL,
	`rate` real NOT NULL,
	`taxRate` real DEFAULT 0 NOT NULL,
	`discount` real DEFAULT 0 NOT NULL,
	`total` real NOT NULL,
	`hsnCode` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`deliveryChallanId`) REFERENCES `DeliveryChallan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_DeliveryChallanItem`("id", "deliveryChallanId", "itemId", "quantity", "rate", "taxRate", "discount", "total", "hsnCode", "createdAt") SELECT "id", "deliveryChallanId", "itemId", "quantity", "rate", "taxRate", "discount", "total", "hsnCode", "createdAt" FROM `DeliveryChallanItem`;--> statement-breakpoint
DROP TABLE `DeliveryChallanItem`;--> statement-breakpoint
ALTER TABLE `__new_DeliveryChallanItem` RENAME TO `DeliveryChallanItem`;--> statement-breakpoint
CREATE TABLE `__new_GstCache` (
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
	`fetchedAt` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_GstCache`("id", "gstin", "tradeName", "legalName", "gstStatus", "registrationDate", "businessType", "addressLine1", "addressLine2", "city", "district", "state", "stateCode", "pincode", "additionalAddresses", "rawResponse", "fetchedAt", "createdAt", "updatedAt") SELECT "id", "gstin", "tradeName", "legalName", "gstStatus", "registrationDate", "businessType", "addressLine1", "addressLine2", "city", "district", "state", "stateCode", "pincode", "additionalAddresses", "rawResponse", "fetchedAt", "createdAt", "updatedAt" FROM `GstCache`;--> statement-breakpoint
DROP TABLE `GstCache`;--> statement-breakpoint
ALTER TABLE `__new_GstCache` RENAME TO `GstCache`;--> statement-breakpoint
CREATE UNIQUE INDEX `GstCache_gstin_unique` ON `GstCache` (`gstin`);--> statement-breakpoint
CREATE TABLE `__new_Item` (
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
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_Item`("id", "name", "skuHsn", "hsnCode", "type", "unit", "salePrice", "purchasePrice", "taxRate", "gstType", "trackStock", "currentStock", "lowStockWarning", "createdAt", "updatedAt") SELECT "id", "name", "skuHsn", "hsnCode", "type", "unit", "salePrice", "purchasePrice", "taxRate", "gstType", "trackStock", "currentStock", "lowStockWarning", "createdAt", "updatedAt" FROM `Item`;--> statement-breakpoint
DROP TABLE `Item`;--> statement-breakpoint
ALTER TABLE `__new_Item` RENAME TO `Item`;--> statement-breakpoint
CREATE TABLE `__new_PaymentTransaction` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`partyId` text,
	`supplierId` text,
	`amount` real NOT NULL,
	`paymentMode` text DEFAULT 'CASH' NOT NULL,
	`paymentDate` text NOT NULL,
	`referenceType` text,
	`referenceId` text,
	`salesInvoiceId` text,
	`purchaseBillId` text,
	`notes` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`salesInvoiceId`) REFERENCES `SalesInvoice`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchaseBillId`) REFERENCES `PurchaseBill`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_PaymentTransaction`("id", "type", "partyId", "supplierId", "amount", "paymentMode", "paymentDate", "referenceType", "referenceId", "salesInvoiceId", "purchaseBillId", "notes", "createdAt") SELECT "id", "type", "partyId", "supplierId", "amount", "paymentMode", "paymentDate", "referenceType", "referenceId", "salesInvoiceId", "purchaseBillId", "notes", "createdAt" FROM `PaymentTransaction`;--> statement-breakpoint
DROP TABLE `PaymentTransaction`;--> statement-breakpoint
ALTER TABLE `__new_PaymentTransaction` RENAME TO `PaymentTransaction`;--> statement-breakpoint
CREATE TABLE `__new_PreviousInvoice` (
	`id` text PRIMARY KEY NOT NULL,
	`serialNumber` integer,
	`invoiceNumber` text NOT NULL,
	`invoiceDate` text NOT NULL,
	`partyName` text NOT NULL,
	`partyGstin` text,
	`totalAmount` real NOT NULL,
	`notes` text,
	`fileData` blob NOT NULL,
	`fileMimeType` text NOT NULL,
	`fileName` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_PreviousInvoice`("id", "serialNumber", "invoiceNumber", "invoiceDate", "partyName", "partyGstin", "totalAmount", "notes", "fileData", "fileMimeType", "fileName", "createdAt", "updatedAt") SELECT "id", "serialNumber", "invoiceNumber", "invoiceDate", "partyName", "partyGstin", "totalAmount", "notes", "fileData", "fileMimeType", "fileName", "createdAt", "updatedAt" FROM `PreviousInvoice`;--> statement-breakpoint
DROP TABLE `PreviousInvoice`;--> statement-breakpoint
ALTER TABLE `__new_PreviousInvoice` RENAME TO `PreviousInvoice`;--> statement-breakpoint
CREATE UNIQUE INDEX `PreviousInvoice_serialNumber_unique` ON `PreviousInvoice` (`serialNumber`);--> statement-breakpoint
CREATE TABLE `__new_PreviousInvoiceItem` (
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
	`createdAt` text NOT NULL,
	FOREIGN KEY (`previousInvoiceId`) REFERENCES `PreviousInvoice`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_PreviousInvoiceItem`("id", "previousInvoiceId", "name", "hsnCode", "quantity", "unit", "rate", "discount", "taxRate", "amount", "createdAt") SELECT "id", "previousInvoiceId", "name", "hsnCode", "quantity", "unit", "rate", "discount", "taxRate", "amount", "createdAt" FROM `PreviousInvoiceItem`;--> statement-breakpoint
DROP TABLE `PreviousInvoiceItem`;--> statement-breakpoint
ALTER TABLE `__new_PreviousInvoiceItem` RENAME TO `PreviousInvoiceItem`;--> statement-breakpoint
CREATE TABLE `__new_ProformaInvoice` (
	`id` text PRIMARY KEY NOT NULL,
	`invoiceNumber` text NOT NULL,
	`invoiceDate` text NOT NULL,
	`dueDate` text,
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
	`deliveryTime` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_ProformaInvoice`("id", "invoiceNumber", "invoiceDate", "dueDate", "partyId", "subtotal", "discount", "taxAmount", "totalAmount", "status", "notes", "termsConditions", "placeOfSupply", "placeOfSupplyName", "isInterState", "reverseCharge", "cgstAmount", "sgstAmount", "igstAmount", "cessAmount", "supplyType", "ecommerceGstin", "deliveryTime", "createdAt", "updatedAt") SELECT "id", "invoiceNumber", "invoiceDate", "dueDate", "partyId", "subtotal", "discount", "taxAmount", "totalAmount", "status", "notes", "termsConditions", "placeOfSupply", "placeOfSupplyName", "isInterState", "reverseCharge", "cgstAmount", "sgstAmount", "igstAmount", "cessAmount", "supplyType", "ecommerceGstin", "deliveryTime", "createdAt", "updatedAt" FROM `ProformaInvoice`;--> statement-breakpoint
DROP TABLE `ProformaInvoice`;--> statement-breakpoint
ALTER TABLE `__new_ProformaInvoice` RENAME TO `ProformaInvoice`;--> statement-breakpoint
CREATE UNIQUE INDEX `ProformaInvoice_invoiceNumber_unique` ON `ProformaInvoice` (`invoiceNumber`);--> statement-breakpoint
CREATE TABLE `__new_ProformaInvoiceItem` (
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
	`createdAt` text NOT NULL,
	FOREIGN KEY (`proformaInvoiceId`) REFERENCES `ProformaInvoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_ProformaInvoiceItem`("id", "proformaInvoiceId", "itemId", "quantity", "rate", "discount", "taxRate", "total", "hsnCode", "taxableAmount", "cgstRate", "cgstAmount", "sgstRate", "sgstAmount", "igstRate", "igstAmount", "cessRate", "cessAmount", "createdAt") SELECT "id", "proformaInvoiceId", "itemId", "quantity", "rate", "discount", "taxRate", "total", "hsnCode", "taxableAmount", "cgstRate", "cgstAmount", "sgstRate", "sgstAmount", "igstRate", "igstAmount", "cessRate", "cessAmount", "createdAt" FROM `ProformaInvoiceItem`;--> statement-breakpoint
DROP TABLE `ProformaInvoiceItem`;--> statement-breakpoint
ALTER TABLE `__new_ProformaInvoiceItem` RENAME TO `ProformaInvoiceItem`;--> statement-breakpoint
CREATE TABLE `__new_PurchaseBill` (
	`id` text PRIMARY KEY NOT NULL,
	`billNumber` text NOT NULL,
	`billDate` text NOT NULL,
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
	`supplierInvoiceDate` text,
	`itcEligibility` text DEFAULT 'ELIGIBLE' NOT NULL,
	`attachmentData` blob,
	`attachmentMimeType` text,
	`purchaseOrderId` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_PurchaseBill`("id", "billNumber", "billDate", "supplierId", "subtotal", "discount", "taxAmount", "totalAmount", "amountPaid", "balanceDue", "status", "notes", "placeOfSupply", "placeOfSupplyName", "isInterState", "reverseCharge", "cgstAmount", "sgstAmount", "igstAmount", "cessAmount", "supplierInvoiceNumber", "supplierInvoiceDate", "itcEligibility", "attachmentData", "attachmentMimeType", "purchaseOrderId", "createdAt", "updatedAt") SELECT "id", "billNumber", "billDate", "supplierId", "subtotal", "discount", "taxAmount", "totalAmount", "amountPaid", "balanceDue", "status", "notes", "placeOfSupply", "placeOfSupplyName", "isInterState", "reverseCharge", "cgstAmount", "sgstAmount", "igstAmount", "cessAmount", "supplierInvoiceNumber", "supplierInvoiceDate", "itcEligibility", "attachmentData", "attachmentMimeType", "purchaseOrderId", "createdAt", "updatedAt" FROM `PurchaseBill`;--> statement-breakpoint
DROP TABLE `PurchaseBill`;--> statement-breakpoint
ALTER TABLE `__new_PurchaseBill` RENAME TO `PurchaseBill`;--> statement-breakpoint
CREATE UNIQUE INDEX `PurchaseBill_billNumber_unique` ON `PurchaseBill` (`billNumber`);--> statement-breakpoint
CREATE TABLE `__new_PurchaseBillItem` (
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
	`createdAt` text NOT NULL,
	FOREIGN KEY (`purchaseBillId`) REFERENCES `PurchaseBill`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplierItemId`) REFERENCES `SupplierItem`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_PurchaseBillItem`("id", "purchaseBillId", "supplierItemId", "quantity", "rate", "discount", "taxRate", "total", "hsnCode", "taxableAmount", "cgstRate", "cgstAmount", "sgstRate", "sgstAmount", "igstRate", "igstAmount", "cessRate", "cessAmount", "createdAt") SELECT "id", "purchaseBillId", "supplierItemId", "quantity", "rate", "discount", "taxRate", "total", "hsnCode", "taxableAmount", "cgstRate", "cgstAmount", "sgstRate", "sgstAmount", "igstRate", "igstAmount", "cessRate", "cessAmount", "createdAt" FROM `PurchaseBillItem`;--> statement-breakpoint
DROP TABLE `PurchaseBillItem`;--> statement-breakpoint
ALTER TABLE `__new_PurchaseBillItem` RENAME TO `PurchaseBillItem`;--> statement-breakpoint
CREATE TABLE `__new_PurchaseOrder` (
	`id` text PRIMARY KEY NOT NULL,
	`orderNumber` text NOT NULL,
	`orderDate` text NOT NULL,
	`expectedDate` text,
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
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_PurchaseOrder`("id", "orderNumber", "orderDate", "expectedDate", "supplierId", "billingAddress", "shippingAddress", "vendorQuotationRef", "subtotal", "discount", "taxAmount", "totalAmount", "status", "notes", "termsConditions", "placeOfSupply", "placeOfSupplyName", "isInterState", "cgstAmount", "sgstAmount", "igstAmount", "cessAmount", "createdAt", "updatedAt") SELECT "id", "orderNumber", "orderDate", "expectedDate", "supplierId", "billingAddress", "shippingAddress", "vendorQuotationRef", "subtotal", "discount", "taxAmount", "totalAmount", "status", "notes", "termsConditions", "placeOfSupply", "placeOfSupplyName", "isInterState", "cgstAmount", "sgstAmount", "igstAmount", "cessAmount", "createdAt", "updatedAt" FROM `PurchaseOrder`;--> statement-breakpoint
DROP TABLE `PurchaseOrder`;--> statement-breakpoint
ALTER TABLE `__new_PurchaseOrder` RENAME TO `PurchaseOrder`;--> statement-breakpoint
CREATE UNIQUE INDEX `PurchaseOrder_orderNumber_unique` ON `PurchaseOrder` (`orderNumber`);--> statement-breakpoint
CREATE TABLE `__new_PurchaseOrderItem` (
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
	`createdAt` text NOT NULL,
	FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`supplierItemId`) REFERENCES `SupplierItem`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_PurchaseOrderItem`("id", "purchaseOrderId", "supplierItemId", "quantity", "receivedQuantity", "rate", "discount", "taxRate", "total", "hsnCode", "taxableAmount", "cgstRate", "cgstAmount", "sgstRate", "sgstAmount", "igstRate", "igstAmount", "createdAt") SELECT "id", "purchaseOrderId", "supplierItemId", "quantity", "receivedQuantity", "rate", "discount", "taxRate", "total", "hsnCode", "taxableAmount", "cgstRate", "cgstAmount", "sgstRate", "sgstAmount", "igstRate", "igstAmount", "createdAt" FROM `PurchaseOrderItem`;--> statement-breakpoint
DROP TABLE `PurchaseOrderItem`;--> statement-breakpoint
ALTER TABLE `__new_PurchaseOrderItem` RENAME TO `PurchaseOrderItem`;--> statement-breakpoint
CREATE TABLE `__new_Quotation` (
	`id` text PRIMARY KEY NOT NULL,
	`invoiceNumber` text NOT NULL,
	`invoiceDate` text NOT NULL,
	`dueDate` text,
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
	`deliveryTime` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_Quotation`("id", "invoiceNumber", "invoiceDate", "dueDate", "partyId", "subtotal", "discount", "taxAmount", "totalAmount", "status", "notes", "termsConditions", "placeOfSupply", "placeOfSupplyName", "isInterState", "reverseCharge", "cgstAmount", "sgstAmount", "igstAmount", "cessAmount", "supplyType", "ecommerceGstin", "deliveryTime", "createdAt", "updatedAt") SELECT "id", "invoiceNumber", "invoiceDate", "dueDate", "partyId", "subtotal", "discount", "taxAmount", "totalAmount", "status", "notes", "termsConditions", "placeOfSupply", "placeOfSupplyName", "isInterState", "reverseCharge", "cgstAmount", "sgstAmount", "igstAmount", "cessAmount", "supplyType", "ecommerceGstin", "deliveryTime", "createdAt", "updatedAt" FROM `Quotation`;--> statement-breakpoint
DROP TABLE `Quotation`;--> statement-breakpoint
ALTER TABLE `__new_Quotation` RENAME TO `Quotation`;--> statement-breakpoint
CREATE UNIQUE INDEX `Quotation_invoiceNumber_unique` ON `Quotation` (`invoiceNumber`);--> statement-breakpoint
CREATE TABLE `__new_QuotationItem` (
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
	`createdAt` text NOT NULL,
	FOREIGN KEY (`quotationId`) REFERENCES `Quotation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_QuotationItem`("id", "quotationId", "itemId", "quantity", "rate", "discount", "taxRate", "total", "hsnCode", "taxableAmount", "cgstRate", "cgstAmount", "sgstRate", "sgstAmount", "igstRate", "igstAmount", "cessRate", "cessAmount", "createdAt") SELECT "id", "quotationId", "itemId", "quantity", "rate", "discount", "taxRate", "total", "hsnCode", "taxableAmount", "cgstRate", "cgstAmount", "sgstRate", "sgstAmount", "igstRate", "igstAmount", "cessRate", "cessAmount", "createdAt" FROM `QuotationItem`;--> statement-breakpoint
DROP TABLE `QuotationItem`;--> statement-breakpoint
ALTER TABLE `__new_QuotationItem` RENAME TO `QuotationItem`;--> statement-breakpoint
CREATE TABLE `__new_SalesInvoice` (
	`id` text PRIMARY KEY NOT NULL,
	`invoiceNumber` text NOT NULL,
	`invoiceDate` text NOT NULL,
	`dueDate` text,
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
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`partyId`) REFERENCES `Party`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_SalesInvoice`("id", "invoiceNumber", "invoiceDate", "dueDate", "type", "partyId", "subtotal", "discount", "taxAmount", "totalAmount", "amountPaid", "balanceDue", "status", "convertedFromQuotationId", "convertedFromProformaId", "notes", "termsConditions", "placeOfSupply", "placeOfSupplyName", "isInterState", "reverseCharge", "cgstAmount", "sgstAmount", "igstAmount", "cessAmount", "supplyType", "ecommerceGstin", "poNumber", "ewayBillNo", "vehicleNumber", "warrantyPeriod", "dispatchedThrough", "createdAt", "updatedAt") SELECT "id", "invoiceNumber", "invoiceDate", "dueDate", "type", "partyId", "subtotal", "discount", "taxAmount", "totalAmount", "amountPaid", "balanceDue", "status", "convertedFromQuotationId", "convertedFromProformaId", "notes", "termsConditions", "placeOfSupply", "placeOfSupplyName", "isInterState", "reverseCharge", "cgstAmount", "sgstAmount", "igstAmount", "cessAmount", "supplyType", "ecommerceGstin", "poNumber", "ewayBillNo", "vehicleNumber", "warrantyPeriod", "dispatchedThrough", "createdAt", "updatedAt" FROM `SalesInvoice`;--> statement-breakpoint
DROP TABLE `SalesInvoice`;--> statement-breakpoint
ALTER TABLE `__new_SalesInvoice` RENAME TO `SalesInvoice`;--> statement-breakpoint
CREATE UNIQUE INDEX `SalesInvoice_invoiceNumber_unique` ON `SalesInvoice` (`invoiceNumber`);--> statement-breakpoint
CREATE TABLE `__new_SalesInvoiceItem` (
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
	`createdAt` text NOT NULL,
	FOREIGN KEY (`salesInvoiceId`) REFERENCES `SalesInvoice`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_SalesInvoiceItem`("id", "salesInvoiceId", "itemId", "quantity", "rate", "discount", "taxRate", "total", "hsnCode", "taxableAmount", "cgstRate", "cgstAmount", "sgstRate", "sgstAmount", "igstRate", "igstAmount", "cessRate", "cessAmount", "createdAt") SELECT "id", "salesInvoiceId", "itemId", "quantity", "rate", "discount", "taxRate", "total", "hsnCode", "taxableAmount", "cgstRate", "cgstAmount", "sgstRate", "sgstAmount", "igstRate", "igstAmount", "cessRate", "cessAmount", "createdAt" FROM `SalesInvoiceItem`;--> statement-breakpoint
DROP TABLE `SalesInvoiceItem`;--> statement-breakpoint
ALTER TABLE `__new_SalesInvoiceItem` RENAME TO `SalesInvoiceItem`;--> statement-breakpoint
CREATE TABLE `__new_Settings` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_Settings`("id", "key", "value", "createdAt", "updatedAt") SELECT "id", "key", "value", "createdAt", "updatedAt" FROM `Settings`;--> statement-breakpoint
DROP TABLE `Settings`;--> statement-breakpoint
ALTER TABLE `__new_Settings` RENAME TO `Settings`;--> statement-breakpoint
CREATE UNIQUE INDEX `Settings_key_unique` ON `Settings` (`key`);--> statement-breakpoint
CREATE TABLE `__new_StockMovement` (
	`id` text PRIMARY KEY NOT NULL,
	`itemId` text NOT NULL,
	`movementType` text NOT NULL,
	`quantity` real NOT NULL,
	`referenceType` text,
	`referenceId` text,
	`notes` text,
	`createdAt` text NOT NULL,
	FOREIGN KEY (`itemId`) REFERENCES `Item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_StockMovement`("id", "itemId", "movementType", "quantity", "referenceType", "referenceId", "notes", "createdAt") SELECT "id", "itemId", "movementType", "quantity", "referenceType", "referenceId", "notes", "createdAt" FROM `StockMovement`;--> statement-breakpoint
DROP TABLE `StockMovement`;--> statement-breakpoint
ALTER TABLE `__new_StockMovement` RENAME TO `StockMovement`;--> statement-breakpoint
CREATE TABLE `__new_Supplier` (
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
	`lastGstFetch` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_Supplier`("id", "name", "phone", "email", "billingAddress", "shippingAddress", "taxId", "openingBalance", "currentBalance", "stateCode", "stateName", "gstType", "legalName", "tradeName", "gstStatus", "city", "district", "pincode", "fetchedFromGst", "lastGstFetch", "createdAt", "updatedAt") SELECT "id", "name", "phone", "email", "billingAddress", "shippingAddress", "taxId", "openingBalance", "currentBalance", "stateCode", "stateName", "gstType", "legalName", "tradeName", "gstStatus", "city", "district", "pincode", "fetchedFromGst", "lastGstFetch", "createdAt", "updatedAt" FROM `Supplier`;--> statement-breakpoint
DROP TABLE `Supplier`;--> statement-breakpoint
ALTER TABLE `__new_Supplier` RENAME TO `Supplier`;--> statement-breakpoint
CREATE TABLE `__new_SupplierItem` (
	`id` text PRIMARY KEY NOT NULL,
	`supplierId` text NOT NULL,
	`name` text NOT NULL,
	`hsnCode` text,
	`unit` text DEFAULT 'pcs' NOT NULL,
	`lastPurchasePrice` real DEFAULT 0 NOT NULL,
	`defaultTaxRate` real DEFAULT 0 NOT NULL,
	`linkedItemId` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`supplierId`) REFERENCES `Supplier`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`linkedItemId`) REFERENCES `Item`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_SupplierItem`("id", "supplierId", "name", "hsnCode", "unit", "lastPurchasePrice", "defaultTaxRate", "linkedItemId", "createdAt", "updatedAt") SELECT "id", "supplierId", "name", "hsnCode", "unit", "lastPurchasePrice", "defaultTaxRate", "linkedItemId", "createdAt", "updatedAt" FROM `SupplierItem`;--> statement-breakpoint
DROP TABLE `SupplierItem`;--> statement-breakpoint
ALTER TABLE `__new_SupplierItem` RENAME TO `SupplierItem`;--> statement-breakpoint
CREATE TABLE `__new_SyncMetadata` (
	`id` text PRIMARY KEY NOT NULL,
	`lastSyncTimestamp` text NOT NULL,
	`deviceId` text NOT NULL,
	`syncStatus` text DEFAULT 'idle' NOT NULL,
	`cloudFileModifiedTime` text,
	`lastError` text,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_SyncMetadata`("id", "lastSyncTimestamp", "deviceId", "syncStatus", "cloudFileModifiedTime", "lastError", "updatedAt") SELECT "id", "lastSyncTimestamp", "deviceId", "syncStatus", "cloudFileModifiedTime", "lastError", "updatedAt" FROM `SyncMetadata`;--> statement-breakpoint
DROP TABLE `SyncMetadata`;--> statement-breakpoint
ALTER TABLE `__new_SyncMetadata` RENAME TO `SyncMetadata`;