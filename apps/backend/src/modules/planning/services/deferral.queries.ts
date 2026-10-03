import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { addDays } from '@waypoint/shared';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import { CrudQueryService } from '../../../core/persistence/crud-query.service';
import type { ListQuery, Page } from '../../../core/persistence/page';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import {
  deferralReasons,
  deferrals,
  orders,
  outlets,
  plans,
  users,
} from '../../../db/schema';
import { DEFERRAL_RESOURCE } from '../deferral.resource';
import type { DeferralDto } from '../dto/deferral.dto';
import { DeferralScope } from '../policies/deferral.scope';
import type { DeferralRow } from './deferral.service';

interface SkipCounts {
  skips30d: number;
  recentSkips: number;
  recentRuns: number;
}

const eqOrder = eq(orders.id, deferrals.orderId);

/** A deferral as the API shows it, plus what the links and rules look at. */
export interface DeferralView extends Omit<DeferralDto, '_links'> {
  depotId: string;
  planStatus: string;
}

/**
 * Reads of deferrals (23, M4, M7), always through `DeferralScope`. A store
 * manager reads the reason in the store's words and the dispatcher's note;
 * the engine's numbers (`choice`, `bindingRule`, `priorityScore`) are left
 * out for them (AC-PLN-16).
 */
@Injectable()
export class DeferralQueries {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly crud: CrudQueryService,
    private readonly scope: DeferralScope,
  ) {}

  async list(query: ListQuery, actor: Actor): Promise<Page<DeferralView>> {
    const page = await this.crud.list<DeferralRow>(
      DEFERRAL_RESOURCE,
      query,
      this.scope.where(actor),
    );
    return { ...page, items: await this.views(page.items, actor) };
  }

  /** One deferral, or 404 when it is missing or outside the caller's scope. */
  async get(id: string, actor: Actor): Promise<DeferralView> {
    const row = await this.crud.get<DeferralRow>(
      DEFERRAL_RESOURCE,
      id,
      this.scope.where(actor),
    );
    const [view] = await this.views([row], actor);
    return view;
  }

  /** Each row with its order, outlet, reason and plan, in four reads for the page. */
  private async views(
    rows: DeferralRow[],
    actor: Actor,
  ): Promise<DeferralView[]> {
    if (!rows.length) return [];
    const tx = this.txHost.tx;
    const orderRows = await tx
      .select({
        id: orders.id,
        orderNo: orders.orderNo,
        status: orders.status,
        outletId: orders.outletId,
      })
      .from(orders)
      .where(inArray(orders.id, [...new Set(rows.map((r) => r.orderId))]));
    const orderOf = new Map(orderRows.map((o) => [o.id, o]));
    const outletRows = await tx
      .select({ id: outlets.id, name: outlets.name, brand: outlets.brand })
      .from(outlets)
      .where(
        inArray(outlets.id, [...new Set(orderRows.map((o) => o.outletId))]),
      );
    const outletOf = new Map(outletRows.map((o) => [o.id, o]));
    const reasonRows = await tx
      .select()
      .from(deferralReasons)
      .where(
        inArray(deferralReasons.code, [
          ...new Set(rows.map((r) => r.reasonCode)),
        ]),
      );
    const reasonOf = new Map(reasonRows.map((r) => [r.code, r]));
    const planRows = await tx
      .select({ id: plans.id, depotId: plans.depotId, status: plans.status })
      .from(plans)
      .where(inArray(plans.id, [...new Set(rows.map((r) => r.planId))]));
    const planOf = new Map(planRows.map((p) => [p.id, p]));
    const deciders = [
      ...new Set(
        rows.flatMap((r) =>
          [r.decidedById, r.storeRespondedById].filter(
            (id): id is string => id !== null,
          ),
        ),
      ),
    ];
    const nameOf = new Map(
      deciders.length
        ? (
            await tx
              .select({ id: users.id, name: users.name })
              .from(users)
              .where(inArray(users.id, deciders))
          ).map((u) => [u.id, u.name])
        : [],
    );

    const engineFacts = actor.role !== 'store_manager';
    const skips = engineFacts
      ? await this.skipCounts(
          rows.map((r) => ({
            id: r.id,
            outletId: orderOf.get(r.orderId)?.outletId ?? '',
            depotId: planOf.get(r.planId)?.depotId ?? '',
            fromDate: r.fromDate,
          })),
        )
      : new Map<string, SkipCounts>();
    return rows.map((r) => {
      const order = orderOf.get(r.orderId);
      const reason = reasonOf.get(r.reasonCode);
      const plan = planOf.get(r.planId);
      return {
        id: r.id,
        orderId: r.orderId,
        orderNo: order?.orderNo ?? '',
        orderStatus: order?.status ?? '',
        outletId: order?.outletId ?? '',
        outletName: outletOf.get(order?.outletId ?? '')?.name ?? '',
        outletBrand: outletOf.get(order?.outletId ?? '')?.brand ?? '',
        planId: r.planId,
        status: r.status,
        source: r.source,
        reasonCode: r.reasonCode,
        reasonLabel: reason?.label ?? r.reasonCode,
        reasonText: reason?.description ?? null,
        note: r.note,
        fromDate: r.fromDate,
        toDate: r.toDate,
        repeatSkip: r.repeatSkip,
        partial: r.partial,
        storeResponse: r.storeResponse,
        storeNote: r.storeNote,
        storeRespondedAt: r.storeRespondedAt?.toISOString() ?? null,
        storeRespondedByName: r.storeRespondedById
          ? (nameOf.get(r.storeRespondedById) ?? null)
          : null,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        decidedByName: r.decidedById
          ? (nameOf.get(r.decidedById) ?? null)
          : null,
        dispatcherReply: r.dispatcherReply,
        dispatcherRepliedAt: r.dispatcherRepliedAt?.toISOString() ?? null,
        skips30d: skips.get(r.id)?.skips30d ?? null,
        recentSkips: skips.get(r.id)?.recentSkips ?? null,
        recentRuns: skips.get(r.id)?.recentRuns ?? null,
        choice: engineFacts ? r.choice : null,
        bindingRule: engineFacts ? r.bindingRule : null,
        priorityScore: engineFacts ? r.priorityScore : null,
        createdAt: r.createdAt.toISOString(),
        depotId: plan?.depotId ?? '',
        planStatus: plan?.status ?? '',
      };
    });
  }

  /**
   * How often each row's outlet has been skipped (23): its live deferrals in the 30 days up to
   * this one, and on how many of the depot's last five plans up to this one it was deferred.
   * Two reads for the whole page.
   */
  private async skipCounts(
    rows: { id: string; outletId: string; depotId: string; fromDate: string }[],
  ): Promise<Map<string, SkipCounts>> {
    const counts = new Map<string, SkipCounts>();
    if (!rows.length) return counts;
    const tx = this.txHost.tx;
    const latest = rows.reduce(
      (d, r) => (r.fromDate > d ? r.fromDate : d),
      rows[0].fromDate,
    );
    const earliest = addDays(
      rows.reduce((d, r) => (r.fromDate < d ? r.fromDate : d), latest),
      -60,
    );
    const live = await tx
      .select({
        outletId: orders.outletId,
        planId: deferrals.planId,
        fromDate: deferrals.fromDate,
      })
      .from(deferrals)
      .innerJoin(orders, eqOrder)
      .where(
        and(
          inArray(orders.outletId, [...new Set(rows.map((r) => r.outletId))]),
          inArray(deferrals.status, ['PROPOSED', 'CONFIRMED']),
          gte(deferrals.fromDate, earliest),
          lte(deferrals.fromDate, latest),
        ),
      );
    const runs = await tx
      .select({ id: plans.id, depotId: plans.depotId, date: plans.date })
      .from(plans)
      .where(
        and(
          inArray(plans.depotId, [...new Set(rows.map((r) => r.depotId))]),
          gte(plans.date, earliest),
          lte(plans.date, latest),
        ),
      );
    for (const r of rows) {
      const mine = live.filter((d) => d.outletId === r.outletId);
      const last5 = runs
        .filter((p) => p.depotId === r.depotId && p.date <= r.fromDate)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 5);
      const skippedOn = new Set(mine.map((d) => d.planId));
      counts.set(r.id, {
        skips30d: mine.filter(
          (d) =>
            d.fromDate <= r.fromDate && d.fromDate > addDays(r.fromDate, -30),
        ).length,
        recentSkips: last5.filter((p) => skippedOn.has(p.id)).length,
        recentRuns: last5.length,
      });
    }
    return counts;
  }
}
