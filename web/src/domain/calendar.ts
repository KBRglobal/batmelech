const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Whether a given calendar date is marked as closed.
 * @param dateString - YYYY-MM-DD date to check.
 * @param closedDates - List of closed YYYY-MM-DD strings (typically from settings.closedDates).
 */
export function isDateClosed(dateString: string, closedDates: readonly string[] | undefined): boolean {
  if (typeof dateString !== 'string' || !ISO_DATE.test(dateString)) return false
  const list = closedDates ?? []
  return list.some((entry) => typeof entry === 'string' && entry === dateString)
}
