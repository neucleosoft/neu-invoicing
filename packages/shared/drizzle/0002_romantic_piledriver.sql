ALTER TABLE `BankAccount` ADD `deletedAt` text;--> statement-breakpoint
ALTER TABLE `CreditDebitNote` ADD `deletedAt` text;--> statement-breakpoint
ALTER TABLE `Party` ADD `deletedAt` text;--> statement-breakpoint
ALTER TABLE `DeliveryChallan` ADD `deletedAt` text;--> statement-breakpoint
ALTER TABLE `Item` ADD `deletedAt` text;--> statement-breakpoint
ALTER TABLE `PaymentTransaction` ADD `deletedAt` text;--> statement-breakpoint
ALTER TABLE `PreviousInvoice` ADD `deletedAt` text;--> statement-breakpoint
ALTER TABLE `ProformaInvoice` ADD `deletedAt` text;--> statement-breakpoint
ALTER TABLE `PurchaseBill` ADD `deletedAt` text;--> statement-breakpoint
ALTER TABLE `PurchaseOrder` ADD `deletedAt` text;--> statement-breakpoint
ALTER TABLE `Quotation` ADD `deletedAt` text;--> statement-breakpoint
ALTER TABLE `SalesInvoice` ADD `deletedAt` text;--> statement-breakpoint
ALTER TABLE `Supplier` ADD `deletedAt` text;--> statement-breakpoint
ALTER TABLE `SupplierItem` ADD `deletedAt` text;