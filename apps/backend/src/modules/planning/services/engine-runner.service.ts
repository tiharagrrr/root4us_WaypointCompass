import { createHash } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Transactional, TransactionHost } from '@nestjs-cls/transactional';
import {
  allocate,
  ENGINE_VERSION,
  type EngineInput,
  type EngineOutput,
} from '@waypoint/engine';
import type { Actor } from '@waypoint/shared';
import type { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import { PinoLogger } from 'nestjs-pino';
import { ClockService } from '../../../core/clock/clock.service';
import { jobContextOf } from '../../../core/context/job-context';
import type { AppClsStore } from '../../../core/context/request-context';
import {
  NotFoundError,
  StateConflictError,
} from '../../../core/errors/domain-errors';
import { OutboxService } from '../../../core/outbox/outbox.service';
import type { StampedDrizzleAdapter } from '../../../core/persistence/transactions';
import { deferrals, engineRuns, plans } from '../../../db/schema';
import { QUEUES } from '../../../queues';
import { AuditService } from '../../audit';
import {
  PLANNING_AUDIT,
  PLANNING_EVENTS,
  PLANNING_LOGS,
} from '../planning.constants';
import { DeferralService } from './deferral.service';
import { PlanContextBuilder } from './plan-context.builder';
import { PlanWriter } from './plan-writer';
import { PlansService } from './plans.service';

export type EngineRunRow = typeof engineRuns.$inferSelect;

/** What the worker needs to finish a run. */
export interface EngineRunJob {
  runId: string;
  keepLocked: boolean;
}

/**
 * Auto-suggest (05, 09). `start` records a RUNNING run and answers 202; the
 * worker's `complete` runs `allocate()` on the plan's context and writes the
 * trips, stops and PROPOSED deferrals in one transaction (AC-PLN-01, 09, 10).
 * A run that fails changes nothing but the run row (AC-PLN-11).
 */
@Injectable()
export class EngineRunner {
  constructor(
    private readonly txHost: TransactionHost<StampedDrizzleAdapter>,
    private readonly clock: ClockService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly plans: PlansService,
    private readonly contexts: PlanContextBuilder,
    private readonly writer: PlanWriter,
    private readonly deferralsService: DeferralService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly log: PinoLogger,
    @InjectQueue(QUEUES.allocation) private readonly queue: Queue,
  ) {
    this.log.setContext(EngineRunner.name);
  }

  @Transactional()
  async start(
    planId: string,
    version: number,
    input: { mode: 'AUTO_SUGGEST' | 'REPAIR'; keepLocked: boolean },
    actor: Actor,
  ): Promise<EngineRunRow> {
    if (input.mode === 'REPAIR')
      // Repair works on a published plan's unreleased trips (ROO-56).
      throw new StateConflictError(
        'Repair runs need a published plan; use AUTO_SUGGEST on a draft.',
      );
    const ctx = await this.plans.loadDraft(planId, version, actor);
    const [run] = await this.txHost.tx
      .insert(engineRuns)
      .values({
        planId: ctx.plan.id,
        mode: input.mode,
        engineVersion: ENGINE_VERSION,
        params: ctx.params,
        inputHash: inputHash(ctx.input),
        triggeredById: actor.id,
      })
      .returning();
    await this.queue.add(
      'run',
      {
        runId: run.id,
        keepLocked: input.keepLocked,
        _ctx: jobContextOf(this.cls),
      },
      { jobId: run.id, removeOnComplete: 100, removeOnFail: 100 },
    );
    return run;
  }

  /** In the worker: run the engine and save its plan. */
  @Transactional()
  async complete({ runId, keepLocked }: EngineRunJob): Promise<EngineRunRow> {
    const started = Date.now();
    const run = await this.runRow(runId);
    if (run.status !== 'RUNNING') return run;
    const [plan] = await this.txHost.tx
      .select()
      .from(plans)
      .where(eq(plans.id, run.planId))
      .for('update');
    if (!plan || plan.status !== 'DRAFT')
      throw new StateConflictError('The plan is no longer a draft.');

    const ctx = await this.contexts.build(plan);
    const input: EngineInput = {
      ...ctx.input,
      lockedTrips: ctx.draft.trips.filter((t) => t.locked && !t.reserved),
      reservedTrips: ctx.draft.trips.filter((t) => t.reserved),
    };
    const out = allocate(input, { keepLocked });
    await this.writer.save(ctx, out, { lockChanged: false });
    await this.writeProposals(
      ctx.plan.id,
      ctx.plan.date,
      run.id,
      out,
      ctx.deferrals,
    );

    const [done] = await this.txHost.tx
      .update(engineRuns)
      .set({
        status: 'SUCCEEDED',
        servedCount: out.stats.served,
        deferredCount: out.stats.deferred,
        stats: { ...out.stats, excluded: out.excluded },
        finishedAt: this.clock.realNow(),
      })
      .where(eq(engineRuns.id, run.id))
      .returning();
    const bumped = await this.plans.bump(plan);

    await this.audit.record({
      action: PLANNING_AUDIT.engineRunCompleted,
      entity: ['engine_run', run.id],
      after: {
        planId: plan.id,
        version: bumped.version,
        engineVersion: run.engineVersion,
        inputHash: run.inputHash,
        params: run.params,
        served: out.stats.served,
        deferred: out.stats.deferred,
      },
    });
    await this.outbox.add(
      PLANNING_EVENTS.engineRunCompleted,
      {
        v: 1,
        planId: plan.id,
        runId: run.id,
        served: out.stats.served,
        deferred: out.stats.deferred,
      },
      { aggregate: ['plan', plan.id], depotId: plan.depotId },
    );
    this.log.info(
      {
        event: PLANNING_AUDIT.engineRunCompleted,
        planId: plan.id,
        runId: run.id,
        served: out.stats.served,
        deferred: out.stats.deferred,
        excluded: out.excluded.length,
        ms: Date.now() - started,
        inputHash: run.inputHash,
      },
      'engine run completed',
    );
    return done;
  }

  /** In its own transaction after `complete` rolled back: the run failed, nothing else changed. */
  @Transactional()
  async fail(runId: string, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const [run] = await this.txHost.tx
      .update(engineRuns)
      .set({
        status: 'FAILED',
        error: message.slice(0, 1_000),
        finishedAt: this.clock.realNow(),
      })
      .where(and(eq(engineRuns.id, runId), eq(engineRuns.status, 'RUNNING')))
      .returning();
    if (!run) return;
    const [plan] = await this.txHost.tx
      .select({ depotId: plans.depotId })
      .from(plans)
      .where(eq(plans.id, run.planId));
    await this.outbox.add(
      PLANNING_EVENTS.engineRunFailed,
      { v: 1, planId: run.planId, runId: run.id },
      { aggregate: ['plan', run.planId], depotId: plan?.depotId ?? null },
    );
    this.log.warn(
      {
        event: PLANNING_LOGS.engineRunFailed,
        planId: run.planId,
        runId: run.id,
        err,
      },
      'engine run failed',
    );
  }

  /**
   * The engine's reasons for what it left off: earlier PROPOSED rows go, and
   * each unplanned order gets a new PROPOSED deferral with the reason code,
   * choice, binding rule and what was tried. An order the dispatcher has
   * already decided (CONFIRMED) keeps its decision.
   */
  private async writeProposals(
    planId: string,
    date: string,
    runId: string,
    out: EngineOutput,
    live: ReadonlyMap<string, typeof deferrals.$inferSelect>,
  ): Promise<void> {
    const tx = this.txHost.tx;
    await tx
      .update(deferrals)
      .set({ status: 'CANCELLED', updatedAt: this.clock.realNow() })
      .where(
        and(
          eq(deferrals.planId, planId),
          eq(deferrals.status, 'PROPOSED'),
          eq(deferrals.partial, false),
        ),
      );
    const rows: (typeof deferrals.$inferInsert)[] = [];
    for (const u of out.unplanned) {
      if (live.get(u.orderId)?.status === 'CONFIRMED' || !u.reasonCode)
        continue;
      rows.push({
        orderId: u.orderId,
        planId,
        engineRunId: runId,
        status: 'PROPOSED',
        source: 'ENGINE',
        reasonCode: u.reasonCode,
        choice: u.choice,
        bindingRule: u.bindingRule,
        reasonDetail: {
          ...(u.detail && { detail: u.detail }),
          ...(u.tried && { tried: u.tried }),
          ...(u.displacedBy && { displacedBy: u.displacedBy }),
        },
        priorityScore: u.priority,
        repeatSkip: u.repeatSkip,
        fromDate: date,
        toDate: await this.deferralsService.deferralDate(u.orderId, date),
      });
    }
    if (rows.length) await tx.insert(deferrals).values(rows);
  }

  private async runRow(id: string): Promise<EngineRunRow> {
    const [run] = await this.txHost.tx
      .select()
      .from(engineRuns)
      .where(eq(engineRuns.id, id));
    if (!run) throw new NotFoundError('engine run');
    return run;
  }
}

/** sha256 of the input as JSON with sorted keys, so equal inputs hash equally (AC-PLN-09). */
export function inputHash(input: EngineInput): string {
  return createHash('sha256').update(canonical(input)).digest('hex');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
