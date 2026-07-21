ALTER TABLE `CreditDebitNote` ADD `cancelledAt` text;--> statement-breakpoint
ALTER TABLE `CreditDebitNote` ADD `cancelReason` text;--> statement-breakpoint
ALTER TABLE `DeliveryChallan` ADD `cancelledAt` text;--> statement-breakpoint
ALTER TABLE `DeliveryChallan` ADD `cancelReason` text;--> statement-breakpoint
ALTER TABLE `PaymentTransaction` ADD `cancelledAt` text;--> statement-breakpoint
ALTER TABLE `PaymentTransaction` ADD `cancelReason` text;--> statement-breakpoint
ALTER TABLE `PurchaseBill` ADD `cancelledAt` text;--> statement-breakpoint
ALTER TABLE `PurchaseBill` ADD `cancelReason` text;--> statement-breakpoint
ALTER TABLE `SalesInvoice` ADD `cancelledAt` text;--> statement-breakpoint
ALTER TABLE `SalesInvoice` ADD `cancelReason` text;