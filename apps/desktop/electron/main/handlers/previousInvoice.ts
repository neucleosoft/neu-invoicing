import { ipcMain } from 'electron'
import { getPrisma } from '../database'
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
// Prisma's Bytes column wants Buffer/Uint8Array — normalize here.
const toBuffer = (data: Uint8Array | Buffer | ArrayBuffer): Buffer => {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)
  return Buffer.from(new Uint8Array(data))
}

// Coerce optional/missing fields on each item to their defaults so the Prisma
// nested-create call gets clean shapes regardless of what the caller omits.
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

export const setupPreviousInvoiceHandlers = () => {
  const prisma = getPrisma()

  // List: omit fileData so we don't ship megabytes per row to the renderer.
  // The file is fetched on demand by getFile (or getById if metadata-only isn't enough).
  ipcMain.handle('previousInvoice:getAll', async () => {
    try {
      const rows = await prisma.previousInvoice.findMany({
        select: {
          id: true,
          serialNumber: true,
          invoiceNumber: true,
          invoiceDate: true,
          partyName: true,
          partyGstin: true,
          totalAmount: true,
          notes: true,
          fileMimeType: true,
          fileName: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { invoiceDate: 'desc' },
      })
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
      const row = await prisma.previousInvoice.findUnique({
        where: { id },
        include: { items: true },
      })
      return { success: true, data: row }
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
      const row = await prisma.previousInvoice.findUnique({
        where: { id },
        select: { fileData: true, fileMimeType: true, fileName: true },
      })
      if (!row) return { success: false, error: 'Not found' }
      return {
        success: true,
        data: {
          fileData: new Uint8Array(row.fileData as Buffer),
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
      // aggregate-then-create without a transaction because this is a single-
      // user offline app — no concurrent inserts.
      const agg = await prisma.previousInvoice.aggregate({ _max: { serialNumber: true } })
      const nextSerial = (agg._max.serialNumber ?? 0) + 1
      const itemsCreate = data.items?.length
        ? { create: data.items.map(normalizeItem) }
        : undefined
      const row = await prisma.previousInvoice.create({
        data: {
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
          items: itemsCreate,
        },
        select: {
          id: true,
          serialNumber: true,
          invoiceNumber: true,
          invoiceDate: true,
          partyName: true,
          partyGstin: true,
          totalAmount: true,
          notes: true,
          fileMimeType: true,
          fileName: true,
          createdAt: true,
          updatedAt: true,
        },
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
      const patch: any = {}
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
      // Replace-all strategy for items: Prisma wraps deleteMany + create in a
      // transaction, so a partial failure doesn't leave stale rows behind.
      if (data.items !== undefined) {
        patch.items = {
          deleteMany: {},
          create: data.items.map(normalizeItem),
        }
      }
      const row = await prisma.previousInvoice.update({
        where: { id },
        data: patch,
        select: {
          id: true,
          serialNumber: true,
          invoiceNumber: true,
          invoiceDate: true,
          partyName: true,
          partyGstin: true,
          totalAmount: true,
          notes: true,
          fileMimeType: true,
          fileName: true,
          createdAt: true,
          updatedAt: true,
        },
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
      await prisma.previousInvoice.delete({ where: { id } })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete previous invoice',
      }
    }
  })
}
