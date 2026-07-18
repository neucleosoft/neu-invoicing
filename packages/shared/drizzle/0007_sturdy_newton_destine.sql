ALTER TABLE `DeliveryChallan` ADD `placeOfSupply` text;--> statement-breakpoint
ALTER TABLE `DeliveryChallan` ADD `placeOfSupplyName` text;--> statement-breakpoint
ALTER TABLE `DeliveryChallan` ADD `isInterState` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `DeliveryChallan` ADD `cgstAmount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `DeliveryChallan` ADD `sgstAmount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `DeliveryChallan` ADD `igstAmount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `DeliveryChallan` ADD `cessAmount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `DeliveryChallanItem` ADD `taxableAmount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `DeliveryChallanItem` ADD `cgstRate` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `DeliveryChallanItem` ADD `cgstAmount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `DeliveryChallanItem` ADD `sgstRate` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `DeliveryChallanItem` ADD `sgstAmount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `DeliveryChallanItem` ADD `igstRate` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `DeliveryChallanItem` ADD `igstAmount` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `DeliveryChallanItem` ADD `cessRate` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `DeliveryChallanItem` ADD `cessAmount` real DEFAULT 0 NOT NULL;