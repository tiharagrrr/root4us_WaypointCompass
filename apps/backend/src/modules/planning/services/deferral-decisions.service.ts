import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import type { EditOp } from '@waypoint/engine';
import type { Actor } from '@waypoint/shared';
import { eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import {
  StateConflictError,
  ValidationError,
  type FieldError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { deferrals } from '../../../db/schema';
import { AuditService } from '../../audit';
import type { DeferralDecisionDto } from '../dto/plan-actions.dto';
import { PLANNING_AUDIT, PLANNING_EVENTS } from '../planning.constants';
import { DeferralService } from './deferral.service';
import type { PlanContext } from './plan-context.builder';
import { PlanEngine } from './plan-engine';
import { PlanWriter } from './plan-writer';
import { PlansService } from './plans.service';

/** A DEFER to write once the plan's trips are saved. */
interface Defer {
  orderId: string;
  reasonCode: string;
  note: string;
  overrideNote: string | null;
}

/**
 * What the dispatcher decides for unplanned orders on 15 and 16: DEFER with a
 * reason and a note for the store, PLAN_ON a trip, or SWAP with an order on
 * that trip (AC-PLN-05, 16, 17, 18). Every trip change goes through the
 * engine's applyEdits, so a decision can never break a hard rule unseen.
 *
 * A confirmed deferral only records the decision here; the order moves to
 * DEFERRED and the store hears about it when the plan is published (D6).
 */
@Injectable()
export class DeferralDecisions {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly plans: PlansService,
    private readonly engine: PlanEngine,
    private readonly writer: PlanWriter,
    private readonly deferralsService: DeferralService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(DeferralDecisions.name);
  }

  @Transactional()
  async decide(
    planId: string,
    version: number,
    decisions: readonly DeferralDecisionDto[],
    actor: Actor,
  ): Promise<PlanContext> {
    const ctx = await this.plans.loadDraft(planId, version, actor);
    const unplanned = new Map(ctx.draft.unplanned.map((u) => [u.orderId, u]));
    const errors: FieldError[] = [];
    const ops: EditOp[] = [];
    const defers: Defer[] = [];
    const swaps: {
      added: string;
      deferred: string;
      tripKey: string;
      reasonCode: string;
      swapReasonCode: string;
    }[] = [];

    decisions.forEach((d, i) => {
      const at = (field: string) => `decisions[${i}].${field}`;
      const entry = unplanned.get(d.orderId);
      if (!entry)
        throw new StateConflictError(
          `${ctx.orders.get(d.orderId)?.orderNo ?? d.orderId} is not unplanned on this plan.`,
        );
      if (d.action === 'DEFER') {
        if (!d.note)
          errors.push({
            field: at('note'),
            code: 'required',
            message: 'A note for the store is required',
          });
        if (entry.repeatSkip && !d.overrideNote)
          errors.push({
            field: at('overrideNote'),
            code: 'required',
            message:
              'This store was skipped on its last run; say why it waits again',
          });
        defers.push({
          orderId: d.orderId,
          reasonCode: d.reasonCode,
          note: d.note ?? '',
          overrideNote: d.overrideNote ?? null,
        });
        return;
      }
      if (!d.tripKey) {
        errors.push({
          field: at('tripKey'),
          code: 'required',
          message: 'Pick the trip',
        });
        return;
      }
      if (d.action === 'PLAN_ON') {
        ops.push({
          op: 'ASSIGN_ORDER',
          orderId: d.orderId,
          tripKey: d.tripKey,
        });
        return;
      }
      // SWAP: the other order leaves the trip and waits, with its own reason.
      if (!d.swapOrderId)
        errors.push({
          field: at('swapOrderId'),
          code: 'required',
          message: 'Pick the order to swap out',
        });
      if (!d.swapReasonCode)
        errors.push({
          field: at('swapReasonCode'),
          code: 'required',
          message: 'Say why that order waits',
        });
      if (!d.swapNote)
        errors.push({
          field: at('swapNote'),
          code: 'required',
          message: 'A note for that store is required',
        });
      if (!d.swapOrderId || !d.swapReasonCode || !d.swapNote) return;
      ops.push(
        { op: 'UNASSIGN_ORDER', orderId: d.swapOrderId },
        { op: 'ASSIGN_ORDER', orderId: d.orderId, tripKey: d.tripKey },
      );
      defers.push({
        orderId: d.swapOrderId,
        reasonCode: d.swapReasonCode,
        note: d.swapNote,
        overrideNote: d.overrideNote ?? null,
      });
      swaps.push({
        added: d.orderId,
        deferred: d.swapOrderId,
        tripKey: d.tripKey,
        reasonCode: d.reasonCode,
        swapReasonCode: d.swapReasonCode,
      });
    });
    if (errors.length) throw new ValidationError(errors);

    if (ops.length) {
      const result = this.engine.applyEdits(ctx.input, ctx.draft, ops);
      this.plans.refuseIntroduced(ctx, result.introduced, {});
      await this.writer.save(ctx, result.plan, { lockChanged: true });
    }

    for (const defer of defers) await this.confirm(ctx, defer, actor);
    for (const swap of swaps) {
      const trip = ctx.tripsByKey.get(swap.tripKey);
      await this.audit.record({
        action: PLANNING_AUDIT.orderSwapped,
        entity: ['plan', ctx.plan.id],
        after: {
          deferredOrderId: swap.deferred,
          addedOrderId: swap.added,
          tripId: trip?.id ?? null,
        },
        reasonCode: swap.reasonCode,
        reasonNote: `${swap.added}: ${swap.reasonCode}; ${swap.deferred}: ${swap.swapReasonCode}`,
      });
    }

    const plan = await this.plans.bump(ctx.plan);
    await this.outbox.add(
      PLANNING_EVENTS.planEdited,
      {
        v: 1,
        planId: plan.id,
        version: plan.version,
        decisions: decisions.length,
      },
      { aggregate: ['plan', plan.id], depotId: plan.depotId },
    );
    return this.plans.contextFor(plan);
  }

  /**
   * The order waits: its live deferral becomes CONFIRMED with the
   * dispatcher's reason and note, or a new one is written when the order was
   * taken off by hand. A repeat skip also records the override (AC-PLN-05).
   */
  private async confirm(
    ctx: PlanContext,
    defer: Defer,
    actor: Actor,
  ): Promise<void> {
    await this.deferralsService.assertReason(defer.reasonCode);
    const tx = this.txHost.tx;
    const order = ctx.orders.get(defer.orderId);
    const entry = ctx.draft.unplanned.find((u) => u.orderId === defer.orderId);
    const toDate = await this.deferralsService.deferralDate(
      defer.orderId,
      ctx.plan.date,
    );
    const now = this.clock.now();
    const values = {
      status: 'CONFIRMED' as const,
      reasonCode: defer.reasonCode,
      note: defer.note,
      overrideNote: defer.overrideNote,
      toDate,
      decidedById: actor.id,
      decidedAt: now,
      updatedAt: this.clock.realNow(),
    };
    // A swapped-out order has no row yet; nor has one taken off by hand.
    const live = ctx.deferrals.get(defer.orderId);
    let id: string;
    if (live && live.status !== 'CANCELLED') {
      await tx.update(deferrals).set(values).where(eq(deferrals.id, live.id));
      id = live.id;
    } else {
      const [row] = await tx
        .insert(deferrals)
        .values({
          ...values,
          orderId: defer.orderId,
          planId: ctx.plan.id,
          source: 'PLANNING',
          fromDate: ctx.plan.date,
          priorityScore: entry?.priority ?? null,
          repeatSkip: entry?.repeatSkip ?? false,
        })
        .returning({ id: deferrals.id });
      id = row.id;
    }

    await this.audit.record({
      action: PLANNING_AUDIT.deferralConfirmed,
      entity: ['deferral', id],
      after: { orderId: defer.orderId, reasonCode: defer.reasonCode, toDate },
      reasonCode: defer.reasonCode,
      reasonNote: defer.note,
    });
    if (entry?.repeatSkip && defer.overrideNote)
      await this.audit.record({
        action: PLANNING_AUDIT.repeatSkipOverridden,
        entity: ['deferral', id],
        after: { orderId: defer.orderId },
        reasonNote: defer.overrideNote,
      });
    this.log.info(
      {
        event: PLANNING_AUDIT.deferralConfirmed,
        planId: ctx.plan.id,
        orderId: defer.orderId,
        reasonCode: defer.reasonCode,
        outletId: order?.outletId,
      },
      'deferral confirmed',
    );
  }
}
