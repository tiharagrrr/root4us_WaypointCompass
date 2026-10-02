import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { orderDayMarks, orders } from '../../../db/schema';
import { AuditService } from '../../audit';
import type { OrderCutoffClosedEvent } from '../events/ordering.events';
import { ORDER_AUDIT, ORDER_EVENTS, ORDER_LOGS } from '../ordering.constants';
import { CutoffService } from './cutoff.service';
import { OrderLifecycleService } from './order-lifecycle.service';

/** The two once-a-day marks ordering keeps (`order_day_marks.kind`). */
export const DAY_MARKS = {
  cutoffClosed: 'cutoff_closed',
  cutoffReminder: 'cutoff_reminder',
} as const;

export interface CloseResult {
  depotId: string;
  deliveryDate: string;
  confirmed: number;
  /** False when the day was already closed, so nothing was emitted again. */
  closed: boolean;
}

/** A depot's day that still has orders waiting for their cutoff. */
export interface DueDay {
  depotId: string;
  deliveryDate: string;
  waiting: number;
}

/**
 * Closing a cutoff: every SUBMITTED order for a depot's delivery date becomes
 * CONFIRMED, and the day is marked closed exactly once. The ticker does this
 * a minute after the cutoff; in demo mode a dispatcher can do it on the spot
 * (AC-ORD-06, AC-ORD-24, AC-ORD-25).
 *
 * The mark in `order_day_marks` is what makes "exactly once" true: whoever
 * inserts it first owns the close, so the demo button and the ticker reaching
 * the same day emit `order.cutoff_closed` once between them.
 */
@Injectable()
export class CutoffCloseService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly cutoff: CutoffService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(CutoffCloseService.name);
  }

  /**
   * Days whose cutoff has passed and that still hold SUBMITTED orders. A day
   * that rolled forward is not due yet: its own cutoff is a run later, which
   * is why AC-ORD-24's rolled order stays SUBMITTED.
   */
  async due(now: Date): Promise<DueDay[]> {
    const pending = await this.txHost.tx
      .select({
        depotId: orders.depotId,
        deliveryDate: orders.deliveryDate,
        waiting: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(eq(orders.status, 'SUBMITTED'))
      .groupBy(orders.depotId, orders.deliveryDate);
    if (pending.length === 0) return [];

    const cutoffs = await this.cutoff.cutoffsFor(pending);
    return pending.filter(({ depotId, deliveryDate }) => {
      const at = cutoffs.get(`${depotId}#${deliveryDate}`);
      return at !== undefined && now.getTime() >= at.getTime();
    });
  }

  /**
   * Confirms the day's submitted orders and marks it closed. Safe to call
   * twice: the second call finds the mark and returns `closed: false`.
   */
  @Transactional()
  async close(
    depotId: string,
    deliveryDate: string,
    closedBy: 'ticker' | 'demo',
  ): Promise<CloseResult> {
    const won = await this.claim(depotId, deliveryDate, closedBy);
    const waiting = await this.txHost.tx
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.depotId, depotId),
          eq(orders.deliveryDate, deliveryDate),
          eq(orders.status, 'SUBMITTED'),
        ),
      )
      .for('update');

    for (const { id } of waiting) await this.lifecycle.markConfirmed(id);
    const confirmed = waiting.length;

    if (!won) {
      // The day was already closed; later arrivals are still confirmed, but
      // the day is not announced a second time.
      if (confirmed)
        this.log.info(
          { event: ORDER_LOGS.cutoffClosed, depotId, deliveryDate, confirmed },
          'late orders confirmed on an already closed day',
        );
      return { depotId, deliveryDate, confirmed, closed: false };
    }

    await this.record(depotId, deliveryDate, confirmed, closedBy);
    return { depotId, deliveryDate, confirmed, closed: true };
  }

  /** Whether this depot's day has already been closed. */
  async closedAt(depotId: string, deliveryDate: string): Promise<Date | null> {
    const [mark] = await this.txHost.tx
      .select({ at: orderDayMarks.at })
      .from(orderDayMarks)
      .where(
        and(
          eq(orderDayMarks.kind, DAY_MARKS.cutoffClosed),
          eq(orderDayMarks.scopeId, depotId),
          eq(orderDayMarks.deliveryDate, deliveryDate),
        ),
      );
    return mark?.at ?? null;
  }

  /** Which of these depot days are closed, for a batch of summaries. */
  async closedDays(
    depotIds: readonly string[],
    deliveryDate: string,
  ): Promise<Map<string, Date>> {
    if (depotIds.length === 0) return new Map();
    const marks = await this.txHost.tx
      .select({ scopeId: orderDayMarks.scopeId, at: orderDayMarks.at })
      .from(orderDayMarks)
      .where(
        and(
          eq(orderDayMarks.kind, DAY_MARKS.cutoffClosed),
          inArray(orderDayMarks.scopeId, [...depotIds]),
          eq(orderDayMarks.deliveryDate, deliveryDate),
        ),
      );
    return new Map(marks.map((m) => [m.scopeId, m.at]));
  }

  /** The primary key decides the winner: one insert succeeds, the rest do not. */
  private async claim(
    depotId: string,
    deliveryDate: string,
    closedBy: string,
  ): Promise<boolean> {
    const claimed = await this.txHost.tx
      .insert(orderDayMarks)
      .values({
        kind: DAY_MARKS.cutoffClosed,
        scopeId: depotId,
        deliveryDate,
        at: this.clock.now(),
        detail: { closedBy },
      })
      .onConflictDoNothing()
      .returning({ scopeId: orderDayMarks.scopeId });
    return claimed.length > 0;
  }

  private async record(
    depotId: string,
    deliveryDate: string,
    confirmed: number,
    closedBy: 'ticker' | 'demo',
  ): Promise<void> {
    await this.audit.record({
      action: ORDER_AUDIT.cutoffClosed,
      entity: ['depot_day', `${depotId}#${deliveryDate}`],
      after: { depotId, deliveryDate, confirmed, closedBy },
    });
    const payload: OrderCutoffClosedEvent = {
      v: 1,
      depotId,
      deliveryDate,
      confirmed,
      closedBy,
    };
    await this.outbox.add(ORDER_EVENTS.cutoffClosed, payload, {
      aggregate: ['depot_day', `${depotId}#${deliveryDate}`],
      depotId,
    });
    this.log.info(
      {
        event: ORDER_LOGS.cutoffClosed,
        depotId,
        deliveryDate,
        count: confirmed,
        closedBy,
      },
      'cutoff closed',
    );
  }
}
