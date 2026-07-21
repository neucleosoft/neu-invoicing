// 21-day purge (design R8/D10) — mobile side. Archived (Mode A) DOCUMENTS past
// the window are hard-deleted locally for real; both devices share deletedAt,
// so each converges on its own without any sync message.
//
// TWO deliberate narrowings versus the original design, both for safety:
//  1. The wait is 35 DAYS, not 21. Diaries re-offer every row whose updatedAt
//     is within 30 days — purging sooner would let a peer's stale packet
//     re-INSERT the purged row (a resurrection loop until the packet aged
//     out). 35d > the 30d diary window, with margin.
//  2. Only DOCUMENTS purge (quotation, proforma, purchase order, previous
//     invoice) — and never one that a surviving invoice/bill still points at.
//     Master rows (customers, items, …) are tiny and heavily referenced;
//     purging them risks FK breakage for zero space gain. They stay archived.
//
// Cancelled money docs are NEVER purged — permanent GST audit trail.
//
// Known benign edge: a FROZEN peer diary (a device that stopped syncing keeps
// its last diary on Drive) can re-insert a purged row — but it arrives still
// ARCHIVED (deletedAt set), stays out of every number, and re-purges on the
// next daily run. Cosmetic churn only; disappears when the peer syncs again.

import { eq, isNotNull, lte, and } from 'drizzle-orm'
import * as SecureStore from 'expo-secure-store'
import { previousInvoiceFileName } from '@neu/shared'

import { schema, useDb } from '@/db'

import { appendSyncActivity } from './activityLog'

type Db = ReturnType<typeof useDb>

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'

const PURGE_AFTER_MS = 35 * 24 * 60 * 60 * 1000
const CHECK_THROTTLE_MS = 24 * 60 * 60 * 1000
const LAST_CHECK_KEY = 'neu.sync.lastPurgeCheckAt'

// Best-effort: free the archived file's Drive object once its row is gone.
async function deleteDriveFile(accessToken: string, name: string): Promise<void> {
  try {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q: `name='${name}' and trashed=false`,
      fields: 'files(id)',
      pageSize: '1',
    })
    const res = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return
    const f = ((await res.json()) as { files?: { id: string }[] }).files?.[0]
    if (!f) return
    await fetch(`${DRIVE_FILES_URL}/${f.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  } catch {
    // the other device (or the next purge run) can still delete it
  }
}

export async function purgeArchivedDocs(db: Db, accessToken?: string): Promise<void> {
  try {
    const now = Date.now()
    const last = await SecureStore.getItemAsync(LAST_CHECK_KEY)
    if (last && now - Number(last) < CHECK_THROTTLE_MS) return
    await SecureStore.setItemAsync(LAST_CHECK_KEY, String(now))

    const cutoff = new Date(now - PURGE_AFTER_MS)
    let purged = 0

    // Quotations — unless a surviving invoice was converted from one.
    const quotes = await db
      .select({ id: schema.quotation.id })
      .from(schema.quotation)
      .where(and(isNotNull(schema.quotation.deletedAt), lte(schema.quotation.deletedAt, cutoff)))
    for (const q of quotes) {
      const [ref] = await db
        .select({ id: schema.salesInvoice.id })
        .from(schema.salesInvoice)
        .where(eq(schema.salesInvoice.convertedFromQuotationId, q.id))
        .limit(1)
      if (ref) continue
      await db.transaction(async (tx) => {
        await tx.delete(schema.quotationItem).where(eq(schema.quotationItem.quotationId, q.id))
        await tx.delete(schema.quotation).where(eq(schema.quotation.id, q.id))
      })
      purged++
    }

    // Proformas — same conversion guard.
    const proformas = await db
      .select({ id: schema.proformaInvoice.id })
      .from(schema.proformaInvoice)
      .where(and(isNotNull(schema.proformaInvoice.deletedAt), lte(schema.proformaInvoice.deletedAt, cutoff)))
    for (const p of proformas) {
      const [ref] = await db
        .select({ id: schema.salesInvoice.id })
        .from(schema.salesInvoice)
        .where(eq(schema.salesInvoice.convertedFromProformaId, p.id))
        .limit(1)
      if (ref) continue
      await db.transaction(async (tx) => {
        await tx.delete(schema.proformaInvoiceItem).where(eq(schema.proformaInvoiceItem.proformaInvoiceId, p.id))
        await tx.delete(schema.proformaInvoice).where(eq(schema.proformaInvoice.id, p.id))
      })
      purged++
    }

    // Purchase orders — unless a surviving bill still references one.
    const pos = await db
      .select({ id: schema.purchaseOrder.id })
      .from(schema.purchaseOrder)
      .where(and(isNotNull(schema.purchaseOrder.deletedAt), lte(schema.purchaseOrder.deletedAt, cutoff)))
    for (const po of pos) {
      const [ref] = await db
        .select({ id: schema.purchaseBill.id })
        .from(schema.purchaseBill)
        .where(eq(schema.purchaseBill.purchaseOrderId, po.id))
        .limit(1)
      if (ref) continue
      await db.transaction(async (tx) => {
        await tx.delete(schema.purchaseOrderItem).where(eq(schema.purchaseOrderItem.purchaseOrderId, po.id))
        await tx.delete(schema.purchaseOrder).where(eq(schema.purchaseOrder.id, po.id))
      })
      purged++
    }

    // Previous invoices — nothing references them; their Drive file dies too.
    const prevs = await db
      .select({ id: schema.previousInvoice.id })
      .from(schema.previousInvoice)
      .where(and(isNotNull(schema.previousInvoice.deletedAt), lte(schema.previousInvoice.deletedAt, cutoff)))
    for (const pi of prevs) {
      await db.transaction(async (tx) => {
        await tx.delete(schema.previousInvoiceItem).where(eq(schema.previousInvoiceItem.previousInvoiceId, pi.id))
        await tx.delete(schema.previousInvoice).where(eq(schema.previousInvoice.id, pi.id))
      })
      purged++
      if (accessToken) await deleteDriveFile(accessToken, previousInvoiceFileName(pi.id))
    }

    if (purged > 0) {
      await appendSyncActivity([
        {
          kind: 'PURGE',
          detail: `Purged ${purged} archived document(s) deleted more than 35 days ago (${new Date(now).toDateString()})`,
        },
      ])
    }
  } catch {
    // hygiene only — never surface; the next daily check retries
  }
}
