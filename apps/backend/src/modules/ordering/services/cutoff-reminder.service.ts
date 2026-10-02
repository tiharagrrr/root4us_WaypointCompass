import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { businessDateOf, cutoffFor } from '@waypoint/shared';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { SettingsService } from '../../../core/settings/settings.service';
import { orderDayMarks, orders, outlets } from '../../../db/schema';
import type { OrderCutoffReminderEvent } from '../events/ordering.events';
import {
  ORDER_EVENTS,
  ORDER_LOGS,
  ORDER_SETTINGS,
} from '../ordering.constants';
import { DAY_MARKS } from './cutoff-close.service';
import { CutoffService, openDateFor } from './cutoff.service';

/** An outlet and the run its depot closes next for it. */
interface OutletRun {
  outletId: string;
  depotId: string;
  deliveryDate: string;
  cutoffAt: Date;
}

/**
 * The nudge at 15:30 (`ordering.cutoffReminderMin`, 930): every outlet with
 * no order yet for the run its depot closes today gets one
 * `order.cutoff_reminder`, which notifications turns into a push and an
 * in-app message. The mark in `order_day_marks` keeps it to one per outlet
 * and date, however many times the minute's tick runs (AC-ORD-26).
 *
 * The run is worked out per outlet, not per depot: a Style outlet is served
 * one weekday a week, so it is only reminded on the day before that run, and
 * never about a day it would not be served anyway.
 *
 * "No order" means no order of any class that is not cancelled: a store that
 * has sent its dry order knows the cutoff is coming.
 */
@Injectable()
export class CutoffReminderService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly cutoff: CutoffService,
    private readonly settings: SettingsService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(CutoffReminderService.name);
  }

  /**
   * Reminds every outlet whose next run closes later today and that has
   * nothing on it. Returns how many were reminded, which is what the log
   * line carries.
   */
  @Transactional()
  async remind(now: Date): Promise<number> {
    const reminderMin = await this.settings.get(
      ORDER_SETTINGS.cutoffReminderMin,
    );
    if (this.clock.minutesOfDay(now) < reminderMin) return 0;

    const runs = await this.runsClosingToday(now);
    const quiet = await this.withoutOrders(runs);
    const fresh = await this.claim(quiet, now);

    for (const run of fresh) {
      const payload: OrderCutoffReminderEvent = {
        v: 1,
        outletId: run.outletId,
        depotId: run.depotId,
        deliveryDate: run.deliveryDate,
        cutoffAt: this.clock.toIso(run.cutoffAt),
      };
      await this.outbox.add(ORDER_EVENTS.cutoffReminder, payload, {
        aggregate: ['outlet_day', `${run.outletId}#${run.deliveryDate}`],
        depotId: run.depotId,
        outletIds: [run.outletId],
      });
    }

    if (fresh.length)
      this.log.info(
        { event: ORDER_LOGS.reminderSent, count: fresh.length },
        'cutoff reminders queued',
      );
    return fresh.length;
  }

  /**
   * Every outlet whose next open run has its cutoff later today. A depot's
   * cutoff minute and calendar are read once, and each outlet's own run then
   * falls out of pure date maths.
   */
  private async runsClosingToday(now: Date): Promise<OutletRun[]> {
    const today = businessDateOf(now);
    const rows = await this.txHost.tx
      .select({
        id: outlets.id,
        depotId: outlets.depotId,
        brand: outlets.brand,
        styleDeliveryDow: outlets.styleDeliveryDow,
      })
      .from(outlets);

    const runs: OutletRun[] = [];
    const contexts = new Map<
      string,
      Awaited<ReturnType<CutoffService['openDateContext']>>
    >();
    for (const outlet of rows) {
      let context = contexts.get(outlet.depotId);
      if (!context) {
        context = await this.cutoff.openDateContext(outlet.depotId, now);
        contexts.set(outlet.depotId, context);
      }
      const deliveryDate = openDateFor(
        { brand: outlet.brand, styleDeliveryDow: outlet.styleDeliveryDow },
        context.cutoffMin,
        context.known,
        now,
      );
      const cutoffAt = cutoffFor(
        deliveryDate,
        context.cutoffMin,
        context.known,
      );
      // Only a cutoff that falls later today: a reminder at 15:30 is about
      // the 16:00 deadline, not one two days out.
      if (businessDateOf(cutoffAt) !== today) continue;
      if (now.getTime() >= cutoffAt.getTime()) continue;
      runs.push({
        outletId: outlet.id,
        depotId: outlet.depotId,
        deliveryDate,
        cutoffAt,
      });
    }
    return runs;
  }

  /** The runs with no order on them yet, cancelled ones not counting. */
  private async withoutOrders(runs: OutletRun[]): Promise<OutletRun[]> {
    if (runs.length === 0) return [];
    const placed = await this.txHost.tx
      .select({
        outletId: orders.outletId,
        deliveryDate: orders.deliveryDate,
      })
      .from(orders)
      .where(
        and(
          inArray(
            orders.outletId,
            runs.map((r) => r.outletId),
          ),
          inArray(
            orders.deliveryDate,
            runs.map((r) => r.deliveryDate),
          ),
          ne(orders.status, 'CANCELLED'),
        ),
      );
    const busy = new Set(placed.map((p) => `${p.outletId}#${p.deliveryDate}`));
    return runs.filter((r) => !busy.has(`${r.outletId}#${r.deliveryDate}`));
  }

  /** The runs this sweep owns, as the primary key allows. */
  private async claim(runs: OutletRun[], now: Date): Promise<OutletRun[]> {
    if (runs.length === 0) return [];
    const claimed = await this.txHost.tx
      .insert(orderDayMarks)
      .values(
        runs.map((run) => ({
          kind: DAY_MARKS.cutoffReminder,
          scopeId: run.outletId,
          deliveryDate: run.deliveryDate,
          at: now,
        })),
      )
      .onConflictDoNothing()
      .returning({
        scopeId: orderDayMarks.scopeId,
        deliveryDate: orderDayMarks.deliveryDate,
      });
    const won = new Set(claimed.map((c) => `${c.scopeId}#${c.deliveryDate}`));
    return runs.filter((r) => won.has(`${r.outletId}#${r.deliveryDate}`));
  }

  /** Which outlets have already been reminded about a date (01, and tests). */
  async remindedOutlets(deliveryDate: string): Promise<string[]> {
    const marks = await this.txHost.tx
      .select({ scopeId: orderDayMarks.scopeId })
      .from(orderDayMarks)
      .where(
        and(
          eq(orderDayMarks.kind, DAY_MARKS.cutoffReminder),
          eq(orderDayMarks.deliveryDate, deliveryDate),
        ),
      );
    return marks.map((m) => m.scopeId);
  }
}
