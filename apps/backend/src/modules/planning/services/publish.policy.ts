import { Injectable } from '@nestjs/common';
import { ClockService } from '../../../core/clock/clock.service';
import { CutoffService } from '../../ordering';
import type { PublishBlocker } from '../domain/errors';
import type { PlanContext } from './plan-context.builder';
import { PlanEngine } from './plan-engine';

export interface PublishCheck {
  /** The previous operating day's cutoff at the depot (AC-PLN-03). */
  opensAt: Date;
  open: boolean;
  blockers: PublishBlocker[];
}

/**
 * What publishing needs (specs/planning/spec.md, decided 2026-10-03): the
 * plan is a DRAFT, no hard violation, a driver on every trip that carries
 * orders, and a confirmed deferral for every unplanned order. An empty
 * reservation is never a blocker; publish cancels it. The plan's `publish`
 * link, publish-preview and publish itself all ask this, so the screen and
 * the server never disagree.
 */
@Injectable()
export class PublishPolicy {
  constructor(
    private readonly cutoff: CutoffService,
    private readonly engine: PlanEngine,
    private readonly clock: ClockService,
  ) {}

  async check(ctx: PlanContext): Promise<PublishCheck> {
    const opensAt = await this.cutoff.cutoffAt(ctx.plan.depotId, ctx.plan.date);
    const blockers: PublishBlocker[] = [];
    if (ctx.plan.status !== 'DRAFT')
      blockers.push({
        kind: 'NOT_DRAFT',
        message: `The plan is ${ctx.plan.status}`,
      });

    for (const v of this.engine.validate(ctx.input, ctx.draft)) {
      if (v.severity !== 'HARD') continue;
      const trip = v.tripKey ? ctx.tripsByKey.get(v.tripKey) : undefined;
      const order = v.orderId ? ctx.orders.get(v.orderId) : undefined;
      blockers.push({
        kind: 'HARD_VIOLATION',
        message: v.message,
        rule: v.rule,
        ...(v.tripKey && { tripKey: v.tripKey }),
        ...(trip && { tripId: trip.id }),
        ...(order && { orderId: order.id, orderNo: order.orderNo }),
      });
    }

    for (const [key, trip] of ctx.tripsByKey) {
      const carries = (ctx.stopsByTrip.get(trip.id) ?? []).length > 0;
      if (carries && !trip.driverId)
        blockers.push({
          kind: 'NO_DRIVER',
          message: `${key} has no driver`,
          tripId: trip.id,
          tripKey: key,
        });
    }

    for (const u of ctx.draft.unplanned) {
      if (ctx.deferrals.get(u.orderId)?.status === 'CONFIRMED') continue;
      const order = ctx.orders.get(u.orderId);
      blockers.push({
        kind: 'UNDECIDED_ORDER',
        message: `${order?.orderNo ?? u.orderId} has no decision yet`,
        orderId: u.orderId,
        ...(order && { orderNo: order.orderNo }),
      });
    }

    return {
      opensAt,
      open: this.clock.now().getTime() >= opensAt.getTime(),
      blockers,
    };
  }
}
