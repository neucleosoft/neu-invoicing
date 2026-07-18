ALTER TABLE `PaymentTransaction` ADD `updatedAt` text;--> statement-breakpoint
UPDATE `PaymentTransaction` SET `updatedAt` = `createdAt` WHERE `updatedAt` IS NULL;
