import { ipcMain } from 'electron'
import { and, asc, eq, isNull, sql } from '@neu/shared'
import { getDb, schema } from '../db'
import { notDeleted } from './softDelete'

// One-shot data fix (P3): every account's typed opening/adjusted balance
// becomes a journal row, so the balance is rebuildable and mergeable. The
// deterministic id `open-<accountId>` makes BOTH devices' backfills mint the
// SAME row — sync converges to one instead of doubling the balance.
// Idempotent: skips accounts that already have their opening row.
export async function backfillBankOpeningJournals(): Promise<void> {
  const db = getDb()
  try {
    const accounts = await db
      .select({ id: schema.bankAccount.id, currentBalance: schema.bankAccount.currentBalance, createdAt: schema.bankAccount.createdAt })
      .from(schema.bankAccount)
    let created = 0
    for (const account of accounts) {
      const [existing] = await db
        .select({ id: schema.bankTransaction.id })
        .from(schema.bankTransaction)
        .where(eq(schema.bankTransaction.id, `open-${account.id}`))
        .limit(1)
      if (existing) continue
      const [sums] = await db
        .select({ total: sql<number | null>`sum(${schema.bankTransaction.amount})` })
        .from(schema.bankTransaction)
        .where(and(eq(schema.bankTransaction.bankAccountId, account.id), isNull(schema.bankTransaction.deletedAt)))
      const opening = account.currentBalance - (sums?.total ?? 0)
      if (Math.abs(opening) < 0.005) continue
      await db.insert(schema.bankTransaction).values({
        id: `open-${account.id}`,
        bankAccountId: account.id,
        amount: opening,
        description: 'Opening balance',
        transactionDate: account.createdAt,
      })
      created++
    }
    if (created > 0) console.log(`[bankJournalBackfill] recorded ${created} opening journal(s)`)
  } catch (e) {
    console.error('[bankJournalBackfill] failed, app continues:', e)
  }
}

export const setupCashBankHandlers = () => {
  const db = getDb()

  // Get all bank accounts
  ipcMain.handle('cashBank:getAll', async () => {
    try {
      const accounts = await db.select().from(schema.bankAccount).orderBy(asc(schema.bankAccount.name))
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
      const [account] = await db.select().from(schema.bankAccount).where(eq(schema.bankAccount.id, id)).limit(1)
      return { success: true, data: account ?? null }
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
      const account = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(schema.bankAccount)
          .values({
            name: data.name,
            type: data.type,
            accountNumber: data.accountNumber || null,
            bankName: data.bankName || null,
            ifscCode: data.ifscCode || null,
            currentBalance: opening
          })
          .returning()
        if (opening !== 0) {
          await tx.insert(schema.bankTransaction).values({
            id: `open-${created.id}`,
            bankAccountId: created.id,
            amount: opening,
            description: 'Opening balance',
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
      const [account] = await db
        .update(schema.bankAccount)
        .set({
          name: data.name,
          type: data.type,
          accountNumber: data.accountNumber || null,
          bankName: data.bankName || null,
          ifscCode: data.ifscCode || null
        })
        .where(eq(schema.bankAccount.id, id))
        .returning()

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
      const [account] = await db.select({ id: schema.bankAccount.id }).from(schema.bankAccount).where(eq(schema.bankAccount.id, id)).limit(1)
      if (!account) {
        return { success: false, error: 'Account not found' }
      }

      // Soft-delete: stamp deletedAt (updatedAt + hlc auto-bump). The row stays
      // put so a restore brings the account back intact.
      await db.update(schema.bankAccount).set({ deletedAt: new Date() }).where(eq(schema.bankAccount.id, id))

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
      const [account] = await db.select({ id: schema.bankAccount.id }).from(schema.bankAccount).where(eq(schema.bankAccount.id, id)).limit(1)
      if (!account) {
        return { success: false, error: 'Account not found' }
      }

      await db.update(schema.bankAccount).set({ deletedAt: null }).where(eq(schema.bankAccount.id, id))

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
      const accounts = await db.select().from(schema.bankAccount).where(notDeleted(schema.bankAccount.deletedAt))

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
      const [account] = await db.select({ id: schema.bankAccount.id }).from(schema.bankAccount).where(eq(schema.bankAccount.id, id)).limit(1)
      if (!account) {
        return { success: false, error: 'Account not found' }
      }

      const updated = await db.transaction(async (tx) => {
        await tx.insert(schema.bankTransaction).values({
          bankAccountId: id,
          amount,
          description: notes?.trim() || 'Manual adjustment',
        })
        const [row] = await tx
          .update(schema.bankAccount)
          .set({ currentBalance: sql`${schema.bankAccount.currentBalance} + ${amount}` })
          .where(eq(schema.bankAccount.id, id))
          .returning()
        return row
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
