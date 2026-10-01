/** Business dates and times are Asia/Colombo (UTC+05:30, no daylight saving). */
export const COLOMBO_TIME_ZONE = 'Asia/Colombo'

export type Instant = Date | string | number

const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: COLOMBO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'long',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const toDate = (instant: Instant): Date => {
  const date = instant instanceof Date ? instant : new Date(instant)
  if (Number.isNaN(date.getTime())) throw new RangeError(`formatColombo: invalid instant ${String(instant)}`)
  return date
}

interface ColomboParts {
  year: string
  month: number
  day: number
  weekday: string
  hour: number
  minute: string
  second: string
}

const partsOf = (date: Date): ColomboParts => {
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value
  return {
    year: parts.year ?? '',
    month: Number(parts.month),
    day: Number(parts.day),
    weekday: parts.weekday ?? '',
    hour: Number(parts.hour) % 24,
    minute: parts.minute ?? '',
    second: parts.second ?? '',
  }
}

const pad = (n: number): string => String(n).padStart(2, '0')

const TOKENS = /'([^']*)'|yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|H|hh|h|mm|ss|a/g

/**
 * Formats an instant in Colombo time with a date-fns style pattern:
 * yyyy yy, MMMM MMM MM M, dd d, EEEE EEE, HH H hh h, mm, ss, a; text in 'single quotes'.
 * formatColombo('2026-10-01T10:25:00Z', 'EEE HH:mm') === 'Thu 15:55'
 */
export const formatColombo = (instant: Instant, pattern: string): string => {
  const p = partsOf(toDate(instant))
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12
  return pattern.replace(TOKENS, (token, literal: string | undefined) => {
    if (literal !== undefined) return literal === '' ? "'" : literal
    switch (token) {
      case 'yyyy': return p.year
      case 'yy': return p.year.slice(-2)
      case 'MMMM': return MONTHS[p.month - 1] ?? ''
      case 'MMM': return (MONTHS[p.month - 1] ?? '').slice(0, 3)
      case 'MM': return pad(p.month)
      case 'M': return String(p.month)
      case 'dd': return pad(p.day)
      case 'd': return String(p.day)
      case 'EEEE': return p.weekday
      case 'EEE': return p.weekday.slice(0, 3)
      case 'HH': return pad(p.hour)
      case 'H': return String(p.hour)
      case 'hh': return pad(hour12)
      case 'h': return String(hour12)
      case 'mm': return p.minute
      case 'ss': return p.second
      case 'a': return p.hour < 12 ? 'AM' : 'PM'
      default: return token
    }
  })
}

/** The Colombo business date of an instant, as YYYY-MM-DD. */
export const toColomboDate = (instant: Instant): string => formatColombo(instant, 'yyyy-MM-dd')
