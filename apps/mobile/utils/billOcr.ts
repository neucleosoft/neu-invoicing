import * as SecureStore from 'expo-secure-store'

// Mobile port of the OpenRouter OCR path in desktop's handlers/purchase.ts.
// Desktop can also use Gemini, but that needs the Files API (three round trips)
// and a Google key; OpenRouter is one fetch with a base64 data URL and a free
// OCR-specialized default model, which fits a phone far better. Same prompt and
// same JSON-extraction rules as desktop so a bill scanned on either reads the
// same way.

const OPENROUTER_KEY_STORE = 'neu.openrouter.apiKey'
const DEFAULT_MODEL = 'baidu/qianfan-ocr-fast:free'

// SecureStore mirrors how the Google token is kept (auth/index.ts). The key is
// a credential, so it never lands in the SQLite db or the Drive backup.
export async function getOpenRouterKey(): Promise<string | null> {
  return SecureStore.getItemAsync(OPENROUTER_KEY_STORE)
}

export async function setOpenRouterKey(key: string): Promise<void> {
  const trimmed = key.trim()
  if (trimmed) {
    await SecureStore.setItemAsync(OPENROUTER_KEY_STORE, trimmed)
  } else {
    await SecureStore.deleteItemAsync(OPENROUTER_KEY_STORE)
  }
}

// One extracted line from the bill. Matches the shape desktop's prompt asks for.
export type ExtractedItem = {
  name: string
  hsnCode: string | null
  quantity: number
  rate: number
  taxRate: number
  total: number
}

export type ExtractedBill = {
  supplierName: string | null
  supplierGstin: string | null
  billNumber: string | null
  billDate: string | null
  subtotal: number
  taxAmount: number
  totalAmount: number
  cgstAmount: number
  sgstAmount: number
  igstAmount: number
  items: ExtractedItem[]
}

export type OcrResult =
  | { success: true; data: ExtractedBill }
  | { success: false; error: string }

// Verbatim from desktop handlers/purchase.ts so extraction behaves identically.
const OCR_PROMPT = `You are a strict data extractor for Indian GST purchase bills.

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
- TAX HANDLING: only set per-item "taxRate" when the bill shows a tax %
  column (or per-line CGST/SGST/IGST values) for each line item. When the
  bill shows tax only as a single total at the bottom (no per-item tax
  column), leave every item's "taxRate" at 0 and put the total tax into
  "taxAmount" (and split into cgst/sgst/igst when those line items exist).
  Do not distribute a bottom-line tax across items.
- Return ONLY the JSON object, nothing else.`

// Strip markdown fences / preamble, then JSON.parse the first {...} block.
// Same robustness trick as desktop: models love wrapping output in ```json.
function parseExtractedJson(text: string): OcrResult {
  let cleaned = text
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first !== -1 && last > first) {
    cleaned = cleaned.substring(first, last + 1)
  }
  try {
    const raw = JSON.parse(cleaned)
    // Coerce to our shape defensively — the model can omit fields or send the
    // wrong type, and we don't want a stray string crashing the form.
    const items: ExtractedItem[] = Array.isArray(raw.items)
      ? raw.items.map((it: any) => ({
          name: typeof it?.name === 'string' ? it.name : '',
          hsnCode: typeof it?.hsnCode === 'string' ? it.hsnCode : null,
          quantity: Number(it?.quantity) || 0,
          rate: Number(it?.rate) || 0,
          taxRate: Number(it?.taxRate) || 0,
          total: Number(it?.total) || 0,
        }))
      : []
    return {
      success: true,
      data: {
        supplierName: typeof raw.supplierName === 'string' ? raw.supplierName : null,
        supplierGstin: typeof raw.supplierGstin === 'string' ? raw.supplierGstin : null,
        billNumber: typeof raw.billNumber === 'string' ? raw.billNumber : null,
        billDate: typeof raw.billDate === 'string' ? raw.billDate : null,
        subtotal: Number(raw.subtotal) || 0,
        taxAmount: Number(raw.taxAmount) || 0,
        totalAmount: Number(raw.totalAmount) || 0,
        cgstAmount: Number(raw.cgstAmount) || 0,
        sgstAmount: Number(raw.sgstAmount) || 0,
        igstAmount: Number(raw.igstAmount) || 0,
        items,
      },
    }
  } catch {
    return {
      success: false,
      error: 'Could not read the bill — the AI response was not valid data. Try a clearer photo.',
    }
  }
}

// Send a base64 image to OpenRouter and extract the bill. `base64` is the raw
// string (no data: prefix); `mimeType` like "image/jpeg".
export async function extractBillFromImage(
  base64: string,
  mimeType: string,
): Promise<OcrResult> {
  const apiKey = await getOpenRouterKey()
  if (!apiKey) {
    return {
      success: false,
      error:
        'No OpenRouter API key set. Add a free key in Settings → AI Bill Scan to use this.',
    }
  }

  const dataUrl = `data:${mimeType};base64,${base64}`

  let res: Response
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              // Image part FIRST — Qianfan/Gemini reject the message when text
              // precedes the image. Same ordering as desktop.
              { type: 'image_url', image_url: { url: dataUrl } },
              { type: 'text', text: OCR_PROMPT },
            ],
          },
        ],
        max_tokens: 8192,
      }),
    })
  } catch (e) {
    return {
      success: false,
      error: `Network error reaching OpenRouter: ${e instanceof Error ? e.message : 'unknown'}`,
    }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    return {
      success: false,
      error: `OpenRouter error (${res.status}): ${errText.slice(0, 200)}`,
    }
  }

  const json: any = await res.json().catch(() => null)
  const text: string | undefined = json?.choices?.[0]?.message?.content
  if (!text) {
    return { success: false, error: 'OpenRouter returned an empty response.' }
  }

  return parseExtractedJson(text)
}
