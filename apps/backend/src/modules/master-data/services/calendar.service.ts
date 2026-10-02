import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  addDays,
  cutoffFor,
  isOperatingDay,
  nextOperatingDay,
  type OperatingLookup,
  previousOperatingDay,
} from '@waypoint/shared';
import { and, asc, gte, inArray, lte } from 'drizzle-orm';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { calendarDays } from '../../../db/schema';

export type CalendarDayRow = typeof calendarDays.$inferSelect;

/** How far around a date the operating-day helpers load calendar rows. */
const WINDOW_DAYS = 28;

/**
 * The calendar: which business dates the depots run on. A date with no row
 * falls back to Monday to Saturday (`packages/shared`'s business-time
 * helpers), so a demo day outside the seeded range still behaves (AC-MD-10).
 *
 * Ordering's cutoff reads this, so the one calendar decides both the day an
 * order rolls to and the instant its cutoff falls on.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
  ) {}

  /** The rows between two business dates, inclusive, in date order. */
  range(from: string, to: string): Promise<CalendarDayRow[]> {
    return this.txHost.tx
      .select()
      .from(calendarDays)
      .where(and(gte(calendarDays.date, from), lte(calendarDays.date, to)))
      .orderBy(asc(calendarDays.date));
  }

  /** A lookup over the days around `date`, for the business-time helpers. */
  async lookupAround(
    date: string,
    days = WINDOW_DAYS,
  ): Promise<OperatingLookup> {
    const rows = await this.range(addDays(date, -days), addDays(date, days));
    const known = new Map(rows.map((r) => [r.date, r.isOperating]));
    return (day) => known.get(day);
  }

  /** A lookup over exactly these dates, for a batch of orders. */
  async lookupFor(dates: readonly string[]): Promise<OperatingLookup> {
    if (dates.length === 0) return () => undefined;
    const span = [...dates].sort();
    const rows = await this.range(
      addDays(span[0], -WINDOW_DAYS),
      addDays(span[span.length - 1], WINDOW_DAYS),
    );
    const known = new Map(rows.map((r) => [r.date, r.isOperating]));
    return (day) => known.get(day);
  }

  async isOperating(date: string): Promise<boolean> {
    return isOperatingDay(date, await this.lookupAround(date, 1));
  }

  /** The first operating day after `date`. */
  async nextOperating(date: string): Promise<string> {
    return nextOperatingDay(date, await this.lookupAround(date));
  }

  /** The last operating day before `date`. */
  async previousOperating(date: string): Promise<string> {
    return previousOperatingDay(date, await this.lookupAround(date));
  }

  /** When orders for `deliveryDate` close, given the depot's cutoff minute. */
  async cutoffAt(deliveryDate: string, cutoffMin: number): Promise<Date> {
    return cutoffFor(
      deliveryDate,
      cutoffMin,
      await this.lookupAround(deliveryDate),
    );
  }

  /** Which of these dates the calendar knows to be operating days. */
  async operatingOf(dates: readonly string[]): Promise<Map<string, boolean>> {
    if (dates.length === 0) return new Map();
    const rows = await this.txHost.tx
      .select({
        date: calendarDays.date,
        isOperating: calendarDays.isOperating,
      })
      .from(calendarDays)
      .where(inArray(calendarDays.date, [...new Set(dates)]));
    return new Map(rows.map((r) => [r.date, r.isOperating]));
  }
}
