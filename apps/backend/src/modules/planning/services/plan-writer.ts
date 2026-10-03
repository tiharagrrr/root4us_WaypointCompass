import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import {
  planSchedule,
  tripKeyOf,
  type Plan,
  type ScheduledTrip,
  type TripDraft,
} from '@waypoint/engine';
import { instantAt } from '@waypoint/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { ClockService } from '../../../core/clock/clock.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { deferrals, stops, trips } from '../../../db/schema';
import type { PlanContext, StopRow, TripRow } from './plan-context.builder';

export interface SaveOptions {
  /** Mark every trip whose orders changed as built by hand (edits, decisions). */
  lockChanged: boolean;
}

/**
 * The one way trips and stops are written from an engine plan (edits,
 * decisions and engine runs all come here), so the rows always say what the
 * engine measured: totals, planned departure, each stop's arrival, travel and
 * service minutes and its window.
 *
 * - A trip is matched by vehicle and trip number; a new one is inserted, one
 *   the plan no longer has is cancelled with `tripNo` null (freeing the slot),
 *   and so is one left with no orders, unless it is a reservation (D5).
 * - A stop is matched by trip and order. A stop that left is cancelled before
 *   any is inserted, so an order moving trips never holds two live stops.
 *   Kept stops take their new seq in two steps (negative first), because
 *   `(tripId, seq)` is unique.
 * - Any live deferral of an order that is now on a trip is cancelled: the
 *   order is planned after all (AC-PLN-17).
 *
 * Runs in the caller's transaction; the caller audits and bumps the plan.
 */
@Injectable()
export class PlanWriter {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
  ) {}

  /** Returns the ids of the trips it inserted, changed or cancelled. */
  @Transactional()
  async save(
    ctx: PlanContext,
    after: Plan,
    { lockChanged }: SaveOptions,
  ): Promise<string[]> {
    const tx = this.txHost.tx;
    const { plan } = ctx;
    // measureTrip keeps only what it measures, so the flags come from the drafts.
    const drafts = new Map<string, TripDraft>();
    for (const d of after.trips) {
      const code = ctx.vehicles.get(d.vehicleId)?.code;
      if (code) drafts.set(d.key ?? tripKeyOf(code, d.tripNo), d);
    }
    const reserved = (t: ScheduledTrip) => Boolean(drafts.get(t.key)?.reserved);
    const scheduled = planSchedule(ctx.input, after).filter(
      (t) => t.orderIds.length > 0 || reserved(t),
    );
    const wanted = new Map(scheduled.map((t) => [t.key, t]));
    const touched = new Set<string>();
    const now = this.clock.realNow();

    // 1. Trips the plan no longer has, or whose brand or district changed
    //    (stops are keyed on both), go first, with every stop on them.
    for (const [key, row] of ctx.tripsByKey) {
      const next = wanted.get(key);
      if (
        next &&
        next.brand === row.brand &&
        next.districtId === row.districtId
      )
        continue;
      await this.cancelStops(
        ctx.stopsByTrip.get(row.id) ?? [],
        'removed from the plan',
      );
      await tx
        .update(trips)
        .set({
          status: 'CANCELLED',
          tripNo: null,
          cancelReason: 'removed from the plan',
          version: sql`${trips.version} + 1`,
          updatedAt: now,
        })
        .where(eq(trips.id, row.id));
      ctx.tripsByKey.delete(key);
      touched.add(row.id);
    }

    // 2. Stops that left a kept trip.
    for (const [key, row] of ctx.tripsByKey) {
      const keep = new Set(wanted.get(key)?.orderIds ?? []);
      const gone = (ctx.stopsByTrip.get(row.id) ?? []).filter(
        (s) => !keep.has(s.orderId),
      );
      if (gone.length) {
        await this.cancelStops(gone, 'moved off the trip');
        touched.add(row.id);
      }
    }

    // 3. Insert or update each wanted trip, then lay its stops.
    for (const next of scheduled) {
      const existing = ctx.tripsByKey.get(next.key);
      const before = existing
        ? (ctx.stopsByTrip.get(existing.id) ?? []).map((s) => s.orderId)
        : [];
      const changed = !existing || before.join('|') !== next.orderIds.join('|');
      const values = this.tripValues(ctx, next);
      const locked =
        (existing?.locked ?? Boolean(drafts.get(next.key)?.locked)) ||
        (lockChanged && changed);

      let tripId: string;
      if (existing) {
        tripId = existing.id;
        await tx
          .update(trips)
          .set({
            ...values,
            locked,
            status:
              existing.status === 'RESERVED' && next.orderIds.length > 0
                ? 'PLANNED'
                : existing.status,
            version: changed ? sql`${trips.version} + 1` : existing.version,
            updatedAt: now,
          })
          .where(eq(trips.id, existing.id));
      } else {
        const [row] = await tx
          .insert(trips)
          .values({
            ...values,
            planId: plan.id,
            depotId: plan.depotId,
            vehicleId: next.vehicleId,
            tripNo: next.tripNo,
            brand: next.brand,
            districtId: next.districtId,
            status:
              reserved(next) && next.orderIds.length === 0
                ? 'RESERVED'
                : 'PLANNED',
            isReserved: reserved(next),
            locked,
          })
          .returning({ id: trips.id });
        tripId = row.id;
      }
      if (changed) touched.add(tripId);
      await this.layStops(
        ctx,
        tripId,
        next,
        existing ? (ctx.stopsByTrip.get(existing.id) ?? []) : [],
      );
    }

    // 4. Orders on a trip again are no longer deferred.
    const planned = scheduled.flatMap((t) => t.orderIds);
    if (planned.length)
      await tx
        .update(deferrals)
        .set({ status: 'CANCELLED', updatedAt: now })
        .where(
          and(
            eq(deferrals.planId, plan.id),
            inArray(deferrals.orderId, planned),
            inArray(deferrals.status, ['PROPOSED', 'CONFIRMED']),
            eq(deferrals.partial, false),
          ),
        );

    return [...touched].sort();
  }

  /** What a trip row stores from the engine's measured, scheduled trip. */
  private tripValues(ctx: PlanContext, t: ScheduledTrip) {
    const chilled = t.orderIds.some(
      (id) => ctx.orders.get(id)?.tempClass === 'CHILLED',
    );
    return {
      tempClass: chilled ? ('CHILLED' as const) : ('AMBIENT' as const),
      plannedDepartAt: instantAt(ctx.plan.date, t.departMin),
      plannedReturnAt: instantAt(ctx.plan.date, t.returnMin),
      budgetMinutes: t.minutes,
      plannedKm: t.km,
      plannedFuelL: t.litres,
      loadWeightKg: t.weightKg,
      loadVolumeM3: t.volumeM3,
    };
  }

  private async layStops(
    ctx: PlanContext,
    tripId: string,
    t: ScheduledTrip,
    current: readonly StopRow[],
  ): Promise<void> {
    const tx = this.txHost.tx;
    const live = new Map(
      current
        .filter((s) => t.orderIds.includes(s.orderId))
        .map((s) => [s.orderId, s]),
    );
    // Free every seq first, so the final ones never collide.
    if (live.size)
      await tx
        .update(stops)
        .set({ seq: sql`-${stops.seq}` })
        .where(
          inArray(
            stops.id,
            [...live.values()].map((s) => s.id),
          ),
        );

    for (const [i, stop] of t.stops.entries()) {
      const order = ctx.orders.get(stop.orderId);
      if (!order) continue;
      const values = {
        seq: i + 1,
        plannedArrivalAt: instantAt(ctx.plan.date, stop.arriveMin),
        plannedTravelMin: stop.travelMin,
        plannedServiceMin: stop.serviceMin,
        windowOpenMin: stop.windowOpenMin,
        windowCloseMin: stop.windowCloseMin,
      };
      const existing = live.get(stop.orderId);
      if (existing)
        await tx.update(stops).set(values).where(eq(stops.id, existing.id));
      else
        await tx.insert(stops).values({
          ...values,
          tripId,
          orderId: order.id,
          outletId: order.outletId,
          depotId: ctx.plan.depotId,
          brand: order.brand,
          districtId: order.districtId,
        });
    }
  }

  private async cancelStops(
    rows: readonly StopRow[],
    reason: string,
  ): Promise<void> {
    if (rows.length === 0) return;
    await this.txHost.tx
      .update(stops)
      .set({
        status: 'CANCELLED',
        seq: null,
        cancelledReason: reason,
        version: sql`${stops.version} + 1`,
        updatedAt: this.clock.realNow(),
      })
      .where(
        inArray(
          stops.id,
          rows.map((s) => s.id),
        ),
      );
  }
}

export type { TripRow };
