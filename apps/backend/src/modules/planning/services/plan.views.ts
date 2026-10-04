import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { resolveParams, type Violation } from '@waypoint/engine';
import { inArray } from 'drizzle-orm';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { deferralReasons, users } from '../../../db/schema';
import type { PlanDto, PlanStopDto, TripDto } from '../dto/plan.dto';
import type { UnplannedOrderDto } from '../dto/plan-actions.dto';
import type { PlanContext } from './plan-context.builder';

/**
 * Shapes a plan's rows into the responses 05, 09 and 15 read. Names (driver,
 * outlet, district, vehicle code) come from the context the engine ran on, so
 * a screen and the engine always describe the same plan.
 */
@Injectable()
export class PlanViews {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
  ) {}

  plan(ctx: PlanContext, opensAt: Date, links: PlanDto['_links']): PlanDto {
    const { plan } = ctx;
    const undecided = ctx.draft.unplanned.filter(
      (u) => ctx.deferrals.get(u.orderId)?.status !== 'CONFIRMED',
    ).length;
    return {
      id: plan.id,
      depotId: plan.depotId,
      date: plan.date,
      status: plan.status,
      revision: plan.revision,
      version: plan.version,
      publishOpensAt: opensAt.toISOString(),
      publishedAt: plan.publishedAt?.toISOString() ?? null,
      publishedById: plan.publishedById,
      closedAt: plan.closedAt?.toISOString() ?? null,
      summary: {
        trips: ctx.draft.trips.filter((t) => t.orderIds.length > 0).length,
        plannedOrders: ctx.draft.trips.reduce(
          (n, t) => n + t.orderIds.length,
          0,
        ),
        unplanned: ctx.draft.unplanned.length,
        undecided,
      },
      _links: links,
    };
  }

  async trips(
    ctx: PlanContext,
    violations: readonly Violation[],
  ): Promise<TripDto[]> {
    const params = resolveParams(ctx.input.params);
    const driverIds = [...ctx.tripsByKey.values()]
      .map((t) => t.driverId)
      .filter((id): id is string => Boolean(id));
    const drivers = driverIds.length
      ? await this.txHost.tx
          .select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, driverIds))
      : [];
    const driverName = new Map(drivers.map((d) => [d.id, d.name]));

    return [...ctx.tripsByKey.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, trip]) => {
        const vehicle = ctx.vehicles.get(trip.vehicleId);
        const stops: PlanStopDto[] = (ctx.stopsByTrip.get(trip.id) ?? []).map(
          (s) => {
            const order = ctx.orders.get(s.orderId);
            return {
              id: s.id,
              seq: s.seq,
              status: s.status,
              orderId: s.orderId,
              orderNo: order?.orderNo ?? '',
              outletId: s.outletId,
              outletName: ctx.outlets.get(s.outletId)?.name ?? s.outletId,
              units: order?.units ?? 0,
              weightKg: order?.weightKg ?? 0,
              volumeM3: order?.volumeM3 ?? 0,
              plannedArrivalAt: s.plannedArrivalAt?.toISOString() ?? null,
              plannedServiceMin: s.plannedServiceMin,
              windowOpenMin: s.windowOpenMin,
              windowCloseMin: s.windowCloseMin,
            };
          },
        );
        return {
          id: trip.id,
          key,
          planId: trip.planId,
          vehicleId: trip.vehicleId,
          vehicleCode: vehicle?.code ?? trip.vehicleId,
          driverId: trip.driverId,
          driverName: trip.driverId
            ? (driverName.get(trip.driverId) ?? null)
            : null,
          tripNo: trip.tripNo,
          brand: trip.brand,
          districtId: trip.districtId,
          districtName:
            ctx.districts.get(trip.districtId)?.name ?? trip.districtId,
          tempClass: trip.tempClass,
          status: trip.status,
          locked: trip.locked,
          isReserved: trip.isReserved,
          waveId: trip.waveId,
          plannedDepartAt: trip.plannedDepartAt?.toISOString() ?? null,
          minutes: trip.budgetMinutes,
          budgetMinutes:
            trip.brand === 'FRESH'
              ? params.freshBudgetMin
              : params.styleTechBudgetMin,
          plannedKm: trip.plannedKm,
          plannedFuelL: trip.plannedFuelL,
          loadWeightKg: trip.loadWeightKg,
          loadVolumeM3: trip.loadVolumeM3,
          weightCapKg: vehicle?.weightCapKg ?? 0,
          volumeCapM3: vehicle?.volumeCapM3 ?? 0,
          version: trip.version,
          stops,
          violations: violations.filter((v) => v.tripKey === key),
          _links: { self: { href: `/api/v1/trips/${trip.id}` } },
        };
      });
  }

  async unplanned(ctx: PlanContext): Promise<UnplannedOrderDto[]> {
    const codes = [
      ...new Set(
        ctx.draft.unplanned
          .map((u) => ctx.deferrals.get(u.orderId)?.reasonCode ?? u.reasonCode)
          .filter((c): c is string => Boolean(c)),
      ),
    ];
    const labels = codes.length
      ? await this.txHost.tx
          .select({ code: deferralReasons.code, label: deferralReasons.label })
          .from(deferralReasons)
          .where(inArray(deferralReasons.code, codes))
      : [];
    const label = new Map(labels.map((l) => [l.code, l.label]));

    return ctx.draft.unplanned
      .map((u) => {
        const order = ctx.orders.get(u.orderId);
        const deferral = ctx.deferrals.get(u.orderId);
        const reasonCode = deferral?.reasonCode ?? u.reasonCode;
        return {
          orderId: u.orderId,
          orderNo: order?.orderNo ?? '',
          outletId: order?.outletId ?? '',
          outletName: order
            ? (ctx.outlets.get(order.outletId)?.name ?? order.outletId)
            : '',
          brand: order?.brand ?? 'FRESH',
          districtId: order?.districtId ?? '',
          tempClass: order?.tempClass ?? 'AMBIENT',
          units: order?.units ?? 0,
          weightKg: order?.weightKg ?? 0,
          volumeM3: order?.volumeM3 ?? 0,
          priority: u.priority,
          repeatSkip: u.repeatSkip,
          reasonCode,
          reasonLabel: reasonCode
            ? (label.get(reasonCode) ?? reasonCode)
            : null,
          bindingRule: deferral?.bindingRule ?? u.bindingRule,
          choice: deferral?.choice ?? u.choice,
          deferralStatus: deferral?.status ?? null,
          deferralId: deferral?.id ?? null,
          note: deferral?.note ?? null,
          toDate: deferral?.toDate ?? null,
        };
      })
      .sort(
        (a, b) => b.priority - a.priority || a.orderNo.localeCompare(b.orderNo),
      );
  }
}
