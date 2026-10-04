import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { Violation } from '@waypoint/engine';
import type { Actor } from '@waypoint/shared';
import { and, count, desc, eq } from 'drizzle-orm';
import { NotFoundError } from '../../../core/errors/domain-errors';
import type { Collection } from '../../../core/http/envelope.interceptor';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { engineRuns, planRevisions, plans, users } from '../../../db/schema';
import { parsePlanEdits } from '../domain/plan-edits';
import type {
  EngineRunDto,
  PlanRevisionDto,
  PublishPreviewDto,
  UnplannedOrderDto,
} from '../dto/plan-actions.dto';
import type {
  FixDto,
  OrderOptionDto,
  PlanContextDto,
  PlanVehicleOptionDto,
  ValidationResultDto,
} from '../dto/plan-engine.dto';
import type { PlanDto, TripDto } from '../dto/plan.dto';
import { PlanLinks } from '../policies/plan.links';
import { PlanScope } from '../policies/plan.scope';
import { ENGINE_VERSION } from '@waypoint/engine';
import {
  PlanContextBuilder,
  type PlanContext,
  type PlanRow,
} from './plan-context.builder';
import { PlanEngine } from './plan-engine';
import { PlanViews } from './plan.views';
import { PublishPolicy } from './publish.policy';

/** A whole list as one page, the way deferral reasons answer. */
function all<T>(items: T[], self: string): Collection<T> {
  return {
    items,
    page: { limit: items.length, offset: 0, total: items.length },
    links: { self: { href: self } },
  };
}

/**
 * Every read of a plan (05 to 18), always through `PlanScope` (out of scope
 * is 404, AC-PLN-32). The wizard reads run the engine over the plan's context
 * and save nothing (AC-PLN-12).
 */
@Injectable()
export class PlanQueries {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly scope: PlanScope,
    private readonly contexts: PlanContextBuilder,
    private readonly engine: PlanEngine,
    private readonly views: PlanViews,
    private readonly links: PlanLinks,
    private readonly publishing: PublishPolicy,
  ) {}

  /** The plan row, or 404 when it is missing or out of scope. */
  async row(id: string, actor: Actor): Promise<PlanRow> {
    const [row] = await this.txHost.tx
      .select()
      .from(plans)
      .where(and(eq(plans.id, id), this.scope.where(actor)));
    return this.scope.found(row);
  }

  async contextOf(id: string, actor: Actor): Promise<PlanContext> {
    return this.contexts.build(await this.row(id, actor));
  }

  /** The plan as 05, 09 and 17 read it, with its links. */
  async view(ctx: PlanContext, actor: Actor): Promise<PlanDto> {
    const check = await this.publishing.check(ctx);
    return this.views.plan(
      ctx,
      check.opensAt,
      this.links.links(ctx.plan, actor, check),
    );
  }

  async get(id: string, actor: Actor): Promise<PlanDto> {
    return this.view(await this.contextOf(id, actor), actor);
  }

  async trips(id: string, actor: Actor): Promise<Collection<TripDto>> {
    const ctx = await this.contextOf(id, actor);
    const violations = this.engine.validate(ctx.input, ctx.draft);
    return all(
      await this.views.trips(ctx, violations),
      `/api/v1/plans/${id}/trips`,
    );
  }

  /** One trip as its plan shows it, after 19b or 20 changed it. */
  async trip(planId: string, tripId: string, actor: Actor): Promise<TripDto> {
    const ctx = await this.contextOf(planId, actor);
    const violations = this.engine.validate(ctx.input, ctx.draft);
    const found = (await this.views.trips(ctx, violations)).find(
      (t) => t.id === tripId,
    );
    if (!found) throw new NotFoundError('trip');
    return found;
  }

  async context(id: string, actor: Actor): Promise<PlanContextDto> {
    const ctx = await this.contextOf(id, actor);
    return {
      planId: ctx.plan.id,
      version: ctx.plan.version,
      engineVersion: ENGINE_VERSION,
      input: ctx.input as unknown as Record<string, unknown>,
      plan: ctx.draft as unknown as Record<string, unknown>,
    };
  }

  async unplanned(
    id: string,
    actor: Actor,
  ): Promise<Collection<UnplannedOrderDto>> {
    const ctx = await this.contextOf(id, actor);
    return all(
      await this.views.unplanned(ctx),
      `/api/v1/plans/${id}/unplanned`,
    );
  }

  async revisions(
    id: string,
    actor: Actor,
  ): Promise<Collection<PlanRevisionDto>> {
    const plan = await this.row(id, actor);
    const rows = await this.txHost.tx
      .select()
      .from(planRevisions)
      .where(eq(planRevisions.planId, plan.id))
      .orderBy(desc(planRevisions.revision));
    return all(
      rows.map((r) => ({
        id: r.id,
        revision: r.revision,
        reasonCode: r.reasonCode,
        note: r.note,
        changes: r.changes,
        affectedTripIds: r.affectedTripIds,
        affectedOutletIds: r.affectedOutletIds,
        createdById: r.createdById,
        createdAt: r.createdAt.toISOString(),
      })),
      `/api/v1/plans/${id}/revisions`,
    );
  }

  async run(id: string, runId: string, actor: Actor): Promise<EngineRunDto> {
    const plan = await this.row(id, actor);
    const [run] = await this.txHost.tx
      .select()
      .from(engineRuns)
      .where(and(eq(engineRuns.id, runId), eq(engineRuns.planId, plan.id)));
    if (!run) throw new NotFoundError('engine run');
    return toRunDto(run);
  }

  async vehicleOptions(
    id: string,
    actor: Actor,
  ): Promise<Collection<PlanVehicleOptionDto>> {
    const ctx = await this.contextOf(id, actor);
    const options = this.engine
      .vehicleOptions(ctx.input, ctx.draft)
      .map((o) => {
        const v = ctx.vehicles.get(o.vehicleId);
        return {
          ...o,
          type: v?.type ?? 'TRUCK',
          temp: v?.temp ?? 'AMBIENT',
          weeklyFuelQuotaL: v?.weeklyFuelQuotaL ?? 0,
        };
      });
    return all(options, `/api/v1/plans/${id}/vehicle-options`);
  }

  async orderOptions(
    id: string,
    target: { vehicleId: string; tripNo: number; selected?: string[] },
    actor: Actor,
  ): Promise<Collection<OrderOptionDto>> {
    const ctx = await this.contextOf(id, actor);
    const options = this.engine.optionsForTrip(ctx.input, ctx.draft, {
      vehicleId: target.vehicleId,
      tripNo: target.tripNo,
      selectedOrderIds: target.selected ?? [],
    });
    return all(
      options as OrderOptionDto[],
      `/api/v1/plans/${id}/order-options`,
    );
  }

  async validate(
    id: string,
    ops: readonly unknown[] | undefined,
    actor: Actor,
  ): Promise<ValidationResultDto> {
    const ctx = await this.contextOf(id, actor);
    if (!ops?.length) {
      const violations = this.engine.validate(ctx.input, ctx.draft);
      return { violations, introduced: [] };
    }
    const { engine } = parsePlanEdits(ops);
    const result = this.engine.applyEdits(ctx.input, ctx.draft, engine);
    return {
      violations: result.violations,
      introduced: result.introduced,
    };
  }

  async suggestFixes(
    id: string,
    violation: Violation,
    ops: readonly unknown[] | undefined,
    actor: Actor,
  ): Promise<Collection<FixDto>> {
    const ctx = await this.contextOf(id, actor);
    let plan = ctx.draft;
    if (ops?.length)
      plan = this.engine.applyEdits(
        ctx.input,
        plan,
        parsePlanEdits(ops).engine,
      ).plan;
    const fixes = this.engine.suggestFixes(ctx.input, plan, violation);
    return all(
      fixes.map((f) => ({ ...f, edits: f.edits })) as FixDto[],
      `/api/v1/plans/${id}/suggest-fixes`,
    );
  }

  async publishPreview(id: string, actor: Actor): Promise<PublishPreviewDto> {
    const ctx = await this.contextOf(id, actor);
    const check = await this.publishing.check(ctx);
    const tripIds = [...ctx.tripsByKey.values()].map((t) => t.id);
    const drivers = new Set(
      [...ctx.tripsByKey.values()].map((t) => t.driverId).filter(Boolean),
    );
    const stores = new Set([
      ...[...ctx.stopsByTrip.values()].flat().map((s) => s.outletId),
      ...ctx.draft.unplanned
        .map((u) => ctx.orders.get(u.orderId)?.outletId)
        .filter(Boolean),
    ]);
    const self = `/api/v1/plans/${id}`;
    const links = this.links.links(ctx.plan, actor, check);
    return {
      opensAt: check.opensAt.toISOString(),
      open: check.open,
      blockers: check.blockers,
      notify: {
        // Every loader at the depot hears about a published plan.
        loaders: tripIds.length ? await this.loadersAt(ctx.plan.depotId) : 0,
        drivers: drivers.size,
        stores: stores.size,
      },
      _links: {
        self: { href: `${self}/publish-preview` },
        ...(links.publish && { publish: links.publish }),
      },
    };
  }

  private async loadersAt(depotId: string): Promise<number> {
    const [row] = await this.txHost.tx
      .select({ n: count() })
      .from(users)
      .where(and(eq(users.role, 'loader'), eq(users.depotId, depotId)));
    return row?.n ?? 0;
  }
}

export function toRunDto(run: typeof engineRuns.$inferSelect): EngineRunDto {
  return {
    id: run.id,
    planId: run.planId,
    mode: run.mode,
    status: run.status,
    engineVersion: run.engineVersion,
    inputHash: run.inputHash,
    servedCount: run.servedCount,
    deferredCount: run.deferredCount,
    stats: run.stats ?? null,
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
    _links: {
      self: { href: `/api/v1/plans/${run.planId}/engine-runs/${run.id}` },
    },
  };
}
