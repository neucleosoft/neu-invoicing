// Maps the internal SalesInvoice.status enum to a user-facing label.
// DRAFT is shown as "Unpaid" because that's what end users see it as
// in everyday usage — the underlying value stays "DRAFT" in the DB.
const LABELS: Record<string, string> = {
  DRAFT: 'Unpaid',
  PAID: 'Paid',
  PARTIAL: 'Partial',
  OVERDUE: 'Overdue',
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
  totalAmount: number = 0
): DueCountdown | null => {
  if (!dueDate) return null
  if (status === 'PAID') return null
  // Treat any invoice with no balance remaining as paid (defensive — sometimes
  // status hasn't been bumped after a final payment).
  if (totalAmount > 0 && amountPaid >= totalAmount) return null

  const due = new Date(dueDate)
  due.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const days = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  if (days < 0) {
    const n = Math.abs(days)
    return { text: `${n} day${n === 1 ? '' : 's'} overdue`, tone: 'overdue', days }
  }
  if (days === 0) return { text: 'Due today', tone: 'today', days }
  if (days <= 7) return { text: `Due in ${days} day${days === 1 ? '' : 's'}`, tone: 'soon', days }
  return { text: `Due in ${days} days`, tone: 'far', days }
}

export const dueCountdownColorClass: Record<DueCountdownTone, string> = {
  overdue: 'text-red-600 dark:text-red-400',
  today: 'text-orange-600 dark:text-orange-400',
  soon: 'text-amber-600 dark:text-amber-400',
  far: 'text-gray-500 dark:text-gray-400',
}
