-- Append-only bank journal (P3): every balance change becomes a row, making
-- bankAccount.currentBalance rebuildable (and mergeable) like every other
-- total. Opening balances are backfilled as journal rows at startup with
-- deterministic ids (open-<accountId>) so both devices converge to one row.
CREATE TABLE "BankTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deletedAt" DATETIME,
    "bankAccountId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "description" TEXT,
    "transactionDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
