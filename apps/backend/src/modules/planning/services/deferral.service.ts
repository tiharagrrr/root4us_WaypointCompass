import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import { and, eq, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import { NotFoundError } from '../../../core/errors/domain-errors';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  deferralReasons,
  deferrals,
  orders,
  outlets,
  planRevisions,
  plans,
  trips,
} from '../../../db/schema';
import { AuditService } from '../../audit';
import { CutoffService } from '../../ordering';
import { PLANNING_AUDIT } from '../planning.constants';

export type DeferralRow = typeof deferrals.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;

/** What a deferral's audit row keeps: the fields a reviewer reads. */
const auditShape = (d: DeferralRow) => ({
  status: d.status,
  source: d.source,
  reasonCode: d.reasonCode,
  partial: d.partial,
  fromDate: d.fromDate,
  toDate: d.toDate,
  note: d.note,
});

export interface PartialDeferralInput {
  /** The order part of whose goods are not travelling. */
  orderId: string;
  /** The trip the removal happened on, which fixes the plan and its date. */
  tripId: string;
  /** A code from `deferral_reasons`; required (AC-LOD-08). */
  reasonCode: string;
  /** The dispatcher's note, which the store sees. */
  note?: string | null;
  /** What the removal is recorded against, for the plan revision's log. */
  detail?: Record<string, unknown>;
}

export interface PartialDeferral {
  deferral: DeferralRow;
  /** The plan's revision after the removal, which load lines are stamped with. */
  revision: number;
  planId: string;
  /** The date the deferred goods are now due, for the backorder. */
  toDate: string;
}

/**
 * Deferrals other modules cause (architecture rule 2: only planning writes
 * `deferrals`, `plans` and `plan_revisions`).
 *
 * Today that is one use case: a loader found goods missing, a dispatcher
 * decided REMOVE, and part of an order is not travelling (AC-LOD-12). The
 * whole-order deferrals the engine proposes and the dispatcher confirms on
 * 16 and 17 are planning's own and land with the planning API; this method
 * is deliberately narrow so it cannot be used for them by accident.
 *
 * It runs inside loading's transaction, so the deferral, the plan's new
 * revision and the flag's decision all commit together, and `@Transactional()`
 * joins that transaction rather than opening one of its own.
 */
@Injectable()
export class DeferralService {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly audit: AuditService,
    private readonly cutoff: CutoffService,
    private readonly log: PinoLogger,
  ) {
    this.log.setContext(DeferralService.name);
  }

  /**
   * Records that part of an order is staying behind, and bumps the plan's
   * revision so the dock's list and the driver's bundle both know the plan
   * changed. The deferral is CONFIRMED rather than PROPOSED: nobody is being
   * asked, the goods are already not on the vehicle.
   */
  @Transactional()
  async deferPartially(input: PartialDeferralInput): Promise<PartialDeferral> {
    await this.assertReason(input.reasonCode);
    const plan = await this.planOf(input.tripId);
    const toDate = await this.deferralDate(input.orderId, plan.date);

    const [deferral] = await this.txHost.tx
      .insert(deferrals)
      .values({
        orderId: input.orderId,
        planId: plan.id,
        status: 'CONFIRMED',
        source: 'LOAD_CHECK',
        reasonCode: input.reasonCode,
        reasonDetail: input.detail ?? null,
        note: input.note ?? null,
        fromDate: plan.date,
        toDate,
        partial: true,
        decidedAt: this.clock.now(),
      })
      .returning();

    const revision = await this.revise(plan, {
      reasonCode: input.reasonCode,
      note: input.note ?? null,
      tripId: input.tripId,
      orderId: input.orderId,
      detail: input.detail ?? {},
    });

    await this.audit.record({
      action: PLANNING_AUDIT.stopDeferred,
      entity: ['deferral', deferral.id],
      after: { ...auditShape(deferral), revision },
      reasonCode: input.reasonCode,
      ...(input.note && { reasonNote: input.note }),
    });
    this.log.info(
      {
        event: PLANNING_AUDIT.stopDeferred,
        planId: plan.id,
        tripId: input.tripId,
        orderId: input.orderId,
        reasonCode: input.reasonCode,
        partial: true,
        revision,
      },
      'part of an order was deferred at the dock',
    );

    return { deferral, revision, planId: plan.id, toDate };
  }

  /**
   * The plan's next revision, with a row saying what changed and why. The
   * update is one statement on `revision`, so two removals on the same plan
   * cannot both read revision 1 and both write 2.
   */
  private async revise(
    plan: PlanRow,
    change: {
      reasonCode: string;
      note: string | null;
      tripId: string;
      orderId: string;
      detail: Record<string, unknown>;
    },
  ): Promise<number> {
    const [bumped] = await this.txHost.tx
      .update(plans)
      .set({
        revision: sql`${plans.revision} + 1`,
        version: sql`${plans.version} + 1`,
        updatedAt: this.clock.realNow(),
      })
      .where(eq(plans.id, plan.id))
      .returning({ revision: plans.revision });

    await this.txHost.tx.insert(planRevisions).values({
      planId: plan.id,
      revision: bumped.revision,
      reasonCode: change.reasonCode,
      note: change.note,
      changes: [{ op: 'REMOVE_LOAD_LINE', ...change }],
      affectedTripIds: [change.tripId],
      affectedOutletIds: [],
    });
    return bumped.revision;
  }

  /** The plan a trip belongs to, locked, so its revision moves once. */
  private async planOf(tripId: string): Promise<PlanRow> {
    const [row] = await this.txHost.tx
      .select({ plan: plans })
      .from(trips)
      .innerJoin(plans, eq(plans.id, trips.planId))
      .where(eq(trips.id, tripId))
      .for('update', { of: plans });
    if (!row) throw new NotFoundError('trip');
    return row.plan;
  }

  /**
   * A reason code nobody registered would leave a deferral the store cannot
   * be told about, so it is a 404 on the reason rather than a bad row. The
   * code must also still be active: A6 turns a reason off when it stops
   * being used (AC-IDN-57).
   */
  private async assertReason(code: string): Promise<void> {
    const [row] = await this.txHost.tx
      .select({ code: deferralReasons.code })
      .from(deferralReasons)
      .where(
        and(eq(deferralReasons.code, code), eq(deferralReasons.active, true)),
      );
    if (!row) throw new NotFoundError('deferral reason');
  }

  /**
   * The run deferred goods are due on: the next run after the plan's date,
   * which is the next operating day, or for a Style outlet its next weekly
   * delivery day (ordering's `nextRun`, the same answer a late order gets).
   * Any other date would put the goods on a day with no run for them, and
   * the engine would leave them out as not due.
   */
  private async deferralDate(
    orderId: string,
    planDate: string,
  ): Promise<string> {
    const [row] = await this.txHost.tx
      .select({
        brand: orders.brand,
        styleDeliveryDow: outlets.styleDeliveryDow,
      })
      .from(orders)
      .innerJoin(outlets, eq(outlets.id, orders.outletId))
      .where(eq(orders.id, orderId));
    if (!row) throw new NotFoundError('order');
    return this.cutoff.nextRun(planDate, row);
  }
}
