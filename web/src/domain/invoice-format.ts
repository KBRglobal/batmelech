// Shared by the invoice list and the new-invoice form so an amount or a date
// never reads one way in the list and another in the form that created it.

const dateFormatter = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function formatInvoiceDate(value: string | null): string {
  if (value === null || value === '') return 'ללא תאריך'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'ללא תאריך'
  return dateFormatter.format(parsed)
}

// The invoice PDF prints amounts the same way, so the panel keeps the currency
// code rather than a localized symbol — AED and USD both appear here.
export function formatInvoiceAmount(totalMinor: number, currency: string): string {
  return `${currency} ${(totalMinor / 100).toFixed(2)}`
}
