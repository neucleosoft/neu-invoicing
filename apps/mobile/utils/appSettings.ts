// Key/value app settings in the shared Settings table (same rows desktop's
// settings.get/set IPC uses, so a synced database carries these across).

import { eq } from 'drizzle-orm'

import { schema, useDb } from '@/db'

type Db = ReturnType<typeof useDb>

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, key))
    .limit(1)
  return row?.value ?? null
}

export async function setSetting(db: Db, key: string, value: string): Promise<void> {
  await db
    .insert(schema.settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value } })
}
