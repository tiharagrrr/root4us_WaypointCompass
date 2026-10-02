import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type Actor, minuteLabel } from '@waypoint/shared';
import { and, eq, sql } from 'drizzle-orm';
import { ClockService } from '../../../core/clock/clock.service';
import { NotFoundError } from '../../../core/errors/domain-errors';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { depots, orders } from '../../../db/schema';
import { OrderScope } from '../policies/order.scope';
import { CutoffCloseService } from './cutoff-close.service';
import { CutoffService } from './cutoff.service';

/** One depot's delivery day, summed the way 01 and 03 show it. */
export interface DepotDaySummary {
  depotId: string;
  date: string;
  total: number;
  byStatus: Record<string, number>;
  byBrand: Record<string, number>;
  byClass: Record<string, number>;
  urgent: number;
  afterCutoff: number;
  units: number;
  weightKg: number;
  volumeM3: number;
  cutoff: {
    at: Date;
    cutoffMin: number;
    passed: boolean;
    closed: boolean;
    closedAt: Date | null;
    minutesLeft: number;
  };
}

/**
 * The day summary behind 01 Today and 03 Order queue: how many orders sit in
 * each status, brand and class on one depot's run, and where its cutoff
 * stands (AC-ORD-35). The counts come from one grouped query over the same
 * rows `GET /orders` would return, with the actor's scope applied, so a
 * dispatcher at Peliyagoda cannot read Kandy's day.
 */
@Injectable()
export class DepotDayQueries {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: OrderScope,
    private readonly cutoff: CutoffService,
    private readonly closures: CutoffCloseService,
    private readonly clock: ClockService,
  ) {}

  async summary(
    depotId: string,
    date: string,
    actor: Actor,
  ): Promise<DepotDaySummary> {
    await this.depotInScope(depotId, actor);

    const rows = await this.txHost.tx
      .select({
        status: orders.status,
        brand: orders.brand,
        tempClass: orders.tempClass,
        urgent: orders.urgent,
        afterCutoff: orders.afterCutoff,
        count: sql<number>`count(*)::int`,
        units: sql<number>`coalesce(sum(${orders.units}), 0)::int`,
        weightKg: sql<number>`coalesce(sum(${orders.weightKg}), 0)::double precision`,
        volumeM3: sql<number>`coalesce(sum(${orders.volumeM3}), 0)::double precision`,
      })
      .from(orders)
      .where(
        and(
          eq(orders.depotId, depotId),
          eq(orders.deliveryDate, date),
          this.scope.where(actor),
        ),
      )
      .groupBy(
        orders.status,
        orders.brand,
        orders.tempClass,
        orders.urgent,
        orders.afterCutoff,
      );

    const byStatus: Record<string, number> = {};
    const byBrand: Record<string, number> = {};
    const byClass: Record<string, number> = {};
    let total = 0;
    let urgent = 0;
    let afterCutoff = 0;
    let units = 0;
    let weightKg = 0;
    let volumeM3 = 0;
    for (const row of rows) {
      total += row.count;
      byStatus[row.status] = (byStatus[row.status] ?? 0) + row.count;
      byBrand[row.brand] = (byBrand[row.brand] ?? 0) + row.count;
      byClass[row.tempClass] = (byClass[row.tempClass] ?? 0) + row.count;
      if (row.urgent) urgent += row.count;
      if (row.afterCutoff) afterCutoff += row.count;
      units += row.units;
      weightKg += row.weightKg;
      volumeM3 += row.volumeM3;
    }

    const [at, cutoffMin, closedAt] = await Promise.all([
      this.cutoff.cutoffAt(depotId, date),
      this.cutoff.cutoffMinFor(depotId),
      this.closures.closedAt(depotId, date),
    ]);
    const now = this.clock.now();
    const msLeft = at.getTime() - now.getTime();
    return {
      depotId,
      date,
      total,
      byStatus,
      byBrand,
      byClass,
      urgent,
      afterCutoff,
      units,
      weightKg: Math.round(weightKg * 100) / 100,
      volumeM3: Math.round(volumeM3 * 100) / 100,
      cutoff: {
        at,
        cutoffMin,
        passed: msLeft <= 0,
        closed: closedAt !== null,
        closedAt,
        minutesLeft: msLeft > 0 ? Math.ceil(msLeft / 60_000) : 0,
      },
    };
  }

  /** The cutoff label a screen shows beside the countdown. */
  cutoffLabel(cutoffMin: number): string {
    return minuteLabel(cutoffMin);
  }

  /**
   * The depot exists, and it is one this actor may ask about. A dispatcher or
   * loader tied to another depot gets the same 404 as a depot that does not
   * exist, so a depot id tells them nothing (AC-ORD-33). An admin and a store
   * manager may ask about any depot; `OrderScope` then decides which orders
   * the numbers count, so a store manager's day covers their outlet only.
   */
  private async depotInScope(depotId: string, actor: Actor): Promise<void> {
    const [row] = await this.txHost.tx
      .select({ id: depots.id })
      .from(depots)
      .where(eq(depots.id, depotId));
    if (!row) throw new NotFoundError('depot');
    const tiedElsewhere =
      (actor.role === 'dispatcher' || actor.role === 'loader') &&
      Boolean(actor.depotId) &&
      actor.depotId !== depotId;
    const loaderWithoutDepot = actor.role === 'loader' && !actor.depotId;
    if (tiedElsewhere || loaderWithoutDepot) throw new NotFoundError('depot');
  }
}
