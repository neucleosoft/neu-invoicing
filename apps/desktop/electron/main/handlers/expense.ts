import { ipcMain } from 'electron'
import { and, asc, desc, eq, gte, lte, sql } from '@neu/shared'
import { getDb, schema } from '../db'

// Ported from the Prisma original (Nitesh, PR #65) during the drizzle merge —
// same IPC names, same response shapes, the renderer is untouched.

interface CreateExpenseInput {
  date: string
  category: string
  description: string
  amount: number
  paymentMode?: string
  notes?: string | null
  // Receipt is optional. Renderer sends bytes when the user attaches a file.
  receiptData?: Uint8Array | Buffer | ArrayBuffer | null
  receiptMimeType?: string | null
  receiptFileName?: string | null
}

interface UpdateExpenseInput {
  date?: string
  category?: string
  description?: string
  amount?: number
  paymentMode?: string
  notes?: string | null
  // For receipts on update:
  //   undefined     → leave the existing receipt untouched
  //   null          → clear the receipt
  //   Uint8Array... → replace with new bytes
  receiptData?: Uint8Array | Buffer | ArrayBuffer | null
  receiptMimeType?: string | null
  receiptFileName?: string | null
}

const toBuffer = (data: Uint8Array | Buffer | ArrayBuffer): Buffer => {
  if (Buffer.isBuffer(data)) return data
  if (data instanceof Uint8Array) return Buffer.from(data)
  return Buffer.from(new Uint8Array(data))
}

export const setupExpenseHandlers = () => {
  const db = getDb()

  // Columns sent to the renderer — everything except the receiptData BLOB so
  // listing all expenses doesn't ship MB of file bytes over IPC. The renderer
  // fetches the bytes on demand via expense:getReceipt.
  const expenseNoBlob = {
    id: schema.expense.id,
    date: schema.expense.date,
    category: schema.expense.category,
    description: schema.expense.description,
    amount: schema.expense.amount,
    paymentMode: schema.expense.paymentMode,
    notes: schema.expense.notes,
    receiptMimeType: schema.expense.receiptMimeType,
    receiptFileName: schema.expense.receiptFileName,
    createdAt: schema.expense.createdAt,
    updatedAt: schema.expense.updatedAt,
  }

  ipcMain.handle('expense:getAll', async () => {
    try {
      const rows = await db
        .select(expenseNoBlob)
        .from(schema.expense)
        .orderBy(desc(schema.expense.date), desc(schema.expense.createdAt))
      return { success: true, data: rows }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch expenses',
      }
    }
  })

  ipcMain.handle('expense:getById', async (_, id: string) => {
    try {
      const [row] = await db
        .select(expenseNoBlob)
        .from(schema.expense)
        .where(eq(schema.expense.id, id))
        .limit(1)
      return { success: true, data: row ?? null }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch expense',
      }
    }
  })

  // Returns the receipt file bytes only — used by view / download actions.
  ipcMain.handle('expense:getReceipt', async (_, id: string) => {
    try {
      const [row] = await db
        .select({
          receiptData: schema.expense.receiptData,
          receiptMimeType: schema.expense.receiptMimeType,
          receiptFileName: schema.expense.receiptFileName,
        })
        .from(schema.expense)
        .where(eq(schema.expense.id, id))
        .limit(1)
      if (!row || !row.receiptData) {
        return { success: false, error: 'No receipt attached' }
      }
      return {
        success: true,
        data: {
          receiptData: new Uint8Array(row.receiptData as Buffer),
          receiptMimeType: row.receiptMimeType,
          receiptFileName: row.receiptFileName,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch receipt',
      }
    }
  })

  ipcMain.handle('expense:create', async (_, data: CreateExpenseInput) => {
    try {
      const expenseDate = new Date(data.date)
      if (isNaN(expenseDate.getTime())) {
        return { success: false, error: 'Invalid expense date' }
      }
      if (!data.category || !data.description) {
        return { success: false, error: 'Category and description are required' }
      }
      if (typeof data.amount !== 'number' || !isFinite(data.amount) || data.amount <= 0) {
        return { success: false, error: 'Amount must be a positive number' }
      }

      const [row] = await db
        .insert(schema.expense)
        .values({
          date: expenseDate,
          category: data.category,
          description: data.description,
          amount: data.amount,
          paymentMode: data.paymentMode || 'CASH',
          notes: data.notes ?? null,
          receiptData: data.receiptData ? toBuffer(data.receiptData) : null,
          receiptMimeType: data.receiptMimeType ?? null,
          receiptFileName: data.receiptFileName ?? null,
        })
        .returning(expenseNoBlob)
      return { success: true, data: row }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create expense',
      }
    }
  })

  ipcMain.handle('expense:update', async (_, id: string, data: UpdateExpenseInput) => {
    try {
      const patch: Record<string, unknown> = {}
      if (data.date !== undefined) {
        const d = new Date(data.date)
        if (isNaN(d.getTime())) return { success: false, error: 'Invalid expense date' }
        patch.date = d
      }
      if (data.category !== undefined) patch.category = data.category
      if (data.description !== undefined) patch.description = data.description
      if (data.amount !== undefined) {
        if (typeof data.amount !== 'number' || !isFinite(data.amount) || data.amount <= 0) {
          return { success: false, error: 'Amount must be a positive number' }
        }
        patch.amount = data.amount
      }
      if (data.paymentMode !== undefined) patch.paymentMode = data.paymentMode
      if (data.notes !== undefined) patch.notes = data.notes
      // Receipt: undefined = no-op, null = clear, bytes = replace
      if (data.receiptData !== undefined) {
        if (data.receiptData === null) {
          patch.receiptData = null
          patch.receiptMimeType = null
          patch.receiptFileName = null
        } else {
          patch.receiptData = toBuffer(data.receiptData)
          if (data.receiptMimeType !== undefined) patch.receiptMimeType = data.receiptMimeType
          if (data.receiptFileName !== undefined) patch.receiptFileName = data.receiptFileName
        }
      }
      const [row] = await db
        .update(schema.expense)
        .set(patch)
        .where(eq(schema.expense.id, id))
        .returning(expenseNoBlob)
      return { success: true, data: row }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update expense',
      }
    }
  })

  ipcMain.handle('expense:delete', async (_, id: string) => {
    try {
      await db.delete(schema.expense).where(eq(schema.expense.id, id))
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete expense',
      }
    }
  })

  // Total amount + count grouped by category, optionally limited to a date range.
  // Used by the page's summary cards.
  ipcMain.handle('expense:getTotals', async (_, args?: { fromDate?: string; toDate?: string }) => {
    try {
      const conds = []
      if (args?.fromDate) conds.push(gte(schema.expense.date, new Date(args.fromDate)))
      if (args?.toDate) conds.push(lte(schema.expense.date, new Date(args.toDate)))
      const where = conds.length ? and(...conds) : undefined

      const grouped = await db
        .select({
          category: schema.expense.category,
          total: sql<number>`COALESCE(SUM(${schema.expense.amount}), 0)`,
          count: sql<number>`COUNT(*)`,
        })
        .from(schema.expense)
        .where(where)
        .groupBy(schema.expense.category)
        .orderBy(asc(schema.expense.category))

      let grandTotal = 0
      let totalCount = 0
      for (const g of grouped) {
        grandTotal += g.total
        totalCount += Number(g.count)
      }
      return {
        success: true,
        data: {
          byCategory: grouped.map((g) => ({
            category: g.category,
            total: g.total,
            count: Number(g.count),
          })),
          grandTotal,
          totalCount,
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to compute totals',
      }
    }
  })
}
