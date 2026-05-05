import JSZip from 'jszip'

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
