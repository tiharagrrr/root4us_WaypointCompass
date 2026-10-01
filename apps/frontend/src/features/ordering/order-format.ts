import type { DeliveryWindowDto, OrderDto, TempClass } from '@compass/api-client'
import { formatColombo } from '@/lib/format-colombo'

/** A business date (YYYY-MM-DD) as the instant it starts in Colombo, for formatColombo. */
const startOfDay = (date: string): string => `${date}T00:00:00+05:30`

/** "Wed 30 Sep", as M1's "Orders · Wed 30 Sep" and its Delivery box read. */
export const dayLabel = (date: string): string => formatColombo(startOfDay(date), 'EEE d MMM')

/** "Wed 30 Sep · 07:00–09:00". */
export const deliveryLabel = (date: string, window: DeliveryWindowDto): string =>
  `${dayLabel(date)} · ${window.open}–${window.close}`

/** The screens say "Dry order" and "Chilled order"; only chips show AMBIENT and CHILLED. */
export const classLabel = (tempClass: TempClass): string =>
  tempClass === 'CHILLED' ? 'Chilled order' : 'Dry order'

/** "chilled order" and "dry order" inside a sentence ("Add items to dry order"). */
export const classLabelInline = (tempClass: TempClass): string => classLabel(tempClass).toLowerCase()

/** "Order 1 of 2": where this order sits among the day's, in the order the cards are shown. */
export const positionLabel = (orders: readonly OrderDto[], order: OrderDto): string => {
  const index = orders.findIndex((o) => o.id === order.id)
  return `Order ${index + 1} of ${orders.length}`
}

const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 })
const fixed2 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 544 → "544", 83.5 → "83.5". Weights carry at most 2 decimals (specs/api-conventions.md). */
export const kg = (value: number): string => number.format(value)

/** 1.08 → "1.08": volumes always show their 2 decimals, as the frames do. */
export const m3 = (value: number): string => fixed2.format(value)

/** "4:00 PM", the cutoff as M1's card names it. */
export const clockLabel = (instant: string): string => formatColombo(instant, 'h:mm a')

/** "16:12", the 24-hour reading M2 quotes. */
export const timeLabel = (instant: string): string => formatColombo(instant, 'HH:mm')

/**
 * "1H 48M LEFT" until the cutoff, "LESS THAN A MINUTE" in the last minute, and null once it has
 * passed, when M1 shows M2's notice instead of a countdown.
 */
export const countdownLabel = (until: string, now: Date): string | null => {
  const ms = new Date(until).getTime() - now.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return null
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'LESS THAN A MINUTE'
  const hours = Math.floor(minutes / 60)
  return hours > 0 ? `${hours}H ${minutes % 60}M LEFT` : `${minutes}M LEFT`
}

/** The day M1 is placing for: the orders already open, else the next business date. */
export const openDayOf = (orders: readonly OrderDto[], now: Date): string => {
  const earliest = orders.map((o) => o.requestedDate).sort()[0]
  if (earliest) return earliest
  const next = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  return formatColombo(next, 'yyyy-MM-dd')
}
