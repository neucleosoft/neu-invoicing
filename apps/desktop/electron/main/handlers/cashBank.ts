import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { notDeleted } from './softDelete'

// One-shot data fix (P3): every account's typed opening/adjusted balance
// becomes a journal row, so the balance is rebuildable and mergeable. The
// deterministic id `open-<accountId>` makes BOTH devices' backfills mint the
// SAME row — sync converges to one instead of doubling the balance.
// Idempotent: skips accounts that already have their opening row.
export async function backfillBankOpeningJournals(): Promise<void> {
  const prisma = getPrisma()
  try {
    const accounts = await prisma.bankAccount.findMany({
      select: { id: true, currentBalance: true, createdAt: true },
    })
    let created = 0
    for (const account of accounts) {
      const existing = await prisma.bankTransaction.findUnique({ where: { id: `open-${account.id}` } })
      if (existing) continue
      const sums = await prisma.bankTransaction.aggregate({
        where: { bankAccountId: account.id, deletedAt: null },
        _sum: { amount: true },
      })
      const opening = account.currentBalance - (sums._sum.amount ?? 0)
      if (Math.abs(opening) < 0.005) continue
      await prisma.bankTransaction.create({
        data: {
          id: `open-${account.id}`,
          bankAccountId: account.id,
          amount: opening,
          description: 'Opening balance',
          transactionDate: account.createdAt,
        },
      })
      created++
    }
    if (created > 0) console.log(`[bankJournalBackfill] recorded ${created} opening journal(s)`)
  } catch (e) {
    console.error('[bankJournalBackfill] failed, app continues:', e)
  }
}

export const setupCashBankHandlers = () => {
  const prisma = getPrisma()

  // Get all bank accounts
  ipcMain.handle('cashBank:getAll', async () => {
    try {
      const accounts = await prisma.bankAccount.findMany({
        orderBy: { name: 'asc' }
      })
      return { success: true, data: accounts }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch accounts'
      }
    }
  })

  // Get account by ID
  ipcMain.handle('cashBank:getById', async (_, id: string) => {
    try {
      const account = await prisma.bankAccount.findUnique({
        where: { id }
      })
      return { success: true, data: account }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch account'
      }
    }
  })

  // Create account. The typed opening balance becomes a JOURNAL row (P3) with
  // the deterministic id open-<accountId>, so the balance is rebuildable and
  // a dual-device replay of this account converges to one opening entry.
  ipcMain.handle('cashBank:create', async (_, data) => {
    try {
      const opening = data.currentBalance || 0
      const account = await prisma.$transaction(async (tx: any) => {
        const created = await tx.bankAccount.create({
          data: {
            name: data.name,
            type: data.type,
            accountNumber: data.accountNumber || null,
            bankName: data.bankName || null,
            ifscCode: data.ifscCode || null,
            currentBalance: opening
          }
        })
        if (opening !== 0) {
          await tx.bankTransaction.create({
            data: {
              id: `open-${created.id}`,
              bankAccountId: created.id,
              amount: opening,
              description: 'Opening balance',
            }
          })
        }
        return created
      })

      return { success: true, data: account }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create account'
      }
    }
  })

  // Update account
  ipcMain.handle('cashBank:update', async (_, id: string, data) => {
    try {
      const account = await prisma.bankAccount.update({
        where: { id },
        data: {
          name: data.name,
          type: data.type,
          accountNumber: data.accountNumber || null,
          bankName: data.bankName || null,
          ifscCode: data.ifscCode || null
        }
      })

      return { success: true, data: account }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update account'
      }
    }
  })

  // Delete account
  ipcMain.handle('cashBank:delete', async (_, id: string) => {
    try {
      const account = await prisma.bankAccount.findUnique({
        where: { id }
      })

      if (!account) {
        return { success: false, error: 'Account not found' }
      }

      // Soft-delete: stamp deletedAt (updatedAt auto-bumps). The row stays put so
      // a restore brings the account back intact.
      await prisma.bankAccount.update({
        where: { id },
        data: { deletedAt: new Date() }
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete account'
      }
    }
  })

  // Restore account
  ipcMain.handle('cashBank:restore', async (_, id: string) => {
    try {
      const account = await prisma.bankAccount.findUnique({
        where: { id }
      })

      if (!account) {
        return { success: false, error: 'Account not found' }
      }

      await prisma.bankAccount.update({
        where: { id },
        data: { deletedAt: null }
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restore account'
      }
    }
  })

  // Get total balance (cash, bank, total)
  ipcMain.handle('cashBank:getTotalBalance', async () => {
    try {
      const accounts = await prisma.bankAccount.findMany({ where: { ...notDeleted } })

      let cash = 0
      let bank = 0

      for (const account of accounts) {
        if (account.type === 'CASH') {
          cash += account.currentBalance
        } else if (account.type === 'BANK') {
          bank += account.currentBalance
        }
      }

      return {
        success: true,
        data: {
          cash,
          bank,
          total: cash + bank
        }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch total balance'
      }
    }
  })

  // Adjust balance (increment or decrement). Every adjustment is a JOURNAL
  // row (P3) — two devices adjusting offline become two rows that both
  // survive the merge; the stored column stays live for reads and recompute
  // rebuilds it from the journal after any sync.
  ipcMain.handle('cashBank:adjustBalance', async (_, id: string, amount: number, notes?: string) => {
    try {
      const account = await prisma.bankAccount.findUnique({
        where: { id }
      })

      if (!account) {
        return { success: false, error: 'Account not found' }
      }

      const updated = await prisma.$transaction(async (tx: any) => {
        await tx.bankTransaction.create({
          data: {
            bankAccountId: id,
            amount,
            description: notes?.trim() || 'Manual adjustment',
          }
        })
        return tx.bankAccount.update({
          where: { id },
          data: { currentBalance: { increment: amount } }
        })
      })

      return { success: true, data: updated }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to adjust balance'
      }
    }
  })
}
