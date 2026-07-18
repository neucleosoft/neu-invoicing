import { useMemo } from 'react'
import { drizzle } from 'drizzle-orm/expo-sqlite'
import { migrate } from 'drizzle-orm/expo-sqlite/migrator'
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite'
import * as schema from '@neu/shared'
import migrations from '../../../packages/shared/drizzle/migrations'
import { repairLegacyTextDates } from './dateRepair'
import { backfillOpeningStock } from './openingStockBackfill'
import { backfillBankOpeningJournals } from './bankJournalBackfill'
import { initMobileHlcClock } from '../sync/hlc'

export { schema }

export async function runMigrations(sqlite: SQLiteDatabase) {
  const db = drizzle(sqlite)
  await migrate(db, migrations)
  await repairLegacyTextDates(sqlite)
  await backfillOpeningStock(sqlite)
  await backfillBankOpeningJournals(sqlite)
  // P1: seed the HLC ratchet from MAX(hlc) and hook the schema's stamper —
  // AFTER migrations (the column must exist) and before any user write.
  // The repairs above are raw-SQL and never mint stamps.
  await initMobileHlcClock(sqlite)
}

export function useDb() {
  const sqlite = useSQLiteContext()
  return useMemo(() => drizzle(sqlite, { schema }), [sqlite])
}
