import JSZip from 'jszip'
import { downloadBytes, TableData } from './downloadHelpers'

export interface BulkPdfItem {
  id: string
  filename: string
}

export interface BulkDownloadResult {
  added: number
  failed: number
}

export async function bulkDownloadPdfs(args: {
  items: BulkPdfItem[]
  getBytes: (id: string) => Promise<Uint8Array | null>
  zipFilename: string
  onProgress?: (done: number, total: number) => void
}): Promise<BulkDownloadResult> {
  const { items, getBytes, zipFilename, onProgress } = args
  const zip = new JSZip()
  let added = 0
  let failed = 0

  for (const item of items) {
    try {
      const bytes = await getBytes(item.id)
      if (!bytes) {
        failed++
      } else {
        zip.file(item.filename, bytes)
        added++
      }
    } catch {
      failed++
    }
    onProgress?.(added + failed, items.length)
  }

  if (added === 0) {
    return { added, failed }
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = zipFilename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  return { added, failed }
}

// Bulk Excel export: one sheet per "section" (typically a single Summary sheet).
// Each row maps the same headers shape used by the per-document Excel export.
export interface BulkExcelSheet {
  // Sheet name (clamped to 30 chars by ExcelJS — we trim ourselves so it's predictable).
  name: string
  // Optional meta fields merged into the header row (mirror of TableData.meta).
  meta?: Array<[string, string | number]>
  headers: string[]
  rows: (string | number)[][]
}

export async function bulkDownloadExcel(args: {
  filename: string
  sheets: BulkExcelSheet[]
}): Promise<void> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()

  for (const sheet of args.sheets) {
    const ws = wb.addWorksheet((sheet.name || 'Sheet').slice(0, 30))

    const hasMeta = !!(sheet.meta && sheet.meta.length > 0)
    const metaKeys = hasMeta ? sheet.meta!.map(([k]) => k) : []
    const metaVals = hasMeta ? sheet.meta!.map(([, v]) => v) : []

    const headerRow = ws.addRow([...metaKeys, ...sheet.headers])
    headerRow.font = { bold: true }
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } }
    })

    for (const row of sheet.rows) {
      if (row.length === 0) continue
      ws.addRow([...metaVals, ...row])
    }

    ws.columns.forEach((col) => {
      let max = 10
      col.eachCell?.({ includeEmpty: false }, (cell) => {
        const len = String(cell.value ?? '').length
        if (len > max) max = len
      })
      col.width = Math.min(max + 2, 40)
    })
  }

  const buffer = await wb.xlsx.writeBuffer()
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer)
  downloadBytes(
    bytes,
    args.filename,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  )
}

// Convenience: pack a single TableData into one sheet and trigger the download.
export async function bulkDownloadSingleSheetExcel(filename: string, data: TableData): Promise<void> {
  await bulkDownloadExcel({
    filename,
    sheets: [{ name: data.baseName, meta: data.meta, headers: data.headers, rows: data.rows }],
  })
}

export function buildZipFilename(prefix: string, partyName: string, from?: string, to?: string): string {
  const safe = (s: string) => (s || '').replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')
  const today = new Date().toISOString().slice(0, 10)
  const range = from && to ? `_${from}_to_${to}` : `_${today}`
  return `${safe(prefix)}_${safe(partyName) || 'all'}${range}.zip`
}

export type BulkRange = 'all' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'

export const BULK_RANGE_OPTIONS: { value: BulkRange; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'weekly', label: 'Last 7 days' },
  { value: 'monthly', label: 'Last Month' },
  { value: 'quarterly', label: 'Last Quarter' },
  { value: 'yearly', label: 'Last Year' },
]

export function getBulkRangeStart(range: BulkRange): Date | null {
  if (range === 'all') return null
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  switch (range) {
    case 'weekly':
      start.setDate(start.getDate() - 6)
      break
    case 'monthly':
      start.setMonth(start.getMonth() - 1)
      break
    case 'quarterly':
      start.setMonth(start.getMonth() - 3)
      break
    case 'yearly':
      start.setFullYear(start.getFullYear() - 1)
      break
  }
  return start
}
