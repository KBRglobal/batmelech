export function dubaiTodayIso(now: Date = new Date()): string {
  if (!Number.isFinite(now.getTime())) throw new RangeError('now must be a valid Date')
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Dubai',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((candidate) => candidate.type === type)?.value
    if (part === undefined || !/^\d+$/u.test(part)) throw new RangeError(`Unable to resolve ${type}`)
    return part
  }
  return `${value('year')}-${value('month')}-${value('day')}`
}

// The operator always works forward: the soonest service date that has not
// passed yet in Dubai. Falls back to the most recent past date so a board of
// only-historical dates still shows something instead of an empty screen.
export function upcomingServiceDate(
  serviceDates: readonly string[],
  now: Date = new Date(),
): string | null {
  if (serviceDates.length === 0) return null
  const today = dubaiTodayIso(now)
  let soonest: string | null = null
  let latestPast: string | null = null
  for (const date of serviceDates) {
    if (date >= today) {
      if (soonest === null || date < soonest) soonest = date
    } else if (latestPast === null || date > latestPast) {
      latestPast = date
    }
  }
  return soonest ?? latestPast
}
