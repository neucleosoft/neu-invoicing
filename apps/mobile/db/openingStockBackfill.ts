import type { SQLiteDatabase } from 'expo-sqlite'

// One-time data backfill: set Item.openingStock so stock is rebuildable from rows.
//
// The openingStock column (added 2026-06-19) defaults to 0, but items made before it had
// their opening stock typed straight into currentStock with no movement behind it. The
// recompute/sync engine rebuilds currentStock = openingStock + Σ(stockMovements), so each
// item's openingStock must equal (currentStock − Σ its movements). New items set it at
// create; this fixes the existing ones.
//
// Runs on every boot right after migrations (like repairLegacyTextDates), but the WHERE
// clause writes only rows where the invariant is violated — once aligned it's a no-op.
// Because it runs on launch, every device aligns itself automatically — no manual step.
// Tolerant: a missing column (an old DB mid-upgrade) is caught and retried next launch.
export async function backfillOpeningStock(sqlite: SQLiteDatabase): Promise<void> {
  try {
    const movesum = `COALESCE((SELECT SUM("quantity") FROM "StockMovement" WHERE "StockMovement"."itemId" = "Item"."id"), 0)`
    const res = await sqlite.runAsync(
      `UPDATE "Item"
       SET "openingStock" = "currentStock" - ${movesum}
       WHERE ABS("openingStock" - ("currentStock" - ${movesum})) > 0.0001`,
    )
    if (res.changes > 0) console.log(`[openingStockBackfill] aligned ${res.changes} item(s)`)
  } catch (e) {
    console.error('[openingStockBackfill] failed, app continues:', e)
  }
}
