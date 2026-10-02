import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  type Brand,
  businessDateOf,
  cutoffFor,
  isOperatingDay,
  nextOperatingDay,
  nextWeekdayAfter,
  type OperatingLookup,
  weekdayOnOrAfter,
} from '@waypoint/shared';
import { eq } from 'drizzle-orm';
import { SettingsService } from '../../../core/settings/settings.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { depots } from '../../../db/schema';
import { CalendarService } from '../../master-data';
import { ORDER_SETTINGS } from '../ordering.constants';

/** What the next run depends on: the brand, and a Style outlet's weekly day. */
/** How many runs ahead `nextOpenDate` will look before giving up. */
const OPEN_DATE_SEARCH_STEPS = 14;

export interface RunTarget {
  brand: Brand;
  /** Style only: the outlet's weekly delivery day, 0 = Monday. */
  styleDeliveryDow?: number | null;
}

/**
 * The cutoff: when a depot's orders for a delivery date close, and which run
 * a late order goes on.
 *
 * `cutoffMin` is the depot's own override (`depots.cutoffMin`, A4), then the
 * per-depot `ordering.cutoffMin` setting, then its default, 960 = 16:00. The
 * cutoff instant is that minute on the operating day before delivery, so a
 * closed Sunday pushes Monday's cutoff back to Saturday. A submit is late
 * when `now >= cutoffFor(...)`.
 *
 * The maths lives in packages/shared; this service only resolves the depot's
 * minute and the calendar around the date. It holds no cache of its own: a
 * provider is a singleton, and A4 may move a depot's cutoff at any moment.
 */
@Injectable()
export class CutoffService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly settings: SettingsService,
    private readonly calendar: CalendarService,
  ) {}

  /** The cutoff minute in force at a depot. */
  async cutoffMinFor(depotId: string): Promise<number> {
    const own = await this.depotCutoffMin(depotId);
    if (own != null) return own;
    return this.settings.get(ORDER_SETTINGS.cutoffMin, depotId);
  }

  /** When orders for a depot's delivery date close. */
  async cutoffAt(depotId: string, deliveryDate: string): Promise<Date> {
    const [cutoffMin, known] = await Promise.all([
      this.cutoffMinFor(depotId),
      this.calendar.lookupAround(deliveryDate),
    ]);
    return cutoffFor(deliveryDate, cutoffMin, known);
  }

  /** The cutoff for several (depot, date) pairs, as one lookup each way. */
  async cutoffsFor(
    pairs: readonly { depotId: string; deliveryDate: string }[],
  ): Promise<Map<string, Date>> {
    if (pairs.length === 0) return new Map();
    const dates = pairs.map((p) => p.deliveryDate);
    const depotIds = [...new Set(pairs.map((p) => p.depotId))];
    const [known, minutes] = await Promise.all([
      this.calendar.lookupFor(dates),
      this.minutesFor(depotIds),
    ]);
    const out = new Map<string, Date>();
    for (const { depotId, deliveryDate } of pairs) {
      const key = cutoffKey(depotId, deliveryDate);
      if (out.has(key)) continue;
      out.set(key, cutoffFor(deliveryDate, minutes.get(depotId) ?? 960, known));
    }
    return out;
  }

  /**
   * The run an order moves to when it misses the cutoff: the next operating
   * day, or for Style the outlet's next weekly delivery day, which is the
   * only day its outlet is served (specs/engine/rules.md section 9).
   */
  async nextRun(
    date: string,
    target: RunTarget,
    known?: OperatingLookup,
  ): Promise<string> {
    if (target.brand === 'STYLE' && target.styleDeliveryDow != null)
      return nextWeekdayAfter(date, target.styleDeliveryDow);
    return nextOperatingDay(
      date,
      known ?? (await this.calendar.lookupAround(date)),
    );
  }

  /**
   * The first date a store can still order for: the next run whose cutoff has
   * not passed. M8's reorder opens its draft on it, and a Style outlet's
   * search walks its weekly delivery days rather than every operating day
   * (AC-ORD-07).
   */
  async nextOpenDate(
    depotId: string,
    target: RunTarget,
    now: Date,
  ): Promise<string> {
    const [cutoffMin, known] = await Promise.all([
      this.cutoffMinFor(depotId),
      this.calendar.lookupAround(businessDateOf(now)),
    ]);
    return openDateFor(target, cutoffMin, known, now);
  }

  /**
   * The depot's cutoff minute and the calendar around today, loaded once, so
   * a caller working through a depot's outlets can ask `openDateFor` for each
   * of them without going back to the database (the 15:30 reminder sweep).
   */
  async openDateContext(
    depotId: string,
    now: Date,
  ): Promise<{ cutoffMin: number; known: OperatingLookup }> {
    const [cutoffMin, known] = await Promise.all([
      this.cutoffMinFor(depotId),
      this.calendar.lookupAround(businessDateOf(now)),
    ]);
    return { cutoffMin, known };
  }

  /** The cutoff minute of each depot, for a batch. */
  private async minutesFor(
    depotIds: readonly string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    await Promise.all(
      depotIds.map(async (id) => out.set(id, await this.cutoffMinFor(id))),
    );
    return out;
  }

  /** The depot's own override, or null when it keeps the global cutoff. */
  private async depotCutoffMin(depotId: string): Promise<number | null> {
    const [row] = await this.txHost.tx
      .select({ cutoffMin: depots.cutoffMin })
      .from(depots)
      .where(eq(depots.id, depotId));
    return row?.cutoffMin ?? null;
  }
}

export const cutoffKey = (depotId: string, deliveryDate: string) =>
  `${depotId}#${deliveryDate}`;

/**
 * The first run a store can still order for, given the depot's cutoff minute
 * and the calendar around today: the next date whose cutoff is still ahead.
 * A Style outlet walks its weekly delivery days rather than every operating
 * day, because that is the only day it is served (AC-ORD-07, AC-ORD-37).
 *
 * Pure, so the reminder sweep can ask it for each of a depot's outlets after
 * loading the cutoff and the calendar once.
 */
export function openDateFor(
  target: RunTarget,
  cutoffMin: number,
  known: OperatingLookup,
  now: Date,
): string {
  const today = businessDateOf(now);
  const weekly = target.brand === 'STYLE' && target.styleDeliveryDow != null;
  const dow = target.styleDeliveryDow ?? 0;
  let date = weekly
    ? weekdayOnOrAfter(today, dow)
    : isOperatingDay(today, known)
      ? today
      : nextOperatingDay(today, known);

  for (let i = 0; i < OPEN_DATE_SEARCH_STEPS; i += 1) {
    if (cutoffFor(date, cutoffMin, known).getTime() > now.getTime())
      return date;
    date = weekly ? nextWeekdayAfter(date, dow) : nextOperatingDay(date, known);
  }
  throw new Error(
    `No open delivery date within ${OPEN_DATE_SEARCH_STEPS} runs of ${today}`,
  );
}
