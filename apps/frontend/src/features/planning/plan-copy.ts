import { cutoffFor, instantAt } from '@waypoint/shared'
import type { PlanVehicleOptionDto } from '@compass/api-client'
import { formatColombo } from '@/lib/format-colombo'
import type { IconName } from '@/ui/icon'

/** Kilograms as the frames print them: "1,240 kg". */
export const kg = (value: number): string => `${Math.round(value).toLocaleString('en-US')} kg`

/** Cubic metres to one decimal: "9.3 m³". */
export const m3 = (value: number): string => `${value.toFixed(1)} m³`

/** A share of a whole as a whole percent, never over 999. */
export const percent = (part: number, whole: number): number =>
  whole > 0 ? Math.min(999, Math.round((part / whole) * 100)) : 0

/** Minutes after midnight as "05:17". */
export const clock = (minuteOfDay: number): string => {
  const m = ((Math.round(minuteOfDay) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** The glyph and tone each brand carries in the order cards (05, 07, 09). */
export const BRAND_GLYPH: Record<string, { icon: IconName; className: string }> = {
  FRESH: { icon: 'leaf', className: 'text-teal-700' },
  STYLE: { icon: 'apparel', className: 'text-primary' },
  TECH: { icon: 'bolt', className: 'text-orange-700' },
}

export const BRAND_WORD: Record<string, string> = { FRESH: 'Fresh', STYLE: 'Style', TECH: 'Tech' }

export const VEHICLE_KIND: Record<string, string> = { REEFER: 'Reefer', AMBIENT: 'Truck' }

/** Reefer, Truck or Van, from the vehicle's type and temperature. */
export const vehicleKind = (type: string, temp: string): string => (type === 'VAN' ? 'Van' : (VEHICLE_KIND[temp] ?? 'Truck'))

/**
 * Why an order cannot go on a trip, in the capitals the 07 chips use. The rule codes are the
 * engine's (specs/engine/rules.md); the engine's own message stays available as the chip's title.
 */
export const RULE_CHIP: Record<string, string> = {
  CAP_WEIGHT: 'OVER WEIGHT',
  CAP_VOLUME: 'NO ROOM LEFT',
  TEMP_REEFER: 'NEEDS A REEFER',
  ACCESS_VAN_ONLY: 'VAN-ONLY OUTLET',
  TRIP_BRAND_DISTRICT: 'DIFFERENT DISTRICT',
  WINDOW_OUTLET: 'WINDOW CLOSES BEFORE ARRIVAL',
  WINDOW_MALL: 'MALL WINDOW CLOSED',
  BUDGET_FRESH: 'NO TIME LEFT',
  BUDGET_STYLE_TECH: 'NO TIME LEFT',
  FUEL_WEEKLY: 'OVER FUEL QUOTA',
  TRIP_LIMIT: 'NO TRIPS LEFT',
  DEPOT_HOME: 'OTHER DEPOT',
  VEHICLE_AVAILABLE: 'VEHICLE UNAVAILABLE',
  TECH_VALUE_LIMIT: 'OVER VALUE LIMIT',
  WHOLE_ORDER: 'SPLIT ORDER',
  OPERATING_DAY: 'NOT DUE TODAY',
  REPEAT_SKIP: 'SKIPPED LAST RUN',
  LATE_RISK: 'TIGHT WINDOW',
}

/** A trip's own problem, in the chip 11 puts on the trip ("Over volume"). */
export const TRIP_PROBLEM: Record<string, string> = {
  CAP_WEIGHT: 'Over weight',
  CAP_VOLUME: 'Over volume',
  BUDGET_FRESH: 'Over time',
  BUDGET_STYLE_TECH: 'Over time',
  FUEL_WEEKLY: 'Over fuel quota',
  TRIP_LIMIT: 'Too many trips',
}

/** The six lines of 08's feasibility check and the rules each one covers. */
export const CHECKS: readonly { label: string; rules: readonly string[] }[] = [
  { label: 'Weight and volume', rules: ['CAP_WEIGHT', 'CAP_VOLUME'] },
  { label: 'Correct condition', rules: ['TEMP_REEFER'] },
  { label: 'Van-only outlets', rules: ['ACCESS_VAN_ONLY'] },
  { label: 'Delivery windows', rules: ['WINDOW_OUTLET', 'WINDOW_MALL'] },
  { label: 'Fuel quota', rules: ['FUEL_WEEKLY'] },
  { label: 'Home depot', rules: ['DEPOT_HOME'] },
]

/** Business date to "Tue 29 Sep". */
export const dayLabel = (date: string): string => formatColombo(instantAt(date, 720), 'EEE d MMM')

/** What a day's chip says: the plan's state for the open day, otherwise whether orders still come in. */
export function dayStatus(date: string, now: Date, planStatus?: string): string {
  if (planStatus) return planStatus
  return now.getTime() < cutoffFor(date, 960).getTime() ? 'ORDERS OPEN' : 'NOT STARTED'
}

/** A vehicle 06 lets the dispatcher pick: in service, with a trip slot left. */
export const canTakeTrip = (v: PlanVehicleOptionDto): boolean => v.available && v.tripsLeft > 0
