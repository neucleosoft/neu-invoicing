// "DD MMM YYYY" date formatter for list rows and detail screens. Accepts a
// Date or an ISO string (the format Drizzle's isoDate columns return). Desktop
// inlines its date formatters per-component; mobile centralizes here because
// Items / Customers / Invoices detail screens all need the same shape.

export const formatDate = (d: Date | string): string => {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
