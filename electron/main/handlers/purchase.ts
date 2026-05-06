import { ipcMain } from 'electron'
import { getPrisma } from '../database'
import { triggerSyncAfterChange } from '../sync'

// Normalize a SupplierItem name for fuzzy-but-bounded matching. Must stay in sync with
// the inline normalizer in src/pages/Purchase.tsx — the frontend pre-selects on extraction
// using this same rule, and we dedupe at save-time here. If they drift, the user sees one
// thing and gets another.
function normalizeItemName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[-/.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const purchaseBillInclude = {
  supplier: true,
  items: {
    include: {
      supplierItem: {
        include: {
          linkedItem: true
        }
      }
    }
  },
  payments: true
} as const

const purchaseBillListInclude = {
  supplier: true,
  items: {
    include: {
      supplierItem: {
        include: {
          linkedItem: true
        }
      }
    }
  }
} as const

async function resolveSupplierItem(tx: any, supplierId: string, item: any) {
  if (item.supplierItemId) {
    const supplierItem = await tx.supplierItem.findUnique({
      where: { id: item.supplierItemId },
      include: { linkedItem: true }
    })

    if (!supplierItem) {
      throw new Error('Supplier item not found')
    }

    return supplierItem
  }

  if (!item.itemId) {
    if (item._extractedName || item.name) {
      const extractedName: string = item._extractedName || item.name

      // Dedupe: AI extraction repeating across bills from the same supplier often returns the
      // same item with slight variations (whitespace, hyphen vs space, punctuation drift from PDF
      // text extraction). Without this check, every extraction creates a fresh SupplierItem row
      // for an item we already have.
      // Done in JS because SQLite's default collation is case-sensitive and the per-supplier
      // catalog is small enough that fetching all rows is cheap.
      const candidates = await tx.supplierItem.findMany({
        where: { supplierId },
        include: { linkedItem: true }
      })
      const target = normalizeItemName(extractedName)
      const existing = target
        ? candidates.find((c: any) => normalizeItemName(c.name) === target)
        : undefined
      if (existing) return existing

      return tx.supplierItem.create({
        data: {
          supplierId,
          name: extractedName,
          hsnCode: item.hsnCode || null,
          unit: 'pcs',
          lastPurchasePrice: item.rate || 0,
          defaultTaxRate: item.taxRate || 0
        },
        include: { linkedItem: true }
      })
    }

    throw new Error('Each purchase line must have a supplier item')
  }

  const supplierItemByLegacyId = await tx.supplierItem.findFirst({
    where: {
      id: item.itemId,
      supplierId
    },
    include: { linkedItem: true }
  })

  if (supplierItemByLegacyId) {
    return supplierItemByLegacyId
  }

  const linkedItem = await tx.item.findUnique({
    where: { id: item.itemId }
  })

  if (!linkedItem) {
    throw new Error('Linked item not found')
  }

  const existingSupplierItem = await tx.supplierItem.findFirst({
    where: {
      supplierId,
      linkedItemId: linkedItem.id
    },
    include: { linkedItem: true }
  })

  if (existingSupplierItem) {
    return existingSupplierItem
  }

  return tx.supplierItem.create({
    data: {
      supplierId,
      name: item._extractedName || linkedItem.name,
      hsnCode: item.hsnCode || linkedItem.hsnCode || linkedItem.skuHsn || null,
      unit: linkedItem.unit || 'pcs',
      lastPurchasePrice: item.rate || linkedItem.purchasePrice || 0,
      defaultTaxRate: item.taxRate || linkedItem.taxRate || 0,
      linkedItemId: linkedItem.id
    },
    include: { linkedItem: true }
  })
}

async function normalizePurchaseItems(tx: any, supplierId: string, items: any[]) {
  const normalizedItems: Array<{
    supplierItemId: string
    hsnCode: string
    quantity: number
    rate: number
    discount: number
    taxRate: number
    total: number
    linkedItemId: string | null
  }> = []

  for (const item of items) {
    const supplierItem = await resolveSupplierItem(tx, supplierId, item)
    const taxableAmount = item.quantity * item.rate - (item.discount || 0)

    await tx.supplierItem.update({
      where: { id: supplierItem.id },
      data: {
        hsnCode: item.hsnCode || supplierItem.hsnCode || supplierItem.linkedItem?.hsnCode || null,
        lastPurchasePrice: item.rate || 0,
        defaultTaxRate: item.taxRate || 0
      }
    })

    normalizedItems.push({
      supplierItemId: supplierItem.id,
      hsnCode: item.hsnCode || supplierItem.hsnCode || supplierItem.linkedItem?.hsnCode || supplierItem.linkedItem?.skuHsn || '',
      quantity: item.quantity,
      rate: item.rate,
      discount: item.discount || 0,
      taxRate: item.taxRate || 0,
      total: taxableAmount + (taxableAmount * (item.taxRate || 0)) / 100,
      linkedItemId: supplierItem.linkedItemId || null
    })
  }

  return normalizedItems
}

async function applyStockUpdates(tx: any, items: Array<{ linkedItemId: string | null; quantity: number; rate: number }>, referenceId: string, direction: 'increment' | 'decrement') {
  for (const item of items) {
    if (!item.linkedItemId) continue

    const linkedItem = await tx.item.findUnique({
      where: { id: item.linkedItemId }
    })

    if (!linkedItem) continue

    const updateData: any = { purchasePrice: item.rate }

    if (linkedItem.trackStock) {
      updateData.currentStock = {
        [direction]: item.quantity
      }
    }

    await tx.item.update({
      where: { id: item.linkedItemId },
      data: updateData
    })

    if (linkedItem.trackStock) {
      await tx.stockMovement.create({
        data: {
          itemId: item.linkedItemId,
          movementType: 'PURCHASE',
          quantity: direction === 'increment' ? item.quantity : -item.quantity,
          referenceType: 'BILL',
          referenceId
        }
      })
    }
  }
}

export const setupPurchaseHandlers = () => {
  const prisma = getPrisma()

  // Get all purchase bills
  ipcMain.handle('purchase:getAll', async () => {
    try {
      const bills = await prisma.purchaseBill.findMany({
        include: purchaseBillListInclude,
        orderBy: { billDate: 'desc' }
      })
      return { success: true, data: bills }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch bills'
      }
    }
  })

  // Get bill by ID
  ipcMain.handle('purchase:getById', async (_, id: string) => {
    try {
      const bill = await prisma.purchaseBill.findUnique({
        where: { id },
        include: purchaseBillInclude
      })
      return { success: true, data: bill }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch bill'
      }
    }
  })

  // Create purchase bill
  ipcMain.handle('purchase:create', async (_, data) => {
    try {
      const bill = await prisma.$transaction(async (tx: any) => {
        const supplierId = data.supplierId || data.partyId
        const normalizedItems = await normalizePurchaseItems(tx, supplierId, data.items)

        // Calculate totals
        let subtotal = 0
        let taxAmount = 0

        normalizedItems.forEach((item: any) => {
          const itemTotal = item.quantity * item.rate - (item.discount || 0)
          subtotal += itemTotal
          taxAmount += (itemTotal * (item.taxRate || 0)) / 100
        })

        const totalAmount = subtotal + taxAmount - (data.discount || 0)
        const balanceDue = totalAmount - (data.amountPaid || 0)

        // Determine status
        let status = 'DRAFT'
        if (data.amountPaid >= totalAmount) {
          status = 'PAID'
        } else if (data.amountPaid > 0) {
          status = 'PARTIAL'
        }

        const created = await tx.purchaseBill.create({
          data: {
            billNumber: data.billNumber,
            billDate: new Date(data.billDate),
            supplierId,
            // Supplier's own invoice number (e.g., "HARI-2024-001") — separate from our internal billNumber
            // which is unique-constrained. AI extraction populates this from the bill image.
            supplierInvoiceNumber: data.supplierInvoiceNumber || null,
            supplierInvoiceDate: data.supplierInvoiceDate ? new Date(data.supplierInvoiceDate) : null,
            subtotal,
            discount: data.discount || 0,
            taxAmount,
            totalAmount,
            amountPaid: data.amountPaid || 0,
            balanceDue,
            status: status as any,
            notes: data.notes,
            attachmentData: data.attachmentData ?? null,
            attachmentMimeType: data.attachmentMimeType ?? null,
            items: {
              create: normalizedItems.map((item) => ({
                supplierItemId: item.supplierItemId,
                hsnCode: item.hsnCode,
                quantity: item.quantity,
                rate: item.rate,
                discount: item.discount,
                taxRate: item.taxRate,
                total: item.total
              }))
            }
          },
          include: purchaseBillListInclude
        })

        await tx.supplier.update({
          where: { id: supplierId },
          data: { currentBalance: { increment: balanceDue } }
        })

        await applyStockUpdates(tx, normalizedItems, created.id, 'increment')

        return created
      })

      await triggerSyncAfterChange()
      return { success: true, data: bill }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to create purchase bill'
      }
    }
  })

  // Update purchase bill
  ipcMain.handle('purchase:update', async (_, id: string, data) => {
    try {
      const bill = await prisma.$transaction(async (tx: any) => {
        const existingBill = await tx.purchaseBill.findUnique({
          where: { id },
          include: {
            items: {
              include: {
                supplierItem: {
                  include: {
                    linkedItem: true
                  }
                }
              }
            }
          }
        })

        if (!existingBill) {
          throw new Error('Purchase bill not found')
        }

        const supplierId = data.supplierId || data.partyId
        const normalizedItems = await normalizePurchaseItems(tx, supplierId, data.items)

        let subtotal = 0
        let taxAmount = 0

        normalizedItems.forEach((item: any) => {
          const itemTotal = item.quantity * item.rate - (item.discount || 0)
          subtotal += itemTotal
          taxAmount += (itemTotal * (item.taxRate || 0)) / 100
        })

        const totalAmount = subtotal + taxAmount - (data.discount || 0)
        const balanceDue = totalAmount - (existingBill.amountPaid || 0)

        let status = existingBill.status
        if (existingBill.amountPaid >= totalAmount) {
          status = 'PAID'
        } else if ((existingBill.amountPaid || 0) > 0) {
          status = 'PARTIAL'
        } else {
          status = 'DRAFT'
        }

        await tx.supplier.update({
          where: { id: existingBill.supplierId },
          data: { currentBalance: { decrement: existingBill.balanceDue } }
        })

        await applyStockUpdates(
          tx,
          existingBill.items.map((item: any) => ({
            linkedItemId: item.supplierItem?.linkedItemId || null,
            quantity: item.quantity,
            rate: item.rate
          })),
          id,
          'decrement'
        )

        await tx.stockMovement.deleteMany({
          where: {
            referenceType: 'BILL',
            referenceId: id
          }
        })

        await tx.purchaseBillItem.deleteMany({
          where: { purchaseBillId: id }
        })

        const updatedBill = await tx.purchaseBill.update({
          where: { id },
          data: {
            billDate: new Date(data.billDate),
            supplierId,
            supplierInvoiceNumber: data.supplierInvoiceNumber ?? undefined,
            supplierInvoiceDate: data.supplierInvoiceDate ? new Date(data.supplierInvoiceDate) : undefined,
            subtotal,
            discount: data.discount || 0,
            taxAmount,
            totalAmount,
            balanceDue,
            status: status as any,
            notes: data.notes,
            attachmentData: data.attachmentData ?? undefined,
            attachmentMimeType: data.attachmentMimeType ?? undefined,
            items: {
              create: normalizedItems.map((item) => ({
                supplierItemId: item.supplierItemId,
                hsnCode: item.hsnCode,
                quantity: item.quantity,
                rate: item.rate,
                discount: item.discount,
                taxRate: item.taxRate,
                total: item.total
              }))
            }
          },
          include: purchaseBillListInclude
        })

        await tx.supplier.update({
          where: { id: supplierId },
          data: { currentBalance: { increment: balanceDue } }
        })

        await applyStockUpdates(tx, normalizedItems, id, 'increment')

        return updatedBill
      })

      await triggerSyncAfterChange()
      return { success: true, data: bill }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update purchase bill'
      }
    }
  })

  // Delete purchase bill
  ipcMain.handle('purchase:delete', async (_, id: string) => {
    try {
      await prisma.$transaction(async (tx: any) => {
        const bill = await tx.purchaseBill.findUnique({
          where: { id },
          include: {
            items: {
              include: {
                supplierItem: {
                  include: {
                    linkedItem: true
                  }
                }
              }
            }
          }
        })

        if (!bill) {
          throw new Error('Purchase bill not found')
        }

        await tx.supplier.update({
          where: { id: bill.supplierId },
          data: {
            currentBalance: {
              decrement: bill.balanceDue
            }
          }
        })

        await applyStockUpdates(
          tx,
          bill.items.map((item: any) => ({
            linkedItemId: item.supplierItem?.linkedItemId || null,
            quantity: item.quantity,
            rate: item.rate
          })),
          id,
          'decrement'
        )

        await tx.stockMovement.deleteMany({
          where: {
            referenceType: 'BILL',
            referenceId: id
          }
        })

        await tx.purchaseBill.delete({
          where: { id }
        })
      })

      await triggerSyncAfterChange()
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete purchase bill'
      }
    }
  })

  // Extract bill data from an uploaded image/PDF using Gemini API
  ipcMain.handle(
    'purchase:extractFromImage',
    async (_, args: { fileBytes: Uint8Array; mimeType: string }) => {
      try {
        const apiKey = process.env.GEMINI_API_KEY
        if (!apiKey) {
          return {
            success: false,
            error:
              'API key not configured. Add GEMINI_API_KEY to your .env file.',
          }
        }

        const model = process.env.GEMINI_MODEL || 'gemma-3-27b-it'

        const buffer = Buffer.from(args.fileBytes)

        // Gemma 4 vision requires the Files API (not inline_data + base64).
        // The protocol is: (1) initial resumable POST for metadata → returns an upload URL.
        //                  (2) POST the actual bytes to that URL → returns a file_uri.
        //                  (3) Reference the file_uri in generateContent via file_data.

        // Step 1a — initial resumable request
        const uploadInitResponse = await fetch(
          `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
          {
            method: 'POST',
            headers: {
              'X-Goog-Upload-Protocol': 'resumable',
              'X-Goog-Upload-Command': 'start',
              'X-Goog-Upload-Header-Content-Length': String(buffer.length),
              'X-Goog-Upload-Header-Content-Type': args.mimeType,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ file: { display_name: 'purchase-bill' } }),
          },
        )
        if (!uploadInitResponse.ok) {
          const errText = await uploadInitResponse.text()
          return {
            success: false,
            error: `Files API init failed (${uploadInitResponse.status}): ${errText.substring(0, 300)}`,
          }
        }
        const uploadUrl = uploadInitResponse.headers.get('x-goog-upload-url')
        if (!uploadUrl) {
          return { success: false, error: 'Files API did not return an upload URL' }
        }

        // Step 1b — upload the actual bytes
        const uploadResponse = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            'Content-Length': String(buffer.length),
            'X-Goog-Upload-Offset': '0',
            'X-Goog-Upload-Command': 'upload, finalize',
          },
          body: buffer,
        })
        if (!uploadResponse.ok) {
          const errText = await uploadResponse.text()
          return {
            success: false,
            error: `Files API upload failed (${uploadResponse.status}): ${errText.substring(0, 300)}`,
          }
        }
        const uploadJson: any = await uploadResponse.json()
        const fileUri: string | undefined = uploadJson?.file?.uri
        if (!fileUri) {
          return { success: false, error: 'Files API did not return a file URI' }
        }

        const prompt = `You are a strict data extractor for Indian GST purchase bills.

Extract the data from this bill image and return ONLY valid JSON in this exact format. No markdown, no code blocks, no explanations — just the JSON object.

{
  "supplierName": "string or null",
  "supplierGstin": "string or null (15-character GSTIN)",
  "billNumber": "string or null (the supplier's invoice number on the bill)",
  "billDate": "string or null (YYYY-MM-DD format)",
  "subtotal": 0,
  "taxAmount": 0,
  "totalAmount": 0,
  "cgstAmount": 0,
  "sgstAmount": 0,
  "igstAmount": 0,
  "items": [
    {
      "name": "string (item description as printed on the bill)",
      "hsnCode": "string or null",
      "quantity": 0,
      "rate": 0,
      "taxRate": 0,
      "total": 0
    }
  ]
}

Rules:
- If a field is not present in the bill, use null for strings or 0 for numbers
- Do not invent data — better to leave null than guess
- Numbers must be numbers (not strings), with no currency symbols or commas
- Dates must be YYYY-MM-DD format
- The "items" array can be empty if no line items are visible
- Return ONLY the JSON object, nothing else.`

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

        // Per Google's docs: place the IMAGE part first, TEXT prompt second.
        // Reversed order can cause smaller models to ignore the image entirely.
        // file_data references the upload from step 1; this is what Gemma 4 needs.
        const requestBody = {
          contents: [
            {
              parts: [
                {
                  file_data: {
                    mime_type: args.mimeType,
                    file_uri: fileUri,
                  },
                },
                { text: prompt },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            // Bills can have many line items; default ~1024 tokens isn't enough.
            // 8192 covers a bill with ~30+ items + Gemma's thinking preamble safely.
            maxOutputTokens: 8192,
            // No thinkingConfig — Gemma 4 26B-A4B-IT rejects any thinkingConfig param
            // (translates everything to "thinking budget" internally and 400s).
            // The model WILL produce thinking-style preamble; we extract the {...} block
            // from the response below regardless.
          },
        }

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        })

        if (!response.ok) {
          const errText = await response.text()
          return {
            success: false,
            error: `Gemini API error (${response.status}): ${errText.substring(0, 300)}`,
          }
        }

        const json: any = await response.json()

        // Defensive: response shape can vary slightly across Gemma/Gemini variants
        const text: string | undefined =
          json?.candidates?.[0]?.content?.parts?.[0]?.text

        if (!text) {
          // Surface what actually came back so we can diagnose
          const finishReason = json?.candidates?.[0]?.finishReason
          const blockReason = json?.promptFeedback?.blockReason
          const safetyRatings = json?.candidates?.[0]?.safetyRatings
          const snippet = JSON.stringify(json).substring(0, 600)
          return {
            success: false,
            error: `No text in response. finishReason=${finishReason ?? 'n/a'}, blockReason=${blockReason ?? 'n/a'}, safetyRatings=${safetyRatings ? 'present' : 'none'}. Raw: ${snippet}`,
          }
        }

        // Strip markdown code fences if the model wrapped JSON in them
        let cleaned = text
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/\s*```\s*$/i, '')
          .trim()

        // If the model added explanation around the JSON, extract just the {...} block.
        // Find the first '{' and the matching last '}' — robust against thinking/preamble text.
        const firstBrace = cleaned.indexOf('{')
        const lastBrace = cleaned.lastIndexOf('}')
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          cleaned = cleaned.substring(firstBrace, lastBrace + 1)
        }

        let extracted: any
        try {
          extracted = JSON.parse(cleaned)
        } catch (parseErr) {
          // Common cause: response was truncated by token limit, leaving JSON unclosed.
          // Show enough context (1500 chars) to diagnose.
          const tail = cleaned.substring(Math.max(0, cleaned.length - 200))
          return {
            success: false,
            error: `Could not parse response as JSON (likely truncated). Last 200 chars: ${tail}. Total length: ${cleaned.length}. Parse error: ${parseErr instanceof Error ? parseErr.message : 'unknown'}`,
          }
        }

        return { success: true, data: extracted }
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof Error ? error.message : 'Failed to extract bill data',
        }
      }
    },
  )

  // Generate bill number
  ipcMain.handle('purchase:generateBillNumber', async () => {
    try {
      const lastBill = await prisma.purchaseBill.findFirst({
        orderBy: { billNumber: 'desc' }
      })

      const year = new Date().getFullYear()
      const lastNumber = lastBill ? parseInt(lastBill.billNumber.split('-').pop() || '0') : 0
      const newBillNumber = `BILL-${year}-${String(lastNumber + 1).padStart(3, '0')}`

      return { success: true, data: newBillNumber }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to generate bill number'
      }
    }
  })
}
