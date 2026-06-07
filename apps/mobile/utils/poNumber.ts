import { desc } from 'drizzle-orm'

import { schema, useDb } from '@/db'

type Db = ReturnType<typeof useDb>

// Purchase Order number: PO-YYYY-NNN (full calendar year, 3-digit). Mirrors
// desktop purchaseOrder:generateOrderNumber. Separate from the BILL-YYYY-NNN
// series the bills use.
export async function generatePoNumber(db: Db, now: Date = new Date()): Promise<string> {
  const rows = await db
    .select({ orderNumber: schema.purchaseOrder.orderNumber })
    .from(schema.purchaseOrder)
    .orderBy(desc(schema.purchaseOrder.orderNumber))
    .limit(1)
  const year = now.getFullYear()
  const last = rows[0]?.orderNumber
  const lastNum = last ? parseInt(last.split('-').pop() || '0', 10) || 0 : 0
  return `PO-${year}-${String(lastNum + 1).padStart(3, '0')}`
}
