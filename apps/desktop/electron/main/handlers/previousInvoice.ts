import { ipcMain } from 'electron'
import { desc, eq, sql } from '@neu/shared'
import { fetchPreviousInvoiceFile } from '../rowSync'
import { getDb, schema } from '../db'
import { extractFromPdfText } from '../lib/parseInvoicePdf'

interface PreviousInvoiceItemInput {
  name: string
  hsnCode?: string | null
  quantity: number
  unit?: string | null
  rate: number
  discount?: number
  taxRate?: number
  amount: number
}

interface CreatePreviousInvoiceInput {
  invoiceNumber: string
  invoiceDate: string
  partyName: string
  partyGstin?: string | null
  totalAmount: number
  notes?: string | null
  fileData: Uint8Array | Buffer | ArrayBuffer
  fileMimeType: string
  fileName: string
  items?: PreviousInvoiceItemInput[]
}

interface UpdatePreviousInvoiceInput {
  invoiceNumber?: string
  invoiceDate?: string
  partyName?: string
  partyGstin?: string | null
  totalAmount?: number
  notes?: string | null
  items?: PreviousInvoiceItemInput[]
}

// Renderer can send file bytes as Uint8Array, Buffer (Node side), or ArrayBuffer.
// The blob column wants Buffer/Uint8Array — normalize here.
const toBuffer = (data: Uint8Array | Buffer | ArrayBuffer): Buffer => {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)
  return Buffer.from(new Uint8Array(data))
}

// Coerce optional/missing fields on each item to their defaults so the insert
// gets clean shapes regardless of what the caller omits.
const normalizeItem = (i: PreviousInvoiceItemInput) => ({
  name: i.name,
  hsnCode: i.hsnCode ?? null,
  quantity: i.quantity,
  unit: i.unit ?? null,
  rate: i.rate,
  discount: i.discount ?? 0,
  taxRate: i.taxRate ?? 0,
  amount: i.amount,
})

// List/return shape without the blob — never ship megabytes per row over IPC.
const headerColumns = {
  id: schema.previousInvoice.id,
  serialNumber: schema.previousInvoice.serialNumber,
  invoiceNumber: schema.previousInvoice.invoiceNumber,
  invoiceDate: schema.previousInvoice.invoiceDate,
  partyName: schema.previousInvoice.partyName,
  partyGstin: schema.previousInvoice.partyGstin,
  totalAmount: schema.previousInvoice.totalAmount,
  notes: schema.previousInvoice.notes,
  fileMimeType: schema.previousInvoice.fileMimeType,
  fileName: schema.previousInvoice.fileName,
  deletedAt: schema.previousInvoice.deletedAt,
  createdAt: schema.previousInvoice.createdAt,
  updatedAt: schema.previousInvoice.updatedAt,
}

export const setupPreviousInvoiceHandlers = () => {
  const db = getDb()

  // List: omit fileData so we don't ship megabytes per row to the renderer.
  // The file is fetched on demand by getFile (or getById if metadata-only isn't enough).
  ipcMain.handle('previousInvoice:getAll', async () => {
    try {
      const rows = await db
        .select(headerColumns)
        .from(schema.previousInvoice)
        .orderBy(desc(schema.previousInvoice.invoiceDate))
      return { success: true, data: rows }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch previous invoices',
      }
    }
  })

  ipcMain.handle('previousInvoice:getById', async (_, id: string) => {
    try {
      const [row] = await db.select().from(schema.previousInvoice).where(eq(schema.previousInvoice.id, id)).limit(1)
      if (!row) return { success: true, data: null }
      const items = await db
        .select()
        .from(schema.previousInvoiceItem)
        .where(eq(schema.previousInvoiceItem.previousInvoiceId, id))
      return { success: true, data: { ...row, items } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch previous invoice',
      }
    }
  })

  // Returns the file bytes only — used by the download / view actions.
  // Returned as a plain Uint8Array which Electron's structured-clone IPC
  // serializes efficiently (no JSON base64 overhead).
  ipcMain.handle('previousInvoice:getFile', async (_, id: string) => {
    try {
      const fileColumns = {
        fileData: schema.previousInvoice.fileData,
        fileMimeType: schema.previousInvoice.fileMimeType,
        fileName: schema.previousInvoice.fileName,
      }
      let [row] = await db.select(fileColumns).from(schema.previousInvoice).where(eq(schema.previousInvoice.id, id)).limit(1)
      if (!row) return { success: false, error: 'Not found' }

      // Empty blob = synced-in sentinel: the file lives on Drive (S4 image
      // split) — fetch it once, then it's local forever.
      const localBytes = row.fileData as unknown as Uint8Array | null
      if (!localBytes || localBytes.length === 0) {
        const fetched = await fetchPreviousInvoiceFile(id)
        if (!fetched.success) return { success: false, error: fetched.error }
        ;[row] = await db.select(fileColumns).from(schema.previousInvoice).where(eq(schema.previousInvoice.id, id)).limit(1)
        if (!row) return { success: false, error: 'Not found' }
      }
      return {
        success: true,
        data: {
          fileData: new Uint8Array(row.fileData as unknown as Uint8Array),
          fileMimeType: row.fileMimeType,
          fileName: row.fileName,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch file',
      }
    }
  })

  ipcMain.handle('previousInvoice:create', async (_, data: CreatePreviousInvoiceInput) => {
    try {
      const invoiceDate = new Date(data.invoiceDate)
      if (isNaN(invoiceDate.getTime())) {
        return { success: false, error: 'Invalid invoice date' }
      }
      // Sequential, app-assigned counter independent of invoiceNumber. Safe to
      // aggregate-then-create without a lock because this is a single-user
      // offline app — no concurrent inserts.
      const [agg] = await db
        .select({ max: sql<number | null>`max(${schema.previousInvoice.serialNumber})` })
        .from(schema.previousInvoice)
      const nextSerial = (agg?.max ?? 0) + 1
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.previousInvoice)
          .values({
            serialNumber: nextSerial,
            invoiceNumber: data.invoiceNumber,
            invoiceDate,
            partyName: data.partyName,
            partyGstin: data.partyGstin ?? null,
            totalAmount: data.totalAmount,
            notes: data.notes ?? null,
            fileData: toBuffer(data.fileData),
            fileMimeType: data.fileMimeType,
            fileName: data.fileName,
          })
          .returning(headerColumns)
        if (data.items?.length) {
          await tx
            .insert(schema.previousInvoiceItem)
            .values(data.items.map((i) => ({ ...normalizeItem(i), previousInvoiceId: created.id })))
        }
        return created
      })
      return { success: true, data: row }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create previous invoice',
      }
    }
  })

  ipcMain.handle('previousInvoice:update', async (_, id: string, data: UpdatePreviousInvoiceInput) => {
    try {
      const patch: Record<string, unknown> = {}
      if (data.invoiceNumber !== undefined) patch.invoiceNumber = data.invoiceNumber
      if (data.invoiceDate !== undefined) {
        const invoiceDate = new Date(data.invoiceDate)
        if (isNaN(invoiceDate.getTime())) {
          return { success: false, error: 'Invalid invoice date' }
        }
        patch.invoiceDate = invoiceDate
      }
      if (data.partyName !== undefined) patch.partyName = data.partyName
      if (data.partyGstin !== undefined) patch.partyGstin = data.partyGstin
      if (data.totalAmount !== undefined) patch.totalAmount = data.totalAmount
      if (data.notes !== undefined) patch.notes = data.notes

      // Replace-all strategy for items, and header + items in ONE transaction
      // so a partial failure doesn't leave stale rows behind.
      const row = await db.transaction(async (tx) => {
        const [updated] = Object.keys(patch).length
          ? await tx.update(schema.previousInvoice).set(patch).where(eq(schema.previousInvoice.id, id)).returning(headerColumns)
          : await tx.select(headerColumns).from(schema.previousInvoice).where(eq(schema.previousInvoice.id, id)).limit(1)
        if (data.items !== undefined) {
          await tx.delete(schema.previousInvoiceItem).where(eq(schema.previousInvoiceItem.previousInvoiceId, id))
          if (data.items.length) {
            await tx
              .insert(schema.previousInvoiceItem)
              .values(data.items.map((i) => ({ ...normalizeItem(i), previousInvoiceId: id })))
          }
        }
        return updated
      })
      return { success: true, data: row }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update previous invoice',
      }
    }
  })

  // Text-based extraction for digital PDFs (app-generated and most modern
  // invoice templates). The renderer tries this BEFORE the OCR fallback —
  // deterministic, free, and ~60× faster. Returns null if the PDF has no
  // usable text layer (scanned images), in which case the caller should fall
  // back to OCR via purchase:extractFromImage.
  ipcMain.handle(
    'previousInvoice:extractFromPdfText',
    async (_, args: { fileBytes: Uint8Array | Buffer | ArrayBuffer }) => {
      try {
        const bytes =
          args.fileBytes instanceof Uint8Array
            ? args.fileBytes
            : Buffer.isBuffer(args.fileBytes)
              ? new Uint8Array(args.fileBytes)
              : new Uint8Array(args.fileBytes as ArrayBuffer)
        const parsed = await extractFromPdfText(bytes)
        if (!parsed) return { success: false, error: 'NO_TEXT_LAYER' }
        return { success: true, data: parsed }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to extract from PDF text',
        }
      }
    },
  )

  ipcMain.handle('previousInvoice:delete', async (_, id: string) => {
    try {
      const [existing] = await db.select({ id: schema.previousInvoice.id }).from(schema.previousInvoice).where(eq(schema.previousInvoice.id, id)).limit(1)
      if (!existing) {
        throw new Error('Previous invoice not found')
      }

      // Terminal removal: stamp deletedAt (updatedAt + hlc auto-bump). A previous
      // invoice is a frozen historical record — once removed it cannot be restored
      // (no restore handler). The row is purged ~35 days later.
      await db.update(schema.previousInvoice).set({ deletedAt: new Date() }).where(eq(schema.previousInvoice.id, id))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete previous invoice',
      }
    }
  })
}
