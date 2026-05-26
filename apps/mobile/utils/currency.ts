// Currency formatting utility. Mirrors apps/desktop/src/utils/currency.ts —
// same exports, same signatures — so call sites are portable across the two
// apps. The mobile implementation uses 'en-IN' locale to render lakh/crore
// separators correctly (₹1,23,456.00); desktop currently emits ₹123456.00
// without separators, which should be upgraded to match this version later.

export const CURRENCY_SYMBOLS: Record<string, string> = {
  INR: '₹',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$',
}

export const DEFAULT_CURRENCY = 'INR'

export const getCurrencySymbol = (currency?: string): string => {
  return CURRENCY_SYMBOLS[currency || DEFAULT_CURRENCY] || '₹'
}

export const formatCurrency = (amount: number, currency?: string): string => {
  const symbol = getCurrencySymbol(currency)
  return (
    symbol +
    amount.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  )
}
