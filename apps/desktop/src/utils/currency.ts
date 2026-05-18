// Currency formatting utility

export const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$'
}

export const DEFAULT_CURRENCY = 'INR'

export const getCurrencySymbol = (currency?: string): string => {
  return CURRENCY_SYMBOLS[currency || DEFAULT_CURRENCY] || '₹'
}

export const formatCurrency = (amount: number, currency?: string): string => {
  const symbol = getCurrencySymbol(currency)
  return `${symbol}${amount.toFixed(2)}`
}
