-- Add updatedAt to PaymentTransaction so payment edits can be reconciled by
-- newest-edit-wins sync (it was the only top-level money table without one).
-- Nullable because SQLite's ADD COLUMN cannot take a non-constant default;
-- legacy rows are backfilled to their createdAt so every row has a usable stamp.
ALTER TABLE "PaymentTransaction" ADD COLUMN "updatedAt" DATETIME;
UPDATE "PaymentTransaction" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
