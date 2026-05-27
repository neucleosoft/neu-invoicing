import { ipcMain } from 'electron'
import { getPrisma } from '../database'

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

// Columns sent to the renderer — everything except the receiptData BLOB so
// listing all expenses doesn't ship MB of file bytes over IPC. The renderer
// fetches the bytes on demand via expense:getReceipt.
const expenseSelectNoBlob = {
  id: true,
  date: true,
  category: true,
  description: true,
  amount: true,
  paymentMode: true,
  notes: true,
  receiptMimeType: true,
  receiptFileName: true,
  createdAt: true,
  updatedAt: true,
} as const

export const setupExpenseHandlers = () => {
  const prisma = getPrisma()

  ipcMain.handle('expense:getAll', async () => {
    try {
      const rows = await prisma.expense.findMany({
        select: expenseSelectNoBlob,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      })
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
      const row = await prisma.expense.findUnique({
        where: { id },
        select: expenseSelectNoBlob,
      })
      return { success: true, data: row }
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
      const row = await prisma.expense.findUnique({
        where: { id },
        select: { receiptData: true, receiptMimeType: true, receiptFileName: true },
      })
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

      const row = await prisma.expense.create({
        data: {
          date: expenseDate,
          category: data.category,
          description: data.description,
          amount: data.amount,
          paymentMode: data.paymentMode || 'CASH',
          notes: data.notes ?? null,
          receiptData: data.receiptData ? toBuffer(data.receiptData) : null,
          receiptMimeType: data.receiptMimeType ?? null,
          receiptFileName: data.receiptFileName ?? null,
        },
        select: expenseSelectNoBlob,
      })
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
      const patch: any = {}
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
      const row = await prisma.expense.update({
        where: { id },
        data: patch,
        select: expenseSelectNoBlob,
      })
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
      await prisma.expense.delete({ where: { id } })
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
      const where: any = {}
      if (args?.fromDate || args?.toDate) {
        where.date = {}
        if (args.fromDate) where.date.gte = new Date(args.fromDate)
        if (args.toDate) where.date.lte = new Date(args.toDate)
      }
      const grouped = await prisma.expense.groupBy({
        by: ['category'],
        where,
        _sum: { amount: true },
        _count: { _all: true },
      })
      const totalAgg = await prisma.expense.aggregate({
        where,
        _sum: { amount: true },
        _count: { _all: true },
      })
      return {
        success: true,
        data: {
          byCategory: grouped.map((g) => ({
            category: g.category,
            total: g._sum.amount ?? 0,
            count: g._count._all,
          })),
          grandTotal: totalAgg._sum.amount ?? 0,
          totalCount: totalAgg._count._all,
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
