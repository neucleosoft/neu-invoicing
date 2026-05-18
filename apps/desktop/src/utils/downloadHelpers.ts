// Multi-format download helpers used by DownloadMenu across all document pages.
// Source of truth is the generated PDF — PNG/JPEG are rasterised first pages of
// the same PDF so output stays visually identical to what the user prints.
//
// Flow: page calls generateArtifact(format, opts) → returns an Artifact with
// raw bytes + filename + (for tabular formats) the source TableData. DownloadMenu
// shows that artifact in a preview modal, then saveArtifact(a) persists it.

import { renderPdfFirstPage } from './pdfRender'

export type DownloadFormat = 'pdf' | 'png' | 'jpeg' | 'excel' | 'csv' | 'print'

export interface TableData {
  // Sheet/file base name (no extension)
  baseName: string
  // Document-level fields placed BEFORE the line-item columns in the single
  // header row. Pairs are [label, value]. Numbers preserved so Excel sees
  // real numbers (sortable/summable), not text.
  meta?: Array<[string, string | number]>
  // Document-level fields placed AFTER the line-item columns (e.g. status, totals).
  metaSuffix?: Array<[string, string | number]>
  // Column headers
  headers: string[]
  // Body rows — strings or numbers
  rows: (string | number)[][]
}

export interface DispatchOpts {
  getPdf: () => Promise<{ bytes: Uint8Array; filename: string }>
  getTable?: () => Promise<TableData>
}

export interface Artifact {
  format: DownloadFormat
  bytes: Uint8Array
  filename: string
  mime: string
  // Original tabular source for CSV/Excel — used to render the preview table.
  table?: TableData
}

const stripExt = (name: string) => name.replace(/\.[^./\\]+$/, '')

export const downloadBytes = (bytes: Uint8Array, filename: string, mime: string): void => {
  const blob = new Blob([bytes as BlobPart], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// Open the PDF in a new window and trigger the print dialog. Works in
// Chromium's PDF viewer because the embedded viewer responds to window.print().
const printPdf = (pdfBytes: Uint8Array): void => {
  const blob = new Blob([pdfBytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (!win) {
    // Popup blocked — fall back to a download so the user can print manually.
    const a = document.createElement('a')
    a.href = url
    a.download = 'document.pdf'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    return
  }
  // Give the embedded viewer time to load before printing.
  win.addEventListener('load', () => {
    try {
      win.focus()
      win.print()
    } catch {
      // Ignore — user can print manually if auto-print is blocked.
    }
  })
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// Quote a CSV field per RFC 4180 — wrap in quotes and double any embedded quotes
// when the field contains commas, quotes, or newlines.
const csvQuote = (val: string | number): string => {
  const s = String(val ?? '')
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

const buildCsvString = (data: TableData): string => {
  const lines: string[] = []
  // Flat layout: meta keys before headers, suffix keys after — all in one row;
  // each data row is wrapped with the matching meta/suffix values.
  const metaKeys = (data.meta || []).map(([k]) => k)
  const metaVals = (data.meta || []).map(([, v]) => v)
  const sufKeys = (data.metaSuffix || []).map(([k]) => k)
  const sufVals = (data.metaSuffix || []).map(([, v]) => v)

  lines.push([...metaKeys, ...data.headers, ...sufKeys].map(csvQuote).join(','))
  for (const row of data.rows) {
    if (row.length === 0) continue // skip legacy spacer rows
    lines.push([...metaVals, ...row, ...sufVals].map(csvQuote).join(','))
  }
  return lines.join('\r\n')
}

const buildExcelBytes = async (data: TableData): Promise<Uint8Array> => {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(data.baseName.slice(0, 30) || 'Sheet1')

  // Flat layout: meta keys before headers, suffix keys after — all in one row.
  const metaKeys = (data.meta || []).map(([k]) => k)
  const metaVals = (data.meta || []).map(([, v]) => v)
  const sufKeys = (data.metaSuffix || []).map(([k]) => k)
  const sufVals = (data.metaSuffix || []).map(([, v]) => v)

  const headerRow = ws.addRow([...metaKeys, ...data.headers, ...sufKeys])
  headerRow.font = { bold: true }
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } }
  })

  for (const row of data.rows) {
    if (row.length === 0) continue // skip legacy spacer rows
    ws.addRow([...metaVals, ...row, ...sufVals])
  }

  ws.columns.forEach((col) => {
    let max = 10
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? '').length
      if (len > max) max = len
    })
    col.width = Math.min(max + 2, 40)
  })

  const buffer = await wb.xlsx.writeBuffer()
  return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer)
}

// Build the artifact (bytes + metadata) for a chosen format, without saving it.
// DownloadMenu calls this to populate the preview modal; saveArtifact persists it
// when the user confirms.
export const generateArtifact = async (
  format: DownloadFormat,
  opts: DispatchOpts,
): Promise<Artifact> => {
  switch (format) {
    case 'pdf':
    case 'print': {
      const { bytes, filename } = await opts.getPdf()
      return { format, bytes, filename, mime: 'application/pdf' }
    }
    case 'png':
    case 'jpeg': {
      const { bytes: pdfBytes, filename } = await opts.getPdf()
      const imgBytes = await renderPdfFirstPage(pdfBytes, format)
      const ext = format === 'png' ? 'png' : 'jpg'
      const mime = format === 'png' ? 'image/png' : 'image/jpeg'
      return { format, bytes: imgBytes, filename: `${stripExt(filename)}.${ext}`, mime }
    }
    case 'csv': {
      if (!opts.getTable) throw new Error('CSV not supported for this document')
      const data = await opts.getTable()
      const csv = buildCsvString(data)
      // BOM so Excel opens UTF-8 CSVs without garbled accented characters.
      const bytes = new TextEncoder().encode('﻿' + csv)
      return {
        format,
        bytes,
        filename: `${stripExt(data.baseName)}.csv`,
        mime: 'text/csv;charset=utf-8',
        table: data,
      }
    }
    case 'excel': {
      if (!opts.getTable) throw new Error('Excel not supported for this document')
      const data = await opts.getTable()
      const bytes = await buildExcelBytes(data)
      return {
        format,
        bytes,
        filename: `${stripExt(data.baseName)}.xlsx`,
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        table: data,
      }
    }
  }
}

// Persist the artifact: PDF/image/csv/excel → save to disk, print → open print dialog.
export const saveArtifact = (a: Artifact): void => {
  if (a.format === 'print') {
    printPdf(a.bytes)
    return
  }
  downloadBytes(a.bytes, a.filename, a.mime)
}
