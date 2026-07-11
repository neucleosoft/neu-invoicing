// Bill-photo store (S4 image split) — mobile side.
//
// A scanned bill photo is immutable-ish and BIG (~1-3 MB), so it gets exactly
// one Drive file (`img-bill-<id>`, shared naming from @neu/shared) instead of
// riding inside every diary and every backup. Push side: after each sync, the
// changed bills' photos are uploaded best-effort (a failure never fails the
// sync — the next one retries). Pull side: a bill that synced in WITHOUT its
// photo (attachmentMimeType set, attachmentData null) lazily downloads it the
// first time the user views the bill, then keeps it locally.

import { eq, inArray, isNotNull, and } from 'drizzle-orm'
import * as LegacyFS from 'expo-file-system/legacy'
import { billImageFileName, previousInvoiceFileName, toEpochMs } from '@neu/shared'

import { schema, useDb } from '@/db'

type Db = ReturnType<typeof useDb>

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files'

async function findDriveImage(
  accessToken: string,
  name: string,
): Promise<{ id: string; modifiedTime?: string; size: number } | null> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name='${name}' and trashed=false`,
    fields: 'files(id,modifiedTime,size)',
    pageSize: '1',
  })
  const res = await fetch(`${DRIVE_FILES_URL}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Drive list failed (${res.status})`)
  const files =
    ((await res.json()) as { files?: { id: string; modifiedTime?: string; size?: string }[] }).files ?? []
  const f = files[0]
  return f ? { id: f.id, modifiedTime: f.modifiedTime, size: Number(f.size ?? 0) } : null
}

// Upload one photo. RN fetch can't stream a Buffer, and base64-in-JS-memory is
// exactly what the backup code avoids — so we stage the bytes as a temp file
// and use the legacy native uploader (same trick as backupToCloud).
async function uploadImage(
  accessToken: string,
  name: string,
  existingId: string | null,
  data: Uint8Array,
  mimeType: string,
): Promise<void> {
  let fileId = existingId
  if (!fileId) {
    const createRes = await fetch(DRIVE_FILES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parents: ['appDataFolder'] }),
    })
    if (!createRes.ok) throw new Error(`Drive create failed (${createRes.status})`)
    fileId = ((await createRes.json()) as { id: string }).id
  }

  const tmpPath = `${LegacyFS.cacheDirectory}${name}.upload`
  await LegacyFS.writeAsStringAsync(tmpPath, Buffer.from(data).toString('base64'), {
    encoding: LegacyFS.EncodingType.Base64,
  })
  try {
    const uploadRes = await LegacyFS.uploadAsync(
      `${DRIVE_UPLOAD_URL}/${fileId}?uploadType=media`,
      tmpPath,
      {
        httpMethod: 'PATCH',
        uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': mimeType },
      },
    )
    if (uploadRes.status < 200 || uploadRes.status >= 300) {
      throw new Error(`Photo upload failed (${uploadRes.status})`)
    }
  } finally {
    await LegacyFS.deleteAsync(tmpPath, { idempotent: true })
  }
}

/**
 * Push the photos of the given (recently changed) bills to Drive. Best-effort:
 * per-photo failures are swallowed — the next sync retries. Returns how many
 * were actually uploaded.
 */
export async function pushBillImages(
  db: Db,
  accessToken: string,
  billIds: string[],
): Promise<number> {
  if (billIds.length === 0) return 0
  const bills = await db
    .select({
      id: schema.purchaseBill.id,
      updatedAt: schema.purchaseBill.updatedAt,
      attachmentData: schema.purchaseBill.attachmentData,
      attachmentMimeType: schema.purchaseBill.attachmentMimeType,
    })
    .from(schema.purchaseBill)
    .where(and(inArray(schema.purchaseBill.id, billIds), isNotNull(schema.purchaseBill.attachmentData)))

  let pushed = 0
  for (const bill of bills) {
    if (!bill.attachmentData || !bill.attachmentMimeType) continue
    try {
      const name = billImageFileName(bill.id)
      const existing = await findDriveImage(accessToken, name)
      // Upload when missing, 0-byte (the residue of a failed create-then-PATCH
      // — never let it look uploaded), or when the bill changed after the last
      // upload (covers a replaced photo; a redundant upload is harmless).
      const stale =
        existing != null &&
        (existing.size === 0 ||
          (existing.modifiedTime != null &&
            (toEpochMs(bill.updatedAt) ?? 0) > (toEpochMs(existing.modifiedTime) ?? 0)))
      if (existing && !stale) continue
      await uploadImage(
        accessToken,
        name,
        existing?.id ?? null,
        bill.attachmentData as unknown as Uint8Array,
        bill.attachmentMimeType,
      )
      pushed++
    } catch {
      // best-effort — never fail the sync over a photo
    }
  }
  return pushed
}

/**
 * Push the archived files of the given (recently changed) previous-invoices.
 * Archive files are immutable — upload only when missing or 0-byte. An empty
 * local blob is the "on Drive, not fetched" sentinel: nothing to push.
 */
export async function pushPreviousInvoiceFiles(
  db: Db,
  accessToken: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0
  const rows = await db
    .select({
      id: schema.previousInvoice.id,
      fileData: schema.previousInvoice.fileData,
      fileMimeType: schema.previousInvoice.fileMimeType,
    })
    .from(schema.previousInvoice)
    .where(inArray(schema.previousInvoice.id, ids))

  let pushed = 0
  for (const row of rows) {
    const data = row.fileData as unknown as Uint8Array | null
    if (!data || data.length === 0) continue
    try {
      const name = previousInvoiceFileName(row.id)
      const existing = await findDriveImage(accessToken, name)
      if (existing && existing.size > 0) continue
      await uploadImage(
        accessToken,
        name,
        existing?.id ?? null,
        data,
        row.fileMimeType || 'application/octet-stream',
      )
      pushed++
    } catch {
      // best-effort — never fail the sync over a file
    }
  }
  return pushed
}

/**
 * Make sure a previous-invoice's archived file is available locally (empty
 * blob = the synced-in sentinel). Machine write — updatedAt preserved (F5).
 * Never throws.
 */
export async function ensurePreviousInvoiceFile(
  db: Db,
  accessToken: string,
  id: string,
): Promise<boolean> {
  try {
    const [row] = await db
      .select({
        fileData: schema.previousInvoice.fileData,
        updatedAt: schema.previousInvoice.updatedAt,
      })
      .from(schema.previousInvoice)
      .where(eq(schema.previousInvoice.id, id))
      .limit(1)
    if (!row) return false
    const local = row.fileData as unknown as Uint8Array | null
    if (local && local.length > 0) return true

    const found = await findDriveImage(accessToken, previousInvoiceFileName(id))
    if (!found || found.size === 0) return false
    const res = await fetch(`${DRIVE_FILES_URL}/${found.id}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return false
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length === 0) return false

    await db
      .update(schema.previousInvoice)
      .set({ fileData: bytes, updatedAt: row.updatedAt })
      .where(eq(schema.previousInvoice.id, id))
    return true
  } catch {
    return false
  }
}

/**
 * Make sure a bill's photo is available locally, downloading it from Drive on
 * first view (a synced-in bill arrives without its blob). Returns true when
 * the photo is present locally afterwards. Never throws.
 */
export async function ensureBillAttachment(
  db: Db,
  accessToken: string,
  billId: string,
): Promise<boolean> {
  try {
    const [bill] = await db
      .select({
        attachmentData: schema.purchaseBill.attachmentData,
        attachmentMimeType: schema.purchaseBill.attachmentMimeType,
        updatedAt: schema.purchaseBill.updatedAt,
      })
      .from(schema.purchaseBill)
      .where(eq(schema.purchaseBill.id, billId))
      .limit(1)
    if (!bill || !bill.attachmentMimeType) return false
    if (bill.attachmentData) return true

    const found = await findDriveImage(accessToken, billImageFileName(billId))
    if (!found || found.size === 0) return false
    const res = await fetch(`${DRIVE_FILES_URL}/${found.id}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return false
    const bytes = Buffer.from(await res.arrayBuffer())
    // Never cache an empty download — the bill would look "fetched" forever.
    if (bytes.length === 0) return false

    // Machine write: filling in the blob is not a content edit — preserve
    // updatedAt so this download can never win a sync conflict (F5 rule).
    await db
      .update(schema.purchaseBill)
      .set({ attachmentData: bytes, updatedAt: bill.updatedAt })
      .where(eq(schema.purchaseBill.id, billId))
    return true
  } catch {
    return false
  }
}
