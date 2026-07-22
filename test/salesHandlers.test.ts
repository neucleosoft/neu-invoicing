import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock the Electron main / Prisma boundary. The real handler logic
// (normalization, duplicate check, GST/total calculation) runs against fakes
// so we never touch Electron IPC or a real database.
const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  state: { tx: null as any }
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: any[]) => any) => {
      h.handlers.set(channel, fn)
    }
  }
}))

vi.mock('../electron/main/sync', () => ({
  triggerSyncAfterChange: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('../electron/main/database', () => ({
  getPrisma: () => ({
    $transaction: async (cb: (tx: any) => any) => cb(h.state.tx)
  })
}))

import { setupSalesHandlers } from '../electron/main/handlers/sales'

const invoke = (channel: string, ...args: any[]) => {
  const fn = h.handlers.get(channel)
  if (!fn) throw new Error(`handler not registered: ${channel}`)
  return fn({}, ...args)
}

beforeEach(() => {
  h.handlers.clear()
  h.state.tx = null
  setupSalesHandlers()
})

describe('sales:create — duplicate invoice-number validation', () => {
  it('rejects a create whose normalized number already exists', async () => {
    h.state.tx = {
      salesInvoice: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'existing', invoiceNumber: 'NS/SL/26-27/06' })
      }
    }

    // Input uses the unpadded "/6" — normalization must collapse it to "/06"
    const res = await invoke('sales:create', {
      invoiceNumber: 'NS/SL/26-27/6',
      partyId: 'p1',
      items: []
    })

    expect(res.success).toBe(false)
    expect(res.error).toBe('Invoice number NS/SL/26-27/06 already exists')
    // The duplicate lookup must have used the normalized key
    expect(h.state.tx.salesInvoice.findUnique).toHaveBeenCalledWith({
      where: { invoiceNumber: 'NS/SL/26-27/06' }
    })
  })
})

describe('sales:create — persists computed GST totals', () => {
  it('creates an intra-state invoice with correct subtotal, tax and totals', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'inv1' })
    h.state.tx = {
      salesInvoice: {
        findUnique: vi.fn().mockResolvedValue(null),
        create
      },
      party: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'p1',
          stateCode: '27',
          stateName: 'Maharashtra',
          taxId: null
        }),
        update: vi.fn().mockResolvedValue({})
      },
      company: {
        findFirst: vi.fn().mockResolvedValue({ stateCode: '27', stateName: 'Maharashtra' })
      },
      item: {
        findUnique: vi.fn().mockResolvedValue({ id: 'i1', trackStock: false, hsnCode: '1234' })
      },
      stockMovement: { create: vi.fn() }
    }

    const res = await invoke('sales:create', {
      invoiceNumber: 'NS/SL/26-27/9',
      invoiceDate: '2026-07-22',
      type: 'INVOICE',
      partyId: 'p1',
      items: [{ itemId: 'i1', quantity: 2, rate: 500, taxRate: 18 }]
    })

    expect(res.success).toBe(true)
    const payload = create.mock.calls[0][0].data
    expect(payload.invoiceNumber).toBe('NS/SL/26-27/09') // normalized
    expect(payload.subtotal).toBe(1000)
    expect(payload.taxAmount).toBe(180)
    expect(payload.cgstAmount).toBe(90)
    expect(payload.sgstAmount).toBe(90)
    expect(payload.igstAmount).toBe(0)
    expect(payload.totalAmount).toBe(1180)
    expect(payload.balanceDue).toBe(1180)
    expect(payload.isInterState).toBe(false)
    expect(payload.supplyType).toBe('B2C_SMALL')
  })

  it('routes tax to IGST for an inter-state supply', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'inv2' })
    h.state.tx = {
      salesInvoice: {
        findUnique: vi.fn().mockResolvedValue(null),
        create
      },
      party: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'p2',
          stateCode: '07',
          stateName: 'Delhi',
          taxId: null
        }),
        update: vi.fn().mockResolvedValue({})
      },
      company: {
        findFirst: vi.fn().mockResolvedValue({ stateCode: '27', stateName: 'Maharashtra' })
      },
      item: {
        findUnique: vi.fn().mockResolvedValue({ id: 'i1', trackStock: false })
      },
      stockMovement: { create: vi.fn() }
    }

    const res = await invoke('sales:create', {
      invoiceNumber: 'NS/SL/26-27/10',
      invoiceDate: '2026-07-22',
      type: 'QUOTATION',
      partyId: 'p2',
      items: [{ itemId: 'i1', quantity: 3, rate: 100, taxRate: 5 }]
    })

    expect(res.success).toBe(true)
    const payload = create.mock.calls[0][0].data
    expect(payload.isInterState).toBe(true)
    expect(payload.igstAmount).toBe(15)
    expect(payload.cgstAmount).toBe(0)
    expect(payload.sgstAmount).toBe(0)
    expect(payload.totalAmount).toBe(315)
  })
})
