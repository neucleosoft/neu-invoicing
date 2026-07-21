import { type SQLiteDatabase } from 'expo-sqlite'

// One-shot data fix (P3): fold each bank account's typed balance into an
// opening-journal row so the balance is rebuildable (and mergeable) like every
// other total. The deterministic id 'open-<accountId>' makes BOTH devices'
// backfills mint the SAME row — sync converges to one instead of doubling the
// balance. Idempotent: the NOT EXISTS guard makes re-runs no-ops.
//
// Raw SQL on purpose (mirrors openingStockBackfill): runs during migration,
// before Drizzle is up. Dates are epoch-ms integers, matching the shared
// prismaDate convention.
export async function backfillBankOpeningJournals(sqlite: SQLiteDatabase): Promise<void> {
  try {
    await sqlite.runAsync(
      `INSERT INTO BankTransaction (id, bankAccountId, amount, description, transactionDate, createdAt, updatedAt)
       SELECT 'open-' || a.id,
              a.id,
              a.currentBalance - COALESCE((SELECT SUM(t.amount) FROM BankTransaction t
                                            WHERE t.bankAccountId = a.id AND t.deletedAt IS NULL), 0),
              'Opening balance',
              a.createdAt, a.createdAt, a.createdAt
       FROM BankAccount a
       WHERE NOT EXISTS (SELECT 1 FROM BankTransaction o WHERE o.id = 'open-' || a.id)
         AND ABS(a.currentBalance - COALESCE((SELECT SUM(t.amount) FROM BankTransaction t
                                               WHERE t.bankAccountId = a.id AND t.deletedAt IS NULL), 0)) > 0.005`,
    )
  } catch (e) {
    console.error('[bankJournalBackfill] failed, app continues:', e)
  }
}
