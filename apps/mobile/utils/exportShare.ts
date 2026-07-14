// Text-file exports through the OS share sheet — the mobile counterpart of
// desktop's CSV/Excel/JSON download buttons. CSV opens in Excel/Sheets, so a
// separate .xlsx writer isn't needed; bulk-ZIP and PNG stay desktop-only by
// design (form-factor decision, see the parity roadmap).

import * as FileSystem from 'expo-file-system/legacy'
import * as Sharing from 'expo-sharing'

export async function shareTextFile(
  filename: string,
  content: string,
  mimeType: string,
): Promise<void> {
  const uri = (FileSystem.cacheDirectory ?? '') + filename
  await FileSystem.writeAsStringAsync(uri, content)
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType, dialogTitle: `Share ${filename}` })
  }
}

// RFC-4180-ish CSV: quote when a value contains comma/quote/newline, double
// embedded quotes. \r\n line endings so Excel on Windows opens it cleanly.
export function toCsv(
  columns: { key: string; label: string }[],
  rows: Record<string, unknown>[],
): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [columns.map((c) => esc(c.label)).join(',')]
  for (const r of rows) {
    lines.push(columns.map((c) => esc(r[c.key])).join(','))
  }
  return lines.join('\r\n')
}
