import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { notDeleted } from './softDelete'

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

  // Create account
  ipcMain.handle('cashBank:create', async (_, data) => {
    try {
      const account = await prisma.bankAccount.create({
        data: {
          name: data.name,
          type: data.type,
          accountNumber: data.accountNumber || null,
          bankName: data.bankName || null,
          ifscCode: data.ifscCode || null,
          currentBalance: data.currentBalance || 0
        }
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

      await prisma.bankAccount.delete({
        where: { id }
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete account'
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

  // Adjust balance (increment or decrement)
  ipcMain.handle('cashBank:adjustBalance', async (_, id: string, amount: number, _notes?: string) => {
    try {
      const account = await prisma.bankAccount.findUnique({
        where: { id }
      })

      if (!account) {
        return { success: false, error: 'Account not found' }
      }

      const updated = await prisma.bankAccount.update({
        where: { id },
        data: {
          currentBalance: { increment: amount }
        }
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
