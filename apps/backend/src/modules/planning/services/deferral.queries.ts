import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Actor } from '@waypoint/shared';
import { inArray } from 'drizzle-orm';
import { CrudQueryService } from '../../../core/persistence/crud-query.service';
import type { ListQuery, Page } from '../../../core/persistence/page';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { deferralReasons, orders, outlets, plans } from '../../../db/schema';
import { DEFERRAL_RESOURCE } from '../deferral.resource';
import type { DeferralDto } from '../dto/deferral.dto';
import { DeferralScope } from '../policies/deferral.scope';
import type { DeferralRow } from './deferral.service';

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
      .select({ id: outlets.id, name: outlets.name })
      .from(outlets)
      .where(
        inArray(outlets.id, [...new Set(orderRows.map((o) => o.outletId))]),
      );
    const outletName = new Map(outletRows.map((o) => [o.id, o.name]));
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

    const engineFacts = actor.role !== 'store_manager';
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
        outletName: outletName.get(order?.outletId ?? '') ?? '',
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
        decidedAt: r.decidedAt?.toISOString() ?? null,
        choice: engineFacts ? r.choice : null,
        bindingRule: engineFacts ? r.bindingRule : null,
        priorityScore: engineFacts ? r.priorityScore : null,
        createdAt: r.createdAt.toISOString(),
        depotId: plan?.depotId ?? '',
        planStatus: plan?.status ?? '',
      };
    });
  }
}
