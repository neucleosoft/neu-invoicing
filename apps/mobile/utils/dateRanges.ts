// Date-range presets for report screens — the ONE copy of the period math
// (was local to reports/gst.tsx; Business Reports needed the same chips).
// Strings are local-time yyyy-mm-dd, ready for the screens' date inputs.

export type DatePreset =
  | 'today'
  | 'thisMonth'
  | 'lastMonth'
  | 'thisQuarter'
  | 'lastQuarter'
  | 'thisYear'

// Local-time yyyy-mm-dd (NOT toISOString — that shifts IST dates back a day).
export function toIsoLocal(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function presetRange(preset: DatePreset): { start: string; end: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  switch (preset) {
    case 'today':
      return { start: toIsoLocal(now), end: toIsoLocal(now) }
    case 'thisMonth':
      return { start: toIsoLocal(new Date(y, m, 1)), end: toIsoLocal(new Date(y, m + 1, 0)) }
    case 'lastMonth':
      return { start: toIsoLocal(new Date(y, m - 1, 1)), end: toIsoLocal(new Date(y, m, 0)) }
    case 'thisQuarter': {
      const q = Math.floor(m / 3)
      return { start: toIsoLocal(new Date(y, q * 3, 1)), end: toIsoLocal(new Date(y, q * 3 + 3, 0)) }
    }
    case 'lastQuarter': {
      let q = Math.floor(m / 3) - 1
      let yy = y
      if (q < 0) {
        q = 3
        yy = y - 1
      }
      return { start: toIsoLocal(new Date(yy, q * 3, 1)), end: toIsoLocal(new Date(yy, q * 3 + 3, 0)) }
    }
    case 'thisYear': {
      // Indian financial year: April 1 → March 31.
      const fy = m >= 3 ? y : y - 1
      return { start: toIsoLocal(new Date(fy, 3, 1)), end: toIsoLocal(new Date(fy + 1, 2, 31)) }
    }
  }
}
