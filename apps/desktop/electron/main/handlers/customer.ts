import { ipcMain } from 'electron'
import { and, asc, desc, eq, lte } from '@neu/shared'
import { getDb, schema } from '../db'
import { notCancelled, notDeleted } from './softDelete'

// Renderer payloads cross IPC as structured clones: Date objects survive, but
// an ISO string (which Prisma used to coerce silently) must become a Date
// before drizzle's prismaDate type writes it.
const asDate = (v: unknown): Date | null =>
  v == null ? null : v instanceof Date ? v : new Date(v as string)

export const setupCustomerHandlers = () => {
  const db = getDb()

  // Get all customers. The customer table is the legacy `Party` table, which
  // historically also stored suppliers (`type='SUPPLIER'`). Filter those out
  // so they don't pollute the Customers UI.
  ipcMain.handle('customer:getAll', async () => {
    try {
      const customers = await db
        .select()
        .from(schema.customer)
        .where(eq(schema.customer.type, 'CUSTOMER'))
        .orderBy(asc(schema.customer.name))
      return { success: true, data: customers }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch customers'
      }
    }
  })

  // Get customer by ID (with recent sales)
  ipcMain.handle('customer:getById', async (_, id: string) => {
    try {
      const [customer] = await db.select().from(schema.customer).where(eq(schema.customer.id, id)).limit(1)
      if (!customer) return { success: true, data: null }
      const salesInvoices = await db
        .select()
        .from(schema.salesInvoice)
        .where(eq(schema.salesInvoice.customerId, id))
        .orderBy(desc(schema.salesInvoice.invoiceDate))
        .limit(10)
      return { success: true, data: { ...customer, salesInvoices } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch customer'
      }
    }
  })

  // Create customer
  ipcMain.handle('customer:create', async (_, data) => {
    try {
      const [customer] = await db
        .insert(schema.customer)
        .values({
          name: data.name,
          type: data.type || 'CUSTOMER',
          phone: data.phone,
          email: data.email,
          billingAddress: data.billingAddress,
          shippingAddress: data.shippingAddress,
          taxId: data.taxId,
          openingBalance: data.openingBalance || 0,
          currentBalance: data.openingBalance || 0,
          stateCode: data.stateCode,
          stateName: data.stateName,
          gstType: data.gstType || 'REGULAR',
          legalName: data.legalName,
          tradeName: data.tradeName,
          gstStatus: data.gstStatus,
          city: data.city,
          district: data.district,
          pincode: data.pincode,
          fetchedFromGst: data.fetchedFromGst || false,
          lastGstFetch: asDate(data.lastGstFetch),
        })
        .returning()

      return { success: true, data: customer }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create customer'
      }
    }
  })

  // Update customer
  ipcMain.handle('customer:update', async (_, id: string, data) => {
    try {
      const [customer] = await db
        .update(schema.customer)
        .set({
          name: data.name,
          type: data.type,
          phone: data.phone,
          email: data.email,
          billingAddress: data.billingAddress,
          shippingAddress: data.shippingAddress,
          taxId: data.taxId,
          stateCode: data.stateCode,
          stateName: data.stateName,
          gstType: data.gstType,
          legalName: data.legalName,
          tradeName: data.tradeName,
          gstStatus: data.gstStatus,
          city: data.city,
          district: data.district,
          pincode: data.pincode,
          fetchedFromGst: data.fetchedFromGst,
          lastGstFetch: asDate(data.lastGstFetch),
        })
        .where(eq(schema.customer.id, id))
        .returning()

      return { success: true, data: customer }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update customer'
      }
    }
  })

  // Delete customer (soft-delete)
  ipcMain.handle('customer:delete', async (_, id: string) => {
    try {
      const [customer] = await db.select({ id: schema.customer.id }).from(schema.customer).where(eq(schema.customer.id, id)).limit(1)
      if (!customer) {
        return { success: false, error: 'Customer not found' }
      }

      // Soft-delete: stamp deletedAt (updatedAt + hlc auto-bump via the schema
      // hooks). The row and its invoices/payments/balance stay put so a
      // restore brings the customer back intact.
      await db.update(schema.customer).set({ deletedAt: new Date() }).where(eq(schema.customer.id, id))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete customer'
      }
    }
  })

  // Restore a soft-deleted customer
  ipcMain.handle('customer:restore', async (_, id: string) => {
    try {
      const [customer] = await db.select({ id: schema.customer.id }).from(schema.customer).where(eq(schema.customer.id, id)).limit(1)
      if (!customer) {
        return { success: false, error: 'Customer not found' }
      }

      await db.update(schema.customer).set({ deletedAt: null }).where(eq(schema.customer.id, id))

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to restore customer'
      }
    }
  })

  // Customer statement — chronological list of all transactions for a customer
  // within a date range, with running balance (positive = customer owes us).
  ipcMain.handle(
    'customer:getStatement',
    async (_, args: { customerId: string; fromDate: string; toDate: string }) => {
      try {
        const [customer] = await db.select().from(schema.customer).where(eq(schema.customer.id, args.customerId)).limit(1)
        if (!customer) {
          return { success: false, error: 'Customer not found' }
        }

        const from = new Date(args.fromDate)
        const to = new Date(args.toDate)
        to.setHours(23, 59, 59, 999)

        const [invoices, payments, notes] = await Promise.all([
          db
            .select({
              id: schema.salesInvoice.id,
              invoiceNumber: schema.salesInvoice.invoiceNumber,
              invoiceDate: schema.salesInvoice.invoiceDate,
              totalAmount: schema.salesInvoice.totalAmount,
            })
            .from(schema.salesInvoice)
            .where(and(
              eq(schema.salesInvoice.customerId, args.customerId),
              eq(schema.salesInvoice.type, 'INVOICE'),
              lte(schema.salesInvoice.invoiceDate, to),
              notDeleted(schema.salesInvoice.deletedAt),
              notCancelled(schema.salesInvoice.cancelledAt),
            )),
          db
            .select({
              id: schema.paymentTransaction.id,
              paymentDate: schema.paymentTransaction.paymentDate,
              amount: schema.paymentTransaction.amount,
              paymentMode: schema.paymentTransaction.paymentMode,
              salesInvoiceId: schema.paymentTransaction.salesInvoiceId,
            })
            .from(schema.paymentTransaction)
            .where(and(
              eq(schema.paymentTransaction.customerId, args.customerId),
              eq(schema.paymentTransaction.type, 'PAYMENT_IN'),
              lte(schema.paymentTransaction.paymentDate, to),
              notDeleted(schema.paymentTransaction.deletedAt),
              notCancelled(schema.paymentTransaction.cancelledAt),
            )),
          db
            .select({
              id: schema.creditDebitNote.id,
              noteNumber: schema.creditDebitNote.noteNumber,
              noteDate: schema.creditDebitNote.noteDate,
              type: schema.creditDebitNote.type,
              totalAmount: schema.creditDebitNote.totalAmount,
              referenceInvoiceId: schema.creditDebitNote.referenceInvoiceId,
            })
            .from(schema.creditDebitNote)
            .where(and(
              eq(schema.creditDebitNote.customerId, args.customerId),
              eq(schema.creditDebitNote.status, 'ACTIVE'),
              lte(schema.creditDebitNote.noteDate, to),
              notDeleted(schema.creditDebitNote.deletedAt),
              notCancelled(schema.creditDebitNote.cancelledAt),
            )),
        ])

        type Entry = {
          date: Date
          type: 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE' | 'DEBIT_NOTE'
          number: string
          particulars: string
          debit: number
          credit: number
        }

        const entries: Entry[] = []

        invoices.forEach((inv) => {
          entries.push({
            date: inv.invoiceDate,
            type: 'INVOICE',
            number: inv.invoiceNumber,
            particulars: `Invoice ${inv.invoiceNumber}`,
            debit: inv.totalAmount || 0,
            credit: 0,
          })
        })

        payments.forEach((p) => {
          entries.push({
            date: p.paymentDate,
            type: 'PAYMENT',
            number: p.id.slice(-8).toUpperCase(),
            particulars: `Payment received (${p.paymentMode})`,
            debit: 0,
            credit: p.amount || 0,
          })
        })

        notes.forEach((n) => {
          if (n.type === 'CREDIT_NOTE') {
            entries.push({
              date: n.noteDate,
              type: 'CREDIT_NOTE',
              number: n.noteNumber,
              particulars: `Credit Note ${n.noteNumber}`,
              debit: 0,
              credit: n.totalAmount || 0,
            })
          } else if (n.type === 'DEBIT_NOTE') {
            entries.push({
              date: n.noteDate,
              type: 'DEBIT_NOTE',
              number: n.noteNumber,
              particulars: `Debit Note ${n.noteNumber}`,
              debit: n.totalAmount || 0,
              credit: 0,
            })
          }
        })

        entries.sort((a, b) => a.date.getTime() - b.date.getTime())

        let openingBalance = customer.openingBalance ?? 0
        const lines: Array<Entry & { balance: number }> = []
        let running = 0

        for (const e of entries) {
          if (e.date < from) {
            openingBalance += e.debit - e.credit
          } else {
            running = (lines.length === 0 ? openingBalance : lines[lines.length - 1].balance) +
              e.debit -
              e.credit
            lines.push({ ...e, balance: running })
          }
        }

        const totalDebit = lines.reduce((s, l) => s + l.debit, 0)
        const totalCredit = lines.reduce((s, l) => s + l.credit, 0)
        const closingBalance = openingBalance + totalDebit - totalCredit

        return {
          success: true,
          data: {
            customer,
            fromDate: args.fromDate,
            toDate: args.toDate,
            openingBalance,
            lines: lines.map((l) => ({ ...l, date: l.date.toISOString() })),
            totalDebit,
            totalCredit,
            closingBalance,
          },
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to build statement',
        }
      }
    }
  )

  ipcMain.handle('customer:getLedger', async (_, id: string) => {
    try {
      const [customer] = await db.select().from(schema.customer).where(eq(schema.customer.id, id)).limit(1)
      if (!customer) return { success: true, data: null }
      const [salesInvoices, payments] = await Promise.all([
        db
          .select()
          .from(schema.salesInvoice)
          .where(and(eq(schema.salesInvoice.customerId, id), notDeleted(schema.salesInvoice.deletedAt)))
          .orderBy(desc(schema.salesInvoice.invoiceDate)),
        db
          .select()
          .from(schema.paymentTransaction)
          .where(and(eq(schema.paymentTransaction.customerId, id), notDeleted(schema.paymentTransaction.deletedAt)))
          .orderBy(desc(schema.paymentTransaction.paymentDate)),
      ])

      return { success: true, data: { ...customer, salesInvoices, payments } }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch ledger'
      }
    }
  })
}
