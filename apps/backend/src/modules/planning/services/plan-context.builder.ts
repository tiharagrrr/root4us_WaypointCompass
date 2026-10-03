import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import {
  allowanceKey,
  manualUnplanned,
  resolveParams,
  tripKeyOf,
  unplannedOrders,
  type EngineInput,
  type EngineParams,
  type FairnessHistory,
  type Plan,
  type TripDraft,
  type Unplanned,
} from '@waypoint/engine';
import { addDays } from '@waypoint/shared';
import { and, asc, eq, inArray, lt, max, notInArray, sql } from 'drizzle-orm';
import { SettingsService } from '../../../core/settings/settings.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  deferrals,
  districts,
  orders,
  outlets,
  plans,
  serviceAllowances,
  stops,
  trips,
} from '../../../db/schema';
import {
  FuelLedgerService,
  VehicleQueries,
  type VehicleRow,
} from '../../fleet';
import { CalendarService } from '../../master-data';
import { OrderQueries, type OrderRow } from '../../ordering';

export type PlanRow = typeof plans.$inferSelect;
export type TripRow = typeof trips.$inferSelect;
export type StopRow = typeof stops.$inferSelect;
export type DeferralRow = typeof deferrals.$inferSelect;
export type OutletRow = typeof outlets.$inferSelect;
export type DistrictRow = typeof districts.$inferSelect;

/** Live means not cancelled: what a plan still holds. */
const DEAD_STOP = ['CANCELLED', 'FAILED'] as const;

/**
 * One plan as the engine sees it, with the rows it came from, so a service
 * can map engine results back to trips, stops, orders and deferrals.
 */
export interface PlanContext {
  plan: PlanRow;
  input: EngineInput;
  params: EngineParams;
  /** The saved plan in engine terms: trips by key, and every order on no trip. */
  draft: Plan;
  /** Live trips, keyed by trip key (`REF-07#1`). */
  tripsByKey: Map<string, TripRow>;
  /** Live stops per trip id, in seq order. */
  stopsByTrip: Map<string, StopRow[]>;
  orders: Map<string, OrderRow>;
  outlets: Map<string, OutletRow>;
  districts: Map<string, DistrictRow>;
  vehicles: Map<string, VehicleRow>;
  /** The live whole-order deferral of each order, PROPOSED or CONFIRMED. */
  deferrals: Map<string, DeferralRow>;
}

/**
 * Builds the engine input for a plan from the database: the depot's fleet,
 * outlets, districts and allowances, the day's queue (ordering's
 * `queueFor`) plus any order already on one of the plan's stops, fairness
 * history, the fuel used this week and the planning settings. Every list is
 * sorted by id so the same rows always give the same input (AC-PLN-09).
 *
 * `/plans/{id}/context` returns it, so the web runs the same engine in the
 * browser (AC-PLN-12).
 */
@Injectable()
export class PlanContextBuilder {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly orderQueries: OrderQueries,
    private readonly vehicleQueries: VehicleQueries,
    private readonly fuel: FuelLedgerService,
    private readonly calendar: CalendarService,
    private readonly settings: SettingsService,
  ) {}

  async build(plan: PlanRow): Promise<PlanContext> {
    const tx = this.txHost.tx;
    const [vehicleRows, outletRows, districtRows, allowanceRows, tripRows] =
      await Promise.all([
        this.vehicleQueries.forDepot(plan.depotId),
        tx
          .select()
          .from(outlets)
          .where(eq(outlets.depotId, plan.depotId))
          .orderBy(asc(outlets.id)),
        tx
          .select()
          .from(districts)
          .where(eq(districts.depotId, plan.depotId))
          .orderBy(asc(districts.id)),
        tx.select().from(serviceAllowances),
        tx
          .select()
          .from(trips)
          .where(
            and(eq(trips.planId, plan.id), sql`${trips.status} <> 'CANCELLED'`),
          )
          .orderBy(asc(trips.vehicleId), asc(trips.tripNo)),
      ]);

    const stopRows = tripRows.length
      ? await tx
          .select()
          .from(stops)
          .where(
            and(
              inArray(
                stops.tripId,
                tripRows.map((t) => t.id),
              ),
              notInArray(stops.status, [...DEAD_STOP]),
            ),
          )
          .orderBy(asc(stops.tripId), asc(stops.seq))
      : [];

    const queue = await this.orderQueries.queueFor(plan.depotId, plan.date);
    const queued = new Set(queue.map((o) => o.id));
    const onStops = stopRows
      .map((s) => s.orderId)
      .filter((id) => !queued.has(id));
    const extra = onStops.length
      ? await tx.select().from(orders).where(inArray(orders.id, onStops))
      : [];
    const orderRows = [...queue, ...extra].sort((a, b) =>
      a.id.localeCompare(b.id),
    );

    const vehicles = new Map(vehicleRows.map((v) => [v.id, v]));
    const params = await this.paramsFor(plan.depotId);
    const input: EngineInput = {
      date: plan.date,
      isOperatingDay: await this.calendar.isOperating(plan.date),
      vehicles: vehicleRows.map((v) => ({
        id: v.id,
        code: v.code,
        depotId: v.depotId,
        type: v.type,
        temp: v.temp,
        weightCapKg: v.weightCapKg,
        volumeCapM3: v.volumeCapM3,
        kmPerL: v.kmPerL,
        weeklyFuelQuotaL: v.weeklyFuelQuotaL,
        available: v.status === 'ACTIVE',
        unavailableReason: v.status === 'ACTIVE' ? null : v.status,
      })),
      outlets: Object.fromEntries(
        outletRows.map((o) => [
          o.id,
          {
            id: o.id,
            depotId: o.depotId,
            dockType: o.dockType,
            parkingConstraint: o.parkingConstraint,
            windowOpenMin: o.windowOpenMin,
            windowCloseMin: o.windowCloseMin,
            mallWindowOpenMin: o.mallWindowOpenMin,
            mallWindowCloseMin: o.mallWindowCloseMin,
            styleDeliveryDow: o.styleDeliveryDow,
          },
        ]),
      ),
      districts: Object.fromEntries(
        districtRows.map((d) => [
          d.id,
          {
            id: d.id,
            name: d.name,
            depotToDistrictMin: d.depotToDistrictMin,
            interStopMin: d.interStopMin,
            depotToDistrictKm: d.depotToDistrictKm,
            interStopKm: d.interStopKm,
          },
        ]),
      ),
      allowances: Object.fromEntries(
        allowanceRows
          .map((a) => [allowanceKey(a.brand, a.dockType), a.minutes] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
      orders: orderRows.map((o) => ({
        id: o.id,
        ref: o.orderNo,
        outletId: o.outletId,
        brand: o.brand,
        districtId: o.districtId,
        tempClass: o.tempClass,
        units: o.units,
        weightKg: o.weightKg,
        volumeM3: o.volumeM3,
        valueLkr: o.valueLkr,
        urgent: o.urgent,
      })),
      history: await this.historyFor(orderRows, plan.date),
      fuelUsedThisWeek: Object.fromEntries(
        await this.fuel.usedThisWeek(
          vehicleRows.map((v) => v.id),
          plan.date,
          { excludePlanId: plan.id },
        ),
      ),
      // Released and in-progress trips are fixed once revisions after publish
      // land (ROO-42); a draft has none.
      fixedTrips: [],
      params,
    };

    const stopsByTrip = new Map<string, StopRow[]>();
    for (const stop of stopRows)
      stopsByTrip.set(stop.tripId, [
        ...(stopsByTrip.get(stop.tripId) ?? []),
        stop,
      ]);

    const tripsByKey = new Map<string, TripRow>();
    const drafts: TripDraft[] = [];
    for (const trip of tripRows) {
      const vehicle = vehicles.get(trip.vehicleId);
      if (!vehicle || trip.tripNo == null) continue;
      const key = tripKeyOf(vehicle.code, trip.tripNo);
      tripsByKey.set(key, trip);
      drafts.push({
        key,
        vehicleId: trip.vehicleId,
        tripNo: trip.tripNo,
        brand: trip.brand,
        districtId: trip.districtId,
        orderIds: (stopsByTrip.get(trip.id) ?? []).map((s) => s.orderId),
        locked: trip.locked,
        reserved: trip.isReserved,
      });
    }

    const deferralRows = await tx
      .select()
      .from(deferrals)
      .where(
        and(
          eq(deferrals.planId, plan.id),
          inArray(deferrals.status, ['PROPOSED', 'CONFIRMED']),
          eq(deferrals.partial, false),
        ),
      );
    const liveDeferrals = new Map(deferralRows.map((d) => [d.orderId, d]));
    const resolved = resolveParams(params);
    const draft: Plan = {
      trips: drafts,
      unplanned: unplannedOrders(input, { trips: drafts, unplanned: [] }).map(
        (order): Unplanned => {
          const own = manualUnplanned(input, order, resolved);
          const row = liveDeferrals.get(order.id);
          if (!row) return own;
          return {
            ...own,
            reasonCode: row.reasonCode,
            bindingRule: (row.bindingRule as Unplanned['bindingRule']) ?? null,
            choice: row.choice ?? null,
          };
        },
      ),
    };

    return {
      plan,
      input,
      params: resolved,
      draft,
      tripsByKey,
      stopsByTrip,
      orders: new Map(orderRows.map((o) => [o.id, o])),
      outlets: new Map(outletRows.map((o) => [o.id, o])),
      districts: new Map(districtRows.map((d) => [d.id, d])),
      vehicles,
      deferrals: liveDeferrals,
    };
  }

  /** The planning settings the engine reads, for the depot. */
  private async paramsFor(depotId: string): Promise<Partial<EngineParams>> {
    const get = <K extends Parameters<SettingsService['get']>[0]>(key: K) =>
      this.settings.get(key, depotId);
    const [
      freshStartMin,
      reloadMin,
      enforceWindows,
      reeferCarriesAmbient,
      techValue,
      lookback,
      weights,
    ] = await Promise.all([
      get('planning.freshStartMin'),
      get('planning.reloadMinutes'),
      get('planning.enforceWindows'),
      get('planning.reeferCarriesAmbient'),
      get('planning.techValueLimitLkr'),
      get('planning.repeatSkipLookbackRuns'),
      get('planning.priorityWeights'),
    ]);
    return {
      freshStartMin,
      reloadMin,
      enforceWindows,
      reeferCarriesAmbient,
      // Unset or 0 means the Tech value rule is off (specs/planning/spec.md).
      techValueLimitLkr: techValue ? techValue : null,
      repeatSkipLookbackRuns: lookback,
      priorityWeights: weights,
    };
  }

  /**
   * Fairness per outlet, from the orders themselves: an order that waits as
   * DEFERRED carries how many runs it has been deferred, so its outlet was
   * deferred on its last run; days since last served is the gap to the
   * outlet's last delivered order.
   */
  private async historyFor(
    queue: readonly OrderRow[],
    date: string,
  ): Promise<Record<string, FairnessHistory>> {
    const outletIds = [...new Set(queue.map((o) => o.outletId))].sort();
    if (outletIds.length === 0) return {};
    const served = await this.txHost.tx
      .select({ outletId: orders.outletId, last: max(orders.deliveryDate) })
      .from(orders)
      .where(
        and(
          inArray(orders.outletId, outletIds),
          inArray(orders.status, [
            'DELIVERED',
            'PARTIAL',
            'RECEIVED',
            'ISSUE_REPORTED',
          ]),
          lt(orders.deliveryDate, date),
        ),
      )
      .groupBy(orders.outletId);
    const lastServed = new Map(served.map((s) => [s.outletId, s.last]));

    const history: Record<string, FairnessHistory> = {};
    for (const outletId of outletIds) {
      const deferred = Math.max(
        0,
        ...queue
          .filter((o) => o.outletId === outletId)
          .map((o) => o.deferredCount),
      );
      const last = lastServed.get(outletId);
      history[outletId] = {
        deferredOnLastRun: deferred > 0,
        consecutiveDeferrals: deferred,
        daysSinceLastServed: last ? daysBetween(last, date) : 0,
      };
    }
    return history;
  }
}

function daysBetween(from: string, to: string): number {
  let days = 0;
  for (let d = from; d < to && days < 366; d = addDays(d, 1)) days += 1;
  return days;
}
