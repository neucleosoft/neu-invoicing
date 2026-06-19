import { ipcMain } from 'electron'
import { getPrisma } from '../database'

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
  payments: true,
  // Surface the linked PO summary so the bill view modal can show "Issued against PO-N"
  purchaseOrder: { select: { id: true, orderNumber: true, orderDate: true, status: true } }
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
  },
  // Same summary on list rows so the bills table can show a "PO" tag inline
  purchaseOrder: { select: { id: true, orderNumber: true } }
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

// ─── OCR extraction (shared across providers) ──────────────────────────────────

const OCR_PROMPT = `You are a strict data extractor for Indian GST purchase bills.

Extract the data from this bill image and return ONLY valid JSON in this exact format. No markdown, no code blocks, no explanations — just the JSON object.

{
  "supplierName": "string or null",
  "supplierGstin": "string or null (15-character GSTIN)",
  "supplierAddress": "string or null (full address as printed on the bill, may span multiple lines)",
  "supplierCity": "string or null",
  "supplierPincode": "string or null (6-digit Indian PIN code)",
  "supplierPhone": "string or null",
  "supplierEmail": "string or null",
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
- TAX HANDLING: only set per-item "taxRate" when the bill shows a tax %
  column (or per-line CGST/SGST/IGST values) for each line item. When the
  bill shows tax only as a single total at the bottom (no per-item tax
  column), leave every item's "taxRate" at 0 and put the total tax into
  "taxAmount" (and split into cgst/sgst/igst when those line items exist).
  Do not distribute a bottom-line tax across items.
- Return ONLY the JSON object, nothing else.`

type OcrResult =
  | { success: true; data: any }
  | { success: false; error: string }

// Strip markdown fences and thinking-style preamble from a model response, then JSON.parse.
// Models often wrap output in ```json ... ``` or add explanation text before the {...} block —
// extracting the first '{' to the last '}' is robust against both.
function parseExtractedJson(text: string): OcrResult {
  let cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  const firstBrace = cleaned.indexOf('{')
  const lastBrace = cleaned.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1)
  }
  try {
    return { success: true, data: JSON.parse(cleaned) }
  } catch (parseErr) {
    const tail = cleaned.substring(Math.max(0, cleaned.length - 200))
    return {
      success: false,
      error: `Could not parse response as JSON (likely truncated). Last 200 chars: ${tail}. Total length: ${cleaned.length}. Parse error: ${parseErr instanceof Error ? parseErr.message : 'unknown'}`,
    }
  }
}

// Extract bill data via Google Gemini Files API. Required by gemma-3-27b-it which doesn't
// accept inline_data + base64. Three round trips: upload init → upload bytes → generateContent.
async function extractWithGemini(args: { fileBytes: Uint8Array; mimeType: string }): Promise<OcrResult> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return {
      success: false,
      error: 'GEMINI_API_KEY not configured. Add it to .env, or switch OCR_PROVIDER to "openrouter".',
    }
  }

  const model = process.env.GEMINI_MODEL || 'gemma-3-27b-it'
  const buffer = Buffer.from(args.fileBytes)

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

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  // Per Google's docs: place the IMAGE part first, TEXT prompt second — reversed order can
  // cause smaller models to ignore the image entirely.
  const requestBody = {
    contents: [
      {
        parts: [
          { file_data: { mime_type: args.mimeType, file_uri: fileUri } },
          { text: OCR_PROMPT },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
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
  const text: string | undefined = json?.candidates?.[0]?.content?.parts?.[0]?.text

  if (!text) {
    const finishReason = json?.candidates?.[0]?.finishReason
    const blockReason = json?.promptFeedback?.blockReason
    const safetyRatings = json?.candidates?.[0]?.safetyRatings
    const snippet = JSON.stringify(json).substring(0, 600)
    return {
      success: false,
      error: `No text in Gemini response. finishReason=${finishReason ?? 'n/a'}, blockReason=${blockReason ?? 'n/a'}, safetyRatings=${safetyRatings ? 'present' : 'none'}. Raw: ${snippet}`,
    }
  }

  return parseExtractedJson(text)
}

// Extract bill data via OpenRouter (OpenAI-compatible chat completions). Default model is
// baidu/qianfan-ocr-fast:free — an OCR-specialized vision model with $0 token cost.
// Image is inlined as a base64 data URL: one HTTP round trip vs Gemini's three.
async function extractWithOpenRouter(args: { fileBytes: Uint8Array; mimeType: string }): Promise<OcrResult> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return {
      success: false,
      error: 'OPENROUTER_API_KEY not configured. Sign up at openrouter.ai, get a key, and add OPENROUTER_API_KEY=... to your .env file.',
    }
  }

  // Qianfan-OCR-Fast (and most multimodal models on OpenRouter) only accept image inputs,
  // not PDFs. If the user uploaded a PDF, surface a clear hint instead of a cryptic 400.
  if (!args.mimeType.startsWith('image/')) {
    return {
      success: false,
      error: `OpenRouter OCR providers only accept image files (PNG, JPEG, WebP). Got "${args.mimeType}". Convert PDF pages to images first, or switch back to OCR_PROVIDER=gemini for PDF support.`,
    }
  }

  const model = process.env.OPENROUTER_MODEL || 'baidu/qianfan-ocr-fast:free'
  const dataUrl = `data:${args.mimeType};base64,${Buffer.from(args.fileBytes).toString('base64')}`

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            // Image part FIRST — Baidu Qianfan (and Gemini) reject the multi-part message
            // when text comes before the image.
            { type: 'image_url', image_url: { url: dataUrl } },
            { type: 'text', text: OCR_PROMPT },
          ],
        },
      ],
      max_tokens: 8192,
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    return {
      success: false,
      error: `OpenRouter API error (${response.status}): ${errText.substring(0, 500)}`,
    }
  }

  const json: any = await response.json()
  const text: string | undefined = json?.choices?.[0]?.message?.content

  if (!text) {
    const snippet = JSON.stringify(json).substring(0, 600)
    return {
      success: false,
      error: `No text in OpenRouter response. Raw: ${snippet}`,
    }
  }

  return parseExtractedJson(text)
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
        let computedTax = 0

        normalizedItems.forEach((item: any) => {
          const itemTotal = item.quantity * item.rate - (item.discount || 0)
          subtotal += itemTotal
          computedTax += (itemTotal * (item.taxRate || 0)) / 100
        })

        // Bill-level tax override: when the original bill shows tax only as a
        // single total (no per-item tax column), the renderer sends the explicit
        // `taxAmount` and leaves item.taxRate at 0. Honor it here so totals
        // match the source document.
        const taxOverrideProvided =
          typeof data.taxAmount === 'number' && Number.isFinite(data.taxAmount) && data.taxAmount >= 0
        const taxAmount = taxOverrideProvided ? data.taxAmount : computedTax

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
            // Optional link back to the originating Purchase Order. If set, the PO is
            // closed below once at least one bill exists against it. Bills can also be
            // standalone (no PO) for cash purchases / walk-in suppliers.
            purchaseOrderId: data.purchaseOrderId || null,
            subtotal,
            discount: data.discount || 0,
            taxAmount,
            cgstAmount: data.cgstAmount || 0,
            sgstAmount: data.sgstAmount || 0,
            igstAmount: data.igstAmount || 0,
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

        // If this bill references a PO, mark that PO as CLOSED now that the
        // financial side is recorded. Future bills referencing the same PO are
        // still allowed (split deliveries) — closing just signals "no more
        // expected." Manual reopen would require an explicit status update.
        if (data.purchaseOrderId) {
          await tx.purchaseOrder.update({
            where: { id: data.purchaseOrderId },
            data: { status: 'CLOSED' },
          })
        }

        return created
      })

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
        let computedTax = 0

        normalizedItems.forEach((item: any) => {
          const itemTotal = item.quantity * item.rate - (item.discount || 0)
          subtotal += itemTotal
          computedTax += (itemTotal * (item.taxRate || 0)) / 100
        })

        const taxOverrideProvided =
          typeof data.taxAmount === 'number' && Number.isFinite(data.taxAmount) && data.taxAmount >= 0
        const taxAmount = taxOverrideProvided ? data.taxAmount : computedTax

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
            // Allow updating the PO link (or clearing it) on edit
            purchaseOrderId: data.purchaseOrderId ?? undefined,
            subtotal,
            discount: data.discount || 0,
            taxAmount,
            cgstAmount: data.cgstAmount ?? 0,
            sgstAmount: data.sgstAmount ?? 0,
            igstAmount: data.igstAmount ?? 0,
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

      return { success: true, data: bill }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update purchase bill'
      }
    }
  })

  // Cancel purchase bill (Mode B): reverse the supplier balance + stock, then stamp
  // cancelledAt. applyStockUpdates('decrement') APPENDS the reversing movements; we do
  // NOT deleteMany — cancel preserves the record and a deleted movement can't sync.
  // Terminal — there is no restore.
  ipcMain.handle('purchase:cancel', async (_, id: string) => {
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

        // Already cancelled — never reverse the balance/stock twice (idempotency guard).
        if (bill.cancelledAt) {
          return
        }

        await tx.supplier.update({
          where: { id: bill.supplierId },
          data: {
            currentBalance: {
              decrement: bill.balanceDue
            }
          }
        })

        // Reverse stock AND append the reversing movements (direction 'decrement'
        // inserts -qty PURCHASE rows). The original +qty rows and these reversals both
        // stay — net zero, append-only, sync-safe. No deleteMany.
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

        // CANCEL, not delete: stamp cancelledAt; the bill, its items, and its stock
        // movements all stay on record.
        await tx.purchaseBill.update({
          where: { id },
          data: { cancelledAt: new Date() }
        })
      })

      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to cancel purchase bill'
      }
    }
  })

  // Extract bill data from an uploaded image/PDF. Provider is selected via OCR_PROVIDER env var:
  //   OCR_PROVIDER=gemini      → Google Gemini Files API (default, requires GEMINI_API_KEY)
  //   OCR_PROVIDER=openrouter  → OpenRouter chat completions (requires OPENROUTER_API_KEY,
  //                              defaults to baidu/qianfan-ocr-fast:free — OCR-specialized,
  //                              free, single round trip vs Gemini's three).
  ipcMain.handle(
    'purchase:extractFromImage',
    async (_, args: { fileBytes: Uint8Array; mimeType: string }) => {
      try {
        const provider = (process.env.OCR_PROVIDER || 'gemini').toLowerCase()
        if (provider === 'openrouter') {
          return await extractWithOpenRouter(args)
        }
        return await extractWithGemini(args)
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to extract bill data',
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
