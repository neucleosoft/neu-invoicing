CREATE TABLE `BankTransaction` (
	`id` text PRIMARY KEY NOT NULL,
	`deletedAt` text,
	`bankAccountId` text NOT NULL,
	`amount` real NOT NULL,
	`description` text,
	`transactionDate` text NOT NULL,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL,
	FOREIGN KEY (`bankAccountId`) REFERENCES `BankAccount`(`id`) ON UPDATE no action ON DELETE no action
);
