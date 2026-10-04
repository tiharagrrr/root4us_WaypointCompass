import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, notInArray } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import type { DeliveredEvent } from '../../../core/outbox/event-bus';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { plans, stops, trips } from '../../../db/schema';
import { AuditService } from '../../audit';
import { ORDER_EVENTS, OrderLifecycleService } from '../../ordering';
import {
  PLANNING_AUDIT,
  PLANNING_EVENTS,
  PLANNING_LOGS,
} from '../planning.constants';
import { PlansService } from './plans.service';
import { TripLifecycleService } from './trip-lifecycle.service';

/** A store's own changes to an order still open before the cutoff. */
const STORE_CHANGES = new Set<string>([
  ORDER_EVENTS.linesChanged,
  ORDER_EVENTS.updated,
  ORDER_EVENTS.priorityChanged,
  ORDER_EVENTS.cancelled,
  ORDER_EVENTS.deleted,
]);

export const consumesStoreChange = (type: string): boolean =>
  STORE_CHANGES.has(type);

/**
 * A dispatcher drafts tomorrow's plan from every order, open ones included
 * (ordering's queueFor). The store may still change an open order until the
 * cutoff; when it does, the draft's stop for that order no longer matches it,
 * so the stop comes off its trip and the order goes back to the unplanned
 * queue, to be placed again as it now is. The plan's version moves, so a
 * dispatcher editing the draft at that moment reloads rather than saving over
 * it, and `plan.edited` refreshes every screen showing the day.
 *
 * Only DRAFT plans: once published, the order is confirmed and the store can
 * no longer change it.
 */
@Injectable()
export class StoreChangeListener {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly trips: TripLifecycleService,
    private readonly orders: OrderLifecycleService,
    private readonly plansService: PlansService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(StoreChangeListener.name);
  }

  @Transactional()
  async handle(event: DeliveredEvent): Promise<'removed' | 'not_on_a_draft'> {
    const payload = (event.payload ?? {}) as { orderId?: unknown };
    if (typeof payload.orderId !== 'string') return 'not_on_a_draft';
    const orderId = payload.orderId;

    const [onDraft] = await this.txHost.tx
      .select({ stop: stops, plan: plans })
      .from(stops)
      .innerJoin(trips, eq(trips.id, stops.tripId))
      .innerJoin(plans, eq(plans.id, trips.planId))
      .where(
        and(
          eq(stops.orderId, orderId),
          eq(plans.status, 'DRAFT'),
          notInArray(stops.status, ['CANCELLED', 'FAILED']),
        ),
      )
      .limit(1);
    if (!onDraft) return 'not_on_a_draft';
    const { stop, plan } = onDraft;

    await this.trips.cancelStop(stop.id, 'changed by the store');
    await this.orders.linkStop(orderId, null).catch(() => undefined);
    await this.plansService.bump(plan);
    await this.audit.record({
      action: PLANNING_AUDIT.storeChangeUnplanned,
      entity: ['plan', plan.id],
      after: {
        orderId,
        stopId: stop.id,
        tripId: stop.tripId,
        cause: event.type,
      },
      source: 'SYSTEM',
    });
    await this.outbox.add(
      PLANNING_EVENTS.planEdited,
      {
        v: 1,
        planId: plan.id,
        depotId: plan.depotId,
        date: plan.date,
        cause: 'store_changed_order',
        orderId,
        tripIds: [stop.tripId],
      },
      {
        aggregate: ['plan', plan.id],
        depotId: plan.depotId,
        outletIds: [stop.outletId],
      },
    );
    this.log.info(
      {
        event: PLANNING_LOGS.storeChangeUnplanned,
        planId: plan.id,
        orderId,
        stopId: stop.id,
      },
      'store changed an order on a draft: back to the queue',
    );
    return 'removed';
  }
}
