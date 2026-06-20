import { useMemo } from 'react'
import { drizzle } from 'drizzle-orm/expo-sqlite'
import { migrate } from 'drizzle-orm/expo-sqlite/migrator'
import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite'
import * as schema from '@neu/shared'
import migrations from '../drizzle/migrations'
import { repairLegacyTextDates } from './dateRepair'
import { backfillOpeningStock } from './openingStockBackfill'

export { schema }

export async function runMigrations(sqlite: SQLiteDatabase) {
  const db = drizzle(sqlite)
  await migrate(db, migrations)
  await repairLegacyTextDates(sqlite)
  await backfillOpeningStock(sqlite)
}

export function useDb() {
  const sqlite = useSQLiteContext()
  return useMemo(() => drizzle(sqlite, { schema }), [sqlite])
}
