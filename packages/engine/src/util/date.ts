import { EngineInputError } from '../errors';

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

const DAYS_BEFORE_MONTH = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeap(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/**
 * Weekday of a YYYY-MM-DD date, 0 = Monday, from the string alone: no clock and no time zone.
 * Counts days since 1970-01-01, which was a Thursday.
 */
export function weekdayOf(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  const day = Number(match?.[3]);
  if (!match || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new EngineInputError(`Not a calendar date: ${date}`);
  }
  let days = 0;
  for (let y = 1970; y < year; y++) days += isLeap(y) ? 366 : 365;
  days += DAYS_BEFORE_MONTH[month - 1] ?? 0;
  if (month > 2 && isLeap(year)) days += 1;
  days += day - 1;
  return (days + 3) % 7;
}
