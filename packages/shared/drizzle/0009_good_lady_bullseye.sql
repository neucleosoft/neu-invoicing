-- IF NOT EXISTS on purpose: desktops that ran the May Prisma build (migration
-- 20260527115832_add_expenses) already carry this table with identical shape;
-- this drizzle step must be a no-op there and a create everywhere else.
CREATE TABLE IF NOT EXISTS `Expense` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`amount` real NOT NULL,
	`paymentMode` text DEFAULT 'CASH' NOT NULL,
	`notes` text,
	`receiptData` blob,
	`receiptMimeType` text,
	`receiptFileName` text,
	`createdAt` text NOT NULL,
	`updatedAt` text NOT NULL
);
