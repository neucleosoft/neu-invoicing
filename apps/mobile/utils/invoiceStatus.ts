// Mirrors apps/desktop/src/utils/invoiceStatus.ts. Same labels, same
// getDueCountdown semantics. The only mobile-specific addition is
// STATUS_BADGE_COLORS — desktop uses Tailwind classes; mobile needs plain
// RN color strings, so we map the same semantic states to hex pairs.

const LABELS: Record<string, string> = {
  DRAFT: 'Unpaid',
  PAID: 'Paid',
  PARTIAL: 'Partial',
  OVERDUE: 'Overdue',
  REVERSED: 'Reversed',
}

export const formatInvoiceStatus = (status?: string | null): string => {
  if (!status) return ''
  return LABELS[status] || status
}

export type DueCountdownTone = 'overdue' | 'today' | 'soon' | 'far'

export interface DueCountdown {
  text: string
  tone: DueCountdownTone
  days: number
}

// Returns a countdown summary for an unpaid invoice, or null if no countdown
// should be shown (already paid, no due date, etc.). `days` is positive when
// the due date is in the future, negative when past.
export const getDueCountdown = (
  dueDate: string | Date | null | undefined,
  status: string | null | undefined,
  amountPaid: number = 0,
  totalAmount: number = 0,
): DueCountdown | null => {
  if (!dueDate) return null
  if (status === 'PAID') return null
  if (totalAmount > 0 && amountPaid >= totalAmount) return null

  const due = new Date(dueDate)
  if (Number.isNaN(due.getTime())) return null
  due.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const days = Math.round(
    (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  )

  if (days < 0) {
    const n = Math.abs(days)
    return { text: `${n} day${n === 1 ? '' : 's'} overdue`, tone: 'overdue', days }
  }
  if (days === 0) return { text: 'Due today', tone: 'today', days }
  if (days <= 7)
    return { text: `Due in ${days} day${days === 1 ? '' : 's'}`, tone: 'soon', days }
  return { text: `Due in ${days} days`, tone: 'far', days }
}

// Mobile-only: hex color pairs for the status pill. Background is light/tinted,
// text is darker for contrast. Matches the semantic intent of desktop's Tailwind
// classes (bg-green-100 + text-green-700, etc.) but in RN-readable form.
export const STATUS_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  PAID: { bg: '#dcfce7', text: '#15803d' },
  PARTIAL: { bg: '#fef3c7', text: '#a16207' },
  OVERDUE: { bg: '#fee2e2', text: '#b91c1c' },
  DRAFT: { bg: '#f3f4f6', text: '#4b5563' },
  REVERSED: { bg: '#f3e8ff', text: '#7e22ce' },
}

// Map a tone from getDueCountdown to a single hex color for inline text.
export const dueCountdownColor: Record<DueCountdownTone, string> = {
  overdue: '#dc2626',
  today: '#ea580c',
  soon: '#d97706',
  far: '#6b7280',
}

// Derives the *displayed* status: an unpaid invoice past its due date should
// read OVERDUE even though the DB still has DRAFT/PARTIAL stored. Mirrors
// desktop's runtime computation; keeps the DB simple (no nightly job needed
// to bump statuses every midnight).
export const deriveDisplayStatus = (
  status: string | null | undefined,
  dueDate: string | Date | null | undefined,
  amountPaid: number = 0,
  totalAmount: number = 0,
): string => {
  if (!status) return 'DRAFT'
  // Reversed is terminal — never let the due-date branch below relabel it OVERDUE.
  if (status === 'REVERSED') return 'REVERSED'
  if (status === 'PAID') return 'PAID'
  if (totalAmount > 0 && amountPaid >= totalAmount) return 'PAID'
  if (!dueDate) return status
  const due = new Date(dueDate)
  if (Number.isNaN(due.getTime())) return status
  due.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (due.getTime() < today.getTime()) return 'OVERDUE'
  return status
}
