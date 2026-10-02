/**
 * Business time in Asia/Colombo: operating days, the order cutoff and the
 * weekly Style delivery day. The API's CutoffService and the web's date
 * pickers read the same helpers, so a cutoff never moves between them.
 *
 * A business date is 'YYYY-MM-DD' in Asia/Colombo, which is UTC+05:30 all
 * year (no daylight saving since 2006). A clock time is minutes after
 * midnight: 16:00 is 960. Day of week is 0 = Monday, as `calendar_days.dow`
 * and `outlets.styleDeliveryDow` store it.
 */

/** Asia/Colombo is UTC+05:30 all year. */
export const COLOMBO_OFFSET_MIN = 330;

const DAY_MS = 86_400_000;
const BUSINESS_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 0 = Monday. The order matches `calendar_days.dow` and `outlets.styleDeliveryDow`. */
export const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** Whether an operating day is known, and if so whether the depot runs that day. */
export type OperatingLookup = (date: string) => boolean | undefined;

/** How far the helpers look for the next or previous operating day before giving up. */
export const OPERATING_DAY_SEARCH_LIMIT = 28;

function assertBusinessDate(date: string): string {
  if (!BUSINESS_DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
    throw new Error(`Not a business date (YYYY-MM-DD): ${date}`);
  return date;
}

/** The Asia/Colombo business date of an instant. */
export function businessDateOf(at: Date): string {
  return new Date(at.getTime() + COLOMBO_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** The instant of a business date at a minute of the day, in Asia/Colombo. */
export function instantAt(date: string, minuteOfDay: number): Date {
  assertBusinessDate(date);
  return new Date(
    Date.parse(`${date}T00:00:00Z`) + (minuteOfDay - COLOMBO_OFFSET_MIN) * 60_000,
  );
}

/** The business date `days` after (or, when negative, before) another. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${assertBusinessDate(date)}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Day of week of a business date, 0 = Monday. */
export function dowOf(date: string): number {
  const sunday0 = new Date(`${assertBusinessDate(date)}T00:00:00Z`).getUTCDay();
  return (sunday0 + 6) % 7;
}

export function weekdayOf(date: string): Weekday {
  return WEEKDAYS[dowOf(date)] as Weekday;
}

/** Minutes after midnight as "07:00", the label every time field carries. */
export function minuteLabel(minuteOfDay: number): string {
  const m = ((Math.trunc(minuteOfDay) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * The fallback when the calendar has no row for a date: Monday to Saturday
 * are operating days and Sunday is not (specs/master-data/spec.md, AC-MD-10).
 */
export function isDefaultOperatingDay(date: string): boolean {
  return dowOf(date) !== 6;
}

/** The calendar's answer for a date, or the Monday-to-Saturday fallback. */
export function isOperatingDay(date: string, known?: OperatingLookup): boolean {
  return known?.(date) ?? isDefaultOperatingDay(date);
}

/** The first operating day strictly after `date`. */
export function nextOperatingDay(date: string, known?: OperatingLookup): string {
  for (let i = 1; i <= OPERATING_DAY_SEARCH_LIMIT; i += 1) {
    const day = addDays(date, i);
    if (isOperatingDay(day, known)) return day;
  }
  throw new Error(`No operating day in the ${OPERATING_DAY_SEARCH_LIMIT} days after ${date}`);
}

/** The last operating day strictly before `date`. */
export function previousOperatingDay(date: string, known?: OperatingLookup): string {
  for (let i = 1; i <= OPERATING_DAY_SEARCH_LIMIT; i += 1) {
    const day = addDays(date, -i);
    if (isOperatingDay(day, known)) return day;
  }
  throw new Error(`No operating day in the ${OPERATING_DAY_SEARCH_LIMIT} days before ${date}`);
}

/**
 * When orders for `deliveryDate` close: the operating day before it, at
 * `cutoffMin` (the depot's override or `ordering.cutoffMin`, 960 = 16:00).
 */
export function cutoffFor(
  deliveryDate: string,
  cutoffMin: number,
  known?: OperatingLookup,
): Date {
  return instantAt(previousOperatingDay(deliveryDate, known), cutoffMin);
}

/**
 * The first occurrence of a weekday strictly after `date`: a Style outlet's
 * next weekly delivery day, which is the run a Style order goes on
 * (specs/engine/rules.md section 9).
 */
export function nextWeekdayAfter(date: string, dow: number): string {
  const ahead = (((dow - dowOf(date)) % 7) + 7) % 7;
  return addDays(date, ahead === 0 ? 7 : ahead);
}

/** That weekday on or after `date`, so a date already on it stays put. */
export function weekdayOnOrAfter(date: string, dow: number): string {
  const ahead = (((dow - dowOf(assertBusinessDate(date))) % 7) + 7) % 7;
  return addDays(date, ahead);
}
